import React, { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { StreamingTextHandle } from "../hooks/useStreamingText";

const COLORS = {
  textPrimary: "#E3E3E3",
  surfaceAssistant: "#2D2E30", // Dark grey bubble for assistant (same as user for now, or distinguish)
};

type StreamingBubbleProps = {
  /** Handle from useStreamingText hook */
  streamingHandle: StreamingTextHandle;
  /** Whether streaming is currently active */
  isStreaming: boolean;
};

/**
 * Optimized bubble component for streaming text.
 * Subscribes directly to streaming handle to bypass React reconciliation.
 * Only this bubble re-renders during streaming; other bubbles remain frozen.
 */
export const StreamingBubble = React.memo(function StreamingBubble({
  streamingHandle,
  isStreaming,
}: StreamingBubbleProps) {
  const [text, setText] = useState("");
  const mountedRef = useRef(true);

  // Subscribe to streaming updates
  useEffect(() => {
    mountedRef.current = true;
    setText(streamingHandle.getText()); // Initial set

    const unsubscribe = streamingHandle.subscribe((newText) => {
      if (mountedRef.current) {
        setText(newText);
      }
    });

    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [streamingHandle]);

  if (!isStreaming && !text) return null;

  return (
    <View style={styles.bubbleRow}>
      <View style={styles.bubble}>
        <Text style={styles.bubbleText}>{text}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  bubbleRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    width: "100%",
    marginBottom: 8,
  },
  bubble: {
    maxWidth: "85%",
    borderRadius: 20,
    borderBottomLeftRadius: 4, // Distinctive assistant shape
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.surfaceAssistant,
    minHeight: 40,
  },
  bubbleText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    lineHeight: 24,
  },
});

export default StreamingBubble;
