import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

/**
 * Refresh when the tab/app returns to the foreground, and on a poll while
 * visible. Covers missed Supabase realtime events (common on idle desktop tabs).
 */
export function useForegroundRefresh(
  enabled: boolean,
  onRefresh: () => void,
  intervalMs = 12_000
): void {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;

    const run = () => {
      onRefreshRef.current();
    };

    const interval = setInterval(() => {
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        if (document.visibilityState !== 'visible') return;
      }
      if (AppState.currentState !== 'active') return;
      run();
    }, intervalMs);

    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') run();
    });

    let removeWeb: (() => void) | undefined;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onVis = () => {
        if (document.visibilityState === 'visible') run();
      };
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('focus', run);
      removeWeb = () => {
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('focus', run);
      };
    }

    return () => {
      clearInterval(interval);
      appSub.remove();
      removeWeb?.();
    };
  }, [enabled, intervalMs]);
}
