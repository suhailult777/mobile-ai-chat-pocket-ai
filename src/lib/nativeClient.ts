import { NativeEventEmitter, NativeModules } from "react-native";
import type { ChatMessage, StreamHandle } from "./ollamaClient";

type StreamCallbacks = {
  onToken: (t: string) => void;
  onError?: (e: any) => void;
  onDone?: () => void;
};

function getNative(): any | null {
  const mod = (NativeModules as any)?.OllamaNative || (NativeModules as any)?.Ollama;
  return mod ?? null;
}

export function streamNative(opts: {
  model: string;
  messages: ChatMessage[];
} & StreamCallbacks): StreamHandle {
  const mod = getNative();
  if (!mod) {
    // Report unavailability async so callers behave consistently
    setTimeout(() => opts.onError && opts.onError(new Error("Native Ollama module not available. Build a dev client/EAS.")), 0);
    return { cancel: () => {} };
  }

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

export async function pingNative(): Promise<boolean> {
  const mod = getNative();
  if (!mod) return false;
  try {
    const res = await (mod.ping?.() ?? false);
    return !!res;
  } catch {
    return false;
  }
}

export async function getModelsNative(): Promise<string[]> {
  const mod = getNative();
  if (!mod) return [];
  try {
    const list = await (mod.getModels?.() ?? []);
    if (Array.isArray(list)) return list.filter((x: any) => typeof x === "string");
    return [];
  } catch {
    return [];
  }
}
