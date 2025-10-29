import React, { useContext, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { SettingsContext } from "../context/SettingsContext";
import type { ChatMessage } from "../lib/ollamaClient";
import {
  streamProvider,
  pingProvider,
  getModelsProvider,
} from "../lib/providerRouter";

export default function ChatScreen() {
  const { settings, saveSettings } = useContext(SettingsContext);
  const baseUrl = useMemo(
    () => `http://${settings.host}:${settings.port}`,
    [settings.host, settings.port]
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [showModels, setShowModels] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const streamRef = useRef<{ cancel: () => void } | null>(null);

  const send = async () => {
    if (!input.trim() || isStreaming) return;
    setError(null);

    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");

    // Seed an assistant message we will stream into
    setMessages((prev: ChatMessage[]) => [
      ...prev,
      { role: "assistant", content: "" },
    ]);

    // Preflight connectivity check to provide actionable errors
    const ok = await pingProvider({ mode: settings.mode, baseUrl });
    if (!ok) {
      setError(
        settings.mode === "native"
          ? "Native module not available. Build a dev client/EAS with the Ollama native module."
          : `Cannot reach Ollama at ${baseUrl}. On Android emulator use http://10.0.2.2:11434; on device use your PC's LAN IP and run Ollama bound to 0.0.0.0.`
      );
      return;
    }

    setIsStreaming(true);

    const handle = streamProvider({
      mode: settings.mode,
      baseUrl,
      model: settings.model,
      messages: history,
      onToken: (t) => {
        setMessages((prev: ChatMessage[]) => {
          const next = [...prev];
          const lastIdx = next.length - 1;
          if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
            next[lastIdx] = {
              ...next[lastIdx],
              content: next[lastIdx].content + t,
            };
          }
          return next;
        });
        scrollRef.current?.scrollToEnd({ animated: true });
      },
      onError: (e) => {
        setError(String(e?.message || e));
        setIsStreaming(false);
      },
      onDone: () => setIsStreaming(false),
    });

    streamRef.current = handle;
  };

  const stop = () => {
    streamRef.current?.cancel();
    setIsStreaming(false);
  };

  const toggleModels = async () => {
    if (!showModels && models.length === 0) {
      try {
        const list = await getModelsProvider({ mode: settings.mode, baseUrl });
        setModels(list);
      } catch (e) {
        setError(`Models fetch failed: ${String((e as any)?.message || e)}`);
      }
    }
    setShowModels((v) => !v);
  };

  const chooseModel = async (m: string) => {
    await saveSettings({ model: m });
    setShowModels(false);
  };

  return (
    <View style={styles.container}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.messages}>
        {messages.map((m, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              m.role === "user" ? styles.user : styles.assistant,
            ]}
          >
            <Text style={styles.bubbleText}>
              {m.content || (m.role === "assistant" && isStreaming ? "…" : "")}
            </Text>
          </View>
        ))}
      </ScrollView>

      {error ? <Text style={styles.error}>Error: {error}</Text> : null}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={`Message (${settings.model})`}
          editable={!isStreaming}
        />
        {isStreaming ? (
          <TouchableOpacity onPress={stop} style={[styles.button, styles.stop]}>
            <Text style={styles.buttonText}>Stop</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={send} style={styles.button}>
            <Text style={styles.buttonText}>Send</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.hint}>
        Connect your phone and Ollama host to the same LAN. Endpoint: {baseUrl}
      </Text>
      <Text style={styles.hintSmall}>
        Mode:{" "}
        {settings.mode === "native"
          ? "Native (dev client required)"
          : "Remote HTTP"}
      </Text>
      <View style={styles.modelRow}>
        <TouchableOpacity
          onPress={toggleModels}
          style={[styles.button, styles.modelButton]}
        >
          <Text style={styles.buttonText}>Model: {settings.model}</Text>
        </TouchableOpacity>
      </View>
      {showModels && (
        <View style={styles.modelList}>
          <ScrollView horizontal contentContainerStyle={styles.modelListInner}>
            {models.map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => chooseModel(m)}
                style={[styles.chip, m === settings.model && styles.chipActive]}
              >
                <Text
                  style={[
                    styles.chipText,
                    m === settings.model && styles.chipTextActive,
                  ]}
                >
                  {m}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  messages: { padding: 12 },
  bubble: {
    padding: 10,
    borderRadius: 10,
    marginVertical: 6,
    maxWidth: "85%",
  },
  user: { alignSelf: "flex-end", backgroundColor: "#DCF8C6" },
  assistant: { alignSelf: "flex-start", backgroundColor: "#eee" },
  bubbleText: { fontSize: 16, color: "#111" },
  inputRow: {
    flexDirection: "row",
    padding: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ddd",
  },
  input: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  button: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: 8,
  },
  stop: { backgroundColor: "#FF3B30" },
  buttonText: { color: "#fff", fontWeight: "700" },
  hint: { textAlign: "center", color: "#666", padding: 8, fontSize: 12 },
  hintSmall: {
    textAlign: "center",
    color: "#888",
    paddingHorizontal: 8,
    fontSize: 11,
  },
  error: { color: "#e00", textAlign: "center", paddingHorizontal: 12 },
  modelRow: { flexDirection: "row", paddingHorizontal: 8, paddingBottom: 4 },
  modelButton: { backgroundColor: "#5856D6", marginRight: 8 },
  modelList: { paddingHorizontal: 8, paddingBottom: 8 },
  modelListInner: { alignItems: "center" },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ccc",
    marginRight: 8,
  },
  chipActive: { backgroundColor: "#E6F0FF", borderColor: "#007AFF" },
  chipText: { color: "#333" },
  chipTextActive: { color: "#007AFF", fontWeight: "700" },
});
