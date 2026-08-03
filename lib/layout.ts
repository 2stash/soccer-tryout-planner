import { Platform, useWindowDimensions } from 'react-native';

export const BREAKPOINTS = {
  phone: 768,
  tablet: 1024,
} as const;

export type LayoutMode = 'phone' | 'tablet' | 'desktop';

function isIPad() {
  return (
    Platform.OS === 'ios' &&
    // Platform.isPad exists on iOS only; cast for cross-platform TS.
    Boolean((Platform as { isPad?: boolean }).isPad)
  );
}

/**
 * Desktop table UI is for wide web only.
 * Native phones/tablets stay on card UIs in any orientation.
 * iPad is always tablet mode (including narrow portrait / mini).
 */
export function layoutModeForWidth(
  width: number,
  platform: typeof Platform.OS = Platform.OS
): LayoutMode {
  if (platform === 'ios' && isIPad()) return 'tablet';

  if (width < BREAKPOINTS.phone) return 'phone';

  const isNative = platform === 'ios' || platform === 'android';
  if (isNative) return 'tablet';

  if (width < BREAKPOINTS.tablet) return 'tablet';
  return 'desktop';
}

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const mode = layoutModeForWidth(width);
  const isLandscape = width > height;
  return {
    width,
    height,
    mode,
    isLandscape,
    isPhone: mode === 'phone',
    isTablet: mode === 'tablet',
    isDesktop: mode === 'desktop',
    /** Compact device UI: phone + tablet (cards / stacked layouts). */
    isCompact: mode !== 'desktop',
  };
}
