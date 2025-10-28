import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from "react-native";
import * as SecureStore from "expo-secure-store";
import ChatScreen from "./src/screens/ChatScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

export type Settings = {
  host: string;
  port: string;
  model: string;
};

export const defaultSettings: Settings = {
  host: "127.0.0.1",
  port: "11434",
  model: "llama3",
};

import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SettingsProvider } from './src/context/SettingsContext';

export default function App() {
  const [tab, setTab] = useState<"chat" | "settings">("chat");
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  useEffect(() => {
    (async () => {
      try {
        const [host, port, model] = await Promise.all([
          SecureStore.getItemAsync("host"),
          SecureStore.getItemAsync("port"),
          SecureStore.getItemAsync("model"),
        ]);
        setSettings({
          host: host || defaultSettings.host,
          port: port || defaultSettings.port,
          model: model || defaultSettings.model,
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
      } catch (e) {
        console.warn("Failed to save settings", e);
      }
    },
    [settings]
  );

  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.tabBar}>
          <TabButton
            label="Chat"
            active={tab === "chat"}
            onPress={() => setTab("chat")}
          />
          <TabButton
            label="Settings"
            active={tab === "settings"}
            onPress={() => setTab("settings")}
          />
        </View>
        <View style={styles.content}>
          {tab === "chat" ? <ChatScreen /> : <SettingsScreen />}
        </View>
        </SafeAreaView>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tabButton, active && styles.tabButtonActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  tabButton: { flex: 1, padding: 12, alignItems: "center" },
  tabButtonActive: { borderBottomWidth: 2, borderBottomColor: "#007AFF" },
  tabText: { color: "#555", fontWeight: "500" },
  tabTextActive: { color: "#007AFF", fontWeight: "700" },
  content: { flex: 1 },
});
