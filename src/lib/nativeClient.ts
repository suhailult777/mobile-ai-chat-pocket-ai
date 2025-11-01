import { NativeEventEmitter, NativeModules } from "react-native";
import { File } from "expo-file-system/next";
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

// Cache a single initialized llama context per model path to avoid re-initializing
// on every message. This dramatically reduces cold-start latency in Native mode.
let cachedModelPath: string | null = null;
let cachedContext: any | null = null;
let contextInitPromise: Promise<any> | null = null;
let parallelEnabledForContext: WeakSet<any> = new WeakSet();

async function ensureContext(modelPath: string) {
  if (cachedContext && cachedModelPath === modelPath) return cachedContext;
  if (contextInitPromise && cachedModelPath === modelPath)
    return contextInitPromise;

  contextInitPromise = (async () => {
    const lrn = await getLlamaRn();
    if (!lrn) throw new Error("llama.rn not available (dev client required)");
    const { initLlama, loadLlamaModelInfo } = lrn;
    if (typeof initLlama !== "function")
      throw new Error("llama.rn missing initLlama()");

    // Preflight validation: check file exists and is readable
    const filePath = modelPath.replace(/^file:\/\//, "");
    const fileUri = `file://${filePath}`;
    try {
      const modelFile = new File(fileUri);
      const fileExists = await modelFile.exists;
      if (!fileExists) {
        throw new Error(
          `Model file not found at path: ${filePath}\n\nPlease re-import the model using the Model Browser in Settings.`
        );
      }
    } catch (fileErr: any) {
      throw new Error(
        `Cannot access model file: ${fileErr?.message || fileErr}`
      );
    }

    // Validate GGUF format if available
    if (typeof loadLlamaModelInfo === "function") {
      await loadLlamaModelInfo(filePath);
    }

    // Try GPU (OpenCL) by default; fall back to CPU-only if unavailable
    // Use safe defaults for n_ctx and memory locking.
    let ctx: any | null = null;
    try {
      ctx = await initLlama({
        model: modelPath,
        n_ctx: 512,
        n_gpu_layers: 99, // offload as many layers as possible
        n_parallel: 2,
        use_mlock: false,
      });
      // If the result indicates no GPU, we will still keep the context (CPU)
      // Some builds expose ctx.gpu or ctx.reasonNoGPU; this is best-effort.
    } catch (gpuErr) {
      // Retry with CPU-only
      ctx = await initLlama({
        model: modelPath,
        n_ctx: 512,
        n_gpu_layers: 0,
        n_parallel: 2,
        use_mlock: false,
      });
    }

    // Dispose previous context if switching models (if dispose exists)
    if (cachedContext && cachedModelPath && cachedModelPath !== modelPath) {
      try {
        cachedContext.dispose?.();
      } catch {}
    }
    cachedContext = ctx;
    cachedModelPath = modelPath;
    // Enable parallel mode once to allow cancellable requests
    try {
      if (!parallelEnabledForContext.has(ctx) && ctx?.parallel?.enable) {
        const ok = await ctx.parallel.enable({ n_parallel: 2, n_batch: 256 });
        if (ok) parallelEnabledForContext.add(ctx);
      }
    } catch (e) {
      // Parallel not available or failed to enable; fall back to single completion later
    }
    return ctx;
  })();

  try {
    const ctx = await contextInitPromise;
    return ctx;
  } finally {
    contextInitPromise = null; // allow future re-init attempts if needed
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
  let stopHandleRef: null | (() => Promise<void> | void) = null;

  // Track emitted text for this stream so we don't emit duplicated final text
  // (some backends return an accumulated `result.text` in addition to per-token
  // callbacks). We append tokens as they arrive and only emit the remaining
  // suffix from `result.text` after completion.
  let emittedText = "";

  (async () => {
    try {
      const modelPath = opts.model;
      if (!modelPath || !/^file:\/\//.test(modelPath)) {
        throw new Error(
          "In Native mode, set Settings → Model to a file:// path for a GGUF model"
        );
      }
      const context = await ensureContext(modelPath);

      // Common stop tokens from llama.cpp examples
      // Use a minimal, safer set of stop tokens to avoid premature endings on some models
      const stopWords = ["</s>", "<|eot_id|>"];

      // Stream completion with partial token callback
      // Try to ensure parallel is enabled before using parallel.completion
      let result: any = null;
      let canUseParallel = false;
      try {
        if (
          context?.parallel?.enable &&
          !parallelEnabledForContext.has(context)
        ) {
          const ok = await context.parallel.enable({
            n_parallel: 2,
            n_batch: 256,
          });
          if (ok) parallelEnabledForContext.add(context);
        }
        canUseParallel = !!(
          context?.parallel?.completion &&
          parallelEnabledForContext.has(context)
        );
      } catch {
        canUseParallel = false;
      }

      if (canUseParallel) {
        const { requestId, promise, stop } = await context.parallel.completion(
          {
            messages: opts.messages,
            n_predict: 256,
            n_batch: 256,
            stop: stopWords,
          },
          (_requestId: any, data: any) => {
            if (!active || canceled) return;
            const t = data?.token ?? data?.content ?? "";
            if (t) {
              emittedText += t;
              opts.onToken(t);
            }
          }
        );
        stopHandleRef = stop;
        result = await promise;
      } else {
        // Fallback to single completion without true cancel
        result = await context.completion(
          {
            messages: opts.messages,
            n_predict: 256,
            n_batch: 256,
            stop: stopWords,
          },
          (data: any) => {
            if (!active || canceled) return;
            const t = data?.token ?? data?.content ?? "";
            if (t) {
              emittedText += t;
              opts.onToken(t);
            }
          }
        );
      }

      if (!active) return;
      if (!canceled && !stopped) {
        // Some bindings return an accumulated text in result.text. Only emit
        // the suffix that hasn't already been emitted via per-token callbacks.
        const tail = (result as any)?.text ?? "";
        if (tail) {
          if (!tail.startsWith(emittedText)) {
            // If the returned text is not a simple extension, emit the full
            // text but avoid duplicating an exact prefix we've already sent.
            const remaining = tail.slice(emittedText.length);
            if (remaining) opts.onToken(remaining);
          } else {
            const remaining = tail.slice(emittedText.length);
            if (remaining) opts.onToken(remaining);
          }
        }
        opts.onDone && opts.onDone();
      }
    } catch (e: any) {
      if (!active) return;
      console.error("[nativeClient] Error in streamNative:", e);
      const errorMsg = e?.message || String(e);
      opts.onError && opts.onError(new Error(`Native mode error: ${errorMsg}`));
    }
  })();

  return {
    cancel: () => {
      canceled = true;
      active = false;
      try {
        // Try to stop the parallel request if present
        if (typeof stopHandleRef === "function") stopHandleRef();
      } catch {}
    },
  };
}

// Optional prewarmer: initialize llama context for the current model path.
export async function prewarmNative(modelPath: string): Promise<boolean> {
  try {
    if (!/^file:\/\//.test(modelPath)) return false;
    const ctx = await ensureContext(modelPath);
    try {
      if (!parallelEnabledForContext.has(ctx) && ctx?.parallel?.enable) {
        const ok = await ctx.parallel.enable({ n_parallel: 2, n_batch: 256 });
        if (ok) parallelEnabledForContext.add(ctx);
      }
    } catch {}
    return true;
  } catch {
    return false;
  }
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
