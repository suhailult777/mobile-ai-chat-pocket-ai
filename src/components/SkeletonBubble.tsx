import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
  FadeIn,
} from "react-native-reanimated";

const COLORS = {
  background: "#131314",
  shimmerBase: "#1E1F20",
  shimmerHighlight: "#2D2E30",
};

type SkeletonBubbleProps = {
  /** Number of skeleton lines to show (1-3) */
  lines?: number;
  /** Whether to show the skeleton (controls mount/unmount animation) */
  visible?: boolean;
};

/**
 * Skeleton loading placeholder for chat bubbles.
 * Shows a shimmer animation while waiting for first token.
 * Uses Reanimated for smooth 60fps animations on UI thread.
 */
export const SkeletonBubble = React.memo(function SkeletonBubble({
  lines = 2,
  visible = true,
}: SkeletonBubbleProps) {
  const shimmerProgress = useSharedValue(0);

  useEffect(() => {
    shimmerProgress.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.linear }),
      -1,
      false,
    );
  }, [shimmerProgress]);

  const shimmerStyle = useAnimatedStyle(() => {
    const translateX = interpolate(shimmerProgress.value, [0, 1], [-200, 200]);
    return {
      transform: [{ translateX }],
    };
  });

  if (!visible) return null;

  const lineWidths = [0.9, 0.7, 0.5]; // Varying widths for natural look

  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.container}>
      <View style={styles.bubble}>
        {Array.from({ length: Math.min(lines, 3) }).map((_, idx) => (
          <View
            key={idx}
            style={[
              styles.skeletonLine,
              {
                width: `${lineWidths[idx] * 100}%`,
                marginTop: idx > 0 ? 8 : 0,
              },
            ]}
          >
            {/* Shimmer overlay */}
            <Animated.View style={[styles.shimmer, shimmerStyle]}>
              <View style={styles.shimmerGradient} />
            </Animated.View>
          </View>
        ))}
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "flex-start",
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  bubble: {
    maxWidth: "85%",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "transparent",
    marginLeft: -10,
  },
  skeletonLine: {
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.shimmerBase,
    overflow: "hidden",
  },
  shimmer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  shimmerGradient: {
    width: 100,
    height: "100%",
    backgroundColor: COLORS.shimmerHighlight,
    opacity: 0.5,
    borderRadius: 8,
  },
});

export default SkeletonBubble;
