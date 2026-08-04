import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, Stack, useFocusEffect } from 'expo-router';
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { useAuth } from '@/lib/AuthContext';
import { useLayout } from '@/lib/layout';
import { alertRequiresOnline } from '@/lib/offline/gate';
import { useOffline } from '@/lib/offline/OfflineContext';
import {
  listRosterMembers,
  removeRosterRole,
  roleLabel,
} from '@/lib/rosterMembers';
import {
  createRosterInvite,
  listRosterInvites,
  revokeRosterInvite,
} from '@/lib/rosterInvites';
import type { RosterInvite, RosterMember, RosterRole } from '@/lib/types';
import { ROSTER_ROLES } from '@/lib/types';
import { colors, layout } from '@/constants/theme';

const INVITE_ROLES: RosterRole[] = [
  'varsity_coach',
  'jv_coach',
  'fr_soph_coach',
  'assistant',
];

export default function TeamSettingsScreen() {
  const { user } = useAuth();
  const { isPhone } = useLayout();
  const {
    rosterId,
    isAdmin,
    refreshRoles,
    loading: roleLoading,
  } = useActiveRole();
  const { isOnline } = useOffline();
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [invites, setInvites] = useState<RosterInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<RosterRole>('varsity_coach');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [revokeBusyId, setRevokeBusyId] = useState<string | null>(null);
  const [removeBusyId, setRemoveBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listRosterMembers(rosterId);
      setMembers(rows);
      try {
        setInvites(await listRosterInvites(rosterId));
      } catch {
        // Non-admins cannot list invites (RLS).
        setInvites([]);
      }
      await refreshRoles();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team');
    } finally {
      setLoading(false);
    }
  }, [rosterId, refreshRoles]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  // Prefer live membership rows — role context can lag briefly after load.
  const canManageTeam =
    isAdmin ||
    Boolean(
      user &&
        members.some((m) => m.user_id === user.id && m.role === 'admin')
    );

  const assistantCount = useMemo(
    () => members.filter((m) => m.role === 'assistant').length,
    [members]
  );
  const pendingAssistantCount = useMemo(
    () => invites.filter((i) => i.role === 'assistant').length,
    [invites]
  );

  const inviteRoleBlocked = useMemo(() => {
    if (inviteRole === 'assistant') {
      return assistantCount + pendingAssistantCount >= 3;
    }
    if (members.some((m) => m.role === inviteRole)) return true;
    return invites.some((i) => i.role === inviteRole);
  }, [inviteRole, assistantCount, pendingAssistantCount, members, invites]);

  async function handleRemoveMembership(member: RosterMember) {
    if (!canManageTeam || member.role === 'admin') return;
    if (!isOnline) {
      alertRequiresOnline('Removing team roles');
      return;
    }
    setRemoveBusyId(member.id);
    setError(null);
    try {
      await removeRosterRole({
        rosterId,
        userId: member.user_id,
        role: member.role,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove role');
    } finally {
      setRemoveBusyId(null);
    }
  }

  async function handleInvite() {
    if (!user || !canManageTeam) return;
    if (!isOnline) {
      alertRequiresOnline('Sending invites');
      return;
    }
    setInviteBusy(true);
    setError(null);
    try {
      await createRosterInvite({
        rosterId,
        email: inviteEmail,
        role: inviteRole,
        invitedBy: user.id,
      });
      setInviteEmail('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create invite');
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    if (!canManageTeam) return;
    if (!isOnline) {
      alertRequiresOnline('Revoking invites');
      return;
    }
    setRevokeBusyId(inviteId);
    setError(null);
    try {
      await revokeRosterInvite(inviteId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke invite');
    } finally {
      setRevokeBusyId(null);
    }
  }

  if (!roleLoading && !isAdmin) {
    return <Redirect href={`/roster/${rosterId}`} />;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        isPhone && styles.contentCompact,
      ]}
    >
      <Stack.Screen options={{ title: 'Team' }} />
      <Text style={styles.heading}>Team</Text>
      <Text style={styles.sub}>
        Invite coaches by email (they accept from the Dashboard after signing
        in with that email). Coaching titles are for display; everyone edits
        the same shared roster.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>Invite by email</Text>
      {!canManageTeam ? (
        <Text style={styles.notice}>
          Only the roster Admin can invite coaches.
        </Text>
      ) : (
        <>
          <Text style={styles.inviteHint}>
            No email is sent yet — tell them to sign up / sign in with this
            address, then Accept on their Dashboard.
          </Text>
          <TextInput
            style={styles.input}
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="coach@school.edu"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="done"
            onSubmitEditing={() => void handleInvite()}
          />
          <View style={styles.roleChipRow}>
            {INVITE_ROLES.map((role) => {
              const active = inviteRole === role;
              return (
                <Pressable
                  key={role}
                  style={[styles.roleChip, active && styles.roleChipActive]}
                  onPress={() => setInviteRole(role)}
                >
                  <Text
                    style={[
                      styles.roleChipText,
                      active && styles.roleChipTextActive,
                    ]}
                  >
                    {roleLabel(role)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            style={[
              styles.primaryBtn,
              (inviteBusy || inviteRoleBlocked || !inviteEmail.trim()) &&
                styles.disabled,
            ]}
            disabled={inviteBusy || inviteRoleBlocked || !inviteEmail.trim()}
            onPress={() => void handleInvite()}
          >
            <Text style={styles.primaryBtnText}>
              {inviteBusy
                ? 'Inviting…'
                : inviteRoleBlocked
                  ? 'Seat unavailable'
                  : 'Create invite'}
            </Text>
          </Pressable>

          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>
            Pending invites
          </Text>
          {loading ? (
            <ActivityIndicator
              color={colors.primary}
              style={{ marginVertical: 12 }}
            />
          ) : invites.length === 0 ? (
            <Text style={styles.emptyMeta}>No pending invites.</Text>
          ) : (
            invites.map((invite) => (
              <View key={invite.id} style={styles.inviteRow}>
                <View style={styles.roleInfo}>
                  <Text style={styles.roleName}>{invite.email}</Text>
                  <Text style={styles.roleMeta}>
                    {roleLabel(invite.role)} · pending
                  </Text>
                </View>
                <Pressable
                  style={[
                    styles.roleBtn,
                    revokeBusyId === invite.id && styles.disabled,
                  ]}
                  disabled={revokeBusyId === invite.id}
                  onPress={() => void handleRevoke(invite.id)}
                >
                  <Text style={styles.roleBtnText}>
                    {revokeBusyId === invite.id ? '…' : 'Revoke'}
                  </Text>
                </Pressable>
              </View>
            ))
          )}
        </>
      )}

      <Text style={[styles.sectionTitle, { marginTop: 28 }]}>
        All memberships
      </Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
      ) : (
        members.map((m) => {
          const canRemove = canManageTeam && m.role !== 'admin';
          const busy = removeBusyId === m.id;
          return (
            <View key={m.id} style={styles.memberRow}>
              <View style={styles.roleInfo}>
                <Text style={styles.memberRole}>{roleLabel(m.role)}</Text>
                <Text style={styles.memberId} numberOfLines={1}>
                  {m.user_id === user?.id
                    ? 'You'
                    : `${m.user_id.slice(0, 8)}…`}
                </Text>
              </View>
              {canRemove ? (
                <Pressable
                  style={[styles.roleBtn, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() => void handleRemoveMembership(m)}
                >
                  <Text style={styles.roleBtnText}>
                    {busy ? '…' : 'Remove'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })
      )}

      <Text style={styles.hint}>
        Roles: {ROSTER_ROLES.map((r) => r.label).join(' · ')}. Max 3
        assistants per roster (including pending invites).
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: layout.pagePadding,
    paddingBottom: 48,
    maxWidth: layout.pageMaxWidth,
    width: '100%',
    alignSelf: 'center',
  },
  contentCompact: {
    paddingHorizontal: layout.pagePaddingCompact,
  },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  sub: {
    color: colors.muted,
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 20,
  },
  notice: {
    backgroundColor: colors.warningBg,
    color: colors.warningText,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 10,
  },
  inviteHint: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: 10,
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    marginBottom: 10,
  },
  roleChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  roleChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  roleChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  roleChipText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.text,
  },
  roleChipTextActive: {
    color: colors.primaryText,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryBtnText: {
    color: colors.primaryText,
    fontWeight: '700',
  },
  emptyMeta: {
    color: colors.muted,
    marginBottom: 8,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  roleInfo: {
    flex: 1,
  },
  roleName: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 16,
  },
  roleMeta: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 13,
  },
  roleBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 110,
    alignItems: 'center',
  },
  roleBtnOn: {
    backgroundColor: colors.primary,
  },
  roleBtnText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 13,
  },
  roleBtnTextOn: {
    color: colors.primaryText,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  memberRole: {
    fontWeight: '700',
    color: colors.text,
  },
  memberId: {
    color: colors.muted,
    fontSize: 13,
    flexShrink: 1,
  },
  hint: {
    marginTop: 20,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    color: colors.danger,
    marginBottom: 12,
  },
  disabled: {
    opacity: 0.5,
  },
});
