import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { RoleSwitcher } from '@/components/RoleSwitcher';
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { useAuth } from '@/lib/AuthContext';
import { colors } from '@/constants/theme';

type Props = {
  rosterId: string;
};

function userLabel(email: string | undefined) {
  if (!email) return 'Signed in';
  const at = email.indexOf('@');
  if (at > 0 && at <= 18) return email.slice(0, at);
  if (email.length <= 22) return email;
  return `${email.slice(0, 20)}…`;
}

export function RosterSubnav({ rosterId }: Props) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const { isAdmin, isAdminLiveMode } = useActiveRole();
  const onAssign = pathname.includes('/assign');
  const onPlanner = pathname.includes('/planner');
  const onDepth = pathname.includes('/depth');
  const onRosters = pathname.includes('/rosters');
  const onTeam = pathname.includes('/team');
  const onPlayers =
    !onAssign && !onPlanner && !onDepth && !onRosters && !onTeam;

  async function handleSignOut() {
    await signOut();
    router.replace('/(auth)/sign-in');
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <View style={styles.inner}>
          <View style={styles.side}>
            <Pressable
              style={styles.dashboard}
              onPress={() => router.replace('/dashboard')}
            >
              <Text style={styles.dashboardText}>Dashboard</Text>
            </Pressable>
          </View>

          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, onPlayers && styles.tabActive]}
              onPress={() => router.replace(`/roster/${rosterId}`)}
            >
              <Text style={[styles.tabText, onPlayers && styles.tabTextActive]}>
                All Players
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, onDepth && styles.tabActive]}
              onPress={() => router.replace(`/roster/${rosterId}/depth`)}
            >
              <Text style={[styles.tabText, onDepth && styles.tabTextActive]}>
                Depth Chart
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, onRosters && styles.tabActive]}
              onPress={() => router.replace(`/roster/${rosterId}/rosters`)}
            >
              <Text style={[styles.tabText, onRosters && styles.tabTextActive]}>
                Rosters
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, onAssign && styles.tabActive]}
              onPress={() => router.replace(`/roster/${rosterId}/assign`)}
            >
              <Text style={[styles.tabText, onAssign && styles.tabTextActive]}>
                Assign Squads
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, onPlanner && styles.tabActive]}
              onPress={() => router.replace(`/roster/${rosterId}/planner`)}
            >
              <Text style={[styles.tabText, onPlanner && styles.tabTextActive]}>
                Squad Planner
              </Text>
            </Pressable>
            {isAdmin ? (
              <Pressable
                style={[styles.tab, onTeam && styles.tabActive]}
                onPress={() => router.replace(`/roster/${rosterId}/team`)}
              >
                <Text style={[styles.tabText, onTeam && styles.tabTextActive]}>
                  Team
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={[styles.side, styles.userSide]}>
            <RoleSwitcher />
            <Text style={styles.userEmail} numberOfLines={1}>
              {userLabel(user?.email)}
            </Text>
            <Pressable
              style={styles.signOut}
              onPress={() => void handleSignOut()}
            >
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
          </View>
        </View>
      </View>
      {isAdminLiveMode ? (
        <View style={[styles.liveBanner, styles.liveBannerAssign]}>
          <Text style={styles.liveBannerText}>
            Live coaches — All Players, Depth, Rosters, and Assign edit the
            three head-coach master rosters.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  bar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    alignItems: 'center',
  },
  liveBanner: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#fff7ed',
    borderTopWidth: 1,
    borderTopColor: '#fdba74',
    alignItems: 'center',
  },
  liveBannerAssign: {
    backgroundColor: '#fef2f2',
    borderTopColor: '#fca5a5',
  },
  liveBannerText: {
    width: '100%',
    maxWidth: 960,
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  inner: {
    width: '100%',
    maxWidth: 960,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
  },
  side: {
    flex: 1,
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
  },
  userSide: {
    justifyContent: 'flex-end',
    gap: 10,
  },
  dashboard: {
    paddingVertical: 8,
  },
  dashboardText: {
    color: colors.primary,
    fontWeight: '800',
    fontSize: 15,
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 14,
  },
  tabTextActive: {
    color: colors.primaryText,
  },
  userEmail: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 140,
  },
  signOut: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  signOutText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 13,
  },
});
