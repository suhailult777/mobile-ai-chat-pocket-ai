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
  AppState,
  type AppStateStatus,
} from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
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
  disposeProvider,
} from "../lib/providerRouter";
import { useStreamingText } from "../hooks/useStreamingText";
import { useThrottledCallback } from "../hooks/useThrottledCallback";
import { StreamingBubble } from "../components/StreamingBubble";
import { SkeletonBubble } from "../components/SkeletonBubble";

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

// Pre-computed styles for FlashList optimization (avoid inline objects)
const FLASH_LIST_CONTENT_STYLE = { padding: 16, paddingBottom: 120 };

function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.round(trimmed.length / 4));
}

// --- Components ---

// Static message bubble - only re-renders when content changes
type StaticBubbleProps = {
  role: ChatMessage["role"];
  content: string;
};

const StaticMessageBubble = React.memo(function StaticMessageBubble({
  role,
  content,
}: StaticBubbleProps) {
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
        <Text style={styles.bubbleText}>{content}</Text>
      </View>
    </View>
  );
});

const GeneratingDots = React.memo(function GeneratingDots() {
  const dot1 = useSharedValue(0.35);
  const dot2 = useSharedValue(0.35);
  const dot3 = useSharedValue(0.35);

  useEffect(() => {
    const pulse = () =>
      withRepeat(
        withSequence(
          withTiming(1, {
            duration: 420,
            easing: Easing.inOut(Easing.ease),
          }),
          withTiming(0.35, {
            duration: 420,
            easing: Easing.inOut(Easing.ease),
          }),
        ),
        -1,
        false,
      );

    dot1.value = pulse();
    dot2.value = withDelay(140, pulse());
    dot3.value = withDelay(280, pulse());
  }, [dot1, dot2, dot3]);

  const dot1Style = useAnimatedStyle(() => ({
    opacity: dot1.value,
    transform: [{ scale: 0.8 + dot1.value * 0.3 }],
  }));

  const dot2Style = useAnimatedStyle(() => ({
    opacity: dot2.value,
    transform: [{ scale: 0.8 + dot2.value * 0.3 }],
  }));

  const dot3Style = useAnimatedStyle(() => ({
    opacity: dot3.value,
    transform: [{ scale: 0.8 + dot3.value * 0.3 }],
  }));

  return (
    <View style={styles.generatingDots}>
      <Animated.View style={[styles.generatingDot, dot1Style]} />
      <Animated.View style={[styles.generatingDot, dot2Style]} />
      <Animated.View style={[styles.generatingDot, dot3Style]} />
    </View>
  );
});

