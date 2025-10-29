## Copilot / AI Agent Instructions — Ollama Mobile

Purpose: give AI coding agents the minimum, concrete context to be productive in this repo. Keep edits small, respect existing data flow and provider contracts.

1. What this app is

- Expo-managed React Native + TypeScript chat client for Ollama over localhost/LAN.
- Two modes via a provider router: Remote HTTP (works in Expo Go) and Native (dev client/EAS; stubbed until a native module exists).

2. Architecture and data flow

- UI: `App.tsx` renders two screens: `ChatScreen` and `SettingsScreen`.
- State: `src/context/SettingsContext.tsx` is the single source of truth (host, port, model, mode) persisted with `expo-secure-store` via `saveSettings`.
- Provider: `src/lib/providerRouter.ts` exposes `pingProvider`, `getModelsProvider`, `streamProvider` and routes to HTTP or Native.
- HTTP client: `src/lib/ollamaClient.ts` uses `XMLHttpRequest` to stream NDJSON; core loop is `parseNew` with `lastIndex` and a line buffer. It emits tokens via `onToken` and calls `onDone` on flush.
- Native stub: `src/lib/nativeClient.ts` calls a module named `OllamaNative` or `Ollama`, wiring events `OllamaToken`, `OllamaDone`, `OllamaError`.
- Chat flow: `ChatScreen` builds history, seeds an empty assistant message, calls `streamProvider`, and appends tokens to the last assistant message.

3. Dev workflow (Windows PowerShell examples)

- Install deps: `npm install`
- Start Expo: `npm start`
- Open on Android (Expo Go): `npm run android`
- Typecheck: `npm run typecheck`

4. Integration points (Ollama and Native)

- HTTP: `/api/chat` (stream), `/api/tags` or `/api/models` (list), `/api/version` (ping).
- `getModels` auto-falls back from `/api/tags` to `/api/models` and normalizes shapes.
- Native contract (if present): `ping()`, `getModels()`, `startChat({ model, messages })`, `stopChat()` + events above.

5. Project-specific conventions and gotchas

- Always invoke provider router from screens; never call `ollamaClient` directly from UI.
- Preserve NDJSON line-by-line parsing in `ollamaClient.ts` (buffer split, `lastIndex`, final-line flush). Don’t switch to fetch streams.
- Network defaults: `127.0.0.1:11434`. Android emulator: `10.0.2.2`. Real device: use PC LAN IP and ensure Ollama bound to `0.0.0.0` and firewall allows 11434.
- Settings changes must go through `saveSettings` so SecureStore stays in sync.

6. Where to look when changing things

- Provider switching: `src/lib/providerRouter.ts`
- Streaming HTTP client: `src/lib/ollamaClient.ts`
- Native wiring (stub): `src/lib/nativeClient.ts`
- UI usage of provider and streaming: `src/screens/ChatScreen.tsx`
- Settings, tests, and mode toggle: `src/screens/SettingsScreen.tsx`

7. Debugging quick tips

- Preflight connectivity in `ChatScreen` uses `pingProvider` to surface actionable errors (emulator vs device hints).
- If tokens stop mid-stream, inspect `parseNew`, `buffer` handling, and the final flush on `readyState === 4`.
- If Native mode fails, ensure dev client includes the module; otherwise expect the explicit “not available” error.

Maintainer questions (for PR notes)

- Should we add linting/tests now or wait for the Native phase? (placeholders exist in `package.json`)
- If the streaming protocol changes, do you want an integration fixture of a recorded NDJSON stream in tests?
