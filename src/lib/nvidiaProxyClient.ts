import type { ChatMessage, StreamHandle } from "./ollamaClient";
import { getToolSchemas } from "./toolExecutor";

export type NvidiaProxyStreamOptions = {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  agentMode?: boolean;
  openclawEnabled?: boolean;
  openclawNodeId?: string;
  onToken: (text: string) => void;
  onMeta?: (meta: {
    requestedModel?: string;
    selectedModel?: string;
    fallbackUsed?: boolean;
  }) => void;
  onError?: (err: any) => void;
  onDone?: () => void;
};

const HTTP_TIMEOUT_MS = 30000;

export function streamNvidiaProxy(
  opts: NvidiaProxyStreamOptions,
): StreamHandle {
  const url = normalizeUrl(opts.baseUrl) + "/v1/chat/completions";
  const xhr = new XMLHttpRequest();
  let lastIndex = 0;
  let lineBuffer = "";
  let doneSignaled = false;
  let metaSignaled = false;

  const emitMeta = (meta: {
    requestedModel?: string;
    selectedModel?: string;
    fallbackUsed?: boolean;
  }) => {
    if (!opts.onMeta) return;
    opts.onMeta(meta);
  };

  const signalDone = () => {
    if (doneSignaled) return;
    doneSignaled = true;
    opts.onDone?.();
  };

  const body = JSON.stringify({
    model: opts.model,
    messages: opts.messages,
    stream: true,
    agent_mode: Boolean(opts.agentMode),
    tools: opts.agentMode
      ? getToolSchemas({ openclawEnabled: opts.openclawEnabled })
      : undefined,
    tool_choice: opts.agentMode ? "auto" : undefined,
    openclaw_enabled: Boolean(opts.openclawEnabled),
    openclaw_node_id: opts.openclawNodeId || undefined,
  });

  const emitTokenFromObject = (obj: any) => {
    const delta = obj?.choices?.[0]?.delta;
    // GLM-5 sends reasoning/reasoning_content before content tokens
    const token: string | undefined =
      (typeof delta?.content === "string" ? delta.content : undefined) ??
      (typeof delta?.reasoning_content === "string"
        ? delta.reasoning_content
        : undefined) ??
      (typeof delta?.reasoning === "string" ? delta.reasoning : undefined) ??
      (typeof obj?.message?.content === "string"
        ? obj.message.content
        : undefined) ??
      (typeof obj?.delta === "string" ? obj.delta : undefined) ??
      (typeof obj?.token === "string" ? obj.token : undefined);

    if (token) {
      opts.onToken(token);
    }
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line) return;

    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (!payload) return;
      if (payload === "[DONE]") {
        signalDone();
        return;
      }
      try {
        const obj = JSON.parse(payload);
        if (obj?.meta) {
          emitMeta({
            requestedModel:
              typeof obj.meta.requested_model === "string"
                ? obj.meta.requested_model
                : undefined,
            selectedModel:
              typeof obj.meta.selected_model === "string"
                ? obj.meta.selected_model
                : undefined,
            fallbackUsed:
              typeof obj.meta.fallback_used === "boolean"
                ? obj.meta.fallback_used
                : undefined,
          });
        }
        emitTokenFromObject(obj);
      } catch {
        // ignore malformed partial lines
      }
      return;
    }

    try {
      const obj = JSON.parse(line);
      if (obj?.done === true) {
        signalDone();
        return;
      }
      emitTokenFromObject(obj);
    } catch {
      // ignore malformed partial lines
    }
  };

  const parseNew = (isDone = false) => {
    const text = xhr.responseText || "";
    const chunk = text.slice(lastIndex);
    lastIndex = text.length;

    if (!chunk && !isDone) return;

    lineBuffer += chunk;
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || "";

    for (const line of lines) {
      processLine(line);
    }

    if (isDone) {
      if (lineBuffer.trim()) {
        processLine(lineBuffer);
      }
      signalDone();
    }
  };

  xhr.open("POST", url, true);
  xhr.setRequestHeader("Content-Type", "application/json");
  // Agent mode needs much longer timeout (multi-step upstream calls)
  xhr.timeout = opts.agentMode ? 120_000 : HTTP_TIMEOUT_MS;
  xhr.ontimeout = () =>
    opts.onError?.(
      new Error(
        "NVIDIA proxy request timed out. Check proxy health/connectivity.",
      ),
    );
  xhr.onreadystatechange = () => {
    try {
      if (!metaSignaled && xhr.readyState >= 2) {
        const selectedModel =
          xhr.getResponseHeader("x-model-selected") || undefined;
        const requestedModel =
          xhr.getResponseHeader("x-model-requested") || undefined;
        const fallbackRaw = xhr.getResponseHeader("x-model-fallback-used");
        const fallbackUsed =
          fallbackRaw == null
            ? undefined
            : fallbackRaw.toLowerCase() === "true";

        if (selectedModel || requestedModel || fallbackUsed !== undefined) {
          emitMeta({ selectedModel, requestedModel, fallbackUsed });
          metaSignaled = true;
        }
      }

      if (xhr.readyState === 3) parseNew(false);
      if (xhr.readyState === 4) {
        // Detect HTTP-level errors before parsing SSE
        if (xhr.status === 0) {
          opts.onError?.(
            new Error(
              `Cannot reach NVIDIA proxy at ${url}. Ensure the proxy server is running and the IP/port in Settings matches your PC's LAN address.`,
            ),
          );
          return;
        }
        if (xhr.status >= 400) {
          let detail = "";
          try {
            const errObj = JSON.parse(xhr.responseText || "");
            detail = errObj?.error || errObj?.details || xhr.responseText || "";
          } catch {
            detail = (xhr.responseText || "").slice(0, 200);
          }
          opts.onError?.(
            new Error(
              `NVIDIA proxy returned HTTP ${xhr.status}: ${detail || xhr.statusText || "Unknown error"}`,
            ),
          );
          return;
        }
        parseNew(true);
      }
    } catch (e: any) {
      opts.onError?.(new Error(`Stream parse error: ${e?.message || e}`));
    }
  };
  xhr.onerror = () => {
    opts.onError?.(
      new Error(
        `Network error reaching ${url} — check that Settings host/port matches your PC's LAN IP and the proxy is running.`,
      ),
    );
  };
  xhr.send(body);

  return { cancel: () => xhr.abort() };
}