// List Footer for streaming content
const ChatListFooter = React.memo(function ChatListFooter({
  showSkeleton,
  isStreaming,
  agentMode,
  selectedModel,
  fallbackUsed,
  streamingHandle,
}: {
  showSkeleton: boolean;
  isStreaming: boolean;
  agentMode: boolean;
  selectedModel: string | null;
  fallbackUsed: boolean;
  streamingHandle: ReturnType<typeof useStreamingText>;
}) {
  const [streamingText, setStreamingText] = useState("");

  useEffect(() => {
    if (!isStreaming) {
      setStreamingText("");
      return;
    }
    const unsubscribe = streamingHandle.subscribe((text) => {
      setStreamingText(text);
    });
    return unsubscribe;
  }, [isStreaming, streamingHandle]);

  const tokenCount = estimateTokenCount(streamingText);
  const activeToolName: string | null = (() => {
    if (!agentMode || !isStreaming) return null;
    if (/fetch_page\s*\(|"fetch_page"|fetch_page/i.test(streamingText)) return "fetch_page";
    if (/<tool_call>|web_search\s*\(|web_search/i.test(streamingText)) return "web_search";
    return null;
  })();
  const isToolCallActive = activeToolName !== null;

  const statusBadge = isStreaming ? (
    <View style={styles.streamingStatusWrap}>
      <View style={styles.streamingStatusBadge}>
        <GeneratingDots />
        <Text style={styles.streamingStatusText}>
          Generating • ~{tokenCount} tokens
        </Text>
      </View>
    </View>
  ) : null;

  const toolBadge =
    agentMode && isStreaming ? (
      <View style={styles.streamingStatusWrap}>
        <View style={styles.toolStatusBadge}>
          <Text style={styles.toolStatusText}>
            {isToolCallActive
              ? `Tool Call • ${activeToolName}`
              : "Tool Call • waiting"}
          </Text>
        </View>
      </View>
    ) : null;

  const modelBadge =
    isStreaming && selectedModel ? (
      <View style={styles.streamingStatusWrap}>
        <View style={styles.modelStatusBadge}>
          <Text style={styles.modelStatusText} numberOfLines={1}>
            Model • {selectedModel}
            {fallbackUsed ? " (fallback)" : ""}
          </Text>
        </View>
      </View>
    ) : null;

  if (showSkeleton) {
    return (
      <View style={{ paddingBottom: 16 }}>
        {statusBadge}
        {toolBadge}
        {modelBadge}
        <SkeletonBubble lines={2} />
      </View>
    );
  }

  if (isStreaming) {
    return (
      <View style={{ paddingBottom: 16 }}>
        {statusBadge}
        {toolBadge}
        {modelBadge}
        <StreamingBubble
          streamingHandle={streamingHandle}
          isStreaming={isStreaming}
        />
      </View>
    );
  }

  return null;
});

// Prewarm status type
type PrewarmStatus = "idle" | "warming" | "ready" | "error";

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
  const [prewarmStatus, setPrewarmStatus] = useState<PrewarmStatus>("idle");
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [fallbackUsed, setFallbackUsed] = useState(false);

  const listRef = useRef<FlashListRef<UIMessage>>(null);
  const streamRef = useRef<{ cancel: () => void } | null>(null);
  const nearBottomRef = useRef<boolean>(true);
  const nextIdRef = useRef<number>(1);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundTimeRef = useRef<number | null>(null);

  // Streaming text handle for optimized token rendering
  const streamingHandle = useStreamingText();

  // Input debouncing refs
  const inputRef = useRef("");
  const inputDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced input handler
  const handleInputChange = useCallback((text: string) => {
    inputRef.current = text;

    // Immediate visual update for responsiveness
    if (inputDebounceRef.current) {
      clearTimeout(inputDebounceRef.current);
    }

    // Debounce state update to reduce re-renders
    inputDebounceRef.current = setTimeout(() => {
      setInput(text);
    }, 50); // Short debounce for typing feel
  }, []);

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

  const truncateHistory = useCallback((history: ChatMessage[]) => {
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
  }, []);

  useEffect(() => {
    // Warm native context early to reduce TTFT when user enters chat directly.
    if (settings.mode !== "native") {
      setPrewarmStatus("ready");
      return;
    }
    if (!settings.model?.startsWith("file://")) {
      setPrewarmStatus("ready");
      return;
    }

    setPrewarmStatus("warming");
    prewarmProvider({ mode: settings.mode, model: settings.model })
      .then(() => setPrewarmStatus("ready"))
      .catch(() => setPrewarmStatus("error"));
  }, [settings.mode, settings.model]);

  // AppState listener for background context management
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;

      if (prevState === "active" && nextState.match(/inactive|background/)) {
        // App going to background - record time
        backgroundTimeRef.current = Date.now();
      } else if (
        prevState.match(/inactive|background/) &&
        nextState === "active"
      ) {
        // App coming to foreground
        const backgroundTime = backgroundTimeRef.current;
        backgroundTimeRef.current = null;

        // If backgrounded for more than 5 minutes, context may be stale
        const FIVE_MINUTES = 5 * 60 * 1000;
        if (backgroundTime && Date.now() - backgroundTime > FIVE_MINUTES) {
          // Dispose and rewarm context
          if (
            settings.mode === "native" &&
            settings.model?.startsWith("file://")
          ) {
            setPrewarmStatus("warming");
            disposeProvider({ mode: settings.mode })
              .then(() =>
                prewarmProvider({ mode: settings.mode, model: settings.model }),
              )
              .then(() => setPrewarmStatus("ready"))
              .catch(() => setPrewarmStatus("error"));
          }
        } else if (
          settings.mode === "native" &&
          settings.model?.startsWith("file://")
        ) {
          // Quick prewarm on return from short background
          prewarmProvider({ mode: settings.mode, model: settings.model }).catch(
            () => {},
          );
        }
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );
    return () => subscription?.remove();
  }, [settings.mode, settings.model]);

  // --- Scroll Logic (throttled) ---
  const handleScrollRaw = useCallback((e: any) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const paddingToBottom = 100;
    nearBottomRef.current =
      layoutMeasurement.height + contentOffset.y >=
      contentSize.height - paddingToBottom;
  }, []);

  const handleScroll = useThrottledCallback(handleScrollRaw, 100);

  // Auto-scroll during streaming
  const scrollToEnd = useCallback(() => {
    if (nearBottomRef.current) {
      listRef.current?.scrollToEnd({ animated: false });
    }
  }, []);

  // Subscribe to streaming text for auto-scroll
  useEffect(() => {
    if (!isStreaming) return;

    const unsubscribe = streamingHandle.subscribe(() => {
      scrollToEnd();
    });

    return unsubscribe;
  }, [isStreaming, streamingHandle, scrollToEnd]);

  // --- Send / Stop ---
  const send = useCallback(async () => {
    const currentInput = inputRef.current.trim() || input.trim();
    if (!currentInput || isStreaming) return;

    // Block if prewarm not ready in native mode
    if (settings.mode === "native" && prewarmStatus === "warming") {
      setError("Model is still loading. Please wait...");
      return;
    }

    setError(null);
    Keyboard.dismiss();

    const userMsg = makeMessage("user", currentInput);
    const historyUI = messages.concat(userMsg);
    const history = truncateHistory(historyUI.map(toChatMessage));

    setMessages(historyUI);
    setInput("");
    inputRef.current = "";

    // Show skeleton while waiting for first token
    setShowSkeleton(true);

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
            : "Cannot reach NVIDIA proxy",
        );
      }
    } catch (e: any) {
      setError(e.message);
      setShowSkeleton(false);
      return;
    }

    setIsStreaming(true);
    setSelectedModel(null);
    setFallbackUsed(false);
    streamingHandle.clear();
    let firstTokenReceived = false;

    const handle = streamProvider({
      mode: settings.mode,
      baseUrl,
      model: settings.model,
      messages: history,
      agentMode: settings.agentMode,
      turboMode: settings.turboMode,
      draftModel: settings.draftModel,
      onToken: (t) => {
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          setShowSkeleton(false);
        }
        streamingHandle.append(t);
      },
      onMeta: (meta) => {
        if (meta?.selectedModel) {
          setSelectedModel(meta.selectedModel);
        }
        if (typeof meta?.fallbackUsed === "boolean") {
          setFallbackUsed(meta.fallbackUsed);
        }
      },
      onError: (e) => {
        setError(String(e?.message || e));
        setIsStreaming(false);
        setShowSkeleton(false);
        setSelectedModel(null);
        setFallbackUsed(false);
        // Commit any partial content to messages
        const partialContent = streamingHandle.getText();
        if (partialContent) {
          const assistantMsg = makeMessage("assistant", partialContent);
          setMessages((prev) => [...prev, assistantMsg]);
        }
        streamingHandle.clear();
      },
      onDone: () => {
        // Commit final content to messages
        const finalContent = streamingHandle.getText();
        if (finalContent) {
          const assistantMsg = makeMessage("assistant", finalContent);
          setMessages((prev) => [...prev, assistantMsg]);
        }
        setIsStreaming(false);
        setShowSkeleton(false);
        setSelectedModel(null);
        setFallbackUsed(false);
        streamingHandle.clear();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      },
    });
    streamRef.current = handle;
  }, [
    input,
    isStreaming,
    settings.mode,
    settings.agentMode,
    settings.turboMode,
    settings.draftModel,
    baseUrl,
    settings.model,
    messages,
    prewarmStatus,
    streamingHandle,
    makeMessage,
    truncateHistory,
    toChatMessage,
  ]);

  const stop = useCallback(() => {
    streamRef.current?.cancel();
    // Commit any partial content
    const partialContent = streamingHandle.getText();
    if (partialContent) {
      const assistantMsg = makeMessage("assistant", partialContent);
      setMessages((prev) => [...prev, assistantMsg]);
    }
    setIsStreaming(false);
    setShowSkeleton(false);
    streamingHandle.clear();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [streamingHandle, makeMessage]);

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
            onPress={() => saveSettings({ mode: "nvidia-proxy" })}
            style={[
              styles.modeOption,
              settings.mode === "nvidia-proxy" && styles.modeActive,
            ]}
          >
            <Text
              style={[
                styles.modeText,
                settings.mode === "nvidia-proxy" && styles.modeTextActive,
              ]}
            >
              Proxy
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
            <FlashList
              data={models}
              renderItem={({ item: m }) => (
                <TouchableOpacity
                  onPress={() => chooseModel(m)}
                  style={styles.modelOption}
                >
                  <Text style={{ color: COLORS.textPrimary }}>{m}</Text>
                  {m === settings.model && (
                    <Ionicons
                      name="checkmark"
                      size={16}
                      color={COLORS.accent}
                    />
                  )}
                </TouchableOpacity>
              )}
              keyExtractor={(item) => item}
              contentContainerStyle={{ paddingVertical: 4 }}
            />
          )}
        </View>
      )}

      {/* Chat List */}
      <FlashList
        ref={listRef}
        data={messages}
        renderItem={({ item }) => (
          <StaticMessageBubble role={item.role} content={item.content} />
        )}
        keyExtractor={(item) => item.id}
        getItemType={(item) => item.role}
        contentContainerStyle={FLASH_LIST_CONTENT_STYLE}
        keyboardDismissMode="on-drag"
        onScroll={handleScroll}
        scrollEventThrottle={100}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={
          <ChatListFooter
            showSkeleton={showSkeleton}
            isStreaming={isStreaming}
            agentMode={settings.agentMode}
            selectedModel={selectedModel}
            fallbackUsed={fallbackUsed}
            streamingHandle={streamingHandle}
          />
        }
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
            onChangeText={handleInputChange}
            placeholder={
              prewarmStatus === "warming"
                ? "Loading model..."
                : "Ask anything..."
            }
            placeholderTextColor={COLORS.textSecondary}
            multiline
            cursorColor={COLORS.accent}
            editable={prewarmStatus !== "warming"}
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
    backgroundColor: "#2D2E30", // Match user bubble for now, robust design
    borderBottomLeftRadius: 4,
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
  streamingContainer: {
    // Removed absolute positioning as it's now in FlaskList Footer
  },
  streamingStatusWrap: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "flex-start",
    marginBottom: 8,
  },
  streamingStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.surfaceFiltered,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  streamingStatusText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  toolStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.surfaceAssistant,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  toolStatusText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
  modelStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surfaceFiltered,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: "100%",
  },
  modelStatusText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  generatingDots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  generatingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.accent,
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
