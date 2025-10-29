// Phase 3 Option B — llama.cpp native bridge contract
// Implement a native module named `OllamaNative` (preferred) or `Ollama`
// exposing these methods and events.
//
// Methods (all optional during development, but recommended):
// - ping(): Promise<boolean>
// - getModels(): Promise<string[]>
// - startChat({ model, messages }): void
// - stopChat(): void
// - getModelsDir(): Promise<string>  // optional helper for Settings display
//
// Events emitted by the native side (subscribe with NativeEventEmitter):
// - "OllamaToken" => { text: string } | string
// - "OllamaDone"  => void
// - "OllamaError" => { message: string } | string
//
// The JS code in `nativeClient.ts` already listens for these events and
// adapts payloads (plain string or object with `text`).

export type NativeChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type OllamaNativeModule = {
  ping?: () => Promise<boolean> | boolean;
  getModels?: () => Promise<string[]> | string[];
  startChat?: (opts: { model: string; messages: NativeChatMessage[] }) => void;
  stopChat?: () => void;
  getModelsDir?: () => Promise<string> | string;
};
