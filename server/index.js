import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
    createOpenClawIdempotencyKey,
    isDangerousOpenClawCommand,
} from "./openclawPolicy.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);
const nvidiaBaseUrl = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com";
const defaultModel = process.env.DEFAULT_MODEL || "nvidia/nemotron-3-nano-30b-a3b";
const qualityFallbackModel = process.env.MODEL_FALLBACK_QUALITY || "nvidia/llama-3.3-nemotron-super-49b-v1.5";
const capacityFallbackModel = process.env.MODEL_FALLBACK_CAPACITY || "nvidia/llama-3.1-nemotron-nano-8b-v1";
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
const jinaApiKey = process.env.JINA_API_KEY || "";

function getModelFallbackChain(primaryModel) {
    const chain = [
        primaryModel || defaultModel,
        qualityFallbackModel,
        capacityFallbackModel,
    ].filter(Boolean);

    return [...new Set(chain)];
}

app.use(cors({
    origin: allowedOrigin,
    exposedHeaders: ["x-model-requested", "x-model-selected", "x-model-fallback-used"],
}));
app.use(express.json({ limit: "2mb" }));

function setModelResponseHeaders(res, requestedModel, selectedModel) {
    const requested = requestedModel || defaultModel;
    const selected = selectedModel || requested;
    const fallbackUsed = selected !== requested;

    res.setHeader("x-model-requested", requested);
    res.setHeader("x-model-selected", selected);
    res.setHeader("x-model-fallback-used", String(fallbackUsed));
}

// ── Global crash handlers (prevent silent proxy death) ──
process.on("uncaughtException", (err) => {
    console.error(`[FATAL] uncaughtException: ${err?.message}\n${err?.stack}`);
});
process.on("unhandledRejection", (reason) => {
    console.error(`[FATAL] unhandledRejection:`, reason);
});

// ── Request logging ──
app.use((req, _res, next) => {
    const ts = new Date().toISOString();
    const agent = req.body?.agent_mode ? " [AGENT]" : "";
    console.log(`[${ts}] ${req.method} ${req.path}${agent} from ${req.ip}`);
    next();
});

function getAuthHeaders() {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
        throw new Error("Missing NVIDIA_API_KEY in environment");
    }
    return {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
    };
}

const WEB_SEARCH_TOOL = {
    type: "function",
    function: {
        name: "web_search",
        description:
            "Search the web for recent information and return concise snippets with source URLs",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query" },
                max_results: {
                    type: "number",
                    description: "Maximum number of results to return",
                },
            },
            required: ["query"],
        },
    },
};

const FETCH_PAGE_TOOL = {
    type: "function",
    function: {
        name: "fetch_page",
        description:
            "Fetch the full markdown content of a specific web page. Use after web_search to read a result URL in detail — ideal for pricing, documentation, release notes, or any in-depth content.",
        parameters: {
            type: "object",
            properties: {
                url: {
                    type: "string",
                    description: "Full URL of the page to fetch (must start with http:// or https://)",
                },
                focus: {
                    type: "string",
                    description: "Optional: topic or section to look for within the page (e.g. 'pricing', 'installation', 'changelog')",
                },
            },
            required: ["url"],
        },
    },
};

const OPENCLAW_GATEWAY_URL = normalizeGatewayUrl(
    process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:3000",
);
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const OPENCLAW_REPLAY_WINDOW_MS = Number(process.env.OPENCLAW_REPLAY_WINDOW_MS || 5000);
const OPENCLAW_GATEWAY_TIMEOUT_MS = Number(process.env.OPENCLAW_GATEWAY_TIMEOUT_MS || 15000);
const OPENCLAW_ALLOWED_TOOLS = new Set([
    "openclaw_list_nodes",
    "openclaw_node_status",
    "openclaw_run_command",
]);
const OPENCLAW_NODE_STATUS_TOOL = {
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
                    description: "Optional target node ID. If omitted, the saved node target is used.",
                },
            },
            required: [],
        },
    },
};
const OPENCLAW_LIST_NODES_TOOL = {
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
};
const OPENCLAW_RUN_COMMAND_TOOL = {
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
                    description: "Optional target node ID. If omitted, the saved node target is used.",
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
};
const openclawReplayCache = new Map();

function getAgentTools(openclawEnabled) {
    return openclawEnabled
        ? [WEB_SEARCH_TOOL, FETCH_PAGE_TOOL, OPENCLAW_LIST_NODES_TOOL, OPENCLAW_NODE_STATUS_TOOL, OPENCLAW_RUN_COMMAND_TOOL]
        : [WEB_SEARCH_TOOL, FETCH_PAGE_TOOL];
}

function normalizeGatewayUrl(input) {
    return String(input || "").trim().replace(/\/$/, "");
}

function getReplayCacheEntry(idempotencyKey) {
    if (!idempotencyKey) return null;
    const entry = openclawReplayCache.get(idempotencyKey);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        openclawReplayCache.delete(idempotencyKey);
        return null;
    }
    return entry;
}

function setReplayCacheEntry(idempotencyKey, value) {
    if (!idempotencyKey) return;
    openclawReplayCache.set(idempotencyKey, {
        expiresAt: Date.now() + OPENCLAW_REPLAY_WINDOW_MS,
        value,
    });
}

function safeParseJson(value) {
    try {
        if (typeof value === "string") return JSON.parse(value);
        return value;
    } catch {
        return null;
    }
}

