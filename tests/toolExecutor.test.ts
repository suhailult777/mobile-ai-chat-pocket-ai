import { describe, expect, it } from "vitest";

import {
  advanceToolLoopState,
  getToolSchemas,
  normalizeToolCallSignature,
  parseToolCall,
} from "../src/lib/toolExecutor";

describe("toolExecutor", () => {
  it("filters OpenClaw tools until the feature is enabled", () => {
    const withoutOpenClaw = getToolSchemas();
    const withOpenClaw = getToolSchemas({ openclawEnabled: true });

    expect(withoutOpenClaw.map((schema) => schema.function.name)).not.toContain(
      "openclaw_run_command",
    );
    expect(withOpenClaw.map((schema) => schema.function.name)).toEqual(
      expect.arrayContaining([
        "openclaw_list_nodes",
        "openclaw_node_status",
        "openclaw_run_command",
      ]),
    );
  });

  it("normalizes tool signatures deterministically", () => {
    const first = normalizeToolCallSignature({
      name: "openclaw_run_command",
      arguments: { cwd: "/tmp", command: "whoami" },
    });
    const second = normalizeToolCallSignature({
      name: "openclaw_run_command",
      arguments: { command: "whoami", cwd: "/tmp" },
    });

    expect(first).toBe(second);
  });

  it("detects repeated tool signatures with the loop guard helper", () => {
    const signature = normalizeToolCallSignature({
      name: "web_search",
      arguments: { query: "OpenClaw" },
    });

    let state = advanceToolLoopState(
      { lastSignature: null, repeatedCount: 0 },
      signature,
      3,
    );
    expect(state.loopDetected).toBe(false);

    state = advanceToolLoopState(
      { lastSignature: state.lastSignature, repeatedCount: state.repeatedCount },
      signature,
      3,
    );
    expect(state.loopDetected).toBe(false);

    state = advanceToolLoopState(
      { lastSignature: state.lastSignature, repeatedCount: state.repeatedCount },
      signature,
      3,
    );
    expect(state.loopDetected).toBe(true);
  });

  it("parses tagged tool calls", () => {
    expect(
      parseToolCall(
        '<tool_call>{"name":"fetch_page","arguments":{"url":"https://example.com"}}</tool_call>',
      ),
    ).toEqual({
      name: "fetch_page",
      arguments: { url: "https://example.com" },
    });
  });
});