export async function getNvidiaProxyModels(baseUrl: string): Promise<string[]> {
  const normalized = normalizeUrl(baseUrl);
  const endpoints = ["/v1/models", "/models"];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(normalized + endpoint);
      if (!res.ok) continue;
      const json = await res.json();

      if (Array.isArray((json as any)?.data)) {
        return (json as any).data
          .map((item: any) => item?.id)
          .filter((id: unknown) => typeof id === "string");
      }

      if (Array.isArray((json as any)?.models)) {
        return (json as any).models
          .map((item: any) =>
            typeof item === "string" ? item : item?.id || item?.name,
          )
          .filter((id: unknown) => typeof id === "string");
      }

      if (Array.isArray(json)) {
        return (json as any[])
          .map((item) =>
            typeof item === "string" ? item : item?.id || item?.name,
          )
          .filter((id) => typeof id === "string");
      }
    } catch {
      // try next endpoint
    }
  }

  return [];
}

export async function pingNvidiaProxy(baseUrl: string): Promise<boolean> {
  const normalized = normalizeUrl(baseUrl);
  const endpoints = ["/health", "/v1/models", "/models"];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(normalized + endpoint);
      if (res.ok) return true;
    } catch {
      // try next endpoint
    }
  }

  return false;
}

function normalizeUrl(base: string): string {
  return base.endsWith("/") ? base.slice(0, -1) : base;
}
