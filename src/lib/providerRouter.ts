import type { ChatMessage, StreamHandle } from "./ollamaClient";
import {
  streamChat,
  getModels as getModelsHttp,
  ping as pingHttp,
} from "./ollamaClient";
import { streamNative, getModelsNative, pingNative } from "./nativeClient";

export type ConnectionMode = "remote" | "native";

export function pingProvider(opts: {
  mode: ConnectionMode;
  baseUrl: string;
}): Promise<boolean> {
  return opts.mode === "native" ? pingNative() : pingHttp(opts.baseUrl);
}

export function getModelsProvider(opts: {
  mode: ConnectionMode;
  baseUrl: string;
}): Promise<string[]> {
  return opts.mode === "native"
    ? getModelsNative()
    : getModelsHttp(opts.baseUrl);
}

export function streamProvider(opts: {
  mode: ConnectionMode;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  onToken: (t: string) => void;
  onError?: (e: any) => void;
  onDone?: () => void;
}): StreamHandle {
  if (opts.mode === "native") {
    return streamNative({
      model: opts.model,
      messages: opts.messages,
      onToken: opts.onToken,
      onError: opts.onError,
      onDone: opts.onDone,
    });
  }
  return streamChat({
    baseUrl: opts.baseUrl,
    model: opts.model,
    messages: opts.messages,
    onToken: opts.onToken,
    onError: opts.onError,
    onDone: opts.onDone,
  });
}
