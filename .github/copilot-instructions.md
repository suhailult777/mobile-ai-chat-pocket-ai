## Copilot / AI Agent Instructions — Ollama Mobile

**Purpose:** Help AI agents contribute productively by documenting architecture, data flow, and project-specific patterns. Keep edits small and respect provider contracts.

### What This App Is

Expo React Native chat client for Ollama with two operational modes:

- **Remote mode** (HTTP/Expo Go): connects to Ollama `/api/chat` endpoint on any LAN/localhost host
- **Native mode** (dev client/EAS): runs llama.cpp locally via `llama.rn` with context caching and GPU acceleration (Phase 3+)

Uses **streaming tokens**, **token batching (50ms debounce)**, **thinking indicators**, and **haptic feedback** for premium UX. Tab-based navigation: Chat + Settings.

### Architecture & Data Flow

**State Management** ([src/context/SettingsContext.tsx](src/context/SettingsContext.tsx))

- Single source of truth: `{ host, port, model, mode }` persisted via `expo-secure-store`
- All settings changes MUST use `saveSettings(partial)` to keep SecureStore in sync
- No async coordination needed—settings load on app mount and updates save atomically

**Provider Router** ([src/lib/providerRouter.ts](src/lib/providerRouter.ts))

- Five entry points: `pingProvider()`, `getModelsProvider()`, `streamProvider()`, `prewarmProvider()`, `disposeProvider()`
- Routes based on `mode` ("remote" | "native") — **never call HTTP or Native clients directly from UI**
- Remote mode: receives `baseUrl` (e.g., `http://10.0.2.2:11434`); Native mode ignores it
- Pattern: `streamProvider()` returns `{ cancel: () => void }` for cancellation support
- **Request deduplication:** automatically cancels previous stream if new request within 500ms debounce window

**HTTP Client** ([src/lib/ollamaClient.ts](src/lib/ollamaClient.ts))

- Uses **XMLHttpRequest** (not fetch) to stream Ollama's NDJSON (`/api/chat` endpoint)
- **Critical pattern:** `parseNew()` maintains `lastIndex` and `buffer` to handle incomplete JSON lines gracefully
  - On `readyState === 3` (LOADING): parse complete lines, keep incomplete in buffer
  - On `readyState === 4` (DONE): flush final buffer, emit remaining tokens
- Emits tokens via `onToken(t)` callback; calls `onDone()` on completion
- **Fallback logic:** tries `/api/tags` first, then `/api/models` for model list
- Supports custom `keepAlive` (default `"1h"`), `options` (temperature, top_p, etc.), and `stop` tokens

**Native Client** ([src/lib/nativeClient.ts](src/lib/nativeClient.ts))

- Adapts two sources: **NativeModule** (`OllamaNative` or `Ollama`) or **JS fallback via llama.rn**
- **Context caching:** single cached context per model path; avoids reinitializing on every message (2-4s savings)
- Validates GGUF files; initializes context with safe defaults: `n_ctx=512`, CPU-only (GPU auto-fallback)
- Implements common LLM stop tokens: `</s>`, `<|end|>`, `<|eot_id|>`, etc.
- Listens for **NativeEventEmitter events:** `OllamaToken` (string), `OllamaDone` (void), `OllamaError` (string)
- Phase 3+: supports **parallel mode** for concurrent requests where native module supports it

**Chat Message Flow** ([src/screens/ChatScreen.tsx](src/screens/ChatScreen.tsx))

1. Preflight `pingProvider()` to surface connection errors (emulator vs. device hints)
2. Build message history (truncate to 40 msgs / 12K chars for context efficiency)
3. Optimistic UI update: append user bubble immediately
4. Call `streamProvider()` with `onToken` callback
5. **Token batching:** `useStreamingText` hook batches tokens via `setImmediate()` (same-frame batching); updates assistant bubble efficiently (prevents UI thrashing)
6. On completion: flush final buffer, fire success haptic feedback
7. Errors: surface with device-specific hints ("use `10.0.2.2` on emulator", "check firewall on device", etc.)
8. **Prewarming (native mode):** Background model initialization on mount reduces TTFT; status tracked via `prewarmStatus` state

### Rendering & UI Patterns

