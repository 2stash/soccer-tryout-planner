import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router, Stack, useFocusEffect } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { useLayout } from '@/lib/layout';
import { alertRequiresOnline } from '@/lib/offline/gate';
import { useIsOnline } from '@/lib/offline/connectivity';
import { createRoster } from '@/lib/rosters';
import { listMyMemberships, roleLabel } from '@/lib/rosterMembers';
import type { RosterMembership } from '@/lib/types';
import { colors, layout } from '@/constants/theme';

export default function DashboardScreen() {
  const { user, session, loading, signOut, configured } = useAuth();
  const { isPhone, isCompact } = useLayout();
  const isOnline = useIsOnline();
  const [memberships, setMemberships] = useState<RosterMembership[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoadingList(true);
    setError(null);
    try {
      const data = await listMyMemberships(user.id);
      setMemberships(data);
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

  function renderMembership({ item }: { item: RosterMembership }) {
    const rolesText = item.roles.map(roleLabel).join(', ');
    return (
      <Pressable
        style={[styles.card, isPhone && styles.cardPhone]}
        onPress={() => router.push(`/roster/${item.roster.id}`)}
      >
        <Text style={styles.cardTitle}>{item.roster.name}</Text>
        <Text style={styles.cardMeta}>
          {rolesText}
          {' · '}
          Created {new Date(item.roster.created_at).toLocaleDateString()}
          {' · Open'}
        </Text>
      </Pressable>
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
          data={[
            ...(created.length > 0
              ? [{ kind: 'header' as const, key: 'h-created', title: 'Created' }]
              : []),
            ...created.map((m) => ({
              kind: 'row' as const,
              key: m.roster.id,
              membership: m,
            })),
            ...(invited.length > 0
              ? [{ kind: 'header' as const, key: 'h-invited', title: 'Invited' }]
              : []),
            ...invited.map((m) => ({
              kind: 'row' as const,
              key: m.roster.id,
              membership: m,
            })),
          ]}
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
