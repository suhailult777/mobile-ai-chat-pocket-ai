import { describe, expect, it } from "vitest";

import {
  defaultSettings,
  getPersistedSettingsWrites,
  normalizeStoredSettings,
} from "../src/context/settingsPersistence";

describe("settingsPersistence", () => {
  it("normalizes legacy and missing stored values", () => {
    const settings = normalizeStoredSettings(
      {
        host: "10.0.2.2",
        port: "11434",
        model: "file:///model.gguf",
        mode: "remote",
        agentMode: "false",
        openclawEnabled: "true",
        openclawNodeId: "node-42",
        turboMode: "true",
        draftModel: "file:///draft.gguf",
      },
      defaultSettings,
    );

    expect(settings).toEqual(
      expect.objectContaining({
        host: "10.0.2.2",
        port: "11434",
        model: "file:///model.gguf",
        mode: "nvidia-proxy",
        agentMode: false,
        openclawEnabled: true,
        openclawNodeId: "node-42",
        turboMode: true,
        draftModel: "file:///draft.gguf",
      }),
    );
  });

  it("falls back to defaults when values are absent", () => {
    expect(normalizeStoredSettings({}, defaultSettings)).toEqual(defaultSettings);
  });

  it("serializes OpenClaw fields for persistence", () => {
    const next = {
      ...defaultSettings,
      mode: "native" as const,
      openclawEnabled: true,
      openclawNodeId: "node-77",
      turboMode: true,
    };

    expect(
      getPersistedSettingsWrites(next, {
        mode: "native",
        openclawEnabled: true,
        openclawNodeId: "node-77",
        turboMode: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        ["mode", "native"],
        ["openclawEnabled", "true"],
        ["openclawNodeId", "node-77"],
        ["turboMode", "true"],
      ]),
    );
  });
});
