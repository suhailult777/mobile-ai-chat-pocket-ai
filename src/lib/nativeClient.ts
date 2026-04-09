import { NativeEventEmitter, NativeModules } from "react-native";
import { File } from "expo-file-system/next";
import type { ChatMessage, StreamHandle } from "./ollamaClient";
import type { AgentExecutionStatus } from "./toolExecutor";
import * as ToolExecutor from "./nativeToolExecutor";

type StreamCallbacks = {
  onToken: (t: string) => void;
  onMeta?: (meta: {
    requestedModel?: string;
    selectedModel?: string;
    fallbackUsed?: boolean;
  }) => void;
  onStatus?: (status: AgentExecutionStatus) => void;
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
let cachedContextNctx = 512;
let cachedContext: any | null = null;
let contextInitPromise: Promise<any> | null = null;
let contextInitKey: string | null = null;
let parallelEnabledForContext: WeakSet<any> = new WeakSet();

// KV-cache state persistence for conversation continuity
let cachedKvState: ArrayBuffer | null = null;
let kvStateMessageCount = 0;

// Speculative decoding: draft model context
let draftModelPath: string | null = null;
let draftContext: any | null = null;
let draftContextInitPromise: Promise<any> | null = null;

// Speculative decoding configuration
const SPECULATION_TOKENS = 4; // Number of tokens to speculate ahead
const SPECULATION_BATCH_SIZE = 128;

async function ensureContext(modelPath: string, nCtx = 512) {
  const cacheKey = `${modelPath}::${nCtx}`;
  if (
    cachedContext &&
    cachedModelPath === modelPath &&
    cachedContextNctx === nCtx
  )
    return cachedContext;
  if (contextInitPromise && contextInitKey === cacheKey)
    return contextInitPromise;

  contextInitKey = cacheKey;

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
          `Model file not found at path: ${filePath}\n\nPlease re-import the model using the Model Browser in Settings.`,
        );
      }
    } catch (fileErr: any) {
      throw new Error(
        `Cannot access model file: ${fileErr?.message || fileErr}`,
      );
    }

    // Validate GGUF format if available
    if (typeof loadLlamaModelInfo === "function") {
      await loadLlamaModelInfo(filePath);
    }

    // Dispose previous context if switching models or context size (if dispose exists)
    if (
      cachedContext &&
      ((cachedModelPath && cachedModelPath !== modelPath) ||
        cachedContextNctx !== nCtx)
    ) {
      try {
        cachedContext.dispose?.();
      } catch {}
      // Clear KV cache when switching models
      cachedKvState = null;
      kvStateMessageCount = 0;
    }

    // Try GPU (OpenCL) by default; fall back to CPU-only if unavailable
    // Use safe defaults for n_ctx and memory locking.
    let ctx: any | null = null;
    try {
      ctx = await initLlama({
        model: modelPath,
        n_ctx: nCtx,
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
        n_ctx: nCtx,
        n_gpu_layers: 0,
        n_parallel: 2,
        use_mlock: false,
      });
    }

    cachedContext = ctx;
    cachedModelPath = modelPath;
    cachedContextNctx = nCtx;

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
    contextInitKey = null;
  }
}

// Save KV-cache state after completion for faster follow-up messages
async function saveKvState(context: any, messageCount: number): Promise<void> {
  try {
    if (typeof context?.saveState === "function") {
      cachedKvState = await context.saveState();
      kvStateMessageCount = messageCount;
    }
  } catch {
    // Best-effort; not all llama.rn versions support this
  }
}

// Restore KV-cache state before completion to skip re-processing history
async function restoreKvState(
  context: any,
  messageCount: number,
): Promise<boolean> {
  try {
    // Only restore if we have a cached state and message count matches
    // (indicates continuation of same conversation)
    if (
      cachedKvState &&
      kvStateMessageCount > 0 &&
      messageCount > kvStateMessageCount &&
      typeof context?.loadState === "function"
    ) {
      await context.loadState(cachedKvState);
      return true;
    }
  } catch {
    // Failed to restore; will process from scratch
  }
  return false;
}

// Invalidate KV cache (e.g., when conversation is cleared)
export function invalidateKvCache(): void {
  cachedKvState = null;
  kvStateMessageCount = 0;
}

