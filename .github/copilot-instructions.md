## Copilot / AI Agent Instructions — Ollama Mobile

**Purpose:** Help AI agents contribute productively by documenting architecture, data flow, and project-specific patterns. Keep edits small and respect provider contracts.

### What this app is

- Expo React Native chat client for Ollama (localhost/LAN) with two connection modes
- **Remote mode** (HTTP/Expo Go): connects to Ollama `/api/chat` endpoint on any LAN host
- **Native mode** (dev client/EAS): runs llama.cpp locally via `llama.rn` (Phase 3) or custom native module

### Architecture & Data Flow

**State Management** (`src/context/SettingsContext.tsx`)

- Single source of truth: `{ host, port, model, mode }` persisted via `expo-secure-store`
- All settings changes must use `saveSettings()` to keep SecureStore in sync

**Provider Router** (`src/lib/providerRouter.ts`)

- **Three entry points:** `pingProvider()`, `getModelsProvider()`, `streamProvider()`
- Routes requests based on `mode` ("remote" | "native") — never call HTTP or Native clients directly from UI
- Receives `baseUrl` only for remote mode; ignores it for native

**HTTP Client** (`src/lib/ollamaClient.ts`)

- Uses `XMLHttpRequest` to stream Ollama's NDJSON (`/api/chat` endpoint)
- **Critical pattern:** `parseNew()` tracks `lastIndex` and maintains a line buffer; handles incomplete JSON gracefully
- On `readyState === 3` (LOADING): parse tokens; on `readyState === 4` (DONE): flush final buffer
- Emits tokens via `onToken(t)` callback; calls `onDone()` on completion
- Fallback: tries `/api/tags` first, then `/api/models` for model list

**Native Client** (`src/lib/nativeClient.ts`)

- Adapts two sources: native NativeModule (`OllamaNative` or `Ollama`) or JS fallback via `llama.rn`
- Listens for events: `OllamaToken` (string), `OllamaDone` (void), `OllamaError` (string)
- Phase 3: validates GGUF files, initializes context with safe defaults (n_ctx=512, cpu-only)
- Implements common LLM stop tokens: `</s>`, `<|end|>`, `<|eot_id|>`, etc.

**Chat Flow** (`src/screens/ChatScreen.tsx`)

1. Preflight `pingProvider()` to surface connection errors (emulator vs. device hints)
2. Build message history including the new user prompt
3. Call `streamProvider()` with `onToken` callback
4. Append tokens to the last assistant message in state via `setMessages()`

### Developer Workflow

```powershell
pnpm install                    # Install deps (uses pnpm per package.json)
pnpm start                      # Start Expo dev server
pnpm start --android           # Start & open on Android emulator/device
pnpm typecheck                 # Verify TypeScript (no build step)
npx eas build --profile development --platform android  # Create dev client for native mode
```

### Key Integration Points

**Ollama HTTP API** (remote mode)

- `POST /api/chat` with `{ model, messages, stream: true }` → emits NDJSON lines
- `GET /api/tags` or `/api/models` → model list (auto-fallback if first fails)
- `GET /api/version` → used by `pingProvider()`

**llama.rn (native mode, Phase 3)**

- Exports `initLlama({ model, n_ctx, n_gpu_layers, use_mlock })` → context object
- Context exposes `completion({ messages, n_predict, stop }, tokenCallback)` → Promise
- Callback fires per token; returns final result on completion

**Network Configuration**

- Default: `127.0.0.1:11434`
- Android emulator: `10.0.2.2:11434`
- Real device: use PC's LAN IP; ensure Ollama bound to `0.0.0.0` (not `127.0.0.1`)

### Project Patterns

- **No fetch streams:** XMLHttpRequest + manual buffer parsing works in Expo Go; avoid fetch ReadableStream
- **Atomic settings:** All partial updates go through `saveSettings({ partial })` to avoid sync issues
- **Error messages provide hints:** emulator vs. device, native module availability, file access errors
- **Callback-based streaming:** avoids Promise overhead on token arrival; enables cancellation via `streamHandle.cancel()`

### File Map

| File                              | Purpose                                                   |
| --------------------------------- | --------------------------------------------------------- |
| `App.tsx`                         | Tab navigation (Chat/Settings)                            |
| `src/context/SettingsContext.tsx` | Centralized config state + persistence                    |
| `src/lib/providerRouter.ts`       | Mode-based router; entry point for all provider calls     |
| `src/lib/ollamaClient.ts`         | HTTP streaming client (XMLHttpRequest + NDJSON parsing)   |
| `src/lib/nativeClient.ts`         | Native module adapter + llama.rn fallback (Phase 3)       |
| `src/lib/nativeContracts.ts`      | Native module type contracts                              |
| `src/screens/ChatScreen.tsx`      | Chat UI; preflight ping + stream handling                 |
| `src/screens/SettingsScreen.tsx`  | Config inputs + mode toggle + native availability check   |
| `native-bridge/android/`          | Kotlin skeletons for custom OllamaNative module (Phase 3) |

### Debugging Tips

- **Connectivity issues:** Check `pingProvider()` error message; emulator uses `10.0.2.2`, devices need LAN IP + firewall rule
- **Tokens stop mid-stream:** Inspect `parseNew()` in `ollamaClient.ts`; verify `lastIndex` increments and final buffer flush on `readyState === 4`
- **Native mode unavailable:** Expected if dev client not built; fall back to remote mode or build via EAS
- **GGUF validation errors:** Check `loadLlamaModelInfo()` in Phase 3; ensure file exists and is valid GGUF format
