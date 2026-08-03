import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { useAuth } from '@/lib/AuthContext';
import { useLayout } from '@/lib/layout';
import {
  addRosterRole,
  listRosterMembers,
  removeRosterRole,
  roleLabel,
} from '@/lib/rosterMembers';
import type { RosterMember, RosterRole } from '@/lib/types';
import { ROSTER_ROLES } from '@/lib/types';
import { colors, layout } from '@/constants/theme';

const SELF_ASSIGN_ROLES: RosterRole[] = [
  'varsity_coach',
  'jv_coach',
  'fr_soph_coach',
  'assistant',
];

export default function TeamSettingsScreen() {
  const { user } = useAuth();
  const { isPhone } = useLayout();
  const { rosterId, isAdmin, roles: myRoles, refreshRoles } = useActiveRole();
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyRole, setBusyRole] = useState<RosterRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listRosterMembers(rosterId);
      setMembers(rows);
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

  const myRoleSet = new Set(myRoles);
  const seatHolder = (role: RosterRole) =>
    members.find((m) => m.role === role);

  async function handleToggle(role: RosterRole) {
    if (!user || !isAdmin) return;
    setBusyRole(role);
    setError(null);
    try {
      if (myRoleSet.has(role)) {
        await removeRosterRole({
          rosterId,
          userId: user.id,
          role,
        });
      } else {
        const holder = seatHolder(role);
        if (holder && holder.user_id !== user.id && role !== 'assistant') {
          throw new Error(
            `${roleLabel(role)} is already assigned to another coach.`
          );
        }
        await addRosterRole({
          rosterId,
          userId: user.id,
          role,
        });
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update role');
    } finally {
      setBusyRole(null);
    }
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
        Assign coaching roles to yourself for testing. Head-coach roles edit
        that master overlay; Admin / Assistant edit your personal overlay.
        Email invites come in a later phase.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!isAdmin ? (
        <Text style={styles.notice}>
          Only the roster Admin can change roles. Your roles:{' '}
          {myRoles.map(roleLabel).join(', ') || 'none'}.
        </Text>
      ) : null}

      <Text style={styles.sectionTitle}>Your roles (self-assign)</Text>
      {SELF_ASSIGN_ROLES.map((role) => {
        const held = myRoleSet.has(role);
        const other = seatHolder(role);
        const takenByOther =
          !!other && other.user_id !== user?.id && role !== 'assistant';
        const busy = busyRole === role;
        return (
          <View key={role} style={styles.roleRow}>
            <View style={styles.roleInfo}>
              <Text style={styles.roleName}>{roleLabel(role)}</Text>
              {takenByOther ? (
                <Text style={styles.roleMeta}>Seat taken by another coach</Text>
              ) : held ? (
                <Text style={styles.roleMeta}>Assigned to you</Text>
              ) : (
                <Text style={styles.roleMeta}>Not assigned</Text>
              )}
            </View>
            {isAdmin ? (
              <Pressable
                style={[
                  styles.roleBtn,
                  held && styles.roleBtnOn,
                  (busy || takenByOther) && styles.disabled,
                ]}
                disabled={busy || takenByOther}
                onPress={() => void handleToggle(role)}
              >
                <Text
                  style={[styles.roleBtnText, held && styles.roleBtnTextOn]}
                >
                  {busy ? '…' : held ? 'Remove' : 'Assign to me'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      <Text style={[styles.sectionTitle, { marginTop: 28 }]}>
        All memberships
      </Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
      ) : (
        members.map((m) => (
          <View key={m.id} style={styles.memberRow}>
            <Text style={styles.memberRole}>{roleLabel(m.role)}</Text>
            <Text style={styles.memberId} numberOfLines={1}>
              {m.user_id === user?.id
                ? 'You'
                : `${m.user_id.slice(0, 8)}…`}
            </Text>
          </View>
        ))
      )}

      <Text style={styles.hint}>
        Roles: {ROSTER_ROLES.map((r) => r.label).join(' · ')}. Max 3
        assistants per roster.
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
