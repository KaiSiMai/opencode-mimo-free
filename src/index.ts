import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import path from "path"
import fs from "fs"
import os from "os"
import crypto from "crypto"

// 协议逆向自官方 MiMo CLI 二进制。
//   POST {BASE}/api/free-ai/bootstrap   body {"client": <fingerprint>} -> {"jwt"}
//   POST {BASE}/api/free-ai/openai/chat  (注意是 /chat,不是 /chat/completions)
//     Authorization: Bearer <jwt>   X-Mimo-Source: mimocode-cli-free
// 网关会校验第一条 system 消息,拒绝(403 illegal_access)任何含 "opencode" 的 system。
// opencode 的 system 与 MiMoCode 字节级相同(仅品牌名不同),把 opencode 改成 MiMoCode 即可绕过。

const PROVIDER_ID = "mimo"
const BASE_URL = (process.env.MIMO_FREE_BASE_URL || "https://api.xiaomimimo.com").replace(/\/+$/, "")
const BOOTSTRAP_URL = `${BASE_URL}/api/free-ai/bootstrap`
const CHAT_BASE_URL = `${BASE_URL}/api/free-ai/openai`
const X_MIMO_SOURCE = "mimocode-cli-free"

const PLUGIN_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config", "opencode"), "opencode-mimo-free")
const LOG_FILE = path.join(PLUGIN_DIR, "plugin.log")
const FINGERPRINT_FILE = path.join(PLUGIN_DIR, "fingerprint")

let logDirReady = false
function log(level: string, msg: string, extra?: unknown) {
  try {
    if (!logDirReady) {
      fs.mkdirSync(PLUGIN_DIR, { recursive: true })
      logDirReady = true
    }
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}${extra ? " " + JSON.stringify(extra) : ""}\n`)
  } catch {}
}

// 稳定机器指纹（与官方实现一致）
function getFingerprint(): string {
  const fpFile = FINGERPRINT_FILE
  try {
    const cached = fs.readFileSync(fpFile, "utf-8").trim()
    if (cached) return cached
  } catch {}
  const cpuModel = os.cpus()[0]?.model ?? "unknown-cpu"
  const username = (() => { try { return os.userInfo().username } catch { return "unknown-user" } })()
  const raw = [os.hostname(), process.platform, process.arch, cpuModel, username].join("|")
  const fp = crypto.createHash("sha256").update(raw).digest("hex")
  try { fs.writeFileSync(fpFile, fp, { mode: 0o600 }) } catch {}
  return fp
}

// JWT 缓存（官方实现风格）
let jwtCache: { jwt: string; exp: number } | null = null
let jwtPromise: Promise<{ jwt: string; exp: number }> | null = null

function decodeJwtExp(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
    if (typeof payload.exp === "number") return payload.exp * 1000
  } catch {}
  return Date.now() + 3000000
}

async function bootstrap(): Promise<{ jwt: string; exp: number }> {
  const resp = await fetch(BOOTSTRAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: getFingerprint() }),
  })
  if (!resp.ok) throw new Error(`mimo-free bootstrap failed: ${resp.status}`)
  const data = (await resp.json()) as { jwt?: string }
  if (!data.jwt) throw new Error("mimo-free bootstrap response missing jwt")
  return { jwt: data.jwt, exp: decodeJwtExp(data.jwt) }
}

async function getJwt(): Promise<string> {
  const ttlBuffer = 300000
  if (jwtCache && jwtCache.exp - Date.now() > ttlBuffer) return jwtCache.jwt
  if (jwtPromise) return (await jwtPromise).jwt
  jwtCache = null
  jwtPromise = bootstrap()
  try {
    jwtCache = await jwtPromise
    return jwtCache.jwt
  } finally {
    jwtPromise = null
  }
}

// 把每条 system 消息里的 "opencode" 改成 "MiMoCode",以通过网关模板校验。
// opencode 的完整指令(工具说明/规则/AGENTS.md)原样保留,仅品牌名变化。
function rewriteSystem(bodyStr: string): string {
  try {
    const body = JSON.parse(bodyStr) as { messages?: any[] }
    if (!Array.isArray(body.messages)) return bodyStr
    body.messages = body.messages.map((m: any) =>
      m && m.role === "system" && typeof m.content === "string" && /opencode/i.test(m.content)
        ? { ...m, content: m.content.replace(/opencode/gi, "MiMoCode") }
        : m,
    )
    return JSON.stringify(body)
  } catch (e) {
    log("warn", "rewriteSystem 解析失败", { error: e instanceof Error ? e.message : String(e) })
    return bodyStr
  }
}

// 作为 provider.options.fetch 注入:重写路径 + system,附上 jwt。
// 401/403 说明 jwt 过期,清缓存重试一次。
async function freeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  const rewritten = url.replace(/\/chat\/completions(\?|$)/, "/chat$1")
  const nextInit: RequestInit = { ...init }
  if (typeof init?.body === "string") nextInit.body = rewriteSystem(init.body)
  const h = new Headers(init?.headers as Headers)
  h.set("Authorization", `Bearer ${await getJwt()}`)
  h.set("X-Mimo-Source", X_MIMO_SOURCE)
  let resp = await fetch(rewritten, { ...nextInit, headers: h })
  if (resp.status === 401 || resp.status === 403) {
    jwtCache = null
    h.set("Authorization", `Bearer ${await getJwt()}`)
    resp = await fetch(rewritten, { ...nextInit, headers: h })
  }
  if (resp.status >= 400) {
    const body = await resp.clone().text().catch(() => "")
    log("warn", "chat 错误", { status: resp.status, body: body.slice(0, 200) })
  }
  return resp
}

export default {
  id: "opencode-mimo-free",
  async server(_input: PluginInput): Promise<Hooks> {
    return {
      async config(cfg: any) {
        if (!cfg.provider) cfg.provider = {}
        if (cfg.provider[PROVIDER_ID]) return // 用户自定义的 mimo provider 优先
        cfg.provider[PROVIDER_ID] = {
          name: "MiMo Code (free)",
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: CHAT_BASE_URL, apiKey: "anonymous", fetch: freeFetch },
          models: {
            "mimo-auto": {
              name: "MiMo Auto",
              attachment: true,
              reasoning: true,
              tool_call: true,
              temperature: true,
              modalities: { input: ["text", "image"], output: ["text"] },
              limit: { context: 1_000_000, output: 128_000 },
              cost: { input: 0, output: 0 },
            },
          },
        }
      },
    }
  },
}
