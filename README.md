# PocketClaw

<div align="center">
  <img src="https://img.shields.io/badge/Expo-SDK%2054-000000?logo=expo&logoColor=white" alt="Expo SDK" />
  <img src="https://img.shields.io/badge/React%20Native-0.81-61dafb?logo=react&logoColor=black" alt="React Native" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Bun-1.3.11-000000?logo=bun&logoColor=white" alt="Bun" />
  <img src="https://img.shields.io/badge/Android-First-3ddc84?logo=android&logoColor=white" alt="Android first" />
</div>

<p align="center">
  Mobile AI chat for local and near-local workflows, with Expo Go compatibility, native dev-client support, and ZeroClaw-backed command execution.
</p>

PocketClaw is a React Native and Expo application for streaming chat against local or LAN-hosted AI backends. The project supports a proxy-based NVIDIA NIM path for Expo Go, a native path for dev-client builds, and a ZeroClaw command-execution bridge for trusted local shell workflows.

The repository is organized for practical development on Windows-first local environments, with an emphasis on predictable setup, streaming reliability, and maintainable configuration.

## Contents

- [Overview](#overview)
- [Recent Changes](#recent-changes)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Proxy API](#proxy-api)
- [Project Structure](#project-structure)
- [Operational Notes](#operational-notes)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## Overview

PocketClaw is designed for three common workflows:

- Expo Go users who want to chat through a local proxy without native builds.
- Dev-client users who want on-device inference through `llama.rn`.
- Power users who want the model to trigger trusted local commands through ZeroClaw.

The app provides a streaming chat interface, persisted settings, model fallback handling, and an agent mode that can call web search, page fetch, and ZeroClaw webhook tools when enabled.

## Recent Changes

The current codebase includes the following notable updates:

- The NVIDIA proxy now trims requested model IDs before forwarding them upstream, which prevents whitespace-related `404` failures.
- Long-running agent streams now stay connected through periodic SSE heartbeats and socket flushing, which reduces Android read-timeout issues.
- ZeroClaw pairing and local execution are part of the documented setup flow, including gateway startup and token pairing.
- The latest tool-call path has been validated with `z-ai/glm5`.

## Architecture

The main runtime path is:

1. The mobile UI captures a prompt and sends the conversation through the configured provider.
2. `providerRouter` selects either the NVIDIA proxy path or the native path.
3. In proxy mode, `server/index.js` forwards requests to NVIDIA NIM and streams responses back to the app.
4. In agent mode, the proxy can execute `web_search`, `fetch_page`, and `zeroclaw_webhook` tool calls.
5. If ZeroClaw is enabled, the proxy relays local command execution to the paired gateway and returns the result to the model.

Core implementation files:

- `src/screens/ChatScreen.tsx`: chat UI, streaming state, and message rendering.
- `src/screens/SettingsScreen.tsx`: provider, model, and ZeroClaw settings.
- `src/context/SettingsContext.tsx`: secure settings persistence.
- `src/lib/providerRouter.ts`: routing boundary between proxy and native modes.
- `src/lib/nvidiaProxyClient.ts`: streaming client for the proxy endpoint.
- `server/index.js`: NVIDIA proxy, tool orchestration, and SSE handling.

## Requirements

- Bun 1.3.11 or newer.
- Windows PowerShell for the ZeroClaw gateway script.
- An NVIDIA API key for proxy mode.
- Expo Go for the proxy path, or an Expo dev client for native mode.
- An Android device or emulator for the primary supported workflow.
- The ZeroClaw gateway binary if you plan to use local command execution.

## Getting Started

### 1. Install dependencies

From the repository root:

```powershell
bun install
bun run proxy:install
```

### 2. Create the proxy environment file

Create `server/.env` and add the required values. A minimal setup looks like this:

```powershell
NVIDIA_API_KEY=your-api-key
PORT=8787
NVIDIA_BASE_URL=https://integrate.api.nvidia.com
DEFAULT_MODEL=nvidia/nemotron-3-nano-30b-a3b
MODEL_FALLBACK_QUALITY=nvidia/llama-3.3-nemotron-super-49b-v1.5
MODEL_FALLBACK_CAPACITY=nvidia/llama-3.1-nemotron-nano-8b-v1
ALLOWED_ORIGIN=*
JINA_API_KEY=
ZEROCLAW_GATEWAY_URL=http://127.0.0.1:3000
ZEROCLAW_GATEWAY_TIMEOUT_MS=15000
ZEROCLAW_REPLAY_WINDOW_MS=5000
ZEROCLAW_WEBHOOK_SECRET=
LOCAL_SHELL_TIMEOUT_MS=20000
```

### 3. Start the ZeroClaw gateway

Open a separate terminal and start the gateway:

```powershell
bun run zeroclaw:start
```

If you prefer to run it from the server package directly, use:

```powershell
bun run --cwd server zeroclaw:gateway
```

Generate a pairing code when needed:

```powershell
zeroclaw gateway get-paircode --new
```

### 4. Start the proxy server

```powershell
bun run proxy:start
```

The proxy listens on `http://0.0.0.0:8787` by default.

### 5. Start the Expo app

For Expo Go:

```powershell
bun run start -- --go --host lan --port 8081 --offline
```

For a dev client build:

```powershell
bun run start:dev
```

### 6. Configure the app

In the Settings screen:

1. Select `NVIDIA Proxy` mode.
2. Set the proxy host to your computer's LAN IP address.
3. Keep the proxy port at `8787` unless you changed the server configuration.
4. Enter the model you want to use. `z-ai/glm5` has been validated with the latest tool-call flow.
5. Enable ZeroClaw only if you have paired the gateway and entered the token.

## Configuration

### App settings

Settings are persisted with `expo-secure-store`.

| Key | Default | Description |
| --- | --- | --- |
| `host` | `127.0.0.1` | Proxy host used in `nvidia-proxy` mode |
| `port` | `8787` | Proxy port |
| `model` | `nvidia/nemotron-3-nano-30b-a3b` | Default model ID or local GGUF path |
| `mode` | `nvidia-proxy` | Active provider mode |
| `agentMode` | `true` | Enables tool-based agent behavior |
| `zeroClawEnabled` | `false` | Enables the ZeroClaw webhook tool |
| `zeroClawGatewayUrl` | `http://127.0.0.1:3000` | Local ZeroClaw gateway base URL |
| `zeroClawToken` | empty | Paired token stored on device |
| `zeroClawWebhookSecret` | empty | Optional webhook secret |
| `turboMode` | `false` | Enables native speculative mode |
| `draftModel` | empty | Draft GGUF model path for Turbo Mode |

### Proxy environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NVIDIA_API_KEY` | required | Authenticates requests to NVIDIA NIM |
| `PORT` | `8787` | Proxy listener port |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com` | Upstream API base URL |
| `DEFAULT_MODEL` | `nvidia/nemotron-3-nano-30b-a3b` | Primary model used by the proxy |
| `MODEL_FALLBACK_QUALITY` | `nvidia/llama-3.3-nemotron-super-49b-v1.5` | Quality fallback model |
| `MODEL_FALLBACK_CAPACITY` | `nvidia/llama-3.1-nemotron-nano-8b-v1` | Capacity fallback model |
| `ALLOWED_ORIGIN` | `*` | CORS origin policy |
| `JINA_API_KEY` | empty | Enables higher quality web search in agent mode |
| `ZEROCLAW_GATEWAY_URL` | `http://127.0.0.1:3000` | Gateway URL used for ZeroClaw relay |
| `ZEROCLAW_GATEWAY_TIMEOUT_MS` | `15000` | Gateway request timeout |
| `ZEROCLAW_REPLAY_WINDOW_MS` | `5000` | Idempotency replay window |
| `ZEROCLAW_WEBHOOK_SECRET` | empty | Optional secret passed to the gateway |
| `LOCAL_SHELL_TIMEOUT_MS` | `20000` | Local shell execution timeout |

## Scripts

### Root scripts

| Command | Description |
| --- | --- |
| `bun run start` | Start the Expo development server |
| `bun run start:dev` | Start Expo in dev-client mode |
| `bun run android` | Launch the Android target |
| `bun run ios` | Launch the iOS target |
| `bun run web` | Launch the web target |
| `bun run proxy:install` | Install dependencies for `server/` |
| `bun run proxy:start` | Start the NVIDIA proxy server |
| `bun run zeroclaw:start` | Start the ZeroClaw gateway script |
| `bun run typecheck` | Run the TypeScript compiler check |
| `bun run test` | Run typecheck plus unit and integration tests |
| `bun run test:unit` | Run unit tests only |
| `bun run test:integration` | Run integration tests only |
| `bun run test:phase6` | Run the Vitest suite |
| `bun run android:apk` | Build a preview Android APK with EAS |

### Server scripts

| Command | Description |
| --- | --- |
| `bun run start` | Start the Express proxy server |
| `bun run zeroclaw:gateway` | Start the PowerShell gateway wrapper |

## Proxy API

Base URL: `http://<host>:<port>`

| Endpoint | Method | Description |
| --- | --- | --- |
| `/health` | GET | Health check endpoint |
| `/v1/models` | GET | Model catalog passthrough |
| `/v1/chat/completions` | POST | Main chat endpoint with streaming support |
| `/test-sse` | GET | SSE diagnostic endpoint |

The chat endpoint supports OpenAI-compatible messages, `stream`, `agent_mode`, and `model`.

## Project Structure

```text
.
├── App.tsx
├── app.json
├── babel.config.js
├── docs/
├── plugins/
├── server/
│   ├── index.js
│   ├── package.json
│   └── zeroclaw-gateway.ps1
├── src/
│   ├── components/
│   ├── context/
│   ├── hooks/
│   ├── lib/
│   └── screens/
└── tests/
```

## Operational Notes

- The proxy exposes `x-model-requested`, `x-model-selected`, and `x-model-fallback-used` headers so clients can inspect routing behavior.
- Model fallback proceeds from the requested model to the quality fallback and then the capacity fallback if the upstream request fails.
- Agent mode keeps SSE streams alive during long operations so mobile clients do not disconnect while a tool is running.
- The proxy strips internal control fields such as `agent_mode` and `zeroclaw_*` before forwarding the payload to NVIDIA.
- ZeroClaw is designed for trusted local or LAN environments only.

## Troubleshooting

### Proxy connection fails

- Confirm the proxy is running on the expected host and port.
- Verify the mobile device and proxy machine are on the same network when using a LAN IP.
- Check Windows Firewall rules for ports `8787` and `8081`.

### The model request returns 404

- Check that the model ID exists in NVIDIA's catalog.
- Remove trailing whitespace from the model field in Settings.
- Restart the proxy after changing the model or `.env` values.

### Streams stall on Android

- Make sure you are using the current proxy implementation.
- Confirm the proxy can reach NVIDIA and that the agent does not lose its SSE connection.
- If the network is unstable, try the non-agent path first to isolate the issue.

### ZeroClaw does not execute commands

- Confirm the gateway is running and the pairing token has been entered.
- Verify `zeroClawEnabled` is turned on in Settings.
- Check `ZEROCLAW_GATEWAY_URL` and `ZEROCLAW_WEBHOOK_SECRET` in `server/.env`.

### Native mode is unavailable in Expo Go

- Expo Go cannot load native `llama.rn` modules.
- Use `bun run start:dev` with a dev-client build if you want local native inference.

## Security

- Keep `NVIDIA_API_KEY` in `server/.env`; do not store it in the mobile app.
- Treat ZeroClaw tokens and webhook secrets as sensitive values.
- Use ZeroClaw only on trusted local networks and machines.
- Review any command execution flow before enabling it for day-to-day use.

## Contributing

Contributions are welcome. Keep changes focused, document any new settings or scripts, and run the test suite before opening a pull request.

Suggested validation before submitting changes:

```powershell
bun run typecheck
bun run test
```

## License

This repository does not currently include a license file. Add one before distributing the project publicly.