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
  fetchOpenClawNodes,
  pingOpenClawBridge,
  type OpenClawNodeInfo,
} from "../lib/toolExecutor";
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
  const [mode, setMode] = useState<"nvidia-proxy" | "native">(settings.mode);
  const [agentMode, setAgentMode] = useState(settings.agentMode);
  const [openclawEnabled, setOpenclawEnabled] = useState(
    settings.openclawEnabled,
  );
  const [openclawNodeId, setOpenclawNodeId] = useState(settings.openclawNodeId);
  const [turboMode, setTurboMode] = useState(settings.turboMode);
  const [draftModel, setDraftModel] = useState(settings.draftModel);

  const [status, setStatus] = useState<string>("");
  const [nativeInfo, setNativeInfo] = useState<string>("");
  const [openclawNodes, setOpenclawNodes] = useState<OpenClawNodeInfo[]>([]);
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserFiles, setBrowserFiles] = useState<string[]>([]);
  const [modelsDir, setModelsDir] = useState<string>("");
  const [showDraftPicker, setShowDraftPicker] = useState(false);
  const baseUrl = useMemo(() => `http://${host}:${port}`, [host, port]);

  const onSave = async () => {
    if (openclawEnabled && !openclawNodeId.trim()) {
      setStatus("OpenClaw requires a target node ID");
      return;
    }

    await saveSettings({
      host,
      port,
      model,
      mode,
      agentMode,
      openclawEnabled,
      openclawNodeId,
      turboMode,
      draftModel,
    });
    setStatus("Saved");
    // Prewarm native model automatically to reduce cold starts
    if (mode === "native" && model.startsWith("file://")) {
      const warmed = await prewarmNative(model);
      if (warmed) setStatus("Saved • Native model prewarmed");
    }
    setTimeout(() => setStatus(""), 1500);
  };

  const onTestOpenClaw = async () => {
    if (!openclawEnabled) {
      setStatus("Enable OpenClaw first");
      return;
    }

    setStatus("Testing OpenClaw bridge…");
    try {
      const ok = await pingOpenClawBridge(baseUrl);
      setStatus(ok ? "OpenClaw bridge OK" : "OpenClaw bridge unreachable");
    } catch (e: any) {
      setStatus(`OpenClaw bridge error: ${e?.message || String(e)}`);
    }
  };

  const onListOpenClawNodes = async () => {
    if (!openclawEnabled) {
      setStatus("Enable OpenClaw first");
      return;
    }

    setStatus("Listing OpenClaw nodes…");
    try {
      const result = await fetchOpenClawNodes(baseUrl);
      setOpenclawNodes(result.nodes);
      if (result.nodes.length > 0) {
        setStatus(`Found ${result.nodes.length} OpenClaw node(s)`);
      } else {
        setStatus("No paired OpenClaw nodes found");
      }
    } catch (e: any) {
      setOpenclawNodes([]);
      setStatus(`OpenClaw node list error: ${e?.message || String(e)}`);
    }
  };

  const onTest = async () => {
    setStatus("Testing…");
    const ok = await pingProvider({ mode, baseUrl });
    setStatus(
      ok
        ? "Connection OK"
        : mode === "native"
          ? "Native module not available or ping failed"
          : "Failed to connect to NVIDIA proxy",
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
            onPress={() => setMode("nvidia-proxy")}
            style={[
              styles.modeBtn,
              mode === "nvidia-proxy" && styles.modeBtnActive,
            ]}
          >
            <Text
              style={[
                styles.modeText,
                mode === "nvidia-proxy" && styles.modeTextActive,
              ]}
            >
              NVIDIA Proxy
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
        ) : (
          <Text style={styles.hint}>
            Proxy mode routes chat through your backend service, which securely
            calls NVIDIA NIM.
          </Text>
        )}
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
          placeholder="8787"
          keyboardType="numeric"
        />

        <Text style={styles.label}>Model</Text>
        <TextInput
          style={styles.input}
          value={model}
          onChangeText={setModel}
          placeholder="z-ai/glm5"
        />

        <View style={styles.turboSection}>
          <View style={styles.turboHeader}>
            <View>
              <Text style={styles.sectionTitle}>Agent Mode (Scaffold)</Text>
              <Text style={styles.hintSmall}>
                Enables web_search/fetch_page tool workflows (proxy mode now,
                native GGUF support experimental).
              </Text>
            </View>
            <Switch
              value={agentMode}
              onValueChange={setAgentMode}
              trackColor={{ false: "#767577", true: "#81b0ff" }}
              thumbColor={agentMode ? "#007AFF" : "#f4f3f4"}
            />
          </View>
        </View>

        {agentMode ? (
          <View style={styles.turboSection}>
            <View style={styles.turboHeader}>
              <View>
                <Text style={styles.sectionTitle}>OpenClaw Bridge</Text>
                <Text style={styles.hintSmall}>
                  Enables controlled PC tools through the local proxy bridge.
                  The app stores only the target node, not gateway credentials.
                </Text>
              </View>
              <Switch
                value={openclawEnabled}
                onValueChange={setOpenclawEnabled}
                trackColor={{ false: "#767577", true: "#81b0ff" }}
                thumbColor={openclawEnabled ? "#007AFF" : "#f4f3f4"}
              />
            </View>

            {openclawEnabled ? (
              <>
                <Text style={styles.label}>Target Node ID</Text>
                <TextInput
                  style={styles.input}
                  value={openclawNodeId}
                  onChangeText={setOpenclawNodeId}
                  placeholder="laptop-01"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={styles.hintSmall}>
                  The node ID must match a paired OpenClaw node on the bridge.
                </Text>
                <View style={styles.row}>
                  <TouchableOpacity
                    onPress={onTestOpenClaw}
                    style={[styles.button, styles.secondary]}
                  >
                    <Text style={styles.buttonText}>Test Bridge</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={onListOpenClawNodes}
                    style={[styles.button, styles.secondary]}
                  >
                    <Text style={styles.buttonText}>List Nodes</Text>
                  </TouchableOpacity>
                </View>
                {openclawNodes.length > 0 ? (
                  <View style={styles.browserPanel}>
                    <Text style={styles.hintSmall}>Paired OpenClaw nodes:</Text>
                    {openclawNodes.map((node) => (
                      <TouchableOpacity
                        key={node.id}
                        onPress={() => {
                          setOpenclawNodeId(node.id);
                          setStatus(`Selected node ID: ${node.id}`);
                        }}
                        style={styles.fileItem}
                      >
                        <Text style={styles.fileText}>{node.name}</Text>
                        <Text style={styles.hintSmall}>
                          ID: {node.id}
                          {node.status ? ` • ${node.status}` : ""}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={styles.hintSmall}>
                Turn this on when you want the agent to use OpenClaw tools.
              </Text>
            )}
          </View>
        ) : null}

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
          Tip: For Expo Go, use NVIDIA Proxy mode and point Host/Port to your
          backend service on the same LAN.
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
