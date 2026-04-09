export type ToolName =
  | "web_search"
  | "fetch_page"
  | "openclaw_list_nodes"
  | "openclaw_node_status"
  | "openclaw_run_command";

type ToolScope = "web" | "openclaw";

type ToolMetadata = {
  scope: ToolScope;
  risk: "low" | "medium" | "high";
  requiresOpenClaw?: boolean;
};

type ToolSchema = {
  type: "function";
  function: {
    name: ToolName;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
  metadata: ToolMetadata;
};

export type ParsedToolCall = {
  name: ToolName;
  arguments: Record<string, any>;
};

export type ToolPromptOptions = {
  openclawEnabled?: boolean;
};

export type OpenClawExecutionOptions = {
  baseUrl: string;
  nodeId?: string;
  openclawEnabled?: boolean;
};

export type OpenClawNodeInfo = {
  id: string;
  name: string;
  status?: string;
  raw: any;
};

export type AgentExecutionStatus = {
  state:
    | "awaiting_approval"
    | "executing_on_node"
    | "denied_by_policy"
    | "replayed"
    | "loop_detected"
    | "error"
    | "idle";
  tool?: ToolName | string;
  detail?: string;
  nodeId?: string;
  replayed?: boolean;
};

const WEB_TOOL_SCHEMAS: ToolSchema[] = [
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
            description: "Search query - be specific and include key terms",
          },
          max_results: {
            type: "number",
            description:
              "Maximum number of results to return (default 5, max 8)",
          },
        },
        required: ["query"],
      },
    },
    metadata: { scope: "web", risk: "low" },
  },
  {
    type: "function",
    function: {
      name: "fetch_page",
      description:
        "Fetch the full content of a specific web page as clean markdown. Use after web_search to read a result URL in detail - ideal for pricing pages, documentation, or any in-depth content.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "Full URL of the page to fetch (must start with https://)",
          },
          focus: {
            type: "string",
            description:
              "Optional topic or section to look for within the page",
          },
        },
        required: ["url"],
      },
    },
    metadata: { scope: "web", risk: "low" },
  },
];

const OPENCLAW_TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "openclaw_list_nodes",
      description:
        "List paired OpenClaw nodes that are visible to the bridge. Use this to confirm which target node IDs are available before attempting a control action.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    metadata: { scope: "openclaw", risk: "low", requiresOpenClaw: true },
  },
  {
    type: "function",
    function: {
      name: "openclaw_node_status",
      description:
        "Get the current status for a paired OpenClaw node. Use this before executing a command if you need to verify availability or the current session state.",
      parameters: {
        type: "object",
        properties: {
          node_id: {
            type: "string",
            description:
              "Optional target node ID. If omitted, the saved node target is used.",
          },
        },
        required: [],
      },
    },
    metadata: { scope: "openclaw", risk: "low", requiresOpenClaw: true },
  },
  {
    type: "function",
    function: {
      name: "openclaw_run_command",
      description:
        "Run a controlled command on the selected OpenClaw node. In this rollout only a small read-only allowlist is permitted; shell chaining and destructive commands are rejected by the bridge.",
      parameters: {
        type: "object",
        properties: {
          node_id: {
            type: "string",
            description:
              "Optional target node ID. If omitted, the saved node target is used.",
          },
          command: {
            type: "string",
            description: "Shell command to execute on the paired node.",
          },
          cwd: {
            type: "string",
            description: "Optional working directory for the command.",
          },
          timeout_ms: {
            type: "number",
            description: "Optional timeout for the command in milliseconds.",
          },
        },
        required: ["command"],
      },
    },
    metadata: { scope: "openclaw", risk: "high", requiresOpenClaw: true },
  },
];

const ALL_TOOL_SCHEMAS: ToolSchema[] = [
  ...WEB_TOOL_SCHEMAS,
  ...OPENCLAW_TOOL_SCHEMAS,
];

const KNOWN_TOOL_NAMES = new Set<ToolName>(
  ALL_TOOL_SCHEMAS.map((schema) => schema.function.name),
);