function extractTextToolCall(content) {
    if (typeof content !== "string") return null;

    // Pattern 1 – Parenthetical JSON: <tool_call>tool_name({"key":"val"})</tool_call>
    for (const toolName of ["web_search", "fetch_page", "openclaw_list_nodes", "openclaw_node_status", "openclaw_run_command"]) {
        const parenRegex = new RegExp(
            `<tool_call>\\s*${toolName}\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)\\s*(?:<\\/tool_call>|$)`,
            "i",
        );
        const match = content.match(parenRegex);
        if (match?.[1]) {
            const args = safeParseJson(match[1]);
            if (!args) continue;
            if (toolName === "web_search" && args.query) {
                return { id: null, function: { name: "web_search", arguments: JSON.stringify(args) } };
            }
            if (toolName === "fetch_page" && args.url) {
                return { id: null, function: { name: "fetch_page", arguments: JSON.stringify(args) } };
            }
        }
    }

    // Pattern 2 – XML arg pairs: <tool_call>tool_name <arg_key>k</arg_key><arg_value>v</arg_value></tool_call>
    const tagStyle = /<tool_call>([\s\S]*?)<\/tool_call>/i.exec(content);
    if (!tagStyle?.[1]) return null;

    const argBlock = tagStyle[1];

    // Detect which tool this block belongs to
    const toolNameMatch = argBlock.match(/^\s*(web_search|fetch_page|openclaw_list_nodes|openclaw_node_status|openclaw_run_command)\b/i);
    const detectedTool = toolNameMatch?.[1]?.toLowerCase() || "web_search";

    const args = {};
    const pairRegex = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
    let pair = null;
    while ((pair = pairRegex.exec(argBlock)) !== null) {
        const key = String(pair[1] || "").trim();
        const value = String(pair[2] || "").trim();
        if (!key) continue;
        args[key] = key === "max_results" ? Number(value) || value : value;
    }

    if (detectedTool === "web_search" && !args.query) return null;
    if (detectedTool === "fetch_page" && !args.url) return null;

    return {
        id: null,
        function: { name: detectedTool, arguments: JSON.stringify(args) },
    };
}

function normalizeOpenClawNodeEntry(raw) {
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
        raw.status ?? raw.state ?? raw.connection_status ?? raw.connected ?? raw.online;
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

function normalizeOpenClawNodes(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) {
        return payload.map(normalizeOpenClawNodeEntry).filter(Boolean);
    }
    if (typeof payload === "string") {
        const parsed = safeParseJson(payload);
        return parsed ? normalizeOpenClawNodes(parsed) : [];
    }
    if (typeof payload !== "object") return [];

    const entries = [];
    const arrayKeys = ["nodes", "items", "data", "results", "pairedNodes", "nodeList"];
    for (const key of arrayKeys) {
        if (Array.isArray(payload[key])) {
            entries.push(...payload[key]);
        }
    }

    const nestedCandidates = [
        payload.node,
        payload.item,
        payload.data?.node,
        payload.data?.item,
    ];

    for (const candidate of nestedCandidates) {
        if (candidate) entries.push(candidate);
    }

    if (entries.length === 0) {
        const idCandidate = payload.id || payload.node_id || payload.nodeId || payload.name;
        if (idCandidate) entries.push(payload);
    }

    const nodes = [];
    const seen = new Set();
    for (const entry of entries) {
        const node = normalizeOpenClawNodeEntry(entry);
        if (!node || seen.has(node.id)) continue;
        seen.add(node.id);
        nodes.push(node);
    }
    return nodes;
}

async function fetchWithTimeout(url, init, timeoutMs = OPENCLAW_GATEWAY_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...(init || {}), signal: controller.signal });
    } catch (error) {
        if (error?.name === "AbortError") {
            const timeoutError = new Error(
                `OpenClaw gateway request timed out after ${timeoutMs}ms`,
            );
            timeoutError.status = 504;
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function buildOpenClawGatewayPayload(tool, args, nodeId, idempotencyKey) {
    return {
        tool,
        args: args || {},
        nodeId: nodeId || undefined,
        node_id: nodeId || undefined,
        target_node_id: nodeId || undefined,
        idempotencyKey,
        idempotency_key: idempotencyKey,
    };
}

async function parseGatewayResponse(response) {
    const text = await response.text();
    if (!text.trim()) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function invokeOpenClawGateway({ tool, args, nodeId, idempotencyKey }) {
    if (!OPENCLAW_GATEWAY_TOKEN) {
        const error = new Error("Missing OPENCLAW_GATEWAY_TOKEN in environment");
        error.status = 500;
        throw error;
    }

    if (!OPENCLAW_ALLOWED_TOOLS.has(tool)) {
        const error = new Error(`Unsupported OpenClaw tool: ${tool}`);
        error.status = 400;
        throw error;
    }

    const response = await fetchWithTimeout(`${OPENCLAW_GATEWAY_URL}/tools/invoke`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(buildOpenClawGatewayPayload(tool, args, nodeId, idempotencyKey)),
    });

    const parsed = await parseGatewayResponse(response);

    if (!response.ok) {
        const error = new Error(
            `OpenClaw gateway returned HTTP ${response.status}: ${(parsed && typeof parsed === "object" && (parsed.error || parsed.details)) ||
            (typeof parsed === "string" ? parsed : response.statusText || "Unknown error")
            }`,
        );
        error.status = response.status;
        error.details = parsed;
        throw error;
    }

    return parsed;
}

async function fetchOpenClawGatewayHealth() {
    const endpoints = ["/health", "/status"];

    for (const endpoint of endpoints) {
        try {
            const response = await fetchWithTimeout(`${OPENCLAW_GATEWAY_URL}${endpoint}`, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
                    Accept: "application/json",
                },
            });
            const parsed = await parseGatewayResponse(response);
            if (response.ok) {
                return { ok: true, endpoint, data: parsed };
            }
        } catch (error) {
            console.warn(`[OpenClaw] health check failed on ${endpoint}: ${error?.message || error}`);
            if (error?.status === 504) {
                return { ok: false, status: 504, error: error.message };
            }
        }
    }

    return { ok: false };
}

