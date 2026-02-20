import { useCallback, useRef } from "react";
import { useSharedValue, runOnJS } from "react-native-reanimated";

export type StreamingTextHandle = {
  /** Append text to the streaming buffer (call from token callback) */
  append: (text: string) => void;
  /** Clear the buffer and reset state */
  clear: () => void;
  /** Get current accumulated text */
  getText: () => string;
  /** Shared value for Reanimated (read-only) */
  textValue: { value: string };
  /** Subscribe to text changes (for non-Reanimated consumers) */
  subscribe: (listener: (text: string) => void) => () => void;
};

/**
 * High-performance streaming text hook using Reanimated shared values.
 * Bypasses React reconciliation for token updates during streaming.
 *
 * Usage:
 * - Call `append(token)` in your streaming callback
 * - Read `textValue` in StreamingBubble with useAnimatedProps
 * - Call `clear()` when starting a new message
 */
export function useStreamingText(): StreamingTextHandle {
  // Reanimated shared value for UI thread access
  const textValue = useSharedValue("");

  // Keep a JS-thread copy for synchronous reads
  const textRef = useRef("");

  // Listeners for React components that need updates
  const listenersRef = useRef<Set<(text: string) => void>>(new Set());

  // Batch pending appends for efficiency
  const pendingRef = useRef("");
  const flushScheduledRef = useRef(false);

  const notifyListeners = useCallback((text: string) => {
    listenersRef.current.forEach((listener) => listener(text));
  }, []);

  const flush = useCallback(() => {
    if (!pendingRef.current) {
      flushScheduledRef.current = false;
      return;
    }

    textRef.current += pendingRef.current;
    const newText = textRef.current;
    pendingRef.current = "";
    flushScheduledRef.current = false;

    // Update shared value (triggers Reanimated consumers)
    textValue.value = newText;

    // Notify JS listeners
    runOnJS(notifyListeners)(newText);
  }, [textValue, notifyListeners]);

  const append = useCallback(
    (text: string) => {
      if (!text) return;

      pendingRef.current += text;

      // Batch appends within the same frame
      if (!flushScheduledRef.current) {
        flushScheduledRef.current = true;
        // Use setImmediate for faster flushing than setTimeout
        setImmediate(flush);
      }
    },
    [flush],
  );

  const clear = useCallback(() => {
    textRef.current = "";
    pendingRef.current = "";
    flushScheduledRef.current = false;
    textValue.value = "";
    notifyListeners("");
  }, [textValue, notifyListeners]);

  const getText = useCallback(() => {
    return textRef.current + pendingRef.current;
  }, []);

  const subscribe = useCallback((listener: (text: string) => void) => {
    listenersRef.current.add(listener);
    // Immediately call with current value
    listener(textRef.current);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  return {
    append,
    clear,
    getText,
    textValue,
    subscribe,
  };
}

export default useStreamingText;