export function getToolSchemas(opts: ToolPromptOptions = {}): ToolSchema[] {
  return opts.openclawEnabled
    ? [...WEB_TOOL_SCHEMAS, ...OPENCLAW_TOOL_SCHEMAS]
    : [...WEB_TOOL_SCHEMAS];
}

export function buildToolSystemPrompt(opts: ToolPromptOptions = {}): string {
  const schemas = getToolSchemas(opts);
  const toolExamples = [
    '<tool_call>{"name":"web_search","arguments":{"query":"...","max_results":5}}</tool_call>',
    '<tool_call>{"name":"fetch_page","arguments":{"url":"https://...","focus":"..."}}</tool_call>',
  ];

  if (opts.openclawEnabled) {
    toolExamples.push(
      '<tool_call>{"name":"openclaw_list_nodes","arguments":{}}</tool_call>',
      '<tool_call>{"name":"openclaw_node_status","arguments":{"node_id":"..."}}</tool_call>',
      '<tool_call>{"name":"openclaw_run_command","arguments":{"command":"...","cwd":"..."}}</tool_call>',
    );
  }

  return [
    "You can use tools to answer user questions when needed.",
    opts.openclawEnabled
      ? "OpenClaw tools are available for controlled PC and node operations. Use read-only tools first, stay inside the command allowlist, obey approvals and policy, and prefer the target node from settings when a node_id is not supplied."
      : "OpenClaw tools are not available in this session.",
    "Available tools:",
    JSON.stringify(schemas, null, 2),
    "When you need a tool, output exactly one JSON object inside <tool_call></tool_call> tags.",
    "Use this format:",
    ...toolExamples,
    "After tool results are provided, continue and produce the final user-facing answer.",
  ].join("\n");
}

export const TOOL_SYSTEM_PROMPT = buildToolSystemPrompt();

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

    if (!isKnownToolName(name)) return null;

    const normalizedArgs =
      typeof args === "string"
        ? (safeParseJson(args) ?? { input: args })
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

function isKnownToolName(name: unknown): name is ToolName {
  return typeof name === "string" && KNOWN_TOOL_NAMES.has(name as ToolName);
}

function stableStringify(value: any): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "undefined") return "undefined";
  return JSON.stringify(String(value));
}

export function normalizeToolCallSignature(call: ParsedToolCall): string {
  return `${call.name}:${stableStringify(call.arguments || {})}`;
}

export type ToolLoopState = {
  lastSignature: string | null;
  repeatedCount: number;
  loopDetected: boolean;
};

export function advanceToolLoopState(
  state: Pick<ToolLoopState, "lastSignature" | "repeatedCount">,
  signature: string,
  maxRepeatedToolCalls: number,
): ToolLoopState {
  const repeatedCount =
    signature === state.lastSignature ? state.repeatedCount + 1 : 1;

  return {
    lastSignature: signature,
    repeatedCount,
    loopDetected: repeatedCount >= maxRepeatedToolCalls,
  };
}