async function fetchOpenClawGatewayNodes() {
    const cacheKey = createOpenClawIdempotencyKey(
        "openclaw_list_nodes",
        {},
        OPENCLAW_REPLAY_WINDOW_MS,
    );
    const cached = getReplayCacheEntry(cacheKey);
    if (cached?.value) {
        return cached.value;
    }

    const result = await invokeOpenClawGateway({
        tool: "openclaw_list_nodes",
        args: {},
        nodeId: undefined,
        idempotencyKey: cacheKey,
    });
    const nodes = normalizeOpenClawNodes(result);
    const payload = {
        ok: true,
        tool: "openclaw_list_nodes",
        nodes,
        count: nodes.length,
        raw: result,
    };
    setReplayCacheEntry(cacheKey, payload);
    return payload;
}

function extractWebResults(payload, limit) {
    const out = [];

    if (payload?.AbstractText) {
        out.push({
            title: payload?.Heading || "Instant Answer",
            url: payload?.AbstractURL || "",
            snippet: payload?.AbstractText,
            source: "duckduckgo",
        });
    }

    const walk = (items) => {
        for (const item of items || []) {
            if (out.length >= limit) return;
            if (Array.isArray(item?.Topics)) {
                walk(item.Topics);
                continue;
            }
            const text = item?.Text;
            const url = item?.FirstURL;
            if (text || url) {
                out.push({
                    title: text ? text.split(" - ")[0].slice(0, 120) : "Result",
                    url: url || "",
                    snippet: text || "",
                    source: "duckduckgo",
                });
            }
        }
    };

    walk(payload?.RelatedTopics || []);
    return out.slice(0, limit);
}