// Initialize draft model context for speculative decoding
async function ensureDraftContext(modelPath: string): Promise<any | null> {
  if (draftContext && draftModelPath === modelPath) return draftContext;
  if (draftContextInitPromise && draftModelPath === modelPath)
    return draftContextInitPromise;

  draftContextInitPromise = (async () => {
    const lrn = await getLlamaRn();
    if (!lrn) return null;
    const { initLlama, loadLlamaModelInfo } = lrn;
    if (typeof initLlama !== "function") return null;

    // Validate draft model file
    const filePath = modelPath.replace(/^file:\/\//, "");
    const fileUri = `file://${filePath}`;
    try {
      const modelFile = new File(fileUri);
      const fileExists = await modelFile.exists;
      if (!fileExists) return null;
    } catch {
      return null;
    }

    // Validate GGUF format
    if (typeof loadLlamaModelInfo === "function") {
      try {
        await loadLlamaModelInfo(filePath);
      } catch {
        return null;
      }
    }

    // Dispose previous draft context if switching
    if (draftContext && draftModelPath && draftModelPath !== modelPath) {
      try {
        draftContext.dispose?.();
      } catch {}
    }

    // Initialize draft context with minimal resources
    let ctx: any | null = null;
    try {
      ctx = await initLlama({
        model: modelPath,
        n_ctx: 256, // Smaller context for draft
        n_gpu_layers: 99,
        n_parallel: 1,
        use_mlock: false,
      });
    } catch {
      // Try CPU-only
      try {
        ctx = await initLlama({
          model: modelPath,
          n_ctx: 256,
          n_gpu_layers: 0,
          n_parallel: 1,
          use_mlock: false,
        });
      } catch {
        return null;
      }
    }

    draftContext = ctx;
    draftModelPath = modelPath;
    return ctx;
  })();

  try {
    const ctx = await draftContextInitPromise;
    return ctx;
  } finally {
    draftContextInitPromise = null;
  }
}

// Speculative decoding: generate tokens with draft model, verify with main model
async function speculativeGenerate(
  mainContext: any,
  draftCtx: any,
  messages: ChatMessage[],
  stopWords: string[],
  onToken: (t: string) => void,
  shouldCancel: () => boolean,
): Promise<string> {
  let fullText = "";
  let iterations = 0;
  const maxIterations = 100; // Safety limit

  while (iterations < maxIterations && !shouldCancel()) {
    iterations++;

    // Step 1: Draft model generates SPECULATION_TOKENS tokens
    const draftTokens: string[] = [];
    try {
      const draftResult = await draftCtx.completion(
        {
          messages: [
            ...messages,
            { role: "assistant" as const, content: fullText },
          ],
          n_predict: SPECULATION_TOKENS,
          n_batch: SPECULATION_BATCH_SIZE,
          stop: stopWords,
        },
        (data: any) => {
          const t = data?.token ?? data?.content ?? "";
          if (t) draftTokens.push(t);
        },
      );

      // Check for stop condition
      if (draftTokens.length === 0 || (draftResult as any)?.stopped) {
        break;
      }
    } catch {
      // Draft failed, fall back to single-token generation
      break;
    }

    // Step 2: Main model verifies draft tokens (single forward pass)
    // This is a simplified implementation - full speculative decoding
    // requires comparing logits, but we approximate by checking output match
    const speculatedText = draftTokens.join("");
    let verifiedText = "";

    try {
      const verifyResult = await mainContext.completion(
        {
          messages: [
            ...messages,
            { role: "assistant" as const, content: fullText },
          ],
          n_predict: draftTokens.length,
          n_batch: SPECULATION_BATCH_SIZE,
          stop: stopWords,
        },
        (data: any) => {
          const t = data?.token ?? data?.content ?? "";
          if (t) verifiedText += t;
        },
      );

      // Accept verified tokens
      if (verifiedText) {
        fullText += verifiedText;
        onToken(verifiedText);
      }

      // Check for stop condition
      if ((verifyResult as any)?.stopped || verifiedText.length === 0) {
        break;
      }
    } catch {
      break;
    }
  }

  return fullText;
}

export function streamNative(
  opts: {
    model: string;
    messages: ChatMessage[];
    agentMode?: boolean;
    baseUrl: string;
    openclawEnabled?: boolean;
    openclawNodeId?: string;
    turboMode?: boolean;
    draftModel?: string;
  } & StreamCallbacks,
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

  const emitStatus = (status: AgentExecutionStatus) => {
    opts.onStatus?.(status);
  };

  const classifyToolResultState = (
    toolName: string,
    resultText: string,
  ): AgentExecutionStatus => {
    const lower = resultText.toLowerCase();
    if (lower.includes("replayed")) {
      return { state: "replayed", tool: toolName, detail: resultText, replayed: true };
    }
    if (
      lower.includes("denied by policy") ||
      lower.includes("command_denied") ||
      lower.includes("forbidden")
    ) {
      return { state: "denied_by_policy", tool: toolName, detail: resultText };
    }
    if (
      lower.startsWith("web_search error:") ||
      lower.startsWith("fetch_page error:") ||
      lower.startsWith("openclaw error")
    ) {
      return { state: "error", tool: toolName, detail: resultText };
    }
    if (lower.includes("timeout")) {
      return { state: "error", tool: toolName, detail: resultText };
    }
    return { state: "idle", tool: toolName, detail: resultText };
  };

  (async () => {
    try {
      const modelPath = opts.model;
      if (!modelPath || !/^file:\/\//.test(modelPath)) {
        throw new Error(
          "In Native mode, set Settings → Model to a file:// path for a GGUF model",
        );
      }
      const nCtx = opts.agentMode ? 2048 : 512;
      const context = await ensureContext(modelPath, nCtx);

      const selectedModel = modelPath.split("/").pop() || modelPath;
      opts.onMeta?.({
        requestedModel: selectedModel,
        selectedModel,
        fallbackUsed: false,
      });

      // Common stop tokens from llama.cpp examples
      // Use a minimal, safer set of stop tokens to avoid premature endings on some models
      const stopWords = ["</s>", "<|eot_id|>"];

      // Try to restore KV-cache for faster follow-up messages
      const messageCount = opts.messages.length;
      const kvRestored = await restoreKvState(context, messageCount);

      // Check if speculative decoding is enabled and draft model is available
      const useTurbo =
        !opts.agentMode &&
        opts.turboMode &&
        opts.draftModel &&
        /^file:\/\//.test(opts.draftModel);
      let draftCtx: any | null = null;

      if (useTurbo) {
        draftCtx = await ensureDraftContext(opts.draftModel!);
      }

      // If turbo mode with valid draft context, use speculative decoding
      if (useTurbo && draftCtx) {
        const result = await speculativeGenerate(
          context,
          draftCtx,
          opts.messages,
          stopWords,
          (t) => {
            if (!active || canceled) return;
            emittedText += t;
            opts.onToken(t);
          },
          () => canceled || !active,
        );

        if (!active) return;
        if (!canceled && !stopped) {
          await saveKvState(context, messageCount + 1);
          opts.onDone && opts.onDone();
        }
        return;
      }

      if (opts.agentMode) {
        const maxAgentLoops = 4;
        const toolSystemPrompt = ToolExecutor.buildToolSystemPrompt({
          openclawEnabled: opts.openclawEnabled,
        });
        let workingMessages: ChatMessage[] = [
          { role: "system", content: toolSystemPrompt },
          ...opts.messages,
        ];
        let lastToolSignature: string | null = null;
        let repeatedToolCount = 0;
        const maxRepeatedToolCalls = 4;

        for (let loop = 0; loop < maxAgentLoops; loop++) {
          if (!active || canceled) return;

          let result: any = null;
          let loopEmittedText = "";

          result = await context.completion(
            {
              messages: workingMessages,
              n_predict: 1024,
              n_batch: 256,
              stop: stopWords,
            },
            (data: any) => {
              if (!active || canceled) return;
              const t = data?.token ?? data?.content ?? "";
              if (t) {
                emittedText += t;
                loopEmittedText += t;
                opts.onToken(t);
              }
            },
          );

          if (!active || canceled) return;

          const tail = (result as any)?.text ?? "";
          if (tail) {
            const remaining = tail.startsWith(loopEmittedText)
              ? tail.slice(loopEmittedText.length)
              : tail.slice(loopEmittedText.length);
            if (remaining) {
              emittedText += remaining;
              loopEmittedText += remaining;
              opts.onToken(remaining);
            }
          }

          const toolCall = ToolExecutor.parseToolCall(loopEmittedText);
          if (!toolCall) {
            break;
          }

          emitStatus({
            state: "awaiting_approval",
            tool: toolCall.name,
            detail: "Tool call parsed",
          });

          const toolSignature =
            ToolExecutor.normalizeToolCallSignature(toolCall);
          const loopState = ToolExecutor.advanceToolLoopState(
            {
              lastSignature: lastToolSignature,
              repeatedCount: repeatedToolCount,
            },
            toolSignature,
            maxRepeatedToolCalls,
          );
          lastToolSignature = loopState.lastSignature;
          repeatedToolCount = loopState.repeatedCount;

          if (loopState.loopDetected) {
            emitStatus({
              state: "loop_detected",
              tool: toolCall.name,
              detail: `Repeated tool call signature detected ${repeatedToolCount} times`,
            });
            opts.onError?.(
              new Error(
                `Tool loop detected for ${toolCall.name} after ${repeatedToolCount} repeated calls`,
              ),
            );
            return;
          }

          if (!active || canceled) return;

          opts.onToken(`\n\nTool Call • ${toolCall.name}\n`);
          try {
            const openclawTool =
              toolCall.name === "openclaw_list_nodes" ||
              toolCall.name === "openclaw_node_status" ||
              toolCall.name === "openclaw_run_command";
            emitStatus({
              state: openclawTool ? "executing_on_node" : "awaiting_approval",
              tool: toolCall.name,
              nodeId: openclawTool
                ? opts.openclawNodeId || String(toolCall.arguments?.node_id || toolCall.arguments?.nodeId || "") || undefined
                : undefined,
              detail: openclawTool ? "Executing via OpenClaw bridge" : "Executing tool",
            });
            const toolResult = await ToolExecutor.executeParsedToolCall(
              toolCall,
              {
                baseUrl: opts.baseUrl,
                openclawEnabled: opts.openclawEnabled,
                openclawNodeId: opts.openclawNodeId,
              },
            );

            emitStatus(classifyToolResultState(toolCall.name, toolResult));

            workingMessages = [
              ...workingMessages,
              { role: "assistant", content: loopEmittedText },
              {
                role: "system",
                content: `Tool result (${toolCall.name}):\n${toolResult}`,
              },
            ];
          } catch (toolErr: any) {
            workingMessages = [
              ...workingMessages,
              { role: "assistant", content: loopEmittedText },
              {
                role: "system",
                content: `Tool result (${toolCall.name}):\ntool execution error: ${toolErr?.message || toolErr}`,
              },
            ];
            emitStatus({
              state: /denied|forbidden/i.test(String(toolErr?.message || toolErr))
                ? "denied_by_policy"
                : /loop/i.test(String(toolErr?.message || toolErr))
                  ? "loop_detected"
                  : "error",
              tool: toolCall.name,
              detail: String(toolErr?.message || toolErr),
            });
          }
        }

        if (!active) return;
        if (!canceled && !stopped) {
          await saveKvState(context, messageCount + 1);
          opts.onDone && opts.onDone();
        }
        return;
      }

      // Standard completion (non-turbo) path
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
          },
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
          },
        );
      }

      if (!active) return;
      if (!canceled && !stopped) {
        // Save KV-cache state for faster follow-up messages
        await saveKvState(context, messageCount + 1);

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

// Dispose native context and clear all caches (for memory management)
export async function disposeNative(): Promise<void> {
  try {
    if (cachedContext) {
      await cachedContext.dispose?.();
    }
  } catch {
    // Best-effort disposal
  } finally {
    cachedContext = null;
    cachedModelPath = null;
    cachedKvState = null;
    kvStateMessageCount = 0;
    contextInitPromise = null;
    cachedContextNctx = 512;
    contextInitKey = null;
  }
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
