export type AppSettings = {
  host: string;
  port: string;
  model: string;
  mode: "nvidia-proxy" | "native";
  agentMode: boolean;
  openclawEnabled: boolean;
  openclawNodeId: string;
  turboMode: boolean;
  draftModel: string;
};

export type StoredSettingsSnapshot = Partial<
  Record<keyof AppSettings, string | null | undefined>
>;

export const defaultSettings: AppSettings = {
  host: "127.0.0.1",
  port: "8787",
  model: "nvidia/nemotron-3-nano-30b-a3b",
  mode: "nvidia-proxy",
  agentMode: true,
  openclawEnabled: false,
  openclawNodeId: "",
  turboMode: false,
  draftModel: "",
};

function getBooleanSnapshot(
  rawValue: string | null | undefined,
  fallback: boolean,
): boolean {
  if (rawValue == null) return fallback;
  return rawValue === "true";
}

function getStringSnapshot(
  rawValue: string | null | undefined,
  fallback: string,
): string {
  return rawValue || fallback;
}

function normalizeModeSnapshot(
  rawValue: string | null | undefined,
  fallback: AppSettings["mode"],
): AppSettings["mode"] {
  if (rawValue === "remote") return "nvidia-proxy";
  if (rawValue === "nvidia-proxy" || rawValue === "native") return rawValue;
  return fallback;
}

export function normalizeStoredSettings(
  raw: StoredSettingsSnapshot,
  defaults: AppSettings = defaultSettings,
): AppSettings {
  return {
    host: getStringSnapshot(raw.host, defaults.host),
    port: getStringSnapshot(raw.port, defaults.port),
    model: getStringSnapshot(raw.model, defaults.model),
    mode: normalizeModeSnapshot(raw.mode, defaults.mode),
    agentMode: getBooleanSnapshot(raw.agentMode, defaults.agentMode),
    openclawEnabled: getBooleanSnapshot(
      raw.openclawEnabled,
      defaults.openclawEnabled,
    ),
    openclawNodeId: getStringSnapshot(raw.openclawNodeId, defaults.openclawNodeId),
    turboMode: getBooleanSnapshot(raw.turboMode, defaults.turboMode),
    draftModel: getStringSnapshot(raw.draftModel, defaults.draftModel),
  };
}

export function getPersistedSettingsWrites(
  current: AppSettings,
  partial: Partial<AppSettings>,
): Array<[keyof AppSettings, string]> {
  const writes: Array<[keyof AppSettings, string]> = [];

  if (partial.host !== undefined) writes.push(["host", current.host]);
  if (partial.port !== undefined) writes.push(["port", current.port]);
  if (partial.model !== undefined) writes.push(["model", current.model]);
  if (partial.mode !== undefined) writes.push(["mode", current.mode]);
  if (partial.agentMode !== undefined)
    writes.push(["agentMode", String(current.agentMode)]);
  if (partial.openclawEnabled !== undefined)
    writes.push(["openclawEnabled", String(current.openclawEnabled)]);
  if (partial.openclawNodeId !== undefined)
    writes.push(["openclawNodeId", current.openclawNodeId]);
  if (partial.turboMode !== undefined)
    writes.push(["turboMode", String(current.turboMode)]);
  if (partial.draftModel !== undefined)
    writes.push(["draftModel", current.draftModel]);

  return writes;
}