function parseJinaSearchResults(text, limit) {
    const out = [];
    if (!text || typeof text !== "string") return out;

    // Jina search returns markdown blocks:
    //   ## [N] Title\nURL Source: https://...\n\nDescription: snippet\n\n...
    // Split on numbered section boundaries
    const blocks = text.split(/\n(?=(?:#{1,3}\s*\[?\d+\]|^\d+\.\s))/m);

    for (const block of blocks) {
        if (out.length >= limit) break;

        const urlMatch = block.match(/URL(?:\s+Source)?:\s*(https?:\/\/[^\s\n]+)/i);
        if (!urlMatch) continue;
        const url = urlMatch[1].trim();

        // Title: first non-empty line, strip markdown # and [N] prefix
        const firstLine = (block.split("\n").find((l) => l.trim()) || "")
            .replace(/^#{1,3}\s*/, "")
            .replace(/^\[?\d+\]?\s*/, "")
            .replace(/\*\*/g, "")
            .trim();

        // Snippet: prefer "Description:" field, else first content text
        const descMatch = block.match(/Description:\s*([^\n]+(?:\n(?!URL|Description|Title)[^\n]+)*)/i);
        const snippet = descMatch
            ? descMatch[1].trim().slice(0, 400)
            : block
                .replace(/^.*\n/, "")
                .replace(/URL(?:\s+Source)?:[^\n]+\n?/i, "")
                .replace(/Description:[^\n]+\n?/i, "")
                .trim()
                .slice(0, 400);

        out.push({ title: firstLine || url, url, snippet, source: "jina" });
    }

    return out.slice(0, limit);
}

async function runJinaSearch(query, maxResults) {
    if (!jinaApiKey) {
        throw new Error("JINA_API_KEY not configured — skipping Jina search");
    }
    const url = `https://s.jina.ai/${encodeURIComponent(query)}`;
    const headers = {
        "Accept": "text/plain",
        "X-Return-Format": "markdown",
        "Authorization": `Bearer ${jinaApiKey}`,
    };
    const response = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
        throw new Error(`Jina search HTTP ${response.status}`);
    }
    const text = await response.text();
    return parseJinaSearchResults(text, maxResults);
}

async function runFetchPage(argsRaw) {
    const parsed = safeParseJson(argsRaw) || {};
    const url = String(parsed?.url || "").trim();
    const focus = String(parsed?.focus || "").trim();

    if (!url) {
        return { url: "", content: "", error: "Missing required argument: url" };
    }

    const jinaUrl = `https://r.jina.ai/${url}`;
    let response;
    try {
        response = await fetch(jinaUrl, {
            method: "GET",
            headers: { "Accept": "text/plain" },
            signal: AbortSignal.timeout(20000),
        });
    } catch (err) {
        return { url, content: "", error: `Fetch failed: ${err?.message}` };
    }

    if (!response.ok) {
        return { url, content: "", error: `Page fetch failed (${response.status})` };
    }

    let content = await response.text();
    const MAX_CHARS = 8000;
    if (content.length > MAX_CHARS) {
        content = content.slice(0, MAX_CHARS) + "\n\n[Content truncated at 8000 characters]";
    }

    return { url, content, focus: focus || null };
}

async function runWikipediaSearch(query, maxResults) {
    const endpoint = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${maxResults}&srprop=snippet`;
    const response = await fetch(endpoint, {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
        throw new Error(`Wikipedia API HTTP ${response.status}`);
    }
    const json = await response.json();
    const items = json?.query?.search || [];
    return items.map((item) => ({
        title: item.title || "Wikipedia",
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
        snippet: (item.snippet || "").replace(/<[^>]+>/g, "").slice(0, 400),
        source: "wikipedia",
    }));
}

async function runWebSearch(argsRaw) {
    const parsed = safeParseJson(argsRaw) || {};
    const query = String(parsed?.query || "").trim();
    const maxResults = Math.min(Math.max(Number(parsed?.max_results || 5), 1), 8);

    if (!query) {
        return { query, results: [], error: "Missing required argument: query" };
    }

    // Tier 1: Jina AI Search (requires JINA_API_KEY, free tier 1M tokens/month)
    try {
        const results = await runJinaSearch(query, maxResults);
        if (results.length > 0) {
            console.log(`[SEARCH] Jina returned ${results.length} results for "${query}"`);
            return { query, results };
        }
        console.warn(`[SEARCH] Jina returned 0 results for "${query}", trying fallbacks`);
    } catch (err) {
        console.warn(`[SEARCH] Jina unavailable (${err?.message}), trying fallbacks`);
    }

    // Tier 2: DuckDuckGo Instant Answer API (limited — only returns knowledge box)
    try {
        const endpoint = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const ddgResponse = await fetch(endpoint, {
            method: "GET",
            signal: AbortSignal.timeout(10000),
        });
        if (ddgResponse.ok) {
            const json = await ddgResponse.json();
            const results = extractWebResults(json, maxResults);
            if (results.length > 0) {
                console.log(`[SEARCH] DDG returned ${results.length} results for "${query}"`);
                return { query, results };
            }
        }
    } catch (err) {
        console.warn(`[SEARCH] DDG failed (${err?.message}), trying Wikipedia`);
    }

    // Tier 3: Wikipedia REST API (always available, scoped to encyclopedic content)
    try {
        const results = await runWikipediaSearch(query, maxResults);
        if (results.length > 0) {
            console.log(`[SEARCH] Wikipedia returned ${results.length} results for "${query}"`);
            return { query, results };
        }
        console.warn(`[SEARCH] Wikipedia returned 0 results for "${query}"`);
    } catch (err) {
        console.warn(`[SEARCH] Wikipedia failed (${err?.message})`);
    }

    return { query, results: [], error: "All search sources failed. Set JINA_API_KEY in server/.env for best results." };
}

async function callNvidiaJson(body) {
    const modelChain = getModelFallbackChain(body?.model || defaultModel);
    let lastError = null;

    for (const model of modelChain) {
        const requestBody = {
            ...body,
            model,
        };

        const upstream = await fetch(`${nvidiaBaseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: {
                ...getAuthHeaders(),
                Accept: "application/json",
            },
            body: JSON.stringify(requestBody),
        });

        if (upstream.ok) {
            const json = await upstream.json();
            if (model !== body?.model) {
                console.log(`[MODEL FALLBACK] JSON switched ${body?.model || defaultModel} -> ${model}`);
            }
            return json;
        }

        const text = await upstream.text();
        const status = upstream.status;
        const error = new Error(`Upstream chat request failed (${status}) on model ${model}: ${text}`);
        error.status = status;
        lastError = error;

        if (status === 429 || status === 404) {
            console.warn(`[MODEL FALLBACK] ${status} on ${model}, trying next model...`);
            continue;
        }

        throw error;
    }

    throw lastError || new Error("Upstream chat request failed on all fallback models");
}

function buildAssistantCompletion(content, model = defaultModel) {
    return {
        id: `chatcmpl-local-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content,
                    tool_calls: [],
                },
                finish_reason: "stop",
            },
        ],
    };
}

function isToolCallLikeContent(content) {
    return typeof content === "string" && /<tool_call>/i.test(content);
}

function summarizeToolResults(allToolResults) {
    const entries = [];

    for (const item of allToolResults || []) {
        if (entries.length >= 6) break;

        // fetch_page result
        if (item?.type === "fetch_page") {
            entries.push({
                kind: "page",
                url: item.url || "",
                content: String(item.content || "").slice(0, 600),
            });
            continue;
        }

        if (item?.type === "openclaw") {
            entries.push({
                kind: "openclaw",
                tool: item.tool || "openclaw",
                nodeId: item.nodeId || "",
                result: item.result || {},
            });
            continue;
        }

        // web_search result (array of result objects)
        const results = Array.isArray(item?.results) ? item.results : [];
        for (const r of results) {
            if (entries.length >= 6) break;
            entries.push({
                kind: "search",
                title: r?.title || "Result",
                url: r?.url || "",
                snippet: r?.snippet || "",
            });
        }
    }

    if (entries.length === 0) {
        return "I couldn't retrieve useful web results for that query right now. Please try a more specific query or retry in a moment.";
    }

    const bullets = entries
        .map((e) => {
            if (e.kind === "page") {
                return `• [Fetched page] ${e.url}\n  ${e.content}`;
            }
            if (e.kind === "openclaw") {
                const nodeLabel = e.nodeId ? ` on ${e.nodeId}` : "";
                return `• [OpenClaw] ${e.tool}${nodeLabel}\n  ${JSON.stringify(e.result).slice(0, 600)}`;
            }
            const urlPart = e.url ? ` (${e.url})` : "";
            const snippetPart = e.snippet ? ` — ${e.snippet}` : "";
            return `• ${e.title}${urlPart}${snippetPart}`;
        })
        .join("\n");

    return `Here are the top web findings:\n${bullets}`;
}

/** Write SSE content chunks + [DONE] and end response (headers must already be set). */
function writeSseContentAndEnd(res, completionJson, modelMeta) {
    const id = completionJson?.id || `chatcmpl-${Date.now()}`;
    const model = completionJson?.model || defaultModel;
    const content = completionJson?.choices?.[0]?.message?.content || "";

    if (modelMeta?.selected_model || modelMeta?.requested_model) {
        res.write(`data: ${JSON.stringify({ meta: modelMeta })}\n\n`);
    }

    const chunkSize = 36;
    for (let index = 0; index < content.length; index += chunkSize) {
        const piece = content.slice(index, index + chunkSize);
        const frame = {
            id,
            object: "chat.completion.chunk",
            model,
            choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(frame)}\n\n`);
    }

    const doneFrame = {
        id,
        object: "chat.completion.chunk",
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    };
    res.write(`data: ${JSON.stringify(doneFrame)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
}

/** Convenience: set SSE headers + write content + end. */
function sendSyntheticSseFromJson(res, completionJson) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    setModelResponseHeaders(res, completionJson?.model || defaultModel, completionJson?.model || defaultModel);
    writeSseContentAndEnd(res, completionJson);
}

function normalizeOpenClawToolArgs(rawArgs) {
    if (typeof rawArgs === "string") {
        return safeParseJson(rawArgs) || { input: rawArgs };
    }
    if (rawArgs && typeof rawArgs === "object") {
        return rawArgs;
    }
    return {};
}

async function runOpenClawTool(fnName, rawArgs, defaultNodeId) {
    const args = normalizeOpenClawToolArgs(rawArgs);
    const nodeId = String(args.node_id || args.nodeId || defaultNodeId || "").trim();
    const idempotencyKey = createOpenClawIdempotencyKey(
        fnName,
        args,
        OPENCLAW_REPLAY_WINDOW_MS,
    );

    if (fnName === "openclaw_list_nodes") {
        const result = await invokeOpenClawGateway({
            tool: fnName,
            args,
            nodeId: nodeId || undefined,
            idempotencyKey,
        });
        return { type: "openclaw", tool: fnName, nodeId: nodeId || null, result };
    }

    if (fnName === "openclaw_node_status") {
        if (!nodeId) {
            throw new Error("OpenClaw node_id is required for openclaw_node_status");
        }
        const result = await invokeOpenClawGateway({
            tool: fnName,
            args,
            nodeId,
            idempotencyKey,
        });
        return { type: "openclaw", tool: fnName, nodeId, result };
    }

    if (fnName === "openclaw_run_command") {
        if (!nodeId) {
            throw new Error("OpenClaw node_id is required for openclaw_run_command");
        }
        const command = String(args.command || "").trim();
        if (!command) {
            throw new Error("OpenClaw command is required for openclaw_run_command");
        }
        if (isDangerousOpenClawCommand(command)) {
            throw new Error("OpenClaw command denied by policy");
        }
        const result = await invokeOpenClawGateway({
            tool: fnName,
            args,
            nodeId,
            idempotencyKey,
        });
        return { type: "openclaw", tool: fnName, nodeId, result };
    }

    throw new Error(`Unsupported OpenClaw tool: ${fnName}`);
}

async function runAgentWebSearchFlow(initialBody) {
    const model = initialBody?.model || defaultModel;
    const openclawEnabled = initialBody?.openclaw_enabled === true;
    const openclawNodeId = String(initialBody?.openclaw_node_id || "").trim();
    const MAX_ROUNDS = openclawEnabled ? 4 : 3;
    const messages = Array.isArray(initialBody?.messages)
        ? [...initialBody.messages]
        : [];
    const allToolResults = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
        console.log(`[AGENT] Round ${round + 1}/${MAX_ROUNDS}`);

        const roundResponse = await callNvidiaJson({
            ...initialBody,
            model,
            stream: false,
            tools: getAgentTools(openclawEnabled),
            tool_choice: "auto",
            messages,
        });

        const assistantMessage = roundResponse?.choices?.[0]?.message;
        const rawToolCalls = Array.isArray(assistantMessage?.tool_calls)
            ? assistantMessage.tool_calls
            : [];

        // Fallback: some models emit tool calls as text tags inside content
        const textToolCall =
            rawToolCalls.length === 0
                ? extractTextToolCall(assistantMessage?.content)
                : null;

        const normalizedCalls = textToolCall ? [textToolCall] : rawToolCalls;

        // No tool calls: model has enough info or answered directly
        if (normalizedCalls.length === 0) {
            const content = assistantMessage?.content;
            const isCleanText =
                !isToolCallLikeContent(content) &&
                String(content || "").trim().length > 0;

            if (isCleanText) {
                console.log(`[AGENT] No tool calls in round ${round + 1}, returning direct response`);
                return roundResponse;
            }

            console.log(`[AGENT] No usable response in round ${round + 1}, forcing synthesis`);
            break;
        }

        // Push assistant message into history
        if (textToolCall) {
            messages.push({
                role: "assistant",
                content: "Gathering information using research and OpenClaw tools.",
            });
        } else {
            messages.push(assistantMessage);
        }

        console.log(`[AGENT] Round ${round + 1}: executing ${normalizedCalls.length} tool call(s) in parallel`);

        // Execute all tool calls in this round in parallel
        const toolMessagePromises = normalizedCalls.map(async (call) => {
            const fnName = call?.function?.name;
            const callId = call?.id;
            let toolResultForHistory;

            try {
                if (fnName === "web_search") {
                    const result = await runWebSearch(call?.function?.arguments);
                    allToolResults.push(result);
                    toolResultForHistory = result;
                } else if (fnName === "fetch_page") {
                    const pageResult = await runFetchPage(call?.function?.arguments);
                    allToolResults.push({ type: "fetch_page", ...pageResult });
                    toolResultForHistory = pageResult;
                } else if (fnName === "openclaw_list_nodes" || fnName === "openclaw_node_status" || fnName === "openclaw_run_command") {
                    const openclawResult = await runOpenClawTool(fnName, call?.function?.arguments, openclawNodeId);
                    allToolResults.push(openclawResult);
                    toolResultForHistory = openclawResult;
                } else {
                    toolResultForHistory = { error: `Unsupported tool: ${fnName}` };
                }
            } catch (error) {
                toolResultForHistory = {
                    error: `Tool execution error: ${error?.message || error}`,
                };
                allToolResults.push(toolResultForHistory);
            }

            if (callId) {
                return {
                    role: "tool",
                    tool_call_id: callId,
                    content: JSON.stringify(toolResultForHistory),
                };
            }

            // Models that emit text tool calls get results as system messages
            return {
                role: "system",
                content: `${fnName} result: ${JSON.stringify(toolResultForHistory)}`,
            };
        });

        const toolMessages = await Promise.all(toolMessagePromises);
        messages.push(...toolMessages);

        console.log(`[AGENT] Round ${round + 1} complete, total tool results: ${allToolResults.length}`);
    }

    // Final synthesis: no tools offered so model must produce plain text
    console.log(`[AGENT] Synthesizing final answer from ${allToolResults.length} tool result(s)`);
    const final = await callNvidiaJson({
        ...initialBody,
        model,
        stream: false,
        tools: undefined,
        tool_choice: "none",
        messages,
    });

    const finalContent = final?.choices?.[0]?.message?.content;
    if (isToolCallLikeContent(finalContent) || !String(finalContent || "").trim()) {
        return buildAssistantCompletion(summarizeToolResults(allToolResults), model);
    }

    return final;
}

app.get("/openclaw/health", async (_req, res) => {
    try {
        if (!OPENCLAW_GATEWAY_TOKEN) {
            res.status(500).json({
                ok: false,
                code: "missing_gateway_token",
                error: "Missing OPENCLAW_GATEWAY_TOKEN in environment",
            });
            return;
        }

        const result = await fetchOpenClawGatewayHealth();
        if (!result.ok) {
            res.status(502).json({
                ok: false,
                code: "gateway_unhealthy",
                error: "OpenClaw gateway health check failed",
                gatewayUrl: OPENCLAW_GATEWAY_URL,
            });
            return;
        }

        res.json({
            ok: true,
            bridge: "openclaw",
            gatewayUrl: OPENCLAW_GATEWAY_URL,
            endpoint: result.endpoint,
            data: result.data,
        });
    } catch (error) {
        const status = error?.status || 500;
        res.status(status).json({
            ok: false,
            code: error?.code || (status === 504 ? "gateway_timeout" : "gateway_error"),
            error: error instanceof Error ? error.message : String(error),
        });
    }
});

app.get("/openclaw/nodes", async (_req, res) => {
    try {
        if (!OPENCLAW_GATEWAY_TOKEN) {
            res.status(500).json({
                ok: false,
                code: "missing_gateway_token",
                error: "Missing OPENCLAW_GATEWAY_TOKEN in environment",
            });
            return;
        }

        const result = await fetchOpenClawGatewayNodes();
        res.json({
            ok: true,
            bridge: "openclaw",
            gatewayUrl: OPENCLAW_GATEWAY_URL,
            count: result.count,
            nodes: result.nodes,
            raw: result.raw,
        });
    } catch (error) {
        const status = error?.status || 500;
        res.status(status).json({
            ok: false,
            code: error?.code || (status === 504 ? "gateway_timeout" : "gateway_error"),
            error: error instanceof Error ? error.message : String(error),
            details: error?.details,
        });
    }
});

app.post("/openclaw/invoke", async (req, res) => {
    try {
        if (!OPENCLAW_GATEWAY_TOKEN) {
            res.status(500).json({
                ok: false,
                code: "missing_gateway_token",
                error: "Missing OPENCLAW_GATEWAY_TOKEN in environment",
            });
            return;
        }

        const tool = String(req.body?.tool || "").trim();
        const args = req.body?.args && typeof req.body.args === "object" ? req.body.args : {};
        const nodeId = String(req.body?.nodeId || req.body?.node_id || req.body?.target_node_id || "").trim();
        const idempotencyKey = String(req.body?.idempotencyKey || req.body?.idempotency_key || "").trim();

        if (!tool) {
            res.status(400).json({ ok: false, code: "missing_tool", error: "tool is required" });
            return;
        }

        if (!idempotencyKey) {
            res.status(400).json({ ok: false, code: "missing_idempotency_key", error: "idempotencyKey is required" });
            return;
        }

        if (!OPENCLAW_ALLOWED_TOOLS.has(tool)) {
            res.status(400).json({ ok: false, code: "unsupported_tool", error: `Unsupported OpenClaw tool: ${tool}` });
            return;
        }

        const cached = getReplayCacheEntry(idempotencyKey);
        if (cached) {
            res.setHeader("x-openclaw-replayed", "true");
            res.json({
                ok: true,
                ...cached.value,
                replayed: true,
            });
            return;
        }

        if (tool === "openclaw_run_command") {
            const command = String(args.command || "").trim();
            if (!nodeId) {
                res.status(400).json({ ok: false, code: "missing_node_id", error: "nodeId is required for openclaw_run_command" });
                return;
            }
            if (!command) {
                res.status(400).json({ ok: false, code: "missing_command", error: "command is required for openclaw_run_command" });
                return;
            }
            if (isDangerousOpenClawCommand(command)) {
                res.status(403).json({ ok: false, code: "command_denied", error: "OpenClaw command denied by policy" });
                return;
            }
        }

        if ((tool === "openclaw_node_status" || tool === "openclaw_run_command") && !nodeId) {
            res.status(400).json({ ok: false, code: "missing_node_id", error: `nodeId is required for ${tool}` });
            return;
        }

        if (tool === "openclaw_node_status" || tool === "openclaw_run_command") {
            const discovery = await fetchOpenClawGatewayNodes();
            if (discovery.nodes.length === 0) {
                res.status(404).json({
                    ok: false,
                    code: "no_paired_nodes",
                    error: "No paired OpenClaw nodes are available",
                    nodes: [],
                });
                return;
            }

            const knownNode = discovery.nodes.find((node) => node.id === nodeId);
            if (!knownNode) {
                res.status(404).json({
                    ok: false,
                    code: "unknown_node_id",
                    error: `Unknown OpenClaw nodeId: ${nodeId}`,
                    nodes: discovery.nodes,
                });
                return;
            }
        }

        const result = await invokeOpenClawGateway({
            tool,
            args,
            nodeId: nodeId || undefined,
            idempotencyKey,
        });

        const normalizedNodes =
            tool === "openclaw_list_nodes" ? normalizeOpenClawNodes(result) : [];

        const payload = {
            ok: true,
            replayed: false,
            tool,
            nodeId: nodeId || null,
            result:
                tool === "openclaw_list_nodes"
                    ? { nodes: normalizedNodes, raw: result }
                    : result,
            nodes: normalizedNodes,
        };

        setReplayCacheEntry(idempotencyKey, payload);
        res.json(payload);
    } catch (error) {
        const status = error?.status || 500;
        res.status(status).json({
            ok: false,
            code: error?.code || (status === 504 ? "gateway_timeout" : "gateway_error"),
            error: error instanceof Error ? error.message : String(error),
            details: error?.details,
        });
    }
});

app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "nvidia-proxy", model: defaultModel });
});

// Diagnostic endpoint: simulates SSE heartbeat + delayed response (like agent mode)
app.get("/test-sse", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    let count = 0;
    const hb = setInterval(() => {
        count++;
        try { res.write(`: heartbeat ${count}\n\n`); } catch { clearInterval(hb); }
    }, 2000);

    setTimeout(() => {
        clearInterval(hb);
        const msg = "SSE test complete after heartbeats.";
        for (let i = 0; i < msg.length; i += 20) {
            const piece = msg.slice(i, i + 20);
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
    }, 10000);
});

app.get("/v1/models", async (_req, res) => {
    try {
        const upstream = await fetch(`${nvidiaBaseUrl}/v1/models`, {
            method: "GET",
            headers: getAuthHeaders(),
        });

        if (!upstream.ok) {
            const text = await upstream.text();
            res.status(upstream.status).json({
                error: "Upstream models request failed",
                status: upstream.status,
                details: text,
            });
            return;
        }

        const json = await upstream.json();
        res.json(json);
    } catch (error) {
        res.status(500).json({
            error: "Failed to fetch models",
            details: error instanceof Error ? error.message : String(error),
        });
    }
});

app.post("/v1/chat/completions", async (req, res) => {
    // Prevent Node from crashing if the client disconnects mid-response
    res.on("error", (err) => {
        console.error("[RES ERROR]", err?.message);
    });

    try {
        const body = {
            ...req.body,
            model: req.body?.model || defaultModel,
            stream: req.body?.stream ?? true,
        };
        console.log(`[CHAT] stream=${body.stream} agent=${!!body.agent_mode} model=${body.model}`);

        if (body?.agent_mode === true) {
            /* ── Streaming agent mode ─────────────────────────────────
             * Open SSE headers IMMEDIATELY and send periodic heartbeat
             * comments so the mobile XHR doesn't timeout / fire onerror
             * while we do multi-step upstream calls (planning → search → synthesis).
             */
            if (body.stream) {
                res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
                res.setHeader("Cache-Control", "no-cache, no-transform");
                res.setHeader("Connection", "keep-alive");
                setModelResponseHeaders(res, body.model || defaultModel, body.model || defaultModel);
                res.flushHeaders();

                // SSE comment lines (: ...) keep the TCP socket alive but are
                // silently ignored by the client's line parser.
                const heartbeat = setInterval(() => {
                    try { res.write(": heartbeat\n\n"); } catch { /* closed */ }
                }, 4000);

                let finalJson;
                try {
                    finalJson = await runAgentWebSearchFlow(body);
                } catch (error) {
                    clearInterval(heartbeat);
                    const status = error?.status;
                    const errMsg = status === 429
                        ? "NVIDIA API rate limit reached (429). Please retry in 30-60 seconds or disable Agent Mode."
                        : `Agent error: ${error?.message || "Unknown"}. Please try again.`;
                    const errorJson = buildAssistantCompletion(errMsg, body.model || defaultModel);
                    writeSseContentAndEnd(res, errorJson, {
                        requested_model: body.model || defaultModel,
                        selected_model: errorJson?.model || body.model || defaultModel,
                        fallback_used: (errorJson?.model || body.model || defaultModel) !== (body.model || defaultModel),
                    });
                    return;
                }

                clearInterval(heartbeat);

                if (!finalJson) {
                    const emptyJson = buildAssistantCompletion("Agent produced no response. Please try again.", body.model || defaultModel);
                    writeSseContentAndEnd(res, emptyJson, {
                        requested_model: body.model || defaultModel,
                        selected_model: emptyJson?.model || body.model || defaultModel,
                        fallback_used: (emptyJson?.model || body.model || defaultModel) !== (body.model || defaultModel),
                    });
                    return;
                }

                const selectedModel = finalJson?.model || body.model || defaultModel;
                writeSseContentAndEnd(res, finalJson, {
                    requested_model: body.model || defaultModel,
                    selected_model: selectedModel,
                    fallback_used: selectedModel !== (body.model || defaultModel),
                });
                return;
            }

            /* ── Non-streaming agent mode ── */
            let finalJson;
            try {
                finalJson = await runAgentWebSearchFlow(body);
            } catch (error) {
                const status = error?.status;
                if (status === 429) {
                    finalJson = buildAssistantCompletion(
                        "NVIDIA API rate limit reached right now (429), so web search couldn't complete. Please retry in about 30-60 seconds, or disable Agent Mode for a direct answer.",
                        body.model || defaultModel,
                    );
                } else {
                    throw error;
                }
            }

            if (!finalJson) {
                res.status(500).json({ error: "Agent flow produced no response" });
                return;
            }

            setModelResponseHeaders(res, body.model || defaultModel, finalJson?.model || body.model || defaultModel);
            res.json(finalJson);
            return;
        }

        const modelChain = getModelFallbackChain(body.model || defaultModel);
        let upstream = null;
        let selectedModel = body.model || defaultModel;
        let lastFailure = null;

        for (const model of modelChain) {
            const candidateBody = {
                ...body,
                model,
            };

            const response = await fetch(`${nvidiaBaseUrl}/v1/chat/completions`, {
                method: "POST",
                headers: {
                    ...getAuthHeaders(),
                    Accept: body.stream ? "text/event-stream" : "application/json",
                },
                body: JSON.stringify(candidateBody),
            });

            if (response.ok) {
                upstream = response;
                selectedModel = model;
                if (model !== body.model) {
                    console.log(`[MODEL FALLBACK] stream=${body.stream} switched ${body.model || defaultModel} -> ${model}`);
                }
                break;
            }

            const details = await response.text();
            lastFailure = {
                status: response.status,
                details,
                model,
            };

            if (response.status === 429 || response.status === 404) {
                console.warn(`[MODEL FALLBACK] ${response.status} on ${model}, trying next model...`);
                continue;
            }

            break;
        }

        if (!upstream) {
            res.status(lastFailure?.status || 500).json({
                error: "Upstream chat request failed",
                status: lastFailure?.status || 500,
                model: lastFailure?.model,
                details: lastFailure?.details || "No upstream response",
            });
            return;
        }

        if (!body.stream) {
            const json = await upstream.json();
            if (json?.model !== selectedModel) {
                json.model = selectedModel;
            }
            setModelResponseHeaders(res, body.model || defaultModel, selectedModel);
            res.json(json);
            return;
        }

        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        setModelResponseHeaders(res, body.model || defaultModel, selectedModel);
        res.flushHeaders(); // Push headers to client immediately so XHR enters readyState 3

        const reader = upstream.body?.getReader();
        if (!reader) {
            res.status(502).json({ error: "Upstream stream body unavailable" });
            return;
        }

        const decoder = new TextDecoder();

        req.on("close", async () => {
            try {
                await reader.cancel();
            } catch {
                // no-op
            }
        });

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
        }

        res.end();
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({
                error: "Failed to stream chat completion",
                details: error instanceof Error ? error.message : String(error),
            });
            return;
        }
        res.end();
    }
});

app.listen(port, () => {
    console.log(`nvidia-proxy listening on http://0.0.0.0:${port}`);
    console.log(`  Search backends: Jina ${jinaApiKey ? "✓ (API key set)" : "✗ (no JINA_API_KEY)"} → DDG → Wikipedia`);
});
