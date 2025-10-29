import { NativeEventEmitter, NativeModules } from "react-native";
import type { ChatMessage, StreamHandle } from "./ollamaClient";

type StreamCallbacks = {
  onToken: (t: string) => void;
  onError?: (e: any) => void;
  onDone?: () => void;
};

function getNative(): any | null {
  const mod =
    (NativeModules as any)?.OllamaNative || (NativeModules as any)?.Ollama;
  return mod ?? null;
}

// Lazy import llama.rn for a JS fallback when no NativeModule exists.
// This allows using the library's JS API (initLlama + completion callback)
// without requiring a custom RN NativeModule name.
let llamaRn: any | null = null;
async function getLlamaRn(): Promise<any | null> {
  if (llamaRn) return llamaRn;
  try {
    // Dynamic import to avoid crashing in environments without the native side
    // (e.g., Expo Go where the module isn't present).
    const mod = await import("llama.rn");
    llamaRn = mod;
    return mod;
  } catch {
    return null;
  }
}

export function streamNative(
  opts: {
    model: string;
    messages: ChatMessage[];
  } & StreamCallbacks
): StreamHandle {
  const mod = getNative();
  if (mod) {
    // Preferred path: NativeModule with DeviceEventEmitter events
    const emitter = new NativeEventEmitter(mod);
    const subToken = emitter.addListener("OllamaToken", (ev: any) => {
      const t = typeof ev === "string" ? ev : ev?.text;
      if (t) opts.onToken(t);
    });
    const subDone = emitter.addListener("OllamaDone", () => {
      opts.onDone && opts.onDone();
    });
    const subErr = emitter.addListener("OllamaError", (e: any) => {
      opts.onError && opts.onError(e);
    });

    try {
      mod.startChat?.({ model: opts.model, messages: opts.messages });
    } catch (e) {
      opts.onError && opts.onError(e);
    }

    return {
      cancel: () => {
        try {
          mod.stopChat?.();
        } finally {
          subToken.remove();
          subDone.remove();
          subErr.remove();
        }
      },
    };
  }

  // Fallback path: use llama.rn JS API directly (no custom NativeModule name)
  let canceled = false;
  let stopped = false;
  let active = true;

  (async () => {
    try {
      const lrn = await getLlamaRn();
      if (!lrn) throw new Error("llama.rn not available (dev client required)");

      const { initLlama } = lrn;
      if (typeof initLlama !== "function")
        throw new Error("llama.rn missing initLlama()");

      const modelPath = opts.model;
      if (!modelPath || !/^file:\/\//.test(modelPath)) {
        throw new Error(
          "In Native mode, set Settings → Model to a file:// path for a GGUF model"
        );
      }

      const context = await initLlama({
        model: modelPath,
        // conservative defaults; users can tune later via advanced UI
        n_ctx: 2048,
        // n_gpu_layers can be tuned later; default 0 (CPU-only) for broadest compatibility
        n_gpu_layers: 0,
        use_mlock: true,
      });

      // Common stop tokens from llama.cpp examples
      const stopWords = [
        "</s>",
        "<|end|>",
        "<|eot_id|>",
        "<|end_of_text|>",
        "<|im_end|>",
        "<|EOT|>",
        "<|END_OF_TURN_TOKEN|>",
        "<|end_of_turn|>",
        "<|endoftext|>",
      ];

      // Stream completion with partial token callback
      const result = await context.completion(
        {
          messages: opts.messages,
          n_predict: 256,
          stop: stopWords,
        },
        (data: any) => {
          if (!active || canceled) return;
          const t = data?.token ?? data?.content ?? "";
          if (t) opts.onToken(t);
        }
      );

      if (!active) return;
      if (!canceled && !stopped) {
        // Emit any remaining text (some bindings provide accumulated text)
        const tail = (result as any)?.text;
        if (tail) opts.onToken(tail);
        opts.onDone && opts.onDone();
      }
    } catch (e) {
      if (!active) return;
      opts.onError && opts.onError(e);
    }
  })();

  return {
    cancel: () => {
      canceled = true;
      active = false;
      // No direct cancellation API exposed here; we stop emitting tokens.
    },
  };
}

export async function pingNative(): Promise<boolean> {
  const mod = getNative();
  try {
    if (mod) {
      const res = await (mod.ping?.() ?? false);
      if (res) return true;
    }
    // Fallback: if llama.rn is importable, consider native path available
    const lrn = await getLlamaRn();
    return !!lrn;
  } catch {
    return false;
  }
}

export async function getModelsNative(): Promise<string[]> {
  const mod = getNative();
  if (!mod) return [];
  try {
    const list = await (mod.getModels?.() ?? []);
    if (Array.isArray(list))
      return list.filter((x: any) => typeof x === "string");
    return [];
  } catch {
    return [];
  }
}

// Optional Phase 3 helpers (no-ops if the native module doesn't provide them)
export function isNativeAvailable(): boolean {
  return !!getNative();
}

export async function getModelsDirNative(): Promise<string | null> {
  const mod = getNative();
  if (!mod || typeof mod.getModelsDir !== "function") return null;
  try {
    const dir = await mod.getModelsDir();
    return typeof dir === "string" ? dir : null;
  } catch {
    return null;
  }
}