function createReplayKey(signature: string, windowMs = 5000): string {
  const bucket = Math.floor(Date.now() / windowMs);
  return `${signature}::${bucket}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl || "").trim().replace(/\/$/, "");
}

function buildToolResultText(name: string, payload: any): string {
  if (typeof payload === "string") return `${name} result: ${payload}`;
  if (payload == null) return `${name} result: (empty response)`;
  return `${name} result: ${JSON.stringify(payload, null, 2)}`;
}

async function parseResponseBody(res: Response): Promise<any> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function formatOpenClawErrorText(
  detail: string,
  code?: string,
  status?: number,
): string {
  const normalizedCode = code ? ` [${code}]` : "";
  const normalizedStatus = typeof status === "number" ? ` HTTP ${status}` : "";
  return `openclaw error${normalizedCode}:${normalizedStatus} ${detail}`.trim();
}

function formatOpenClawResultText(body: any): string {
  const replaySuffix = body?.replayed === true ? " replayed" : "";
  const resultPrefix = `openclaw${replaySuffix} result`;

  if (typeof body === "string") {
    return `${resultPrefix}: ${body}`;
  }

  if (body && typeof body === "object") {
    if (typeof body.output === "string") {
      return `${resultPrefix}: ${body.output}`;
    }
    if (typeof body.result === "string") {
      return `${resultPrefix}: ${body.result}`;
    }
    if (body.result !== undefined) {
      return `${resultPrefix}: ${JSON.stringify(body.result, null, 2)}`;
    }
    return `${resultPrefix}: ${JSON.stringify(body, null, 2)}`;
  }

  return `${resultPrefix}: (empty response)`;
}

async function invokeOpenClawBridge(
  baseUrl: string,
  payload: Record<string, any>,
): Promise<string> {
  try {
    const normalizedBase = normalizeBaseUrl(baseUrl);
    if (!normalizedBase) {
      return formatOpenClawErrorText("bridge baseUrl is required", "missing_base_url");
    }

    const res = await fetchWithTimeout(
      `${normalizedBase}/openclaw/invoke`,
      15000,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const body = await parseResponseBody(res);

    if (!res.ok) {
      const detail =
        (body && typeof body === "object" && (body.error || body.details)) ||
        (typeof body === "string" ? body : res.statusText) ||
        "Unknown error";
      const errorCode =
        (body && typeof body === "object" && (body.code || body.errorCode)) ||
        `http_${res.status}`;
      return formatOpenClawErrorText(detail, errorCode, res.status);
    }

    return formatOpenClawResultText(body);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const errorCode =
      (error as any)?.code ||
      ((error as any)?.status === 504 ? "gateway_timeout" : "gateway_unreachable");
    return formatOpenClawErrorText(detail, errorCode, (error as any)?.status);
  }
}

export async function pingOpenClawBridge(baseUrl: string): Promise<boolean> {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  if (!normalizedBase) return false;

  try {
    const res = await fetchWithTimeout(
      `${normalizedBase}/openclaw/health`,
      8000,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

function extractOpenClawNodeEntries(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "string") {
    const parsed = safeParseJson(payload);
    return parsed ? extractOpenClawNodeEntries(parsed) : [];
  }
  if (typeof payload !== "object") return [];

  const entries: any[] = [];
  const arrayKeys = [
    "nodes",
    "items",
    "data",
    "results",
    "pairedNodes",
    "nodeList",
  ];
  for (const key of arrayKeys) {
    if (Array.isArray((payload as any)[key])) {
      entries.push(...(payload as any)[key]);
    }
  }

  const nestedCandidates = [
    (payload as any).node,
    (payload as any).item,
    (payload as any).data?.node,
    (payload as any).data?.item,
  ];

  for (const candidate of nestedCandidates) {
    if (candidate) entries.push(candidate);
  }

  if (entries.length > 0) return entries;

  const idCandidate =
    (payload as any).id ||
    (payload as any).node_id ||
    (payload as any).nodeId ||
    (payload as any).name;
  return idCandidate ? [payload] : [];
}

function normalizeOpenClawNode(raw: any): OpenClawNodeInfo | null {
  if (!raw || typeof raw !== "object") return null;

  const rawId =
    raw.node_id ??
    raw.nodeId ??
    raw.id ??
    raw.uuid ??
    raw.identifier ??
    raw.name;
  const id = String(rawId || "").trim();
  if (!id) return null;

  const name = String(
    raw.name ??
      raw.label ??
      raw.hostname ??
      raw.display_name ??
      raw.displayName ??
      raw.title ??
      id,
  ).trim();
  const statusValue =
    raw.status ??
    raw.state ??
    raw.connection_status ??
    raw.connected ??
    raw.online;
  const status =
    typeof statusValue === "string"
      ? statusValue
      : typeof statusValue === "boolean"
        ? statusValue
          ? "online"
          : "offline"
        : statusValue == null
          ? undefined
          : String(statusValue);

  return {
    id,
    name: name || id,
    status,
    raw,
  };
}

export function normalizeOpenClawNodes(payload: any): OpenClawNodeInfo[] {
  const entries = extractOpenClawNodeEntries(payload);
  const nodes: OpenClawNodeInfo[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const node = normalizeOpenClawNode(entry);
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    nodes.push(node);
  }

  return nodes;
}

export async function fetchOpenClawNodes(
  baseUrl: string,
): Promise<{ nodes: OpenClawNodeInfo[]; raw: any }> {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  if (!normalizedBase) {
    throw new Error("openclaw bridge baseUrl is required");
  }

  const res = await fetchWithTimeout(
    `${normalizedBase}/openclaw/nodes`,
    10000,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  );
  const body = await parseResponseBody(res);

  if (!res.ok) {
    const detail =
      (body && typeof body === "object" && (body.error || body.details)) ||
      (typeof body === "string" ? body : res.statusText) ||
      "Unknown error";
    const error = new Error(
      `openclaw nodes request failed HTTP ${res.status}: ${detail}`,
    );
    (error as any).status = res.status;
    (error as any).details = body;
    throw error;
  }

  return {
    nodes: normalizeOpenClawNodes(body),
    raw: body,
  };
}

export async function executeParsedToolCall(
  call: ParsedToolCall,
  opts: {
    baseUrl?: string;
    openclawEnabled?: boolean;
    openclawNodeId?: string;
  } = {},
): Promise<string> {
  if (call.name === "web_search") {
    return executeWebSearch(
      String(call.arguments?.query ?? ""),
      Number(call.arguments?.max_results ?? 5),
    );
  }

  if (call.name === "fetch_page") {
    return executeFetchPage(
      String(call.arguments?.url ?? ""),
      typeof call.arguments?.focus === "string"
        ? call.arguments.focus
        : undefined,
    );
  }

  if (!opts.openclawEnabled) {
    return `openclaw error: tool ${call.name} is disabled in this session`;
  }

  const baseUrl = opts.baseUrl || "";
  const nodeId = String(
    call.arguments?.node_id ??
      call.arguments?.nodeId ??
      opts.openclawNodeId ??
      "",
  ).trim();

  if (call.name === "openclaw_list_nodes") {
    const replayKey = createReplayKey(normalizeToolCallSignature(call));
    return invokeOpenClawBridge(baseUrl, {
      tool: call.name,
      args: call.arguments || {},
      nodeId: nodeId || undefined,
      idempotencyKey: replayKey,
    });
  }

  if (
    call.name === "openclaw_node_status" ||
    call.name === "openclaw_run_command"
  ) {
    if (!nodeId) {
      return `openclaw error: node_id is required for ${call.name}`;
    }

    const replayKey = createReplayKey(normalizeToolCallSignature(call));
    return invokeOpenClawBridge(baseUrl, {
      tool: call.name,
      args: call.arguments || {},
      nodeId,
      idempotencyKey: replayKey,
    });
  }

  return `tool execution error: unsupported tool ${call.name}`;
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
  const blocks =
    html.match(
      /<a[^>]*class="[^"]*result__a[^"]*"[\s\S]*?<\/a>[\s\S]*?(?=<a[^>]*class="[^"]*result__a[^"]*"|$)/gi,
    ) || [];

  const items: Array<{ title: string; url: string; snippet: string }> = [];

  for (const block of blocks) {
    if (items.length >= limit) break;

    const linkMatch = block.match(
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkMatch) continue;

    const snippetMatch = block.match(
      /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
    );
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

export async function executeFetchPage(
  url: string,
  focus?: string,
): Promise<string> {
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
    plain
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
      ?.map((s) => s.trim())
      .filter(Boolean) || [];

  let selected = sentences;
  if (trimmedFocus) {
    const focused = sentences.filter((s) =>
      s.toLowerCase().includes(trimmedFocus),
    );
    if (focused.length) selected = focused;
  }

  const excerpt = selected.join(" ").slice(0, 3000);
  return `fetch_page url: ${cleanUrl}${trimmedFocus ? `\nfocus: ${focus}` : ""}\n\n${excerpt}`;
}
