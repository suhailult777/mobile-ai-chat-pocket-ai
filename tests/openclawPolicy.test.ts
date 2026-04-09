import { describe, expect, it } from "vitest";

import {
  createOpenClawIdempotencyKey,
  isDangerousOpenClawCommand,
} from "../server/openclawPolicy.js";

describe("openclawPolicy", () => {
  it("denies chained commands even when the prefix is allowlisted", () => {
    expect(isDangerousOpenClawCommand("git status")).toBe(false);
    expect(isDangerousOpenClawCommand("git status; rm -rf /")).toBe(true);
  });

  it("creates stable idempotency keys inside the replay window", () => {
    const now = 1_700_000_000_000;

    const first = createOpenClawIdempotencyKey(
      "openclaw_run_command",
      { command: "whoami" },
      5000,
      now,
    );
    const second = createOpenClawIdempotencyKey(
      "openclaw_run_command",
      { command: "whoami" },
      5000,
      now + 4999,
    );
    const third = createOpenClawIdempotencyKey(
      "openclaw_run_command",
      { command: "whoami" },
      5000,
      now + 5001,
    );

    expect(first).toBe(second);
    expect(third).not.toBe(first);
  });
});
