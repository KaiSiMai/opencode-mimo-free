# opencode-mimo-free

Xiaomi MiMo free anonymous channel plugin for [opencode](https://opencode.ai). Zero-config access to MiMo API with 1M context window, free.

## Install

Add to `opencode.json`:

```json
{
  "plugin": ["mimo-free@git+https://github.com/KaiSiMai/opencode-mimo-free.git"]
}
```

Restart opencode — installs automatically on startup.

## Usage

No login needed. After install, MiMo models become available in opencode's model list.

The plugin handles everything automatically:
- Anonymous bootstrap (JWT acquisition)
- Stable machine fingerprint (compatible with official `@mimo-ai/cli` protocol)
- Token refresh with caching
- 401/403 auto-retry

## Protocol

Reverse-engineered from the official MiMo CLI binary:
- `POST /api/free-ai/bootstrap` — anonymous bootstrap with machine fingerprint, returns JWT
- `POST /api/free-ai/openai/chat` — OpenAI-compatible chat completions
- `X-Mimo-Source: mimocode-cli-free` — source header
- Gateway rejects system messages containing "opencode"; system prompt rewritten to use "MiMoCode"

## License

MIT
