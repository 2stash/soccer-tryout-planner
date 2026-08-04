import { clearOutbox } from '@/lib/offline/outbox';
import { clearRosterSnapshot } from '@/lib/offline/snapshot';
import type { OfflineScope } from '@/lib/offline/types';

/** Clear outbox + snapshot for a roster (storage key is rosterId-only). */
export async function clearOfflineCacheForRoster(
  rosterId: string
): Promise<void> {
  const scope: OfflineScope = { rosterId, workspaceId: '' };
  await Promise.all([clearOutbox(scope), clearRosterSnapshot(scope)]);
}
