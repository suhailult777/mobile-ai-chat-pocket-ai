# PocketClaw

PocketClaw is an Expo + React Native mobile chat app for local and near-local AI workflows.
It supports:

- NVIDIA proxy mode (works with Expo Go).
- Native mode via llama.rn (Expo dev client).
- ZeroClaw tool execution for trusted local shell workflows.

## Contents

- Overview
- Architecture
- Requirements
- Quick Start
- ZeroClaw Pairing
- Mobile App Settings
- Scripts
- Environment Variables
- Troubleshooting
- Security Notes
- Testing
- Project Structure

## Overview

PocketClaw is designed for Windows-first development and mobile testing.

- In proxy mode, the mobile app streams through a local Express server in server/index.js.
- In agent mode, the proxy can call web_search, fetch_page, and zeroclaw_webhook tools.
- ZeroClaw integration lets the model send trusted command requests to a paired local gateway.

## Architecture

1. Mobile UI sends chat payloads to the active provider mode.
2. src/lib/providerRouter.ts routes between nvidia-proxy and native.
3. In nvidia-proxy mode, server/index.js forwards chat requests to NVIDIA NIM.
4. If agentMode is enabled, tool calls are executed server-side.
5. If zeroClawEnabled is true, zeroclaw_webhook calls are forwarded to the paired gateway.

Core files:

- App.tsx
- src/screens/ChatScreen.tsx
- src/screens/SettingsScreen.tsx
- src/context/SettingsContext.tsx
- src/lib/providerRouter.ts
- src/lib/nvidiaProxyClient.ts
- server/index.js
- server/zeroclaw-gateway.ps1

## Requirements

- Bun 1.3.11+
- Node-compatible Expo toolchain (installed via dependencies)
- Windows PowerShell (for ZeroClaw gateway script)
- NVIDIA API key (proxy mode)
- Expo Go or Expo dev client
- Android device/emulator (primary tested path)

## Quick Start

Run these steps from the repository root.

### 1) Install dependencies

```powershell
bun install
bun run proxy:install
```

### 2) Create server/.env

Create server/.env with values like this:

```dotenv
NVIDIA_API_KEY=your_nvidia_api_key_here
PORT=8787
NVIDIA_BASE_URL=https://integrate.api.nvidia.com
DEFAULT_MODEL=nvidia/nemotron-3-nano-30b-a3b
MODEL_FALLBACK_QUALITY=nvidia/llama-3.3-nemotron-super-49b-v1.5
MODEL_FALLBACK_CAPACITY=nvidia/llama-3.1-nemotron-nano-8b-v1
ALLOWED_ORIGIN=*
JINA_API_KEY=

# ZeroClaw
ZEROCLAW_GATEWAY_URL=http://127.0.0.1:18789
ZEROCLAW_GATEWAY_TIMEOUT_MS=15000
ZEROCLAW_REPLAY_WINDOW_MS=5000
ZEROCLAW_WEBHOOK_SECRET=
LOCAL_SHELL_TIMEOUT_MS=20000
```

Note: the gateway script defaults to port 18789. Use the same port in ZEROCLAW_GATEWAY_URL unless you explicitly run the gateway on another port.

### 3) Start ZeroClaw gateway (terminal 1)

```powershell
bun run zeroclaw:start
```

This runs PowerShell script server/zeroclaw-gateway.ps1.

### 4) Start proxy server (terminal 2)

```powershell
bun run proxy:start
```

Default proxy address: http://127.0.0.1:8787

### 5) Start Expo app (terminal 3)

Expo Go path:

```powershell
bun run start -- --go --host lan --port 8081 --offline
```

Dev client path:

```powershell
bun run start:dev
```

Optional cache reset:

```powershell
npx expo start -c
```

## ZeroClaw Pairing

Generate a fresh pair code before enabling ZeroClaw in the app.

Generic command:

```powershell
zeroclaw gateway get-paircode --new
```

Windows explicit binary path command:

```powershell
& "C:\Users\suhai\AppData\Local\zeroclaw\bin\v0.6.9\zeroclaw.exe" gateway get-paircode --new
```

Use the generated code/token in the app's ZeroClaw settings.

## Mobile App Settings

In the app settings screen:

1. Provider Mode: nvidia-proxy (or native for llama.rn path).
2. Proxy Host:
   - Emulator: often 10.0.2.2 or 127.0.0.1
   - Physical device: your PC LAN IP (for example, 192.168.1.15)
