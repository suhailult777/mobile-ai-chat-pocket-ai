## Copilot / AI Agent Instructions — Ollama Mobile (Option A Phase 1→2)

This file gives concise, actionable context for AI coding agents working on this repo.
Keep suggestions specific to the code and conventions in this project.

1. Project summary

- Expo-managed React Native + TypeScript mobile app to chat with Ollama (local/LAN).
- Phase 1: JS-only client in `src/lib/ollamaClient.ts` talks to Ollama HTTP API.
- Phase 2 (scaffolded): Provider router supports a Native mode (dev client/EAS) via a stub in `src/lib/nativeClient.ts`.

2. How to run / common commands

- Install: `npm install`
- Start dev server (Expo): `npm start`
- Android device/emulator: `npm run android` (Expo CLI). For EAS builds: `npm run android:apk`.
- Quick checks: `npm run typecheck` (uses `tsc -p .`).

3. Big-picture architecture & data flow

- UI: `App.tsx` hosts two screens: `ChatScreen` and `SettingsScreen`.
- State: `SettingsContext` is the single source of truth (host, port, model, mode) persisted by `expo-secure-store`.
- Provider router: `src/lib/providerRouter.ts` switches between Remote HTTP and Native providers.
- Remote HTTP: `src/lib/ollamaClient.ts` streams NDJSON via `XMLHttpRequest` and progressive `responseText` parsing.
- Native (scaffold): `src/lib/nativeClient.ts` expects a native module and relays token/done/error events.
- Flow: user input -> ChatScreen builds history -> provider `stream` -> append tokens to the last assistant message.

4. Project-specific conventions & gotchas

- Network: default `127.0.0.1:11434`; Android emulator: `10.0.2.2`; device: use PC LAN IP and ensure Ollama bound to `0.0.0.0`.
- Streaming: preserve NDJSON per-line parsing in `ollamaClient.ts` (`parseNew` logic, `lastIndex`/buffer handling).
- Settings: always route changes via `SettingsContext.saveSettings` to persist in `SecureStore` and update context.
- Provider: prefer `providerRouter` APIs in screens; do not reach into `ollamaClient` directly from UI.
- TypeScript: strict mode; keep signatures for `streamChat`, `getModels`, `ping` and provider wrappers.

5. Integration points & external dependencies

- Ollama HTTP API: `/api/chat`, `/api/tags` or `/api/models`, `/api/version`.
- Native module (Phase 2): expected JS name `OllamaNative` or `Ollama` with methods `ping()`, `getModels()`, `startChat({ model, messages })`, `stopChat()` and events `OllamaToken`, `OllamaDone`, `OllamaError`.
- Expo: SDK ~54. Expo Go for Remote mode; dev clients/EAS for Native mode.

6. Files to reference when making changes

- `src/lib/providerRouter.ts` — provider switching (use from UI code).
- `src/lib/ollamaClient.ts` — Remote streaming client.
- `src/lib/nativeClient.ts` — Native-mode stub and event wiring.
- `src/screens/ChatScreen.tsx` — streaming UI via provider, mode-aware errors.
- `src/screens/SettingsScreen.tsx` — mode toggle, test and fetch models via provider.
- `src/context/SettingsContext.tsx` — settings + persistence.
- `App.tsx` — tab navigation; settings managed via `SettingsProvider`.

7. Recommended agent behavior when changing code

- Preserve NDJSON parsing in Remote path; if changing, update `ChatScreen`/`SettingsScreen` messages accordingly.
- UI should call provider router, not raw clients.
- If adding Native capabilities, keep the JS contract stable and document any new events.
- Keep UI/layout deltas small; focus on connectivity and stability.

8. Troubleshooting and debugging tips (include these in PR notes)

- If device can't reach Ollama: confirm PC firewall, Ollama running (`ollama serve`), correct host (LAN IP) and that port 11434 is reachable.
- For emulator networking issues: use `10.0.2.2` (Android). For Expo Go on device, scan QR and ensure same Wi‑Fi network.
- Streaming partial JSON: check `lastIndex` and buffering logic in `ollamaClient.ts` if tokens stop mid-stream.

9. PR guidance

- Explain any protocol or network behaviour changes and list files updated that depend on streaming/parsing.
- Keep PRs focused: separate refactors (e.g., moving SettingsContext) from protocol changes.

10. Questions for the maintainer (leave in PR description if unsure)

- Do you want to add linting/tests in Phase 1 or postpone to Phase 2? (Current `package.json` has placeholders.)
- If modifying network protocol, should agents also add an integration test harness against a recorded Ollama NDJSON stream?

---

If anything above is unclear or you want more detail on a specific area (streaming parser, Settings persistence, or EAS build flow), tell me which section to expand and I will iterate.
