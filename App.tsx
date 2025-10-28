import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
} from "react-native";
import ChatScreen from "./src/screens/ChatScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { SettingsProvider } from "./src/context/SettingsContext";

export default function App() {
  const [tab, setTab] = useState<"chat" | "settings">("chat");

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
