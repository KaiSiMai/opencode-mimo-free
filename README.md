# opencode-mimo-free

小米 MiMo 免费匿名通道插件 for [opencode](https://opencode.ai)。零配置接入 MiMo API，支持 1M 上下文窗口，免费。

## 安装

在 `opencode.json` 中添加：

```json
{
  "plugin": ["mimo-free@git+https://github.com/KaiSiMai/opencode-mimo-free.git"]
}
```

重启 opencode，启动时自动安装。

## 使用

无需登录。安装后，MiMo 的模型即可在 opencode 模型列表中使用。

插件全自动处理：
- 匿名 bootstrap（JWT 获取）
- 稳定机器指纹（兼容官方 `@mimo-ai/cli` 协议）
- Token 刷新 + 缓存
- 401/403 自动重试

## 协议

本插件逆向自官方 MiMo CLI 二进制：
- `POST /api/free-ai/bootstrap` — 匿名 bootstrap，传入机器指纹，返回 JWT
- `POST /api/free-ai/openai/chat` — OpenAI 兼容的聊天补全接口
- `X-Mimo-Source: mimocode-cli-free` — 来源标识头
- 网关拒绝含 "opencode" 的 system 消息；system prompt 会自动替换为 "MiMoCode"

## License

MIT
