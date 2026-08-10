import { Platform } from 'react-native';

type OcrModule = {
  isSupported: boolean;
  extractTextFromImage: (uri: string) => Promise<string[]>;
};

let cached: OcrModule | null | undefined;

/**
 * Lazy-load expo-text-extractor so missing native binaries (old TestFlight /
 * Expo Go) do not crash the app at import time.
 */
function loadOcrModule(): OcrModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'ios') {
    cached = null;
    return cached;
  }
  try {
    // requireNativeModule throws if this binary was built without the package.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-text-extractor') as OcrModule;
    if (!mod?.extractTextFromImage || !mod.isSupported) {
      cached = null;
      return cached;
    }
    cached = mod;
    return cached;
  } catch {
    cached = null;
    return cached;
  }
}

/** True when the native OCR module is linked and reports support. */
export function isOcrAvailable(): boolean {
  const mod = loadOcrModule();
  return Boolean(mod?.isSupported);
}

export async function extractTextFromImage(uri: string): Promise<string[]> {
  const mod = loadOcrModule();
  if (!mod?.isSupported) {
    throw new Error(
      'Photo scan needs a newer iOS build that includes OCR. Spreadsheet import still works.'
    );
  }
  return mod.extractTextFromImage(uri);
}
