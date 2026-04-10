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
- [Operational Notes & Caveats](#operational-notes--caveats)
- [Detailed Troubleshooting](#detailed-troubleshooting)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## Overview

PocketClaw is designed for three common workflows:

- Expo Go users who want to chat through a local proxy without native builds.
- Dev-client users who want on-device inference through llama.rn.
- Power users who want the model to trigger trusted local commands through ZeroClaw.

The app provides a streaming chat interface, persisted settings, model fallback handling, and an agent mode that can call web search, page fetch, and ZeroClaw webhook tools when enabled.

## Recent Changes

The current codebase includes the following notable updates:

- The NVIDIA proxy now trims requested model IDs before forwarding them upstream, which prevents whitespace-related 404 failures.
- Long-running agent streams now stay connected through periodic SSE heartbeats and socket flushing, which reduces Android read-timeout issues.
- ZeroClaw pairing and local execution are part of the documented setup flow, including gateway startup and token pairing.
- The latest tool-call path has been validated with z-ai/glm5.

## Architecture

The main runtime path is:

1. The mobile UI captures a prompt and sends the conversation through the configured provider.
2. providerRouter selects either the NVIDIA proxy path or the native path.
3. In proxy mode, server/index.js forwards requests to NVIDIA NIM and streams responses back to the app.
4. In agent mode, the proxy can execute web_search, fetch_page, and zeroclaw_webhook tool calls.
5. If ZeroClaw is enabled, the proxy relays local command execution to the paired gateway and returns the result to the model.

Core implementation files:

- src/screens/ChatScreen.tsx: chat UI, streaming state, and message rendering.
- src/screens/SettingsScreen.tsx: provider, model, and ZeroClaw settings.
- src/context/SettingsContext.tsx: secure settings persistence.
- src/lib/providerRouter.ts: routing boundary between proxy and native modes.
- src/lib/nvidiaProxyClient.ts: streaming client for the proxy endpoint.
- server/index.js: NVIDIA proxy, tool orchestration, and SSE handling.

## Requirements

- Bun 1.3.11 or newer.
- Windows PowerShell for the ZeroClaw gateway script.
- An NVIDIA API key for proxy mode.
- Expo Go for the proxy path, or an Expo dev client for native mode.
- An Android device or emulator for the primary supported workflow.
- The ZeroClaw gateway binary or PowerShell script if you plan to use local command execution.

## Getting Started

To ensure a smooth setup, perform the following steps in order. Three separate terminal instances will be required (one for the proxy, one for the Expo bundler, and one for the ZeroClaw gateway).

### 1. Install Dependencies

From the repository root, install the root and server-specific dependencies:

\\\powershell
bun install
bun run proxy:install
\\\

### 2. Configure the Environment

Create the proxy environment file at server/.env and populate it with the required keys. 

\\\powershell
NVIDIA_API_KEY=your_nvidia_api_key_here
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
\\\

### 3. Start the ZeroClaw Gateway

Open a dedicated terminal. This script acts as the bridge for local command execution.

\\\powershell
bun run zeroclaw:start
\\\
Under the hood, this executes: powershell -ExecutionPolicy Bypass -File ./zeroclaw-gateway.ps1 from the server directory. The script normally listens on port 3000. 

If this is your first time, you can generate a pairing token. Note the token, as you will need to input it into the mobile application settings.
\\\powershell
zeroclaw gateway get-paircode --new
\\\

### 4. Start the Proxy Server

Open a second terminal. This Express server multiplexes requests to NVIDIA and local AI agents.

\\\powershell
bun run proxy:start
\\\
This executes bun index.js inside the server directory. By default, it will listen on http://0.0.0.0:8787. Ensure it boots without throwing module-not-found errors.

### 5. Start the Expo Application

Open a third terminal. You can run the application for the physical device via Expo Go or via an emulator. For physical device testing over LAN without online syncing:

\\\powershell
bun run start -- --go --host lan --port 8081 --offline
\\\
If you encounter bundler caching issues or unexpected UI state, you can clear the Expo cache:
\\\powershell
npx expo start -c
\\\
For users running a native dev-client build (which includes native C++ bindings for llama.rn):
\\\powershell
bun run start:dev
\\\

### 6. App Configuration (Mobile UI)

Open the app via the Expo Go QR code or your emulator.
Navigate to the Settings screen:
1. Provider Mode: Select NVIDIA Proxy.
2. Proxy Host: If using an emulator, entering 10.0.2.2 or 127.0.0.1 may work. If using a physical Android device on your WiFi, you must enter your computer's local IPv4 address (e.g., 192.168.1.15). Do not use localhost for physical devices.
3. Proxy Port: Keep as 8787 unless overridden in the .env file.
4. Model Name: Enter z-ai/glm5 or your designated fallback model.
5. ZeroClaw Integration: Toggle ZeroClaw to ON, enter your computer's local IP address and port 3000 to reach the gateway, and input the webhook pairing token.

## Configuration

### App Settings

Settings are securely preserved using expo-secure-store.

| Key | Default | Description |
| --- | --- | --- |
| host | 127.0.0.1 | Proxy host used in nvidia-proxy mode |
| port | 8787 | Proxy port |
| model | nvidia/nemotron-3-nano-30b-a3b | Default model ID or local GGUF path |
| mode | nvidia-proxy | Active provider mode |
| agentMode | true | Enables tool-based agent behavior |
| zeroClawEnabled | false | Enables the ZeroClaw webhook tool |
| zeroClawGatewayUrl | http://127.0.0.1:3000 | Local ZeroClaw gateway base URL |
| zeroClawToken | empty | Paired token stored on device |
| zeroClawWebhookSecret | empty | Optional webhook secret |
| turboMode | false | Enables native speculative mode |
| draftModel | empty | Draft GGUF model path for Turbo Mode |

### Proxy Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| NVIDIA_API_KEY | required | Authenticates requests to NVIDIA NIM |
| PORT | 8787 | Proxy listener port |
| NVIDIA_BASE_URL | https://integrate.api.nvidia.com | Upstream API base URL |
| DEFAULT_MODEL | nvidia/nemotron-3-nano-30b-a3b | Primary model used by the proxy |
| MODEL_FALLBACK_QUALITY | nvidia/llama-3.3-nemotron-super-49b-v1.5 | Quality fallback model |
| MODEL_FALLBACK_CAPACITY | nvidia/llama-3.1-nemotron-nano-8b-v1 | Capacity fallback model |
| ALLOWED_ORIGIN | * | CORS origin policy |
| JINA_API_KEY | empty | Enables higher quality web search in agent mode |
| ZEROCLAW_GATEWAY_URL | http://127.0.0.1:3000 | Gateway URL used for ZeroClaw relay |
| ZEROCLAW_GATEWAY_TIMEOUT_MS | 15000 | Gateway request timeout |
| ZEROCLAW_REPLAY_WINDOW_MS | 5000 | Idempotency replay window |
| ZEROCLAW_WEBHOOK_SECRET | empty | Optional secret passed to the gateway |
| LOCAL_SHELL_TIMEOUT_MS | 20000 | Local shell execution timeout |

## Scripts

### Root Scripts

| Command | Description |
| --- | --- |
| bun run start | Start the Expo development server |
| bun run start:dev | Start Expo in dev-client mode |
| bun run android | Launch the Android target |
| bun run ios | Launch the iOS target |
| bun run web | Launch the web target |
| bun run proxy:install | Install dependencies for server/ |
| bun run proxy:start | Start the NVIDIA proxy server |
| bun run zeroclaw:start | Start the ZeroClaw gateway script |
| bun run typecheck | Run the TypeScript compiler check |
| bun run test | Run typecheck plus unit and integration tests |
| bun run test:unit | Run unit tests only |
| bun run test:integration | Run integration tests only |
| bun run test:phase6 | Run the Vitest suite |
| bun run android:apk | Build a preview Android APK with EAS |

### Server Scripts

| Command | Description |
| --- | --- |
| bun run start | Start the Express proxy server |
| bun run zeroclaw:gateway | Start the PowerShell gateway wrapper |

## Proxy API

Base URL: http://<host>:<port>

| Endpoint | Method | Description |
| --- | --- | --- |
| /health | GET | Health check endpoint |
| /v1/models | GET | Model catalog passthrough |
| /v1/chat/completions | POST | Main chat endpoint with streaming support |
| /test-sse | GET | SSE diagnostic endpoint |

The chat endpoint supports OpenAI-compatible messages, stream, agent_mode, and model.

## Project Structure

`	ext
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
`

## Operational Notes & Caveats

- Model Fallback Constraints: Model fallback proceeds from the requested model to the quality fallback and then the capacity fallback if the upstream request fails. However, some tools may only be supported by the primary model. Ensure your primary model (like z-ai/glm5) fully supports function calling if agentMode is enabled.
- SSE Keep-Alive: Agent mode routes keep SSE streams alive during long operations (like a lengthy ZeroClaw shell execution) so mobile clients do not throw a read-timeout exception and disconnect while the server is waiting for a response.
- Control Field Stripping: The proxy strips internal PocketClaw control fields such as agent_mode and zeroclaw_* before forwarding the payload to the external upstream API to prevent schema validation failures.
- Trusted Network Disclaimer: ZeroClaw allows deep system execution powers. It is strictly designed for local loops and trusted LAN environments. Do not expose its port (3000) or the proxy port (8787) directly to the WAN.

## Detailed Troubleshooting

### 1. Proxy or ZeroClaw Connection Fails from Physical Device
By far the most common issue. If you specify 127.0.0.1 or localhost in the mobile application settings while using a physical Android device, the connection will fail.
- Cause: The physical Android phone treats localhost as its own internal loopback interface, not your development PC.
- Solution: Run ipconfig (Windows) or ifconfig (Mac/Linux) on your computer. Find the IPv4 address (e.g., 192.168.1.55). Enter this IP address in the PocketClaw App Settings for both the Proxy Host and the ZeroClaw Host. Ensure both devices are connected to the same WiFi network.

### 2. Connection Refused / Blocked by Windows Firewall
- Symptom: You can reach the proxy via a local browser (http://127.0.0.1:8787) but the phone keeps throwing network timeouts using the LAN IP.
- Solution: Windows Defender Firewall prevents inbound LAN connections by default unless the network is set to "Private" and Node/Bun are allowed through. 
- Go to Windows Defender Firewall with Advanced Security.
- Create an Inbound Rule allowing TCP ports 8081, 8787, and 3000.
- Alternatively, check that your network profile is set to Private instead of Public in Windows Network Settings.

### 3. The Model Request Returns a 404 Error
- Cause: Trailing whitespace or an incorrectly typed model ID.
- Solution: Double-check that the model name (e.g., z-ai/glm5) exactly matches the NVIDIA catalog. Ensure there are no spaces at the end of the text input in the app configuration. If changing the default in the .env file, restart the proxy server to load the new config.

### 4. ZeroClaw Does Not Execute Commands
- Symptom: Agent processes a command, but there is no terminal output and the proxy returns a gateway timeout.
- Solution: Verify that bun run zeroclaw:start is actively open in a terminal window. Confirm that zeroClawEnabled is manually checked under App Settings. Finally, ensure ZEROCLAW_GATEWAY_URL and ZEROCLAW_WEBHOOK_SECRET are configured properly inside the server/.env file.

### 5. Expo Bundler Stalls or Throws Component Errors
- Symptom: Making changes to React Native files triggers hot-reload, but it causes strange UI caching artifacts.
- Solution: Restart the Expo bundler while clearing the cache. Run npx expo start -c or bun run start -- -c.

### 6. Streams Stall on Android
- Symptom: Chat hangs mid-message during tool execution.
- Solution: This often correlates with mobile network instability or the upstream API failing quietly. Ensure the proxy's server/index.js is utilizing its SSE keep-alive tick logic and the device is firmly connected to Wi-Fi.

## Security

- ZeroClaw permissions grant the proxy direct access to system-level PowerShell/Bash contexts. Never port-forward your gateway to an untrusted reverse proxy or public domain.
- The webhook secret should be strong and rotated if the gateway is exposed across a multi-user LAN.

## Contributing

Guidelines for contributing to the repository. Please ensure all pull requests pass typecheck (bun run typecheck) and unit tests (bun run test) before requesting review.

## License

MIT License. See the repository headers.
