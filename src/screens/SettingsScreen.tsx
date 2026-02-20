import React, { useContext, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
} from "react-native";
import { SettingsContext } from "../context/SettingsContext";
import { getModelsProvider, pingProvider } from "../lib/providerRouter";
import {
  getModelsDirNative,
  isNativeAvailable,
  prewarmNative,
} from "../lib/nativeClient";
import { File, Directory, Paths } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";

// Recommended draft models for speculative decoding (sorted by size)
const RECOMMENDED_DRAFT_MODELS = [
  {
    name: "Qwen2-0.5B-Instruct-Q4_K_M.gguf",
    size: "~350MB",
    recommended: true,
  },
  {
    name: "SmolLM-360M-Instruct-Q4_K_M.gguf",
    size: "~250MB",
    recommended: false,
  },
  {
    name: "TinyLlama-1.1B-Chat-Q4_K_M.gguf",
    size: "~700MB",
    recommended: false,
  },
];

export default function SettingsScreen() {
  const { settings, saveSettings } = useContext(SettingsContext);
  const [host, setHost] = useState(settings.host);
  const [port, setPort] = useState(settings.port);
  const [model, setModel] = useState(settings.model);
  const [mode, setMode] = useState<"remote" | "native">(settings.mode);
  const [turboMode, setTurboMode] = useState(settings.turboMode);
  const [draftModel, setDraftModel] = useState(settings.draftModel);

  const [status, setStatus] = useState<string>("");
  const [nativeInfo, setNativeInfo] = useState<string>("");
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserFiles, setBrowserFiles] = useState<string[]>([]);
  const [modelsDir, setModelsDir] = useState<string>("");
  const [showDraftPicker, setShowDraftPicker] = useState(false);
  const baseUrl = useMemo(() => `http://${host}:${port}`, [host, port]);

  const onSave = async () => {
    await saveSettings({ host, port, model, mode, turboMode, draftModel });
    setStatus("Saved");
    // Prewarm native model automatically to reduce cold starts
    if (mode === "native" && model.startsWith("file://")) {
      const warmed = await prewarmNative(model);
      if (warmed) setStatus("Saved • Native model prewarmed");
    }
    setTimeout(() => setStatus(""), 1500);
  };

  const onTest = async () => {
    setStatus("Testing…");
    const ok = await pingProvider({ mode, baseUrl });
    setStatus(
      ok
        ? "Connection OK"
        : mode === "native"
          ? "Native module not available or ping failed"
          : "Failed to connect",
    );
    if (mode === "native") {
      // Try to surface optional native details for Phase 3
      const avail = isNativeAvailable();
      let info = avail
        ? "Native module detected."
        : "Native module not detected.";
      const dir = await getModelsDirNative();
      if (dir) info += ` Models dir: ${dir}`;
      setNativeInfo(info);
      // Prewarm model if path looks valid
      if (model.startsWith("file://")) {
        const warmed = await prewarmNative(model);
        if (warmed) setStatus("Connection OK • Native model prewarmed");
      }
    } else {
      setNativeInfo("");
    }
  };

  const onFetchModels = async () => {
    try {
      setStatus("Fetching models…");
      const list = await getModelsProvider({ mode, baseUrl });
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
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionTitle}>Connection Mode</Text>
        <View style={styles.modeRow}>
          <TouchableOpacity
            onPress={() => setMode("remote")}
            style={[styles.modeBtn, mode === "remote" && styles.modeBtnActive]}
          >
            <Text
              style={[
                styles.modeText,
                mode === "remote" && styles.modeTextActive,
              ]}
            >
              Remote HTTP
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMode("native")}
            style={[styles.modeBtn, mode === "native" && styles.modeBtnActive]}
          >
            <Text
              style={[
                styles.modeText,
                mode === "native" && styles.modeTextActive,
              ]}
            >
              Native
            </Text>
          </TouchableOpacity>
        </View>
        {mode === "native" ? (
          <Text style={styles.hint}>
            Native mode requires a custom dev client/EAS build with the Ollama
            native module.
          </Text>
        ) : null}
        {mode === "native" && !!nativeInfo ? (
          <Text style={styles.hintSmall}>{nativeInfo}</Text>
        ) : null}
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

        {mode === "native" && (
          <>
            <View style={styles.browserHeader}>
              <Text style={styles.sectionTitle}>Model Browser (Native)</Text>
              <View style={styles.row}>
                <TouchableOpacity
                  onPress={async () => {
                    try {
                      const modelsDirectory = new Directory(
                        Paths.document,
                        "models",
                      );
                      if (!(await modelsDirectory.exists)) {
                        await modelsDirectory.create();
                      }
                      setModelsDir(modelsDirectory.uri);
                      const contents = await modelsDirectory.list();
                      const ggufs = contents
                        .filter(
                          (item) =>
                            item instanceof File &&
                            item.name.toLowerCase().endsWith(".gguf") &&
                            (item.size || 0) > 0,
                        )
                        .map((item) => item.uri);
                      setBrowserFiles(ggufs);
                      setShowBrowser(true);
                    } catch (e: any) {
                      setStatus(`Browser error: ${e?.message || String(e)}`);
                    }
                  }}
                  style={[styles.button, styles.secondary]}
                >
                  <Text style={styles.buttonText}>Open Browser</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    try {
                      const res = await DocumentPicker.getDocumentAsync({
                        copyToCacheDirectory: true,
                        type: "*/*",
                        multiple: false,
                      });
                      if (res.canceled) return;
                      const file = res.assets?.[0];
                      if (!file) return;
                      if (!file.name.toLowerCase().endsWith(".gguf")) {
                        setStatus("Please select a .gguf file");
                        return;
                      }
                      const modelsDirectory = new Directory(
                        Paths.document,
                        "models",
                      );
                      if (!(await modelsDirectory.exists)) {
                        await modelsDirectory.create();
                      }
                      // Copy from cache to models directory using new File API
                      // Need to specify destination file with proper name
                      const cachedFile = new File(file.uri);
                      const destinationFile = new File(
                        modelsDirectory.uri,
                        file.name,
                      );
                      await cachedFile.copy(destinationFile);
                      // Persist selection to use the just-imported model immediately
                      setModel(destinationFile.uri);
                      await saveSettings({ model: destinationFile.uri });
                      // Prewarm newly imported model
                      if (mode === "native") {
                        await prewarmNative(destinationFile.uri);
                      }
                      setStatus(
                        `Imported and selected: ${file.name} (${(
                          (destinationFile.size || 0) /
                          (1024 * 1024)
                        ).toFixed(2)} MB)`,
                      );

                      // Refresh the browser list
                      const contents = await modelsDirectory.list();
                      const ggufs = contents
                        .filter(
                          (item) =>
                            item instanceof File &&
                            item.name.toLowerCase().endsWith(".gguf") &&
                            (item.size || 0) > 0,
                        )
                        .map((item) => item.uri);
                      setModelsDir(modelsDirectory.uri);
                      setBrowserFiles(ggufs);
                      setShowBrowser(true);
                    } catch (e: any) {
                      setStatus(`Import error: ${e?.message || String(e)}`);
                    }
                  }}
                  style={[styles.button, styles.secondary]}
                >
                  <Text style={styles.buttonText}>Import GGUF</Text>
                </TouchableOpacity>
              </View>
            </View>
            {showBrowser && (
              <View style={styles.browserPanel}>
                <Text style={styles.hintSmall}>
                  Models directory: {modelsDir || "(app documents)/models/"}
                </Text>
                {browserFiles.length === 0 ? (
                  <Text style={styles.hintSmall}>No .gguf files found.</Text>
                ) : (
                  <ScrollView
                    style={{ maxHeight: 160 }}
                    contentContainerStyle={{ paddingVertical: 6 }}
                  >
                    {browserFiles.map((p) => (
                      <TouchableOpacity
                        key={p}
                        onPress={async () => {
                          setModel(p);
                          await saveSettings({ model: p });
                          if (mode === "native") {
                            await prewarmNative(p);
                          }
                          setStatus(`Selected model: ${p}`);
                        }}
                        style={styles.fileItem}
                      >
                        <Text style={styles.fileText}>{p}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            )}
          </>
        )}

        {/* Turbo Mode (Speculative Decoding) - Only for Native mode */}
        {mode === "native" && (
          <View style={styles.turboSection}>
            <View style={styles.turboHeader}>
              <View>
                <Text style={styles.sectionTitle}>⚡ Turbo Mode</Text>
                <Text style={styles.hintSmall}>
                  Uses a small draft model for 1.5-2x faster inference
                </Text>
              </View>
              <Switch
                value={turboMode}
                onValueChange={(value) => {
                  setTurboMode(value);
                  if (!value) {
                    // Clear draft model when disabling
                    setDraftModel("");
                  }
                }}
                trackColor={{ false: "#767577", true: "#81b0ff" }}
                thumbColor={turboMode ? "#007AFF" : "#f4f3f4"}
              />
            </View>

            {turboMode && (
              <View style={styles.draftModelSection}>
                <Text style={styles.label}>Draft Model</Text>
                <Text style={styles.hintSmall}>
                  Select a small GGUF model (~0.5B params) for speculation
                </Text>

                {draftModel ? (
                  <View style={styles.selectedDraft}>
                    <Text style={styles.fileText} numberOfLines={1}>
                      {draftModel.split("/").pop()}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setDraftModel("")}
                      style={styles.clearButton}
                    >
                      <Text style={styles.clearButtonText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => setShowDraftPicker(true)}
                    style={[styles.button, styles.secondary]}
                  >
                    <Text style={styles.buttonText}>Select Draft Model</Text>
                  </TouchableOpacity>
                )}

                {showDraftPicker && (
                  <View style={styles.draftPicker}>
                    <Text style={styles.hintSmall}>
                      Recommended draft models:
                    </Text>
                    {RECOMMENDED_DRAFT_MODELS.map((dm) => (
                      <View key={dm.name} style={styles.draftOption}>
                        <Text style={styles.draftName}>
                          {dm.name} ({dm.size}){dm.recommended && " ⭐"}
                        </Text>
                      </View>
                    ))}
                    <Text style={styles.hintSmall}>
                      Select from your imported models:
                    </Text>
                    {browserFiles.length === 0 ? (
                      <Text style={styles.hintSmall}>
                        No models imported yet. Use Model Browser above.
                      </Text>
                    ) : (
                      browserFiles
                        .filter((f) => f !== model) // Exclude main model
                        .map((f) => (
                          <TouchableOpacity
                            key={f}
                            onPress={() => {
                              setDraftModel(f);
                              setShowDraftPicker(false);
                            }}
                            style={styles.fileItem}
                          >
                            <Text style={styles.fileText}>
                              {f.split("/").pop()}
                            </Text>
                          </TouchableOpacity>
                        ))
                    )}
                    <TouchableOpacity
                      onPress={() => setShowDraftPicker(false)}
                      style={[styles.button, { marginTop: 8 }]}
                    >
                      <Text style={styles.buttonText}>Close</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        <Text style={styles.status}>{status}</Text>
        <Text style={styles.hint}>
          Tip: For Expo Go, use Remote HTTP mode and connect to a desktop/laptop
          running Ollama on the same LAN.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  sectionTitle: {
    marginTop: 4,
    marginBottom: 6,
    fontWeight: "700",
    fontSize: 16,
  },
  modeRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  modeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    marginRight: 8,
  },
  modeBtnActive: { backgroundColor: "#E6F0FF", borderColor: "#007AFF" },
  modeText: { color: "#333" },
  modeTextActive: { color: "#007AFF", fontWeight: "700" },
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
  hintSmall: { marginTop: 4, color: "#777", fontSize: 12 },
  browserHeader: { marginTop: 16 },
  browserPanel: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 8,
  },
  fileItem: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  fileText: { color: "#333", fontSize: 12 },
  // Turbo Mode styles
  turboSection: {
    marginTop: 20,
    padding: 12,
    backgroundColor: "#F8F9FA",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  turboHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  draftModelSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ddd",
  },
  selectedDraft: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#E6F0FF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  clearButton: {
    padding: 4,
  },
  clearButtonText: {
    color: "#666",
    fontSize: 16,
  },
  draftPicker: {
    marginTop: 12,
    padding: 8,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  draftOption: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  draftName: {
    fontSize: 12,
    color: "#333",
  },
});
