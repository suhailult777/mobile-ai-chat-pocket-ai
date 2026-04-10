# Ollama Mobile

![Expo SDK](https://img.shields.io/badge/Expo-SDK%2054-000000?logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React%20Native-0.81-61dafb?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Android%20first-3ddc84?logo=android&logoColor=white)

Mobile chat app for local/near-local LLM workflows with two execution paths:

- NVIDIA Proxy mode (works in Expo Go): device -> local proxy -> NVIDIA NIM
- Native mode (dev client/EAS): on-device GGUF inference via llama.rn

This repository is optimized for low-latency streaming UX, resilient model fallback, and production-oriented error handling.

## Table of Contents

- [Why This Project](#why-this-project)
- [Recent Updates](#recent-updates)
- [Architecture](#architecture)
- [Execution Modes](#execution-modes)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Agent Mode](#agent-mode)
- [ZeroClaw Gateway](#zeroclaw-gateway)
- [Turbo Mode Native](#turbo-mode-native)
- [Proxy API](#proxy-api)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Security and Privacy](#security-and-privacy)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Why This Project

Ollama Mobile is designed for practical mobile AI chat with a clean separation between UI and inference backend:

- Fast iteration in Expo Go for proxy-based usage
- Native path for on-device inference when a dev client is available
- Streaming-first UX with token batching, thinking indicators, and haptics
- Robust fallback behavior and diagnostics for unstable model/network conditions

## Recent Updates

Latest codebase changes include:

- Added NVIDIA proxy server path with SSE streaming and model fallback chain
- Added Agent Mode with tool flow (`web_search`, `fetch_page`) and streaming heartbeats
- Added timeout/error hardening in proxy client and server forwarding
- Added native tool-execution scaffold in on-device mode
- Added speculative decoding controls (Turbo Mode + draft model) in settings
- Improved chat UX performance via FlashList and buffered streaming updates

## Architecture

High-level runtime flow:

1. UI captures prompt and builds truncated message history.
2. `providerRouter` selects backend by mode (`nvidia-proxy` or `native`).
3. Streamed tokens are appended through `useStreamingText` batching.
4. On completion/error, final assistant content is committed to message state.

Core components:

- `src/screens/ChatScreen.tsx`: chat UX, streaming state, prewarm lifecycle, haptics
- `src/screens/SettingsScreen.tsx`: connection/model settings, mode switch, GGUF import
- `src/lib/providerRouter.ts`: single routing boundary for ping/models/stream/prewarm/dispose
- `src/lib/nvidiaProxyClient.ts`: XHR SSE parser for `/v1/chat/completions`
- `src/lib/nativeClient.ts`: llama.rn adapter, context cache, optional speculative decoding
- `src/context/SettingsContext.tsx`: persistent settings via `expo-secure-store`
- `server/index.js`: NVIDIA proxy, agent tooling, fallback model orchestration

## Execution Modes

### 1) NVIDIA Proxy Mode (default)

Use this when running in Expo Go or when you want centralized API key management.

- App talks to your local proxy (`host:port`, default `127.0.0.1:8787`)
- Proxy calls NVIDIA NIM `/v1/chat/completions`
- Streaming is forwarded to app with metadata headers:
  - `x-model-requested`
  - `x-model-selected`
  - `x-model-fallback-used`

### 2) Native Mode

Use this for on-device GGUF inference in dev client builds.

- Requires dev client/EAS build (Expo Go cannot load native llama modules)
- Model path should be a `file://` URI (imported in app storage)
- Includes context prewarm/caching and optional Turbo Mode with draft model

## Quick Start

### Prerequisites

- Bun 1.3.11+
- Expo tooling
- NVIDIA API key (for proxy mode)
- Android device/emulator (primary target)

### 1) Install dependencies

```powershell
bun install
bun run proxy:install
```

### 2) Configure proxy server

```powershell
copy server/.env.example server/.env
```

Set at least:

- `NVIDIA_API_KEY=...`

Then start proxy:

```powershell
bun run proxy:start
```

### 3) Start app

Expo Go path:

```powershell
bun run start
```

Native dev client path:

```powershell
bunx eas build --profile development --platform android
bun run start:dev
```

### 4) Configure app settings

In Settings tab:

1. Set mode to `NVIDIA Proxy` or `Native`
2. Set host/port (proxy mode usually `127.0.0.1:8787` on same machine)
3. Select model
4. Test connection
5. Start chatting

## Running the Project Locally

To test the entire end-to-end ZeroClaw remote execution and AI chatting flow locally, follow these steps to start all three required servers:

### 1. Start the ZeroClaw Gateway

The ZeroClaw gateway is required to execute local terminal commands securely on your computer.

1. Open a new terminal.
2. Run the gateway startup script:
   ```powershell
   cd D:\pocket-claw\mobile-ai-chat-pocket-ai
   .\server\zeroclaw-gateway.ps1
   ```
3. To pair the AI proxy to the gateway, generate a new pairing code by running this command in a separate terminal window:
   ```powershell
   zeroclaw gateway get-paircode --new
   ```
   _(Take note of the 6-digit code for the mobile app's pairing screen if required)._

### 2. Start the NVIDIA Proxy Server

The Node.js proxy server sits between your mobile app and the NVIDIA models. It parses shell executions, intercepts `<tool_calls>`, and runs them locally through the gateway.

1. Open a new terminal.
2. Ensure you have your `NVIDIA_API_KEY` set in `server/.env`.
3. Start the proxy:
   ```powershell
   cd D:\pocket-claw\mobile-ai-chat-pocket-ai
   bun run proxy:start
   ```
   _The proxy will listen on `http://0.0.0.0:8787`._

### 3. Start the Expo Mobile App

The Expo server bundles and serves the React Native mobile application to your physical device or emulator.

1. Open a new terminal.
2. Run the Expo start command:
   ```powershell
   cd D:\pocket-claw\mobile-ai-chat-pocket-ai
   bun run start -- --go --host lan --port 8081 --offline
   ```
   _Note: Using `--offline` and `--go` prevents Expo from requiring an internet connection to the Expo servers and speeds up local LAN bundling._
3. Open the "Expo Go" app on your iOS or Android device and scan the QR code that appears in the terminal.

### Connecting the App

Once the app is open on your phone:

1. Go to the **Settings** tab.
2. Under "Mode", select **NVIDIA Proxy**.
3. Under "Proxy Host", enter your computer's local IP address (e.g., `192.168.x.x`). Keep the port as `8787`.
4. Run a command in the chat to test it: `Run this on my computer via zeroclaw_webhook and return output only: Get-Location`

---

## Configuration

### App Settings (persisted in SecureStore)

| Key                     | Type    | Default                          | Notes                              |
| ----------------------- | ------- | -------------------------------- | ---------------------------------- |
| `host`                  | string  | `127.0.0.1`                      | Proxy host for `nvidia-proxy` mode |
| `port`                  | string  | `8787`                           | Proxy port                         |
| `model`                 | string  | `nvidia/nemotron-3-nano-30b-a3b` | Model ID or `file://` GGUF path    |
| `mode`                  | enum    | `nvidia-proxy`                   | `nvidia-proxy` or `native`         |
| `agentMode`             | boolean | `true`                           | Enables tool workflow support      |
| `zeroClawEnabled`       | boolean | `false`                          | Enables ZeroClaw webhook tools     |
| `zeroClawGatewayUrl`    | string  | `http://127.0.0.1:3000`          | ZeroClaw gateway base URL          |
| `zeroClawToken`         | string  | ``                               | ZeroClaw bearer token from pairing |
| `zeroClawWebhookSecret` | string  | ``                               | Optional webhook secret            |
| `turboMode`             | boolean | `false`                          | Native-only speculative mode       |
| `draftModel`            | string  | ``                               | `file://` draft GGUF path          |

### Proxy Environment Variables

`server/.env.example` includes required basics. Additional optional vars are supported in code.

| Variable                  | Required | Default                                    | Purpose                                         |
| ------------------------- | -------- | ------------------------------------------ | ----------------------------------------------- |
| `NVIDIA_API_KEY`          | Yes      | -                                          | Auth for NVIDIA NIM                             |
| `PORT`                    | No       | `8787`                                     | Proxy listener port                             |
| `ALLOWED_ORIGIN`          | No       | `*`                                        | CORS origin                                     |
| `NVIDIA_BASE_URL`         | No       | `https://integrate.api.nvidia.com`         | Upstream API base                               |
| `DEFAULT_MODEL`           | No       | `nvidia/nemotron-3-nano-30b-a3b`           | Default serving model                           |
| `MODEL_FALLBACK_QUALITY`  | No       | `nvidia/llama-3.3-nemotron-super-49b-v1.5` | Fallback model #2                               |
| `MODEL_FALLBACK_CAPACITY` | No       | `nvidia/llama-3.1-nemotron-nano-8b-v1`     | Fallback model #3                               |
| `JINA_API_KEY`            | No       | empty                                      | Enables higher-quality web search in Agent Mode |

### ZeroClaw Gateway Variables

| Variable                      | Required | Default                 | Purpose                                     |
| ----------------------------- | -------- | ----------------------- | ------------------------------------------- |
| `ZEROCLAW_GATEWAY_URL`        | No       | `http://127.0.0.1:3000` | Local ZeroClaw gateway base URL             |
| `ZEROCLAW_GATEWAY_TIMEOUT_MS` | No       | `15000`                 | Gateway request timeout in milliseconds     |
| `ZEROCLAW_REPLAY_WINDOW_MS`   | No       | `5000`                  | Idempotency replay window for webhook calls |
| `ZEROCLAW_WEBHOOK_SECRET`     | No       | empty                   | Optional X-Webhook-Secret passthrough       |

## Scripts

### Root scripts

| Command                 | Description                             |
| ----------------------- | --------------------------------------- |
| `bun run start`         | Start Expo dev server                   |
| `bun run start:dev`     | Start Expo dev server for dev client    |
| `bun run android`       | Launch Expo on Android                  |
| `bun run ios`           | Launch Expo on iOS                      |
| `bun run web`           | Launch web target                       |
| `bun run proxy:install` | Install proxy dependencies in `server/` |
| `bun run proxy:start`   | Start NVIDIA proxy server               |
| `bun run typecheck`     | TypeScript check                        |
| `bun run test`          | Typecheck + unit + integration tests    |
| `bun run test:phase6`   | Run unit and integration tests          |
| `bun run android:apk`   | Build preview APK via EAS               |

### Server scripts

| Command                      | Description                |
| ---------------------------- | -------------------------- |
| `bun run --cwd server start` | Start Express proxy server |

## Agent Mode

Agent Mode enables tool-based responses.

Proxy mode behavior:

- Tool definitions are passed to model (`web_search`, `fetch_page`)
- Server executes tool calls and loops up to a bounded number of rounds
- Final synthesis answer is streamed back to app
- Search backend cascade:
  - Jina search (if `JINA_API_KEY` present)
  - DuckDuckGo Instant Answer
  - Wikipedia search
- SSE heartbeat comments are emitted during long tool cycles to keep mobile stream alive

Native mode behavior:

- Tool system prompt and tool-call parsing scaffold are present in `nativeClient`
- Local execution paths for `web_search` and `fetch_page` are implemented via `toolExecutor`
- Designed as an incremental scaffold and may vary by model formatting/tool-call style

## ZeroClaw Gateway

ZeroClaw is the lightweight tool-execution path beneath Agent Mode. It does not replace model transport; `nvidia-proxy` and `native` still handle token generation.

- Enable it from Settings with the ZeroClaw toggle.
- Set gateway URL and enter a manual pairing code to obtain a token.
- The app stores the token in secure settings and sends webhook requests through the proxy relay.
- `zeroclaw_webhook` is the single lightweight tool exposed in this rollout.
- The chat footer shows execution states for gateway execution, replayed calls, and gateway failures.

Recommended rollout posture:

- Keep ZeroClaw disabled by default until gateway pairing is validated.
- Verify health and pairing before enabling tool calls in live usage.
- Prefer idempotency keys for retried or repeatable operations.

## Turbo Mode Native

Turbo Mode is an experimental speculative decoding path in native mode:

- Main model: target quality model
- Draft model: small GGUF for faster speculative token proposal
- Flow: draft proposes short chunks, main model verifies and commits tokens
- Enabled only when:
  - Mode is native
  - `turboMode=true`
  - `draftModel` is a valid `file://` GGUF path
  - Agent mode is disabled for that request

Notes:

- This is a practical approximation strategy, not a full logits-level speculative implementation.
- Performance gains depend on device, quantization, and model pair compatibility.

## Proxy API

Base URL: `http://<host>:<port>` (default `http://127.0.0.1:8787`)

| Endpoint               | Method | Description                               |
| ---------------------- | ------ | ----------------------------------------- |
| `/health`              | GET    | Health status                             |
| `/v1/models`           | GET    | Proxy pass-through for model catalog      |
| `/v1/chat/completions` | POST   | Main chat endpoint with streaming support |
| `/test-sse`            | GET    | SSE diagnostic stream                     |

`/v1/chat/completions` supports:

- `stream` (boolean)
- `agent_mode` (boolean)
- `model` (string)
- OpenAI-compatible message list

## Project Structure

```text
.
|-- App.tsx
|-- app.json
|-- eas.json
|-- src/
|   |-- components/
|   |-- context/
|   |-- hooks/
|   |-- lib/
|   `-- screens/
|-- server/
|   |-- index.js
|   |-- .env.example
|   `-- package.json
|-- native-bridge/android/
|-- plugins/
`-- docs/
```

## Troubleshooting

### Cannot connect to proxy

- Ensure proxy is running: `bun run proxy:start`
- Ensure app host/port match your machine or LAN target
- Emulator note: if app runs in emulator, host mapping may differ
- Check firewall rules for chosen proxy port

### Stream times out or breaks

- Confirm proxy `/health` is reachable
- For Agent Mode, allow longer response windows (server already emits heartbeats)
- Check server logs for upstream 429/404 and fallback events

### Native mode not available

- Expo Go does not load native llama bindings
- Build dev client via EAS and run with `bun run start:dev`
- Confirm model path is a valid `file://...gguf` URI

### Draft model not used in Turbo Mode

- Ensure `turboMode` is enabled in Settings
- Ensure `draftModel` is set and points to an existing GGUF file
- Turbo path is skipped for agent-mode requests

## Security and Privacy

- API keys stay on proxy server, not in mobile app code
- App settings are persisted via `expo-secure-store`
- Proxy mode transits prompts through your configured proxy and NVIDIA upstream
- Native mode keeps inference local to device when using GGUF models

## Roadmap

From `PRD.md` and implemented milestones:

- Phase 1: baseline streaming chat and settings
- Phase 2-3: native integration path and model management
- Phase 4: optimization (context lifecycle, fallback strategies)
- Phase 5: UX polish (FlashList, animations, haptics)
- Phase 6 (in progress): speculative decoding and agent workflow hardening

## Contributing

Suggested contribution flow:

1. Open an issue with problem statement and acceptance criteria
2. Keep PRs focused and small
3. Run `bun run typecheck` before opening PR
4. Include screenshots or short recordings for UI changes
5. Document any new env vars or settings in this README

## License

No license file is currently present in the repository. Add a `LICENSE` file before public redistribution.