**FlashList** for 1000+ message histories: automatic view recycling; `estimatedItemSize` pre-computed
**Token batching via useStreamingText** ([src/hooks/useStreamingText.ts](src/hooks/useStreamingText.ts)): Reanimated shared values + `setImmediate()` batching for zero-overhead UI updates during streaming
**Thinking indicator:** pulsing animation (react-native-reanimated, UI thread) masks inference latency  
**Haptic feedback** (expo-haptics): subtle vibrations on send, completion, error (`impactAsync`, `notificationAsync`)
**Gemini dark theme:** OLED-optimized (#131314 deep black), high-contrast accent (#A8C7FA light blue)
**LayoutAnimation** on Android: enable with `UIManager.setLayoutAnimationEnabledExperimental(true)`
**Input debouncing:** 50ms debounce on TextInput state updates to reduce re-renders during typing

### Developer Workflow

```powershell
pnpm install                          # Install deps (uses pnpm per package.json)
pnpm start                            # Start Expo dev server
pnpm start --android                  # Start & open on Android emulator/device
pnpm typecheck                        # Verify TypeScript (no build step)
npx eas build --profile development --platform android  # Create dev client for native mode
```

**Testing locally:**

- **Remote mode (Expo Go):** Run Ollama on PC, open Expo Go on device, scan QR code
- **Native mode (dev client):** Build via EAS, install dev client, mode auto-enables if llama.rn available

### Key Integration Points

**Ollama HTTP API** (remote mode)

- `POST /api/chat` with `{ model, messages, stream: true, keep_alive, options, stop }` → emits NDJSON lines
  - Each line: `{ message: { content: "token" } }` (streaming) or `{ done: true }` (final)
- `GET /api/tags` or `/api/models` → model list (auto-fallback if first fails)
- `GET /api/version` → used by `pingProvider()` to validate connection

**llama.rn (native mode, Phase 3+)**

- Exports `initLlama({ model, n_ctx, n_gpu_layers, use_mlock })` → context object
- Context exposes `completion({ messages, n_predict, stop }, tokenCallback)` → Promise
- Callback fires per token; returns final result on completion
- Supports **parallel requests** if native module exposes `startChatMultiple()` / event routing

**Network Configuration**

- Default: `127.0.0.1:11434` (localhost)
- Android emulator: `10.0.2.2:11434` (special bridge IP; auto-detected in error hints)
- Real device: use PC's LAN IP; ensure Ollama bound to `0.0.0.0` (not `127.0.0.1`)

### Project Patterns & Conventions

**No fetch streams:** XMLHttpRequest + manual buffer parsing works in Expo Go; fetch ReadableStream does not
**Atomic settings updates:** All partial updates go through `saveSettings({ partial })` to avoid race conditions
**Error messages provide context:** Include device type, network hints, file path errors; help users diagnose immediately
**Callback-based streaming:** avoids Promise overhead on token arrival; enables mid-stream cancellation
**Stop tokens:** Common set (`</s>`, `<|eot_id|>`, `<|end|>`) prevents repetition; Ollama server may override
**Token filtering:** ignore empty/whitespace-only tokens to reduce noise in UI

### Native Module Contract

See [src/lib/nativeContracts.ts](src/lib/nativeContracts.ts) for types. Required interface if implementing custom native module:

```typescript
{
  ping?: () => Promise<boolean>;
  getModels?: () => Promise<string[]>;
  startChat?: (opts: { model: string; messages: NativeChatMessage[] }) => void;
  stopChat?: () => void;
  getModelsDir?: () => Promise<string>;  // optional
}
```

Emit events: `OllamaToken` (string or `{ text: string }`), `OllamaDone`, `OllamaError`

### File Map

| File                                                                       | Purpose                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [App.tsx](App.tsx)                                                         | Tab navigation (Chat/Settings); SettingsProvider wrapper                 |
| [src/context/SettingsContext.tsx](src/context/SettingsContext.tsx)         | Centralized config state + SecureStore persistence                       |
| [src/lib/providerRouter.ts](src/lib/providerRouter.ts)                     | Mode-based router; single entry point for all provider calls             |
| [src/lib/ollamaClient.ts](src/lib/ollamaClient.ts)                         | HTTP streaming client (XMLHttpRequest + NDJSON parsing)                  |
| [src/lib/nativeClient.ts](src/lib/nativeClient.ts)                         | Native module adapter + llama.rn fallback; context caching               |
| [src/lib/nativeContracts.ts](src/lib/nativeContracts.ts)                   | Native module type contracts                                             |
| [src/hooks/useStreamingText.ts](src/hooks/useStreamingText.ts)             | Token batching with Reanimated + setImmediate for efficient UI updates   |
| [src/hooks/useThrottledCallback.ts](src/hooks/useThrottledCallback.ts)     | Throttle high-frequency events (scroll, etc.)                            |
| [src/components/StreamingBubble.tsx](src/components/StreamingBubble.tsx)   | Assistant message bubble with streaming animation                        |
| [src/components/SkeletonBubble.tsx](src/components/SkeletonBubble.tsx)     | Thinking indicator skeleton bubble                                       |
| [src/screens/ChatScreen.tsx](src/screens/ChatScreen.tsx)                   | Chat UI; FlashList, thinking animations, haptic feedback, token batching |
| [src/screens/SettingsScreen.tsx](src/screens/SettingsScreen.tsx)           | Config inputs, mode toggle, native availability check, model browser     |
| [native-bridge/android/](native-bridge/android/)                           | Kotlin skeletons for custom OllamaNative module (Phase 3+)               |
| [plugins/with-ollama-native.js](plugins/with-ollama-native.js)             | EAS/Expo Config Plugin for native module integration                     |
| [docs/phase3-optionb-llama-native.md](docs/phase3-optionb-llama-native.md) | Detailed Phase 3 native integration guide                                |

### Debugging Tips

- **Connectivity issues:** Check `pingProvider()` error message; emulator uses `10.0.2.2`, devices need LAN IP + firewall rule
- **Tokens stop mid-stream:** Inspect `parseNew()` in [src/lib/ollamaClient.ts](src/lib/ollamaClient.ts); verify `lastIndex` increments and final buffer flush on `readyState === 4`
- **Native mode unavailable:** Expected if dev client not built; fall back to remote mode or build via EAS
- **Context cache stale:** Model path must match exactly; verify via `ensureContext()` logs
- **Token batching issues:** Check `setImmediate()` batching in [src/hooks/useStreamingText.ts](src/hooks/useStreamingText.ts); batches happen within same frame
- **Input lag during typing:** Verify 50ms debounce on TextInput in [src/screens/ChatScreen.tsx](src/screens/ChatScreen.tsx)
- **GGUF validation errors:** Ensure file exists, is readable, and valid GGUF format (Phase 3+)

### When to Merge vs. Fork Logic

- **Provider router:** Add new routing modes here; keep HTTP and Native clients isolated
- **Settings persistence:** Use `saveSettings()` atomically; never bypass SecureStore
- **UI updates during streaming:** Always go through token batching to prevent thrashing
- **Stop tokens:** Extend via `defaultStop` array in [src/lib/ollamaClient.ts](src/lib/ollamaClient.ts); respect server overrides
- **Error hints:** Add device-specific diagnostics to help users self-service
