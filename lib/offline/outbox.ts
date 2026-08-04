import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  scopeKey,
  type OfflineOp,
  type OfflineScope,
} from '@/lib/offline/types';

function storageKey(scope: OfflineScope): string {
  // v2: roster-only scope (invalidates personal/live/master outboxes).
  return `offlineOutbox:v2:${scopeKey(scope)}`;
}

export async function loadOutbox(scope: OfflineScope): Promise<OfflineOp[]> {
  const raw = await AsyncStorage.getItem(storageKey(scope));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as OfflineOp[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveOutbox(
  scope: OfflineScope,
  ops: OfflineOp[]
): Promise<void> {
  await AsyncStorage.setItem(storageKey(scope), JSON.stringify(ops));
}

export async function enqueueOutboxOp(
  scope: OfflineScope,
  op: OfflineOp
): Promise<OfflineOp[]> {
  const ops = await loadOutbox(scope);
  const next = [...ops, op];
  await saveOutbox(scope, next);
  return next;
}

/** Remove the head op after a successful replay. */
export async function shiftOutbox(
  scope: OfflineScope
): Promise<OfflineOp[]> {
  const ops = await loadOutbox(scope);
  if (ops.length === 0) return [];
  const next = ops.slice(1);
  await saveOutbox(scope, next);
  return next;
}

export async function clearOutbox(scope: OfflineScope): Promise<void> {
  await AsyncStorage.removeItem(storageKey(scope));
}
