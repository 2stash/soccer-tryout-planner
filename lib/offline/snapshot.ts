import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  scopeKey,
  type OfflineScope,
  type RosterSnapshot,
} from '@/lib/offline/types';

function storageKey(scope: OfflineScope): string {
  return `offlineSnapshot:v1:${scopeKey(scope)}`;
}

export async function saveRosterSnapshot(
  snapshot: RosterSnapshot
): Promise<void> {
  await AsyncStorage.setItem(storageKey(snapshot.scope), JSON.stringify(snapshot));
}

export async function loadRosterSnapshot(
  scope: OfflineScope
): Promise<RosterSnapshot | null> {
  const raw = await AsyncStorage.getItem(storageKey(scope));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RosterSnapshot;
    if (parsed.version !== 1) return null;
    if (scopeKey(parsed.scope) !== scopeKey(scope)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearRosterSnapshot(scope: OfflineScope): Promise<void> {
  await AsyncStorage.removeItem(storageKey(scope));
}
