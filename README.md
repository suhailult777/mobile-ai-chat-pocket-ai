# Ollama Mobile — React Native Chat Client

> **Chat with local LLMs on your phone over LAN or localhost**

An Expo-managed React Native app for real-time chat with [Ollama](https://ollama.com) local language models. Built with **streaming tokens**, **flexible connection modes**, and a **phased architecture** from prototype to production.

🚀 **Quick start:** Run Ollama on your PC, scan a QR code, and chat instantly—no internet required.

## Features

- ⚡ **Streaming chat** with real-time token display
- 🔌 **Dual connection modes:** Remote HTTP (Expo Go) + Native (on-device, Phase 3)
- 🎯 **Model switching** with quick connectivity tests
- 📱 **Android-first** with iOS support planned
- 🛡️ **Fully local** — all data and models stay on device/LAN
- 🔧 **Incremental builds:** Works in Expo Go; scales to native modules

## System Architecture

```
┌─────────────────────────────────────────┐
│         React Native UI Layer            │
│     (ChatScreen / SettingsScreen)        │
└────────────────┬────────────────────────┘
                 │
         ┌───────▼────────┐
         │ Provider Router │  ◄─── Single entry point
         │  (mode-based)   │
         └───┬────────┬────┘
             │        │
     ┌───────▼─┐  ┌──▼────────────┐
     │   HTTP  │  │   Native      │
     │ Client  │  │  Client       │
     │ (XHR)   │  │ (llama.rn)    │
     └───────┬─┘  └──┬────────────┘
             │       │
      ┌──────▼───────▼─────┐
      │  Ollama HTTP API   │
      │  or llama.cpp lib  │
      └────────────────────┘
```

**Key principle:** All UI calls go through the provider router; never call clients directly. This enables mode switching without touching UI code.

## Installation & Setup

### Prerequisites

- **Node.js** (LTS 18+) and **pnpm** (or npm/yarn)
- **Ollama** running on your PC: https://ollama.com
- **Android device** with Expo Go (or emulator with `10.0.2.2:11434` routing)

### Step 1: Clone and install

```powershell
git clone https://github.com/yourusername/ollama-mobile.git
cd ollama-mobile
pnpm install
```

### Step 2: Start Expo dev server

```powershell
pnpm start
```

### Step 3: Open on device

**Expo Go** (works in emulator or physical device on same LAN):

```powershell
# Scan QR code from terminal/browser, or:
pnpm start --android
```

**Dev Client** (for native mode):

```powershell
pnpm start:dev
```

### Step 4: Configure in Settings tab

1. **Host & Port:**

   - **PC/LAN:** `192.168.1.100` : `11434` (adjust IP to your PC)
   - **Emulator:** `10.0.2.2` : `11434` (special Android emulator routing)
   - **Local device:** `127.0.0.1` : `11434` (if Ollama running on device)

2. **Connection Mode:** Remote HTTP (default) or Native (requires dev client)

3. **Tap Test** to verify connectivity, then **Fetch Models** to list available models

4. Go to **Chat** tab and send a message!

## Usage

### Remote HTTP Mode (Phase 1)

Works in Expo Go. Your phone connects to Ollama on a PC/server.

```powershell
# Install and run Ollama on your PC
ollama serve

# On phone Settings, set Connection Mode to "Remote HTTP"
# Enter your PC's LAN IP and port 11434
```

**Why XHR and not fetch?**  
React Native in Expo Go doesn't support `fetch` ReadableStream. XMLHttpRequest with progressive response parsing works reliably in Go and continues in native builds.

### Native Mode (Phase 3 — on-device inference)

Run models **directly on your phone** with llama.cpp bindings. Requires building a dev client.

**High-level flow:**

1. Add a llama.cpp React Native library (e.g., `llama.rn`)
2. Build an EAS dev client: `npx eas build --profile development --platform android`
3. Select Connection Mode → Native in Settings
4. Load a GGUF model and chat

See [`docs/phase3-optionb-llama-native.md`](./docs/phase3-optionb-llama-native.md) for detailed integration steps.

## Project Structure

```
.
├── App.tsx                           # Tab navigator (Chat/Settings)
├── src/
│   ├── context/
│   │   └── SettingsContext.tsx      # Global settings state + secure storage
│   ├── lib/
│   │   ├── providerRouter.ts        # Routes to HTTP or Native client
│   │   ├── ollamaClient.ts          # XMLHttpRequest streaming (NDJSON parsing)
│   │   ├── nativeClient.ts          # Native module adapter + llama.rn fallback
│   │   └── nativeContracts.ts       # TypeScript contracts for native bridge
│   └── screens/
│       ├── ChatScreen.tsx            # Chat UI + message streaming
│       └── SettingsScreen.tsx        # Config, mode toggle, connectivity test
├── native-bridge/
│   └── android/                      # Kotlin stubs for custom OllamaNative module
├── plugins/
│   └── with-ollama-native.ts        # Expo config plugin for native builds
├── .github/
│   └── copilot-instructions.md      # AI agent guidance (architecture + patterns)
└── docs/
    └── phase3-optionb-llama-native.md  # Phase 3 native integration guide
```

## Developer Workflow

### Commands

```powershell
# Install dependencies (uses pnpm from package.json)
pnpm install

# Type-check (no build step, uses tsc directly)
pnpm typecheck

# Start Expo dev server
pnpm start

# Start on Android emulator/device
pnpm start --android

# Start dev client (for native mode development)
pnpm start:dev

# Build EAS preview (Android APK)
npx eas build --platform android --profile preview
```

### Key Files for Common Tasks

| Task                                        | File(s)                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| **Add a new provider** (HTTP variant, etc.) | `src/lib/providerRouter.ts` → add router logic; create new client      |
| **Modify chat streaming**                   | `src/lib/ollamaClient.ts` (HTTP) or `src/lib/nativeClient.ts` (native) |
| **Change UI layout**                        | `src/screens/ChatScreen.tsx` or `SettingsScreen.tsx`                   |
| **Add settings field**                      | `src/context/SettingsContext.tsx` + update persistence                 |
| **Implement native module**                 | `native-bridge/android/` → then update `src/lib/nativeClient.ts`       |

## Troubleshooting

### "Cannot reach Ollama"

- **Emulator:** Use `10.0.2.2:11434` (not `127.0.0.1`)
- **Physical device:** Ensure phone and PC are on the **same Wi-Fi**
- **Firewall:** Allow port `11434` on your PC
- **Ollama:** Running? Try `ollama serve` in a terminal

### Tokens stop mid-stream

- Inspect `parseNew()` in `ollamaClient.ts` — verify `lastIndex` increments
- Check `readyState === 4` final buffer flush
- Ensure model isn't crashing; check Ollama logs

### Native mode unavailable

- You've selected "Native" but no dev client is installed
- Build one: `npx eas build --profile development --platform android`
- Or switch back to Remote HTTP mode in Settings

### GGUF file validation error (Phase 3)

- File may be corrupted or unsupported format
- Verify: `file path/to/model.gguf` (should show GGUF magic number)
- Try a known-good model (e.g., TinyLlama quantized)

## Architecture Decisions

### Why XMLHttpRequest over fetch?

**Expo Go limitation:** `fetch` with ReadableStream doesn't work reliably in managed Expo. XMLHttpRequest with manual NDJSON parsing is battle-tested.

### Why provider router?

**Decoupling:** Screens never know if they're calling HTTP or native. Swapping modes is config-only, not code changes.

### Why secure storage for settings?

**Privacy:** Host/port + model name are persisted encrypted, not in cleartext AsyncStorage.

### Why Phase 3 defaults (n_ctx=512, cpu-only)?

**Stability:** Smaller context and CPU-only mode avoid OOM crashes on mid-range devices. Users can tune after validating basic chat.

## Integration Points

### Ollama HTTP API (Remote mode)

- `POST /api/chat` — stream completions (NDJSON)
- `GET /api/tags` (or `/api/models`) — list models
- `GET /api/version` — health check

### llama.rn (Native mode, Phase 3)

```typescript
const context = await initLlama({
  model: 'file:///path/to/model.gguf',
  n_ctx: 512,
  n_gpu_layers: 0,
});

await context.completion(
  { messages, n_predict: 256, stop: [...] },
  (token) => console.log(token)  // Per-token callback
);
```

See `src/lib/nativeClient.ts` for full adaptation pattern.

## Roadmap

| Phase      | Goal                                       | Status                                                 |
| ---------- | ------------------------------------------ | ------------------------------------------------------ |
| **1**      | Prototype in Expo Go, HTTP-only            | ✅ Complete                                            |
| **2**      | Dev client scaffold, native stub           | ✅ In code                                             |
| **3**      | llama.cpp on-device inference              | 🚧 In progress (`docs/phase3-optionb-llama-native.md`) |
| **Future** | Model management UI, parameter tuning, iOS | 📋 Planned                                             |

## Contributing

Issues and PRs welcome! See [`CONTRIBUTING.md`](./CONTRIBUTING.md) (if present) or open an issue.

For AI agents working on this codebase, see [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) for architecture, patterns, and debugging tips.

## License

MIT License — see [`LICENSE`](./LICENSE) file (if present). Project is demonstration/prototyping per PRD Phase 1.
