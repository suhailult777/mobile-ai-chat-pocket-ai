import React, { useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";

export type Settings = {
  host: string;
  port: string;
  model: string;
  mode: "remote" | "native";
};

export const defaultSettings: Settings = {
  host: "127.0.0.1",
  port: "11434",
  model: "tinyllama:latest",
  mode: "remote",
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
        const [host, port, model, mode] = await Promise.all([
          SecureStore.getItemAsync("host"),
          SecureStore.getItemAsync("port"),
          SecureStore.getItemAsync("model"),
          SecureStore.getItemAsync("mode"),
        ]);
        setSettings({
          host: host || defaultSettings.host,
          port: port || defaultSettings.port,
          model: model || defaultSettings.model,
          mode: (mode as Settings["mode"]) || defaultSettings.mode,
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
      } catch (e) {
        console.warn("Failed to save settings", e);
      }
    },
    [settings]
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
