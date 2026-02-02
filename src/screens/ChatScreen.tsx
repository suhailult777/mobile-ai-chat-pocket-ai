import React, {
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  LayoutAnimation,
  UIManager,
  StatusBar,
} from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  FadeIn,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons"; // Assuming expo vector icons are available
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsContext } from "../context/SettingsContext";
import type { ChatMessage } from "../lib/ollamaClient";
import {
  streamProvider,
  pingProvider,
  getModelsProvider,
  prewarmProvider,
} from "../lib/providerRouter";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// --- Colors (Gemini High Contrast / Dark Mode) ---
const COLORS = {
  background: "#131314", // Deep Black/Dark Grey
  surfaceFiltered: "#1E1F20", // Input fields, secondary elements
  surfaceUser: "#2D2E30", // User bubble (Dark Gray)
  surfaceAssistant: "#004A77", // Assistant bubble tint (Subtle Blue) or Transparent
  textPrimary: "#E3E3E3",
  textSecondary: "#A8A8A8", // Hints, timestamps
  accent: "#A8C7FA", // Light Blue for active elements/icons
  accentDanger: "#E2B6B6", // Soft Red for stop
  inputBackground: "#1E1F20",
  border: "#444746",
};

// --- Components ---

const ThinkingIndicator = () => {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.2, { duration: 600, easing: Easing.ease }),
        withTiming(1, { duration: 600, easing: Easing.ease }),
      ),
      -1,
      true,
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={styles.thinkingContainer}>
      <Animated.View style={[styles.thinkingDot, animatedStyle]} />
      <Text style={styles.thinkingText}>Generating...</Text>
    </View>
  );
};

type BubbleProps = {
  role: ChatMessage["role"];
  content: string;
  isStreaming: boolean;
};

