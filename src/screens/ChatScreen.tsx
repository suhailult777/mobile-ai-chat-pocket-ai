import React, { useContext, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
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
  // Buffer incoming tokens and flush at ~30–60Hz to reduce re-renders
  const tokenBufferRef = useRef<string>("");
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startFlushLoop = () => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setInterval(() => {
      const buf = tokenBufferRef.current;
      if (!buf) return;
      tokenBufferRef.current = "";
      setMessages((prev: ChatMessage[]) => {
        const next = [...prev];
        const lastIdx = next.length - 1;
        if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
          next[lastIdx] = {
            ...next[lastIdx],
            content: next[lastIdx].content + buf,
          };
        }
        return next;
      });
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 33); // ~30 FPS
  };

  const stopFlushLoop = () => {
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    // Flush any remaining tokens one last time
    const remaining = tokenBufferRef.current;
    if (remaining) {
      tokenBufferRef.current = "";
      setMessages((prev: ChatMessage[]) => {
        const next = [...prev];
        const lastIdx = next.length - 1;
        if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
          next[lastIdx] = {
            ...next[lastIdx],
            content: next[lastIdx].content + remaining,
          };
        }
        return next;
      });
    }
  };

  // Truncate history to reduce prompt size and speed up server-side processing
  const buildTruncatedHistory = (
    existing: ChatMessage[],
    newUserMsg: ChatMessage,
    budgetChars = 4000
  ): ChatMessage[] => {
    const withNew = [...existing, newUserMsg];
    // Always keep the latest message and at least one assistant reply if present
    let total = 0;
    const out: ChatMessage[] = [];
    for (let i = withNew.length - 1; i >= 0; i--) {
      const m = withNew[i];
      const len = (m.content || "").length + 16; // include role/overhead
      if (out.length === 0 || total + len <= budgetChars) {
        out.push(m);
        total += len;
      } else {
        break;
      }
    }
    return out.reverse();
  };

  const send = async () => {
    if (!input.trim() || isStreaming) return;
    setError(null);

  const userMsg: ChatMessage = { role: "user", content: input.trim() };
  const history = buildTruncatedHistory(messages, userMsg);
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };

    // Update messages with both user and assistant seed in one batch
    setMessages([...history, assistantMsg]);
    setInput("");

    // Dismiss keyboard after sending
    Keyboard.dismiss();

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
  tokenBufferRef.current = "";
  startFlushLoop();

    const handle = streamProvider({
      mode: settings.mode,
      baseUrl,
      model: settings.model,
      messages: history,
      onToken: (t) => {
        tokenBufferRef.current += t;
      },
      onError: (e) => {
        setError(String(e?.message || e));
        setIsStreaming(false);
        stopFlushLoop();
      },
      onDone: () => {
        setIsStreaming(false);
        stopFlushLoop();
      },
    });

    streamRef.current = handle;
  };

  const stop = () => {
    streamRef.current?.cancel();
    setIsStreaming(false);
    stopFlushLoop();
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={100}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
      >
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
          multiline
          maxLength={1000}
          returnKeyType="send"
          onSubmitEditing={send}
          blurOnSubmit={false}
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
      <View style={styles.modeRow}>
        <Text style={styles.label}>Mode:</Text>
        <TouchableOpacity
          onPress={() => saveSettings({ mode: "remote" })}
          style={[
            styles.modeBtn,
            settings.mode === "remote" && styles.modeBtnActive,
          ]}
        >
          <Text
            style={[
              styles.modeText,
              settings.mode === "remote" && styles.modeTextActive,
            ]}
          >
            Remote HTTP
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => saveSettings({ mode: "native" })}
          style={[
            styles.modeBtn,
            settings.mode === "native" && styles.modeBtnActive,
          ]}
        >
          <Text
            style={[
              styles.modeText,
              settings.mode === "native" && styles.modeTextActive,
            ]}
          >
            Native
          </Text>
        </TouchableOpacity>
      </View>
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
    </KeyboardAvoidingView>
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
    maxHeight: 100,
    minHeight: 40,
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
  modeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  label: { fontSize: 13, color: "#333", fontWeight: "600" },
  modeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
  },
  modeBtnActive: { backgroundColor: "#E6F0FF", borderColor: "#007AFF" },
  modeText: { color: "#333", fontSize: 12 },
  modeTextActive: { color: "#007AFF", fontWeight: "700" },
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
