import React, { useContext, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { SettingsContext } from "../../App";
import { getModels, ping } from "../lib/ollamaClient";

export default function SettingsScreen() {
  const { settings, saveSettings } = useContext(SettingsContext);
  const [host, setHost] = useState(settings.host);
  const [port, setPort] = useState(settings.port);
  const [model, setModel] = useState(settings.model);

  const [status, setStatus] = useState<string>("");
  const baseUrl = useMemo(() => `http://${host}:${port}`, [host, port]);

  const onSave = async () => {
    await saveSettings({ host, port, model });
    setStatus("Saved");
    setTimeout(() => setStatus(""), 1500);
  };

  const onTest = async () => {
    setStatus("Testing…");
    const ok = await ping(baseUrl);
    setStatus(ok ? "Connection OK" : "Failed to connect");
  };

  const onFetchModels = async () => {
    try {
      setStatus("Fetching models…");
      const list = await getModels(baseUrl);
      if (list.length) {
        setModel(list[0]);
        setStatus(`Found ${list.length} models. Selected: ${list[0]}`);
      } else {
        setStatus("No models found");
      }
    } catch (e: any) {
      setStatus(`Error: ${e?.message || String(e)}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Host</Text>
      <TextInput
        style={styles.input}
        value={host}
        onChangeText={setHost}
        placeholder="127.0.0.1"
      />

      <Text style={styles.label}>Port</Text>
      <TextInput
        style={styles.input}
        value={port}
        onChangeText={setPort}
        placeholder="11434"
        keyboardType="numeric"
      />

      <Text style={styles.label}>Model</Text>
      <TextInput
        style={styles.input}
        value={model}
        onChangeText={setModel}
        placeholder="llama3"
      />

      <View style={styles.row}>
        <TouchableOpacity onPress={onSave} style={styles.button}>
          <Text style={styles.buttonText}>Save</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onTest}
          style={[styles.button, styles.secondary]}
        >
          <Text style={styles.buttonText}>Test</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onFetchModels}
          style={[styles.button, styles.secondary]}
        >
          <Text style={styles.buttonText}>Fetch Models</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.status}>{status}</Text>
      <Text style={styles.hint}>
        Tip: For Expo Go, connect to a desktop/laptop running Ollama on the same
        LAN.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  label: { marginTop: 8, marginBottom: 4, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  row: { flexDirection: "row", gap: 8, marginTop: 12 },
  button: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginRight: 8,
  },
  secondary: { backgroundColor: "#5856D6" },
  buttonText: { color: "#fff", fontWeight: "700" },
  status: { marginTop: 12, color: "#333" },
  hint: { marginTop: 6, color: "#666" },
});
