import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { HEAD_COACH_ROLES } from '@/lib/types';
import { colors } from '@/constants/theme';

/**
 * Functional seat is Admin or Coach. Coaching titles stay for coach accounts
 * (invite labels / display). Admins only show Admin.
 */
export function RoleSwitcher() {
  const { roles, roleLabel, loading, isAdmin } = useActiveRole();

  const coachTitles = useMemo(
    () =>
      roles
        .filter(
          (r) => HEAD_COACH_ROLES.includes(r) || r === 'assistant'
        )
        .map((r) => roleLabel(r)),
    [roles, roleLabel]
  );

  if (loading || roles.length === 0) {
    return (
      <Text style={styles.actingMuted} numberOfLines={1}>
        {loading ? 'Role…' : 'No role'}
      </Text>
    );
  }

  if (isAdmin) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>Admin</Text>
        <Text style={styles.roles} numberOfLines={1}>
          Team admin
        </Text>
      </View>
    );
  }

  const titlesText = coachTitles.join(', ');

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Coach</Text>
      {titlesText ? (
        <Text style={styles.roles} numberOfLines={2}>
          {titlesText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    maxWidth: 160,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  label: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  roles: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 12,
    marginTop: 1,
  },
  actingMuted: {
    color: colors.muted,
    fontWeight: '600',
    fontSize: 13,
  },
});
