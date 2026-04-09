import { createServer, type IncomingMessage, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

type GatewayCall = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
};

type MockGateway = {
  server: Server;
  port: number;
  baseUrl: string;
  calls: GatewayCall[];
};

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serverDir = path.join(repoRoot, "server");
const testTimeoutMs = 30_000;

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("Failed to resolve a free port")));
        return;
      }
      const port = address.port;
      probe.close(() => resolve(port));
    });
  });
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return null;
  return JSON.parse(text);
}

async function startMockGateway(): Promise<MockGateway> {
  const calls: GatewayCall[] = [];
  const port = await getFreePort();
  const nodes = [
    { node_id: "node-1", name: "Node One", status: "online" },
    { id: "error-node", name: "Error Node", status: "online" },
  ];

  const server = createServer(async (req, res) => {
    const requestPath = new URL(req.url || "/", "http://127.0.0.1").pathname;
    const headers = req.headers;

    if (
      req.method === "GET" &&
      (requestPath === "/health" || requestPath === "/status")
    ) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, endpoint: requestPath }));
      return;
    }

    if (req.method === "POST" && requestPath === "/tools/invoke") {
      const body = await readJsonBody(req);
      calls.push({
        method: req.method || "POST",
        path: requestPath,
        headers: headers as Record<string, string | string[] | undefined>,
        body,
      });

      res.setHeader("Content-Type", "application/json");

      if (body?.tool === "openclaw_list_nodes") {
        res.end(JSON.stringify({ nodes }));
        return;
      }

      if (body?.tool === "openclaw_node_status") {
        const nodeId =
          body?.nodeId || body?.args?.node_id || body?.args?.nodeId;
        if (nodeId === "error-node") {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "gateway exploded" }));
          return;
        }

        res.end(
          JSON.stringify({
            node: {
              id: nodeId || "node-1",
              name: "Node One",
              status: "online",
            },
          }),
        );
        return;
      }

      if (body?.tool === "openclaw_run_command") {
        const command = body?.args?.command || "";
        res.end(JSON.stringify({ output: `ran:${command}` }));
        return;
      }

      res.statusCode = 400;
      res.end(JSON.stringify({ error: `Unsupported tool: ${body?.tool}` }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
  };
}

async function startProxyServer(gatewayBaseUrl: string): Promise<{
  process: ChildProcess;
  port: number;
  baseUrl: string;
}> {
  const port = await getFreePort();
  const child = spawn("node", ["index.js"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      OPENCLAW_GATEWAY_URL: gatewayBaseUrl,
      OPENCLAW_GATEWAY_TOKEN: "test-token",
      NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || "test-key",
      ALLOWED_ORIGIN: "*",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

  const baseUrl = `http://127.0.0.1:${port}`;
  const healthUrl = `${baseUrl}/openclaw/health`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < testTimeoutMs) {
    try {
      const response = await fetch(healthUrl, {
        headers: { Accept: "application/json" },
      });
      if (response.ok) {
        return { process: child, port, baseUrl };
      }
    } catch {
      // retry until the server is ready
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  child.kill("SIGTERM");
  throw new Error("Timed out waiting for the proxy server to start");
}

async function requestJson(
  baseUrl: string,
  pathName: string,
  init?: RequestInit,
): Promise<{ status: number; body: any; headers: Headers }> {
  const response = await fetch(`${baseUrl}${pathName}`, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return {
    status: response.status,
    body,
    headers: response.headers,
  };
}

describe("OpenClaw bridge integration", () => {
  let gateway: MockGateway | null = null;
  let proxyProcess: ChildProcess | null = null;
  let proxyBaseUrl = "";

  beforeAll(async () => {
    gateway = await startMockGateway();
    const proxy = await startProxyServer(gateway.baseUrl);
    proxyProcess = proxy.process;
    proxyBaseUrl = proxy.baseUrl;
  }, testTimeoutMs);

  afterAll(async () => {
    proxyProcess?.kill("SIGTERM");
    gateway?.server.close();
    if (proxyProcess) {
      await once(proxyProcess, "exit").catch(() => {});
    }
  });

  it(
    "reports health and normalized nodes",
    async () => {
      const health = await requestJson(proxyBaseUrl, "/openclaw/health");
      expect(health.status).toBe(200);
      expect(health.body).toMatchObject({
        ok: true,
        bridge: "openclaw",
        gatewayUrl: gateway!.baseUrl,
      });

      const nodes = await requestJson(proxyBaseUrl, "/openclaw/nodes");
      expect(nodes.status).toBe(200);
      expect(nodes.body.count).toBe(2);
      expect(nodes.body.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "node-1",
            name: "Node One",
            status: "online",
          }),
          expect.objectContaining({
            id: "error-node",
            name: "Error Node",
            status: "online",
          }),
        ]),
      );
      expect(gateway!.calls[0]?.headers?.authorization).toBe(
        "Bearer test-token",
      );
    },
    testTimeoutMs,
  );

  it(
    "rejects unknown node ids before invocation",
    async () => {
      const response = await requestJson(proxyBaseUrl, "/openclaw/invoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          tool: "openclaw_node_status",
          nodeId: "missing-node",
          idempotencyKey: "node-target-validation",
          args: {},
        }),
      });

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        ok: false,
        code: "unknown_node_id",
      });
      expect(
        gateway!.calls.some(
          (call) => call.body?.tool === "openclaw_node_status",
        ),
      ).toBe(false);
      expect(
        gateway!.calls.filter(
          (call) => call.body?.tool === "openclaw_list_nodes",
        ).length,
      ).toBeGreaterThanOrEqual(1);
    },
    testTimeoutMs,
  );

  it(
    "replays identical invocations without calling the gateway twice",
    async () => {
      const payload = {
        tool: "openclaw_run_command",
        nodeId: "node-1",
        idempotencyKey: "replay-key",
        args: { command: "whoami" },
      };

      const first = await requestJson(proxyBaseUrl, "/openclaw/invoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      const second = await requestJson(proxyBaseUrl, "/openclaw/invoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        ok: true,
        replayed: false,
        tool: "openclaw_run_command",
        nodeId: "node-1",
      });
      expect(first.body.result).toMatchObject({ output: "ran:whoami" });

      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({
        ok: true,
        replayed: true,
        tool: "openclaw_run_command",
        nodeId: "node-1",
      });

      expect(
        gateway!.calls.filter(
          (call) => call.body?.tool === "openclaw_run_command",
        ).length,
      ).toBe(1);
    },
    testTimeoutMs,
  );

  it(
    "maps gateway failures through the bridge",
    async () => {
      const response = await requestJson(proxyBaseUrl, "/openclaw/invoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          tool: "openclaw_node_status",
          nodeId: "error-node",
          idempotencyKey: "gateway-error",
          args: {},
        }),
      });

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        ok: false,
        code: "gateway_error",
      });
      expect(String(response.body.error)).toContain(
        "OpenClaw gateway returned HTTP 500",
      );
    },
    testTimeoutMs,
  );
});
