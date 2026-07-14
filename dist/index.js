// @bun
// src/index.ts
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
var PROVIDER_ID = "mimo";
var BASE_URL = (process.env.MIMO_FREE_BASE_URL || "https://api.xiaomimimo.com").replace(/\/+$/, "");
var BOOTSTRAP_URL = `${BASE_URL}/api/free-ai/bootstrap`;
var CHAT_BASE_URL = `${BASE_URL}/api/free-ai/openai`;
var X_MIMO_SOURCE = "mimocode-cli-free";
var PLUGIN_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config", "opencode"), "opencode-mimo-free");
var LOG_FILE = path.join(PLUGIN_DIR, "plugin.log");
var FINGERPRINT_FILE = path.join(PLUGIN_DIR, "fingerprint");
var logDirReady = false;
function log(level, msg, extra) {
  try {
    if (!logDirReady) {
      fs.mkdirSync(PLUGIN_DIR, { recursive: true });
      logDirReady = true;
    }
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}${extra ? " " + JSON.stringify(extra) : ""}
`);
  } catch {}
}
function getFingerprint() {
  const fpFile = FINGERPRINT_FILE;
  try {
    const cached = fs.readFileSync(fpFile, "utf-8").trim();
    if (cached)
      return cached;
  } catch {}
  const cpuModel = os.cpus()[0]?.model ?? "unknown-cpu";
  const username = (() => {
    try {
      return os.userInfo().username;
    } catch {
      return "unknown-user";
    }
  })();
  const raw = [os.hostname(), process.platform, process.arch, cpuModel, username].join("|");
  const fp = crypto.createHash("sha256").update(raw).digest("hex");
  try {
    fs.writeFileSync(fpFile, fp, { mode: 384 });
  } catch {}
  return fp;
}
var jwtCache = null;
var jwtPromise = null;
function decodeJwtExp(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    if (typeof payload.exp === "number")
      return payload.exp * 1000;
  } catch {}
  return Date.now() + 3000000;
}
async function bootstrap() {
  const resp = await fetch(BOOTSTRAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: getFingerprint() })
  });
  if (!resp.ok)
    throw new Error(`mimo-free bootstrap failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.jwt)
    throw new Error("mimo-free bootstrap response missing jwt");
  return { jwt: data.jwt, exp: decodeJwtExp(data.jwt) };
}
async function getJwt() {
  const ttlBuffer = 300000;
  if (jwtCache && jwtCache.exp - Date.now() > ttlBuffer)
    return jwtCache.jwt;
  if (jwtPromise)
    return (await jwtPromise).jwt;
  jwtCache = null;
  jwtPromise = bootstrap();
  try {
    jwtCache = await jwtPromise;
    return jwtCache.jwt;
  } finally {
    jwtPromise = null;
  }
}
function rewriteSystem(bodyStr) {
  try {
    const body = JSON.parse(bodyStr);
    if (!Array.isArray(body.messages))
      return bodyStr;
    body.messages = body.messages.map((m) => m && m.role === "system" && typeof m.content === "string" && /opencode/i.test(m.content) ? { ...m, content: m.content.replace(/opencode/gi, "MiMoCode") } : m);
    return JSON.stringify(body);
  } catch (e) {
    log("warn", "rewriteSystem \u89E3\u6790\u5931\u8D25", { error: e instanceof Error ? e.message : String(e) });
    return bodyStr;
  }
}
async function freeFetch(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const rewritten = url.replace(/\/chat\/completions(\?|$)/, "/chat$1");
  const nextInit = { ...init };
  if (typeof init?.body === "string")
    nextInit.body = rewriteSystem(init.body);
  const h = new Headers(init?.headers);
  h.set("Authorization", `Bearer ${await getJwt()}`);
  h.set("X-Mimo-Source", X_MIMO_SOURCE);
  let resp = await fetch(rewritten, { ...nextInit, headers: h });
  if (resp.status === 401 || resp.status === 403) {
    jwtCache = null;
    h.set("Authorization", `Bearer ${await getJwt()}`);
    resp = await fetch(rewritten, { ...nextInit, headers: h });
  }
  if (resp.status >= 400) {
    const body = await resp.clone().text().catch(() => "");
    log("warn", "chat \u9519\u8BEF", { status: resp.status, body: body.slice(0, 200) });
  }
  return resp;
}
var src_default = {
  id: "opencode-mimo-free",
  async server(_input) {
    return {
      async config(cfg) {
        if (!cfg.provider)
          cfg.provider = {};
        if (cfg.provider[PROVIDER_ID])
          return;
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
              limit: { context: 1e6, output: 128000 },
              cost: { input: 0, output: 0 }
            }
          }
        };
      }
    };
  }
};
export {
  src_default as default
};