const MessageBubble = React.memo(function MessageBubble({
  role,
  content,
  isStreaming,
}: BubbleProps) {
  const isUser = role === "user";

  return (
    <View
      style={[
        styles.bubbleRow,
        isUser
          ? { justifyContent: "flex-end" }
          : { justifyContent: "flex-start" },
      ]}
    >
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
        ]}
      >
        <Text style={styles.bubbleText}>
          {content || (role === "assistant" && isStreaming ? "" : "")}
        </Text>
        {role === "assistant" && isStreaming && !content && (
          <ThinkingIndicator />
        )}
      </View>
    </View>
  );
});

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { settings, saveSettings } = useContext(SettingsContext);
  const baseUrl = useMemo(
    () => `http://${settings.host}:${settings.port}`,
    [settings.host, settings.port],
  );

  type UIMessage = ChatMessage & { id: string };
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [showModels, setShowModels] = useState(false);

  const listRef = useRef<FlashListRef<UIMessage>>(null);
  const streamRef = useRef<{ cancel: () => void } | null>(null);
  const tokenBufferRef = useRef<string>("");
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nearBottomRef = useRef<boolean>(true);
  const nextIdRef = useRef<number>(1);

  const toChatMessage = useCallback((m: UIMessage): ChatMessage => {
    return { role: m.role, content: m.content };
  }, []);

  const makeMessage = useCallback(
    (role: ChatMessage["role"], content: string): UIMessage => {
      const id = String(nextIdRef.current++);
      return { id, role, content };
    },
    [],
  );

  const truncateHistory = useCallback(
    (history: ChatMessage[]) => {
      // Simple, safe truncation: keep the most recent messages within both a count and character budget.
      const maxMessages = 40;
      const maxChars = 12000;

      const system = history.filter((m) => m.role === "system");
      const nonSystem = history.filter((m) => m.role !== "system");
      const tail = nonSystem.slice(Math.max(0, nonSystem.length - maxMessages));

      let total = 0;
      const trimmed: ChatMessage[] = [];
      for (let i = tail.length - 1; i >= 0; i--) {
        const m = tail[i];
        const cost = m.content.length;
        if (trimmed.length > 0 && total + cost > maxChars) break;
        total += cost;
        trimmed.push(m);
      }

      trimmed.reverse();
      return system.length ? [...system.slice(-1), ...trimmed] : trimmed;
    },
    [],
  );

  useEffect(() => {
    // Warm native context early to reduce TTFT when user enters chat directly.
    if (settings.mode !== "native") return;
    if (!settings.model?.startsWith("file://")) return;
    prewarmProvider({ mode: settings.mode, model: settings.model }).catch(() => {
      // best-effort
    });
  }, [settings.mode, settings.model]);

  // --- Scroll Logic ---
  const handleScroll = (e: any) => {
    // Basic near-bottom detection
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const paddingToBottom = 100;
    nearBottomRef.current =
      layoutMeasurement.height + contentOffset.y >=
      contentSize.height - paddingToBottom;
  };

  // --- Streaming Logic ---
  const startFlushLoop = () => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setInterval(() => {
      const buf = tokenBufferRef.current;
      if (!buf) return;
      tokenBufferRef.current = "";

      setMessages((prev) => {
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

      // Haptics on significant chunks (optional, kept subtle)
      // Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Auto-scroll logic
      if (nearBottomRef.current) {
        listRef.current?.scrollToEnd({ animated: false }); // False for smoother stream performance
      }
    }, 50); // 20 FPS flush for UI smoothness
  };

  const stopFlushLoop = (kind: "done" | "error" | "cancel") => {
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const remaining = tokenBufferRef.current;
    if (remaining) {
      tokenBufferRef.current = "";
      setMessages((prev) => {
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
    if (kind === "done") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (kind === "cancel") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  };

  // --- Send / Stop ---
  const send = useCallback(async () => {
    if (!input.trim() || isStreaming) return;
    setError(null);
    Keyboard.dismiss();

    const userMsg = makeMessage("user", input.trim());
    const assistantMsg = makeMessage("assistant", "");
    const historyUI = messages.concat(userMsg);
    const history = truncateHistory(historyUI.map(toChatMessage));

    setMessages([...historyUI, assistantMsg]);
    setInput("");

    // Animate list update
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 100);

    // Preflight
    try {
      const ok = await pingProvider({ mode: settings.mode, baseUrl });
      if (!ok) {
        throw new Error(
          settings.mode === "native"
            ? "Native module not ready"
            : "Cannot reach Ollama",
        );
      }
    } catch (e: any) {
      setError(e.message);
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
        stopFlushLoop("error");
      },
      onDone: () => {
        setIsStreaming(false);
        stopFlushLoop("done");
      },
    });
    streamRef.current = handle;
  }, [input, isStreaming, settings.mode, baseUrl, settings.model, messages]);

  const stop = useCallback(() => {
    streamRef.current?.cancel();
    setIsStreaming(false);
    stopFlushLoop("cancel");
  }, []);

  // --- Model Toggles ---
  const toggleModels = useCallback(async () => {
    if (!showModels) {
      try {
        // quick haptic
        Haptics.selectionAsync();
        const list = await getModelsProvider({ mode: settings.mode, baseUrl });
        setModels(list);
      } catch (e) {
        console.warn(e);
      }
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowModels(!showModels);
  }, [showModels, settings.mode, baseUrl]);

  const chooseModel = (m: string) => {
    saveSettings({ model: m });
    setShowModels(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: COLORS.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />

      {/* Header / Mode Switcher */}
      <View style={[styles.header, { marginTop: insets.top }]}>
        <TouchableOpacity onPress={toggleModels} style={styles.modelSelector}>
          <Ionicons name="cube-outline" size={16} color={COLORS.accent} />
          <Text style={styles.modelName}>{settings.model}</Text>
          <Ionicons
            name="chevron-down"
            size={14}
            color={COLORS.textSecondary}
          />
        </TouchableOpacity>

        <View style={styles.modePill}>
          <TouchableOpacity
            onPress={() => saveSettings({ mode: "remote" })}
            style={[
              styles.modeOption,
              settings.mode === "remote" && styles.modeActive,
            ]}
          >
            <Text
              style={[
                styles.modeText,
                settings.mode === "remote" && styles.modeTextActive,
              ]}
            >
              Remote
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => saveSettings({ mode: "native" })}
            style={[
              styles.modeOption,
              settings.mode === "native" && styles.modeActive,
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
      </View>

      {/* Model List Dropdown */}
      {showModels && (
        <View style={styles.modelDropdown}>
          {models.length === 0 ? (
            <Text style={{ color: "#666", padding: 10 }}>Loading...</Text>
          ) : (
            models.map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => chooseModel(m)}
                style={styles.modelOption}
              >
                <Text style={{ color: COLORS.textPrimary }}>{m}</Text>
                {m === settings.model && (
                  <Ionicons name="checkmark" size={16} color={COLORS.accent} />
                )}
              </TouchableOpacity>
            ))
          )}
        </View>
      )}

      {/* Chat List */}
      <FlashList
        ref={listRef}
        data={messages}
        renderItem={({ item }) => (
          <MessageBubble
            role={item.role}
            content={item.content}
            isStreaming={isStreaming}
          />
        )}
        keyExtractor={(item) => item.id}
        getItemType={(item) => item.role}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        keyboardDismissMode="on-drag"
        onScroll={handleScroll}
        keyboardShouldPersistTaps="handled"
      />

      {/* Error Banner */}
      {error && (
        <Animated.View entering={FadeIn} style={styles.errorBanner}>
          <Ionicons name="warning" size={16} color="#fff" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)}>
            <Ionicons name="close" size={16} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Floating Input Area */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
        style={styles.inputWrapper}
      >
        <View
          style={[
            styles.floatingIsland,
            { marginBottom: Platform.OS === "android" ? 12 : 0 },
          ]}
        >
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Ask anything..."
            placeholderTextColor={COLORS.textSecondary}
            multiline
            cursorColor={COLORS.accent}
          />

          <TouchableOpacity
            onPress={isStreaming ? stop : send}
            style={styles.sendButton}
            activeOpacity={0.7}
          >
            {isStreaming ? (
              <View style={styles.stopIcon} />
            ) : (
              <Ionicons name="arrow-up" size={20} color={COLORS.background} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 10,
  },
  modelSelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.surfaceFiltered,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  modelName: {
    color: COLORS.textPrimary,
    fontWeight: "600",
    fontSize: 14,
  },
  modelDropdown: {
    position: "absolute",
    top: 100,
    left: 16,
    right: 16,
    backgroundColor: COLORS.surfaceFiltered,
    borderRadius: 12,
    padding: 8,
    zIndex: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    elevation: 5,
  },
  modelOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  modePill: {
    flexDirection: "row",
    backgroundColor: COLORS.surfaceFiltered,
    borderRadius: 20,
    padding: 2,
  },
  modeOption: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 18,
  },
  modeActive: {
    backgroundColor: "#37383A",
  },
  modeText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "600" },
  modeTextActive: { color: COLORS.textPrimary },

  bubbleRow: {
    flexDirection: "row",
    width: "100%",
    marginBottom: 12,
  },
  bubble: {
    maxWidth: "85%",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bubbleUser: {
    backgroundColor: COLORS.surfaceUser,
    borderTopRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: "transparent",
    marginLeft: -10, // Slight visual offset to align with edge
  },
  bubbleText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    lineHeight: 24,
  },
  thinkingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  thinkingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.accent,
  },
  thinkingText: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },

  inputWrapper: {
    width: "100%",
    backgroundColor: "transparent",
    paddingHorizontal: 16,
    paddingBottom: 24, // Lift from bottom
  },
  floatingIsland: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: COLORS.inputBackground,
    borderRadius: 28,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textInput: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 16,
    maxHeight: 120,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.textPrimary, // White circle
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 2,
  },
  stopIcon: {
    width: 14,
    height: 14,
    backgroundColor: COLORS.background,
    borderRadius: 2,
  },
  errorBanner: {
    position: "absolute",
    bottom: 100,
    left: 16,
    right: 16,
    backgroundColor: "#331111",
    borderWidth: 1,
    borderColor: "#FF3B30",
    padding: 12,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  errorText: { color: "#FF8888", flex: 1, fontSize: 12 },
});
