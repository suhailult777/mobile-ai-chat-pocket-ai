type ToolSchema = {
  type: "function";
  function: {
    name: "web_search" | "fetch_page";
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
};

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for recent information. Returns ranked results with titles, URLs, and content snippets. Use this first to find relevant pages on any topic.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query — be specific and include key terms",
          },
          max_results: {
            type: "number",
            description: "Maximum number of results to return (default 5, max 8)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_page",
      description:
        "Fetch the full content of a specific web page as clean markdown. Use after web_search to read a result URL in detail — ideal for pricing pages, documentation, or any in-depth content.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Full URL of the page to fetch (must start with https://)",
          },
          focus: {
            type: "string",
            description:
              "Optional: specific topic or section to look for within the page (e.g. 'pricing', 'installation', 'changelog')",
          },
        },
        required: ["url"],
      },
    },
  },
];

export const TOOL_SYSTEM_PROMPT = [
  "You can use tools to answer user questions when needed.",
  "Available tools:",
  JSON.stringify(TOOL_SCHEMAS, null, 2),
  "When you need a tool, output exactly one JSON object inside <tool_call></tool_call> tags.",
  "Use this format:",
  '<tool_call>{"name":"web_search","arguments":{"query":"...","max_results":5}}</tool_call>',
  "or",
  '<tool_call>{"name":"fetch_page","arguments":{"url":"https://...","focus":"..."}}</tool_call>',
  "After tool results are provided, continue and produce the final user-facing answer.",
].join("\n");

export type ParsedToolCall = {
  name: "web_search" | "fetch_page";
  arguments: Record<string, any>;
};

export function parseToolCall(text: string): ParsedToolCall | null {
  if (!text) return null;

  const tagged = text.match(/<tool_call>([\s\S]*?)<\/tool_call>/i)?.[1]?.trim();
  if (tagged) {
    const parsed = parseJsonToolCall(tagged);
    if (parsed) return parsed;
  }

  const inlineJson = text.match(/\{[\s\S]*\}/)?.[0];
  if (inlineJson) {
    const parsed = parseJsonToolCall(inlineJson);
    if (parsed) return parsed;
  }

  return null;
}

function parseJsonToolCall(raw: string): ParsedToolCall | null {
  try {
    const obj = JSON.parse(raw);
    const name =
      obj?.name ?? obj?.function_call?.name ?? obj?.function?.name ?? obj?.tool;
    const args =
      obj?.arguments ??
      obj?.function_call?.arguments ??
      obj?.args ??
      obj?.parameters ??
      {};

    if (name !== "web_search" && name !== "fetch_page") return null;

    const normalizedArgs =
      typeof args === "string"
        ? safeParseJson(args) ?? { input: args }
        : args && typeof args === "object"
          ? args
          : {};

    return { name, arguments: normalizedArgs };
  } catch {
    return null;
  }
}

function safeParseJson(value: string): any | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function executeWebSearch(
  query: string,
  maxResults = 5,
): Promise<string> {
  const trimmed = (query || "").trim();
  if (!trimmed) return "web_search error: query is required";

  const limit = Math.max(1, Math.min(8, Number(maxResults) || 5));
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(trimmed)}`;

  const res = await fetchWithTimeout(url, 12000);
  if (!res.ok) {
    return `web_search error: upstream returned HTTP ${res.status}`;
  }

  const html = await res.text();
  const blocks = html.match(/<a[^>]*class="[^"]*result__a[^"]*"[\s\S]*?<\/a>[\s\S]*?(?=<a[^>]*class="[^"]*result__a[^"]*"|$)/gi) || [];

  const items: Array<{ title: string; url: string; snippet: string }> = [];

  for (const block of blocks) {
    if (items.length >= limit) break;

    const linkMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const title = stripHtml(linkMatch[2] || "");
    const href = decodeDuckDuckGoUrl(linkMatch[1] || "");
    const snippet = stripHtml(snippetMatch?.[1] || "");

    if (!title || !href) continue;
    items.push({ title, url: href, snippet });
  }

  if (!items.length) {
    return "web_search result: no results parsed";
  }

  return [
    `web_search query: ${trimmed}`,
    ...items.map(
      (item, index) =>
        `${index + 1}. ${item.title}\nURL: ${item.url}\nSnippet: ${item.snippet || "(no snippet)"}`,
    ),
  ].join("\n\n");
}

function decodeDuckDuckGoUrl(rawHref: string): string {
  if (!rawHref) return rawHref;
  if (rawHref.startsWith("http://") || rawHref.startsWith("https://")) {
    return rawHref;
  }
  const uParam = rawHref.match(/[?&]uddg=([^&]+)/i)?.[1];
  if (uParam) {
    try {
      return decodeURIComponent(uParam);
    } catch {
      return uParam;
    }
  }
  return rawHref;
}

export async function executeFetchPage(url: string, focus?: string): Promise<string> {
  const cleanUrl = (url || "").trim();
  if (!/^https?:\/\//i.test(cleanUrl)) {
    return "fetch_page error: url must start with http:// or https://";
  }

  const res = await fetchWithTimeout(cleanUrl, 12000);
  if (!res.ok) {
    return `fetch_page error: upstream returned HTTP ${res.status}`;
  }

  const html = await res.text();
  const plain = stripHtml(html);

  if (!plain) return `fetch_page result from ${cleanUrl}: (empty content)`;

  const trimmedFocus = (focus || "").trim().toLowerCase();
  const sentences =
    plain.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) || [];

  let selected = sentences;
  if (trimmedFocus) {
    const focused = sentences.filter((s) => s.toLowerCase().includes(trimmedFocus));
    if (focused.length) selected = focused;
  }

  const excerpt = selected.join(" ").slice(0, 3000);
  return `fetch_page url: ${cleanUrl}${trimmedFocus ? `\nfocus: ${focus}` : ""}\n\n${excerpt}`;
}
