# Ollama Mobile (Option A — Phase 1)

Expo-managed React Native prototype for offline/local LLM chat via Ollama over LAN or localhost.

This app currently supports Option A — Phase 1 (Expo Go, JS-only) and scaffolding for Phase 2 (Dev Client/EAS with native module). Phase 1 connects to an Ollama HTTP API endpoint. Phase 2 adds a "Native" mode in Settings intended for a future Ollama native module.

## Features (Phase 1 + Phase 2 scaffold)

- Remote HTTP mode: Connect to Ollama endpoint (default: http://127.0.0.1:11434)
- Chat UI with incremental streaming of tokens using XMLHttpRequest to parse NDJSON
- Settings: edit host, port, and model; quick test connectivity and fetch model list
- Settings: select Connection Mode — Remote HTTP (Expo Go) or Native (requires dev client)
- Android-first but works in Expo Go for rapid iteration

## Requirements

- Node.js LTS and npm
- Android device with Expo Go installed, on the same LAN as your Ollama host (or use localhost if supported)
- Ollama running on your desktop/laptop: https://ollama.com

## Getting started

1. Install dependencies

```powershell
pnpm install
```

2. Start the Expo dev server

```powershell
pnpm start
```

3. Open on device

- Install Expo Go on your Android device
- Scan the QR code from the terminal or browser to open the app

4. Configure endpoint / mode

- Go to the Settings tab
- Choose Connection Mode:
  - Remote HTTP (default): set `Host` to your desktop/laptop IP (e.g., `192.168.1.10`) and `Port` to `11434`.
  - Native: requires a custom dev client/EAS build that includes an Ollama native module (see below). If the module isn't present, tests will report unavailability.
- Tap `Test` to confirm connectivity
- Optionally tap `Fetch Models` to pick the first available model; otherwise set `Model` manually (e.g., `llama3`)

5. Chat

- Go to Chat tab, enter a message, and Send
- Responses should stream token-by-token

## Notes

- Streaming is implemented via `XMLHttpRequest` progressive `responseText` parsing, which works in Expo Go without native modules.
- Phase 2 (Native) uses a stub that looks for a native module named `OllamaNative` (or `Ollama`) exposing methods: `ping()`, `getModels()`, `startChat({ model, messages })`, `stopChat()`, and emits events `OllamaToken`, `OllamaDone`, `OllamaError`. If not present, the app continues to work in Remote HTTP mode.
- If you see connection failures, ensure:
  - Phone and PC are on the same Wi-Fi/LAN
  - Firewall allows connections to port 11434
  - Ollama is running (e.g., `ollama serve`) and reachable from your phone

## Phase 2: Dev client / native module (Option A)

- Build a custom dev client to add native capabilities:

```powershell
pnpm install
# login/setup EAS if needed (optional)
# npx eas build:configure
npx eas build --profile development --platform android
```

## Phase 3: Option B — llama.cpp native integration (Recommended)

This option uses a React Native llama.cpp library for on-device inference and streams tokens via the existing Native provider.

High-level steps:

- Add a RN llama.cpp library (e.g., @mybigday/llama.rn or similar)
- Build an Android dev client (EAS) to include native code
- Provide a native bridge that exposes: `ping()`, `getModels()`, `startChat({ model, messages })`, `stopChat()` and emits `OllamaToken`, `OllamaDone`, `OllamaError`
- Switch Settings → Connection Mode to Native and test streaming

Example commands (Windows PowerShell) — see also `docs/phase3-optionb-llama-native.md`:

```powershell
# 1) Install deps
pnpm install

# 2) Add llama.cpp RN library (choose one)
# pnpm add @mybigday/llama.rn
# or
# pnpm add react-native-llama

# 3) Create a dev client that includes the native module
npx eas build --profile development --platform android

# 4) Run with the dev client
pnpm run start:dev
```

Notes:

- The app’s Native client expects the module name `OllamaNative` or `Ollama` with the methods/events shown above. If your chosen library uses a different module name or API, implement a thin native bridge that adapts to this contract.
- In Native mode, the `Settings` screen shows a quick connectivity test. When the native module is available, it may also display the models directory (if your bridge implements `getModelsDir`).
- If using the built-in `llama.rn` JS fallback (no custom NativeModule), set `Settings → Model` to a `file://` path of your GGUF model (e.g., `file:///storage/emulated/0/Android/data/<package>/files/models/tinyllama.Q4_0.gguf`).

- Implement a native module that matches the stub contract above, then rebuild your dev client. Once present, switch Settings -> Connection Mode to Native.

## Next phases

- Device-native integration via Expo dev clients (for local runtime embedding)
- On-device Ollama runtime (advanced) for supported hardware

## License

This project is for demonstration/prototyping per PRD Phase 1.
