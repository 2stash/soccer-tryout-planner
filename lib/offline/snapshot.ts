import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  scopeKey,
  type OfflineScope,
  type RosterSnapshot,
} from '@/lib/offline/types';

function storageKey(scope: OfflineScope): string {
  return `offlineSnapshot:v2:${scopeKey(scope)}`;
}

/** In-memory mirror so team switches can paint before AsyncStorage resolves. */
const memoryCache = new Map<string, RosterSnapshot>();

export function peekRosterSnapshot(
  scope: OfflineScope
): RosterSnapshot | null {
  return memoryCache.get(scopeKey(scope)) ?? null;
}

export async function saveRosterSnapshot(
  snapshot: RosterSnapshot
): Promise<void> {
  memoryCache.set(scopeKey(snapshot.scope), snapshot);
  await AsyncStorage.setItem(storageKey(snapshot.scope), JSON.stringify(snapshot));
}

export async function loadRosterSnapshot(
  scope: OfflineScope
): Promise<RosterSnapshot | null> {
  const cached = memoryCache.get(scopeKey(scope));
  if (cached) return cached;

  const raw = await AsyncStorage.getItem(storageKey(scope));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RosterSnapshot;
    if (parsed.version !== 2) return null;
    if (scopeKey(parsed.scope) !== scopeKey(scope)) return null;
    memoryCache.set(scopeKey(scope), parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function clearRosterSnapshot(scope: OfflineScope): Promise<void> {
  memoryCache.delete(scopeKey(scope));
  await AsyncStorage.removeItem(storageKey(scope));
}
