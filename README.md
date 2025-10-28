# Ollama Mobile (Option A — Phase 1)

Expo-managed React Native prototype for offline/local LLM chat via Ollama over LAN or localhost.

This Phase 1 app runs in Expo Go (JS-only) and connects to an Ollama HTTP API endpoint. It implements a basic chat screen with streaming responses and a settings screen to configure host/port/model.

## Features (Phase 1)

- Connect to Ollama endpoint (default: http://127.0.0.1:11434)
- Chat UI with incremental streaming of tokens using XMLHttpRequest to parse NDJSON
- Settings to edit host, port, and model; quick test connectivity and fetch model list
- Android-first but works in Expo Go for rapid iteration

## Requirements

- Node.js LTS and npm
- Android device with Expo Go installed, on the same LAN as your Ollama host (or use localhost if supported)
- Ollama running on your desktop/laptop: https://ollama.com

## Getting started

1. Install dependencies

```powershell
npm install
```

2. Start the Expo dev server

```powershell
npm start
```

3. Open on device

- Install Expo Go on your Android device
- Scan the QR code from the terminal or browser to open the app

4. Configure endpoint

- Go to the Settings tab
- Set `Host` to your desktop/laptop IP (for example, `192.168.1.10`) and `Port` to `11434`
- Tap `Test` to confirm connectivity
- Optionally tap `Fetch Models` to pick the first available model; otherwise set `Model` manually (e.g., `llama3`)

5. Chat

- Go to Chat tab, enter a message, and Send
- Responses should stream token-by-token

## Notes

- Streaming is implemented via `XMLHttpRequest` progressive `responseText` parsing, which works in Expo Go without native modules.
- If you see connection failures, ensure:
  - Phone and PC are on the same Wi-Fi/LAN
  - Firewall allows connections to port 11434
  - Ollama is running (e.g., `ollama serve`) and reachable from your phone

## Next phases

- Device-native integration via Expo dev clients (for local runtime embedding)
- On-device Ollama runtime (advanced) for supported hardware

## License

This project is for demonstration/prototyping per PRD Phase 1.
