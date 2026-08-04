import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router, Stack, useFocusEffect } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { confirmAction } from '@/lib/confirm';
import {
  copyRosterFromServer,
  defaultCopyName,
} from '@/lib/copyRoster';
import { useLayout } from '@/lib/layout';
import { clearOfflineCacheForRoster } from '@/lib/offline/clearRosterCache';
import { alertRequiresOnline } from '@/lib/offline/gate';
import { useIsOnline } from '@/lib/offline/connectivity';
import { createRoster, deleteRoster } from '@/lib/rosters';
import { listMyMemberships, roleLabel } from '@/lib/rosterMembers';
import {
  acceptRosterInvite,
  listPendingInvitesForEmail,
  type PendingInviteWithRoster,
} from '@/lib/rosterInvites';
import type { RosterMembership } from '@/lib/types';
import { colors, layout } from '@/constants/theme';

function canManageTeam(m: RosterMembership): boolean {
  return m.isOwner || m.roles.includes('admin');
}

function promptTeamName(defaultName: string): Promise<string | null> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const next = window.prompt('Name for the copied team', defaultName);
    if (next == null) return Promise.resolve(null);
    const trimmed = next.trim();
    return Promise.resolve(trimmed.length > 0 ? trimmed : null);
  }
  // iOS supports Alert.prompt; Android falls back to confirming the default name.
  const promptFn = (
    Alert as typeof Alert & {
      prompt?: (
        title: string,
        message?: string,
        callbackOrButtons?: unknown,
        type?: string,
        defaultValue?: string
      ) => void;
    }
  ).prompt;
  if (typeof promptFn === 'function') {
    return new Promise((resolve) => {
      promptFn(
        'Copy team',
        'Name for the copied team',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
          {
            text: 'Copy',
            onPress: (value?: string) => {
              const trimmed = (value ?? '').trim();
              resolve(trimmed.length > 0 ? trimmed : null);
            },
          },
        ],
        'plain-text',
        defaultName
      );
    });
  }
  return new Promise((resolve) => {
    Alert.alert('Copy team', `Create “${defaultName}”?`, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      { text: 'Copy', onPress: () => resolve(defaultName) },
    ]);
  });
}

type ListItem =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'row'; key: string; membership: RosterMembership }
  | { kind: 'pending'; key: string; invite: PendingInviteWithRoster };

