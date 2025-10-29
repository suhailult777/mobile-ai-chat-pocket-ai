# Phase 3 — Option B: llama.cpp Native Integration (Android-first)

This repo already has a stable JS contract in `src/lib/nativeContracts.ts` and wiring in `src/lib/nativeClient.ts`. Implement the Android native bridge named `OllamaNative` to adapt any RN llama.cpp library to this contract.

## Contract to implement (native)

Methods:

- ping(): Promise<boolean>
- getModels(): Promise<string[]>
- startChat({ model, messages }): void
- stopChat(): void
- getModelsDir(): Promise<string> (optional, for Settings display)

Events (to emit via RCTDeviceEventEmitter):

- "OllamaToken": string | { text: string }
- "OllamaDone": void
- "OllamaError": string | { message: string }

The JS listens to these in `nativeClient.ts`.

## Android bridge skeleton (Kotlin)

See `native-bridge/android/OllamaNativeModule.kt` and `OllamaNativePackage.kt` for a ready-to-adapt outline:

- Exports the required methods
- Emits events per token and on completion/error
- Includes TODOs to call your chosen llama.cpp RN library

## Steps (pnpm + EAS dev client)

```powershell
# 1) Install deps
pnpm install

# 2) Add a RN llama.cpp library
# Example (choose one and verify):
# pnpm add @mybigday/llama.rn
# or
# pnpm add react-native-llama

# 3) Ensure the module is exported as 'OllamaNative' (or 'Ollama')
# If the library's module name differs, create this thin bridge to adapt.

# 4) Build a dev client so native code is available
npx eas build --profile development --platform android

# 5) Start in dev-client mode
pnpm run start:dev
```

Notes:

- This repo registers a placeholder config plugin at `plugins/with-ollama-native.ts`. Extend it later for ABI filters or packaging tweaks.
- Start with a small GGUF (e.g., TinyLlama, Q4_0/Q5_0). Ensure the model is present on-device and your bridge points to its directory.
- `Settings` → Native mode → Test: shows module detection and models dir if your bridge implements `getModelsDir`.