3. Proxy Port: 8787
4. Model: z-ai/glm5 or your configured model
5. Agent Mode: ON (if using tools)
6. ZeroClaw Enabled: ON
7. ZeroClaw Gateway URL: http://<your-pc-ip>:18789 (or your custom port)
8. ZeroClaw Token: paste generated pair code/token
9. ZeroClaw Webhook Secret: optional unless you enforce it

Important: do not use localhost on a physical phone. Use your computer's LAN IP.

## Scripts

### Root scripts

| Command | Description |
| --- | --- |
| bun run start | Start Expo dev server |
| bun run start:dev | Start Expo in dev-client mode |
| bun run zeroclaw:start | Start ZeroClaw gateway wrapper |
| bun run proxy:start | Start proxy server from server/ |
| bun run proxy:install | Install dependencies in server/ |
| bun run android | Start Expo for Android |
| bun run ios | Start Expo for iOS |
| bun run web | Start Expo for web |
| bun run typecheck | Run TypeScript check |
| bun run test | Typecheck + unit + integration tests |
| bun run test:unit | Run unit tests |
| bun run test:integration | Run integration test |
| bun run test:phase6 | Run Vitest suite |
| bun run android:apk | Build Android preview APK via EAS |

### Server scripts

| Command | Description |
| --- | --- |
| bun run start | Run proxy server (bun index.js) |
| bun run zeroclaw:gateway | Run PowerShell gateway script |

## Environment Variables

### Proxy/server variables

| Variable | Default | Purpose |
| --- | --- | --- |
| NVIDIA_API_KEY | required | NVIDIA NIM auth key |
| PORT | 8787 | Proxy listen port |
| NVIDIA_BASE_URL | https://integrate.api.nvidia.com | NVIDIA API base URL |
| DEFAULT_MODEL | nvidia/nemotron-3-nano-30b-a3b | Primary model |
| MODEL_FALLBACK_QUALITY | nvidia/llama-3.3-nemotron-super-49b-v1.5 | Quality fallback |
| MODEL_FALLBACK_CAPACITY | nvidia/llama-3.1-nemotron-nano-8b-v1 | Capacity fallback |
| ALLOWED_ORIGIN | * | CORS origin |
| JINA_API_KEY | empty | Optional web search enhancement |
| ZEROCLAW_GATEWAY_URL | http://127.0.0.1:3000 (code default) | Gateway base URL used by proxy |
| ZEROCLAW_GATEWAY_TIMEOUT_MS | 15000 | Gateway timeout |
| ZEROCLAW_REPLAY_WINDOW_MS | 5000 | Idempotency replay window |
| ZEROCLAW_WEBHOOK_SECRET | empty | Optional shared secret |
| LOCAL_SHELL_TIMEOUT_MS | 20000 | Local shell timeout |

### App-side default settings

| Key | Default |
| --- | --- |
| host | 127.0.0.1 |
| port | 8787 |
| model | nvidia/nemotron-3-nano-30b-a3b |
| mode | nvidia-proxy |
| agentMode | true |
| zeroClawEnabled | false |
| zeroClawGatewayUrl | http://127.0.0.1:3000 |
| zeroClawToken | empty |
| zeroClawWebhookSecret | empty |
| turboMode | false |
| draftModel | empty |

## Troubleshooting

### Connection fails from physical device

- Use your computer LAN IP in app settings, not localhost/127.0.0.1.
- Ensure phone and computer are on the same network.

### Windows firewall blocks requests

- Allow inbound TCP ports used in your setup (typically 8081, 8787, 18789).
- Ensure your network profile is Private.

### Model 404 or request errors

- Check model ID for exact spelling and no trailing spaces.
- Restart proxy after changing model/env values.

### ZeroClaw tool calls timeout

- Confirm gateway is running (bun run zeroclaw:start).
- Confirm ZEROCLAW_GATEWAY_URL matches gateway port.
- Confirm token/pairing in app settings is valid.

### Expo cache/stale UI issues

- Restart with cache clear: npx expo start -c

## Security Notes

- ZeroClaw can execute local commands. Keep gateway usage on trusted local networks.
- Do not expose gateway/proxy ports publicly.
- Use a strong webhook secret if exposing across shared LAN.

## Testing

```powershell
bun run typecheck
bun run test
```

## Project Structure

```text
mobile-ai-chat-pocket-ai/
  App.tsx
  package.json
  server/
    index.js
    package.json
    zeroclaw-gateway.ps1
  src/
    components/
    context/
    hooks/
    lib/
    screens/
  tests/
```

## License

MIT
