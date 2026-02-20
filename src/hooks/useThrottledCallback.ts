import { useCallback, useRef } from "react";

/**
 * Returns a throttled version of the callback that fires at most once per `delay` ms.
 * Useful for scroll handlers and other high-frequency events.
 */
export function useThrottledCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay: number,
): T {
  const lastCall = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastArgsRef = useRef<Parameters<T> | null>(null);

  return useCallback(
    ((...args: Parameters<T>) => {
      const now = Date.now();
      lastArgsRef.current = args;

      if (now - lastCall.current >= delay) {
        lastCall.current = now;
        callback(...args);
      } else if (!timeoutRef.current) {
        // Schedule trailing call
        const remaining = delay - (now - lastCall.current);
        timeoutRef.current = setTimeout(() => {
          lastCall.current = Date.now();
          timeoutRef.current = null;
          if (lastArgsRef.current) {
            callback(...lastArgsRef.current);
          }
        }, remaining);
      }
    }) as T,
    [callback, delay],
  );
}

export default useThrottledCallback;
