import React, { useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";

export type Settings = {
  host: string;
  port: string;
  model: string;
  mode: "nvidia-proxy" | "native";
  agentMode: boolean;
  // Speculative decoding settings (Phase 6)
  turboMode: boolean;
  draftModel: string; // file:// path to smaller GGUF model for speculation
};

export const defaultSettings: Settings = {
  host: "127.0.0.1",
  port: "8787",
  model: "nvidia/nemotron-3-nano-30b-a3b",
  mode: "nvidia-proxy",
  agentMode: true,
  turboMode: false,
  draftModel: "",
};

export const SettingsContext = React.createContext<{
  settings: Settings;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
}>({ settings: defaultSettings, saveSettings: async () => {} });

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  useEffect(() => {
    (async () => {
      try {
        const [host, port, model, mode, agentMode, turboMode, draftModel] =
          await Promise.all([
            SecureStore.getItemAsync("host"),
            SecureStore.getItemAsync("port"),
            SecureStore.getItemAsync("model"),
            SecureStore.getItemAsync("mode"),
            SecureStore.getItemAsync("agentMode"),
            SecureStore.getItemAsync("turboMode"),
            SecureStore.getItemAsync("draftModel"),
          ]);
        const normalizedMode: Settings["mode"] =
          mode === "remote"
            ? "nvidia-proxy"
            : (mode as Settings["mode"]) || defaultSettings.mode;
        setSettings({
          host: host || defaultSettings.host,
          port: port || defaultSettings.port,
          model: model || defaultSettings.model,
          mode: normalizedMode,
          agentMode: agentMode
            ? agentMode === "true"
            : defaultSettings.agentMode,
          turboMode: turboMode === "true",
          draftModel: draftModel || defaultSettings.draftModel,
        });
      } catch (e) {
        console.warn("Failed to load settings", e);
      }
    })();
  }, []);

  const saveSettings = useMemo(
    () => async (partial: Partial<Settings>) => {
      const next = { ...settings, ...partial };
      setSettings(next);
      try {
        if (partial.host !== undefined)
          await SecureStore.setItemAsync("host", next.host);
        if (partial.port !== undefined)
          await SecureStore.setItemAsync("port", next.port);
        if (partial.model !== undefined)
          await SecureStore.setItemAsync("model", next.model);
        if (partial.mode !== undefined)
          await SecureStore.setItemAsync("mode", next.mode);
        if (partial.agentMode !== undefined)
          await SecureStore.setItemAsync("agentMode", String(next.agentMode));
        if (partial.turboMode !== undefined)
          await SecureStore.setItemAsync("turboMode", String(next.turboMode));
        if (partial.draftModel !== undefined)
          await SecureStore.setItemAsync("draftModel", next.draftModel);
      } catch (e) {
        console.warn("Failed to save settings", e);
      }
    },
    [settings],
  );

  return (
    <SettingsContext.Provider value={{ settings, saveSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = React.useContext(SettingsContext);
  return ctx;
}
