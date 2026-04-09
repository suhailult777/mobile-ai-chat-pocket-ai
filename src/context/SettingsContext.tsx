import React, { useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
import {
  defaultSettings as persistedDefaultSettings,
  getPersistedSettingsWrites,
  normalizeStoredSettings,
  type AppSettings,
} from "./settingsPersistence";

export type Settings = AppSettings;

export const defaultSettings: Settings = persistedDefaultSettings;

export const SettingsContext = React.createContext<{
  settings: Settings;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
}>({ settings: defaultSettings, saveSettings: async () => {} });

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  useEffect(() => {
    (async () => {
      try {
        const [
          host,
          port,
          model,
          mode,
          agentMode,
          openclawEnabled,
          openclawNodeId,
          turboMode,
          draftModel,
        ] = await Promise.all([
          SecureStore.getItemAsync("host"),
          SecureStore.getItemAsync("port"),
          SecureStore.getItemAsync("model"),
          SecureStore.getItemAsync("mode"),
          SecureStore.getItemAsync("agentMode"),
          SecureStore.getItemAsync("openclawEnabled"),
          SecureStore.getItemAsync("openclawNodeId"),
          SecureStore.getItemAsync("turboMode"),
          SecureStore.getItemAsync("draftModel"),
        ]);
        setSettings(
          normalizeStoredSettings(
            {
              host,
              port,
              model,
              mode,
              agentMode,
              openclawEnabled,
              openclawNodeId,
              turboMode,
              draftModel,
            },
            defaultSettings,
          ),
        );
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
        const writes = getPersistedSettingsWrites(next, partial);
        for (const [key, value] of writes) {
          await SecureStore.setItemAsync(key, value);
        }
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