export default function DashboardScreen() {
  const { user, session, loading, signOut, configured } = useAuth();
  const { isPhone, isCompact } = useLayout();
  const isOnline = useIsOnline();
  const [memberships, setMemberships] = useState<RosterMembership[]>([]);
  const [pendingInvites, setPendingInvites] = useState<
    PendingInviteWithRoster[]
  >([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [acceptBusyId, setAcceptBusyId] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoadingList(true);
    setError(null);
    try {
      const [data, invites] = await Promise.all([
        listMyMemberships(user.id),
        listPendingInvitesForEmail(),
      ]);
      setMemberships(data);
      setPendingInvites(invites);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load teams');
    } finally {
      setLoadingList(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (session && user) {
        void refresh();
      }
    }, [session, user, refresh])
  );

  const created = useMemo(
    () => memberships.filter((m) => m.isOwner),
    [memberships]
  );
  const invited = useMemo(
    () => memberships.filter((m) => !m.isOwner),
    [memberships]
  );

  const listData = useMemo((): ListItem[] => {
    const items: ListItem[] = [];
    if (pendingInvites.length > 0) {
      items.push({
        kind: 'header',
        key: 'h-pending',
        title: 'Pending invites',
      });
      for (const invite of pendingInvites) {
        items.push({
          kind: 'pending',
          key: `pending-${invite.id}`,
          invite,
        });
      }
    }
    if (created.length > 0) {
      items.push({ kind: 'header', key: 'h-created', title: 'Created' });
      for (const m of created) {
        items.push({ kind: 'row', key: m.roster.id, membership: m });
      }
    }
    if (invited.length > 0) {
      items.push({ kind: 'header', key: 'h-invited', title: 'Invited' });
      for (const m of invited) {
        items.push({
          kind: 'row',
          key: `invited-${m.roster.id}`,
          membership: m,
        });
      }
    }
    return items;
  }, [pendingInvites, created, invited]);

  if (!loading && (!configured || !session)) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  async function handleCreate() {
    if (!user || !name.trim()) {
      setError('Enter a team / tryout name.');
      return;
    }
    if (!isOnline) {
      alertRequiresOnline('Creating a team');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const roster = await createRoster(name, user.id);
      setName('');
      router.push(`/roster/${roster.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create team');
    } finally {
      setBusy(false);
    }
  }

  async function handleAccept(inviteId: string) {
    if (!isOnline) {
      alertRequiresOnline('Accepting invites');
      return;
    }
    setAcceptBusyId(inviteId);
    setError(null);
    try {
      const accepted = await acceptRosterInvite(inviteId);
      await refresh();
      router.push(`/roster/${accepted.roster_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to accept invite');
    } finally {
      setAcceptBusyId(null);
    }
  }

  async function handleCopy(item: RosterMembership) {
    if (!user) return;
    if (!isOnline) {
      alertRequiresOnline('Copying a team');
      return;
    }
    const name = await promptTeamName(defaultCopyName(item.roster.name));
    if (!name) return;
    confirmAction({
      title: 'Copy team?',
      message: `Create “${name}” as a full copy? You will be Admin of the new team.`,
      confirmLabel: 'Copy',
      onConfirm: () => {
        void (async () => {
          setActionBusyId(item.roster.id);
          setError(null);
          try {
            const created = await copyRosterFromServer({
              sourceRosterId: item.roster.id,
              newName: name,
              ownerUserId: user.id,
            });
            await refresh();
            router.push(`/roster/${created.id}`);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to copy team');
          } finally {
            setActionBusyId(null);
          }
        })();
      },
    });
  }

  function handleDelete(item: RosterMembership) {
    if (!isOnline) {
      alertRequiresOnline('Deleting a team');
      return;
    }
    confirmAction({
      title: 'Delete team?',
      message: `Delete “${item.roster.name}”? This cannot be undone.`,
      confirmLabel: 'Continue',
      onConfirm: () => {
        confirmAction({
          title: 'Really delete?',
          message: `Permanently delete “${item.roster.name}” and all players, depth, and assignments?`,
          confirmLabel: 'Delete',
          onConfirm: () => {
            void (async () => {
              setActionBusyId(item.roster.id);
              setError(null);
              try {
                await deleteRoster(item.roster.id);
                await clearOfflineCacheForRoster(item.roster.id);
                await refresh();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : 'Failed to delete team'
                );
              } finally {
                setActionBusyId(null);
              }
            })();
          },
        });
      },
    });
  }

  function renderMembership({ item }: { item: RosterMembership }) {
    const rolesText = item.roles.map(roleLabel).join(', ');
    const manage = canManageTeam(item);
    const busy = actionBusyId === item.roster.id;
    return (
      <View style={[styles.card, isPhone && styles.cardPhone]}>
        <Pressable
          onPress={() => router.push(`/roster/${item.roster.id}`)}
          disabled={busy}
        >
          <Text style={styles.cardTitle}>{item.roster.name}</Text>
          <Text style={styles.cardMeta}>
            {rolesText}
            {' · '}
            Created {new Date(item.roster.created_at).toLocaleDateString()}
            {' · Open'}
          </Text>
        </Pressable>
        {manage ? (
          <View style={styles.cardActions}>
            <Pressable
              style={[styles.secondaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void handleCopy(item)}
            >
              <Text style={styles.secondaryBtnText}>
                {busy ? '…' : 'Copy'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.deleteBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => handleDelete(item)}
            >
              <Text style={styles.deleteBtnText}>Delete</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  function renderPending({ item }: { item: PendingInviteWithRoster }) {
    const busyAccept = acceptBusyId === item.id;
    return (
      <View style={[styles.card, isPhone && styles.cardPhone]}>
        <Text style={styles.cardTitle}>{item.roster.name}</Text>
        <Text style={styles.cardMeta}>
          {roleLabel(item.role)} · invited {item.email}
        </Text>
        <Pressable
          style={[styles.acceptBtn, busyAccept && styles.disabled]}
          disabled={busyAccept}
          onPress={() => void handleAccept(item.id)}
        >
          <Text style={styles.acceptBtnText}>
            {busyAccept ? 'Accepting…' : 'Accept'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.screen, isCompact && styles.screenCompact]}>
      <Stack.Screen
        options={{
          title: 'Dashboard',
          headerBackVisible: false,
          headerRight: () => (
            <View style={styles.headerUser}>
              {user?.email && !isPhone ? (
                <Text style={styles.headerEmail} numberOfLines={1}>
                  {user.email}
                </Text>
              ) : null}
              <Pressable
                onPress={async () => {
                  await signOut();
                  router.replace('/(auth)/sign-in');
                }}
              >
                <Text style={styles.headerLink}>Sign out</Text>
              </Pressable>
            </View>
          ),
        }}
      />

      <Text style={styles.heading}>Dashboard</Text>
      <Text style={styles.sub}>
        Create a team / tryout, then manage players, depth, and squads.
        Accept coach invites below when someone adds your email on Team.
      </Text>

      <View style={[styles.createRow, isPhone && styles.createRowStack]}>
        <TextInput
          style={[styles.input, isPhone && styles.inputFull]}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Boys Soccer Tryouts 2026"
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          onSubmitEditing={() => void handleCreate()}
        />
        <Pressable
          style={[
            styles.primaryBtn,
            isPhone && styles.primaryBtnFull,
            busy && styles.disabled,
          ]}
          onPress={() => void handleCreate()}
          disabled={busy}
        >
          <Text style={styles.primaryText}>
            {busy ? 'Creating…' : 'Create team'}
          </Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loadingList ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No teams yet. Create one to get started.
            </Text>
          }
          renderItem={({ item }) => {
            if (item.kind === 'header') {
              return <Text style={styles.sectionTitle}>{item.title}</Text>;
            }
            if (item.kind === 'pending') {
              return renderPending({ item: item.invite });
            }
            return renderMembership({ item: item.membership });
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: layout.pagePadding,
  },
  screenCompact: {
    paddingHorizontal: layout.pagePaddingCompact,
  },
  heading: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
  },
  sub: {
    color: colors.muted,
    marginTop: 4,
    marginBottom: 16,
  },
  createRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
    alignItems: 'stretch',
  },
  createRowStack: {
    flexDirection: 'column',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    minHeight: 44,
  },
  inputFull: {
    width: '100%',
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    minHeight: 44,
  },
  primaryBtnFull: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 12,
  },
  primaryText: {
    color: colors.primaryText,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.6,
  },
  error: {
    color: colors.danger,
    marginBottom: 8,
  },
  list: {
    gap: 10,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 8,
    marginBottom: 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 16,
  },
  cardPhone: {
    minHeight: 64,
    paddingVertical: 18,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  cardMeta: {
    marginTop: 4,
    color: colors.muted,
    fontSize: 13,
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  secondaryBtnText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  deleteBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  deleteBtnText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 14,
  },
  acceptBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  acceptBtnText: {
    color: colors.primaryText,
    fontWeight: '700',
    fontSize: 14,
  },
  empty: {
    color: colors.muted,
    textAlign: 'center',
    marginTop: 32,
  },
  headerUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginRight: 8,
    maxWidth: 280,
  },
  headerEmail: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  headerLink: {
    color: colors.primary,
    fontWeight: '600',
  },
});
