// Lightweight Ollama client for Expo Go (JS-only) using XMLHttpRequest for streaming NDJSON.
// Works around lack of fetch ReadableStream in React Native/Expo Go by reading xhr.responseText progressively.

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type StreamOptions = {
  baseUrl: string; // e.g. http://127.0.0.1:11434
  model: string;
  messages: ChatMessage[];
  onToken: (text: string) => void; // incremental token text
  onError?: (err: any) => void;
  onDone?: () => void;
};

export type StreamHandle = { cancel: () => void };

export function streamChat(opts: StreamOptions): StreamHandle {
  const url = normalizeUrl(opts.baseUrl) + "/api/chat";
  const body = JSON.stringify({
    model: opts.model,
    messages: opts.messages,
    stream: true,
  });

  const xhr = new XMLHttpRequest();
  let lastIndex = 0;
  let buffer = "";

  const parseNew = (isDone = false) => {
    try {
      const text = xhr.responseText || "";
      const chunk = text.slice(lastIndex);
      lastIndex = text.length;
      if (!chunk && !isDone) return;

      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      // Keep the last line in buffer if it may be incomplete
      buffer = lines.pop() || "";

      for (const ln of lines) {
        const line = ln.trim();
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          // Handle both /api/generate (response) and /api/chat (message.content or delta)
          const token: string | undefined =
            (typeof obj.response === "string" ? obj.response : undefined) ??
            (typeof obj.delta === "string" ? obj.delta : undefined) ??
            (typeof obj?.message?.content === "string"
              ? obj.message.content
              : undefined);
          if (token) opts.onToken(token);
        } catch (e) {
          // Ignore parse errors for partial lines
        }
      }

      if (isDone) {
        // flush any final complete line
        const final = buffer.trim();
        if (final) {
          try {
            const obj = JSON.parse(final);
            const token: string | undefined =
              (typeof obj.response === "string" ? obj.response : undefined) ??
              (typeof obj.delta === "string" ? obj.delta : undefined) ??
              (typeof obj?.message?.content === "string"
                ? obj.message.content
                : undefined);
            if (token) opts.onToken(token);
          } catch {}
        }
        opts.onDone && opts.onDone();
      }
    } catch (err) {
      opts.onError && opts.onError(err);
    }
  };

  xhr.open("POST", url, true);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.onreadystatechange = () => {
    // readyState 3 (LOADING) and 4 (DONE)
    if (xhr.readyState === 3) parseNew(false);
    if (xhr.readyState === 4) parseNew(true);
  };
  xhr.onerror = () => opts.onError && opts.onError(new Error("Network error"));
  xhr.send(body);

  return { cancel: () => xhr.abort() };
}

export async function getModels(baseUrl: string): Promise<string[]> {
  // Prefer /api/tags (current Ollama API) and fall back to /api/models for older variants
  const tryEndpoints = ["/api/tags", "/api/models"];
  let lastErr: any = null;
  for (const path of tryEndpoints) {
    try {
      const res = await fetch(normalizeUrl(baseUrl) + path);
      if (!res.ok) {
        lastErr = new Error(
          `Failed to fetch models from ${path}: ${res.status}`
        );
        continue;
      }
      const json = await res.json();
      // Common shape: { models: [{ name: string, ... }, ...] }
      if (Array.isArray((json as any).models)) {
        return (json as any).models.map((m: any) => m?.name).filter(Boolean);
      }
      // Alternate shape: array of strings or objects with name
      if (Array.isArray(json)) {
        return (json as any[])
          .map((m: any) => (typeof m === "string" ? m : m?.name))
          .filter(Boolean);
      }
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

export async function ping(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(normalizeUrl(baseUrl) + "/api/version");
    if (res.ok) return true;
  } catch {}
  // Fallback to listing tags/models if /api/version isn't available
  try {
    const res = await fetch(normalizeUrl(baseUrl) + "/api/tags");
    return res.ok;
  } catch {
    try {
      const res = await fetch(normalizeUrl(baseUrl) + "/api/models");
      return res.ok;
    } catch {
      return false;
    }
  }
}

function normalizeUrl(base: string): string {
  if (base.endsWith("/")) return base.slice(0, -1);
  return base;
}
