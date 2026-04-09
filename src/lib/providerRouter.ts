import type { ChatMessage, StreamHandle } from "./ollamaClient";
import type { AgentExecutionStatus } from "./toolExecutor";
import {
  streamNvidiaProxy,
  getNvidiaProxyModels,
  pingNvidiaProxy,
} from "./nvidiaProxyClient";
import {
  streamNative,
  getModelsNative,
  pingNative,
  prewarmNative,
  disposeNative,
} from "./nativeClient";

export type ConnectionMode = "nvidia-proxy" | "native";

// Request deduplication - track active stream
let activeStreamHandle: StreamHandle | null = null;
let lastRequestTime = 0;
const DEBOUNCE_MS = 500;

export function pingProvider(opts: {
  mode: ConnectionMode;
  baseUrl: string;
}): Promise<boolean> {
  return opts.mode === "native" ? pingNative() : pingNvidiaProxy(opts.baseUrl);
}

export function getModelsProvider(opts: {
  mode: ConnectionMode;
  baseUrl: string;
}): Promise<string[]> {
  return opts.mode === "native"
    ? getModelsNative()
    : getNvidiaProxyModels(opts.baseUrl);
}

export function streamProvider(opts: {
  mode: ConnectionMode;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  onToken: (t: string) => void;
  onMeta?: (meta: {
    requestedModel?: string;
    selectedModel?: string;
    fallbackUsed?: boolean;
  }) => void;
  onError?: (e: any) => void;
  onDone?: () => void;
  onStatus?: (status: AgentExecutionStatus) => void;
  agentMode?: boolean;
  // Speculative decoding options (native mode only)
  turboMode?: boolean;
  draftModel?: string;
  openclawEnabled?: boolean;
  openclawNodeId?: string;
}): StreamHandle {
  const now = Date.now();

  // Request deduplication - cancel previous if new request within debounce window
  if (activeStreamHandle && now - lastRequestTime < DEBOUNCE_MS) {
    activeStreamHandle.cancel();
  }

  lastRequestTime = now;

  let handle: StreamHandle;

  if (opts.mode === "native") {
    handle = streamNative({
      model: opts.model,
      messages: opts.messages,
      agentMode: opts.agentMode,
      baseUrl: opts.baseUrl,
      openclawEnabled: opts.openclawEnabled,
      openclawNodeId: opts.openclawNodeId,
      onToken: opts.onToken,
      onMeta: opts.onMeta,
      onStatus: opts.onStatus,
      turboMode: opts.turboMode,
      draftModel: opts.draftModel,
      onError: (e) => {
        activeStreamHandle = null;
        opts.onError?.(e);
      },
      onDone: () => {
        activeStreamHandle = null;
        opts.onDone?.();
      },
    });
  } else {
    handle = streamNvidiaProxy({
      baseUrl: opts.baseUrl,
      model: opts.model,
      messages: opts.messages,
      agentMode: opts.agentMode,
      openclawEnabled: opts.openclawEnabled,
      openclawNodeId: opts.openclawNodeId,
      onToken: opts.onToken,
      onMeta: opts.onMeta,
      onStatus: opts.onStatus,
      onError: (e) => {
        activeStreamHandle = null;
        opts.onError?.(e);
      },
      onDone: () => {
        activeStreamHandle = null;
        opts.onDone?.();
      },
    });
  }

  activeStreamHandle = handle;

  // Wrap cancel to clear active handle
  const originalCancel = handle.cancel;
  handle.cancel = () => {
    activeStreamHandle = null;
    originalCancel();
  };

  return handle;
}

export async function prewarmProvider(opts: {
  mode: ConnectionMode;
  model: string;
}): Promise<void> {
  if (opts.mode !== "native") return;
  await prewarmNative(opts.model);
}

export async function disposeProvider(opts: {
  mode: ConnectionMode;
}): Promise<void> {
  if (opts.mode !== "native") return;
  await disposeNative();
}
