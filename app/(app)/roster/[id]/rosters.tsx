import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { FormationPitchPicker } from '@/components/FormationPitchPicker';
import { useAuth } from '@/lib/AuthContext';
import { useRosterData } from '@/lib/RosterDataContext';
import { useLayout } from '@/lib/layout';
import { getFormationStartersByNumber } from '@/lib/depthChart';
import {
  playersInRankPool,
  type RankPool,
} from '@/lib/assignPools';
import { orderAvailablePlayers } from '@/lib/availableRank';
import { getSquadDepthViewFromCache } from '@/lib/squadSections';
import { formatPositionsShort } from '@/lib/positions';
import { formatClassCounts } from '@/lib/schoolYear';
import type { Player, SquadTeam } from '@/lib/types';
import { SQUAD_TEAMS } from '@/lib/types';
import { colors, layout } from '@/constants/theme';

/** Pitch + subs side-by-side (tablet landscape / desktop). */
const SIDE_BY_SIDE_MIN = 720;

type ViewKey = SquadTeam | 'pools';

function playerMeta(player: Player) {
  const pos = formatPositionsShort(player.positions);
  return [player.school_year, pos].filter(Boolean).join(' · ');
}

export default function RostersScreen() {
  const { session, loading: authLoading, configured } = useAuth();
  const { width, isPhone, isCompact, isDesktop } = useLayout();
  const { roster, players, depthCache, loading, depthReady, error } =
    useRosterData();

  const viewTabs = useMemo(
    (): {
      key: ViewKey;
      label: string;
      short: string;
    }[] => [
      ...SQUAD_TEAMS.map((t) => ({
        key: t.id as ViewKey,
        label: t.label,
        short: t.id === 'varsity' ? 'Var' : t.id === 'jv' ? 'JV' : 'Fr',
      })),
      { key: 'pools', label: 'Avail / Unavail', short: 'Pool' },
    ],
    []
  );

  const [viewKey, setViewKey] = useState<ViewKey>('varsity');
  useEffect(() => {
    if (!viewTabs.some((t) => t.key === viewKey)) {
      setViewKey(viewTabs[0]?.key ?? 'varsity');
    }
  }, [viewTabs, viewKey]);

  const sideBySide = !isPhone && width >= SIDE_BY_SIDE_MIN;
  const pitchCompact = !isDesktop;
  const showingPools = viewKey === 'pools';

  const availablePlayers = useMemo(
    () => orderAvailablePlayers(playersInRankPool(players, 'available')),
    [players]
  );

  const unavailablePlayers = useMemo(
    () => orderAvailablePlayers(playersInRankPool(players, 'unavailable')),
    [players]
  );

  const squadTeam: SquadTeam | null = showingPools
    ? null
    : (viewKey as SquadTeam);

  const squadPlayers = useMemo(() => {
    if (!squadTeam) return [] as Player[];
    return players.filter((p) => p.squad_team === squadTeam);
  }, [players, squadTeam]);

  const squadDepthCache = useMemo(() => {
    if (!squadTeam) return undefined;
    return depthCache[squadTeam];
  }, [squadTeam, depthCache]);

  const view = useMemo(() => {
    if (!squadTeam) {
      return { subs: [] as Player[], teamEntries: [] };
    }
    return getSquadDepthViewFromCache({
      squadPlayers,
      cache: squadDepthCache,
      positionNumber: 9,
    });
  }, [squadPlayers, squadDepthCache, squadTeam]);

  const labelByNumber = useMemo(() => {
    if (!squadTeam) return {};
    const byNumber = getFormationStartersByNumber(
      squadPlayers,
      view.teamEntries
    );
    const labels: Partial<Record<number, string | null>> = {};
    for (const [number, player] of byNumber) {
      labels[number] = player?.last_name?.trim() || null;
    }
    return labels;
  }, [squadPlayers, view.teamEntries, squadTeam]);

  const subs = view.subs;
  const teamLabel = squadTeam
    ? SQUAD_TEAMS.find((t) => t.id === squadTeam)?.label ?? squadTeam
    : 'Available / Unavailable';
  const classCounts = formatClassCounts(
    showingPools
      ? [...availablePlayers, ...unavailablePlayers]
      : squadPlayers
  );
  const starterCount = Object.values(labelByNumber).filter(Boolean).length;
  const poolSideBySide = !isPhone && width >= 640;

  if (!authLoading && (!configured || !session)) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  function tabCount(key: ViewKey) {
    if (key === 'pools') {
      return availablePlayers.length + unavailablePlayers.length;
    }
    return players.filter((p) => p.squad_team === key).length;
  }

  function renderPoolList(pool: RankPool, list: Player[]) {
    const title = pool === 'available' ? 'Available' : 'Unavailable';
    return (
      <View
        style={[
          styles.poolCol,
          poolSideBySide && styles.poolColSide,
          !poolSideBySide && styles.colFull,
        ]}
      >
        <View style={styles.colHeader}>
          <Text style={styles.colTitle}>{title}</Text>
          <Text style={styles.colCount}>{list.length}</Text>
        </View>
        {formatClassCounts(list) ? (
          <Text style={styles.colHint} numberOfLines={1}>
            {formatClassCounts(list)}
          </Text>
        ) : null}
        {list.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No players in {title}.</Text>
          </View>
        ) : (
          <View style={styles.subsList}>
            {list.map((player, index) => {
              const pinned = Boolean(player.available_pinned);
              const meta = playerMeta(player);
              return (
                <View
                  key={player.id}
                  style={[
                    styles.subRow,
                    isPhone && styles.subRowPhone,
                    pinned && styles.rowPinned,
                  ]}
                >
                  <Text
                    style={[styles.subRank, pinned && styles.rankPinned]}
                  >
                    {pinned ? '★' : `#${index + 1}`}
                  </Text>
                  <View style={styles.subInfo}>
                    <Text style={styles.subName} numberOfLines={1}>
                      {player.last_name}
                      {player.first_name ? `, ${player.first_name}` : ''}
                    </Text>
                    {meta ? (
                      <Text style={styles.subMeta} numberOfLines={1}>
                        {meta}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isCompact && styles.scrollContentCompact,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <View style={styles.toolbar}>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>
                {roster ? `${roster.name} · Rosters` : 'Rosters'}
              </Text>
              <Text style={styles.subtitle}>
                {showingPools
                  ? 'Available and Unavailable ranked lists'
                  : isPhone
                    ? 'Starting XI and bench for game day'
                    : 'Starting XI on the pitch · substitutes listed beside'}
              </Text>
              {classCounts ? (
                <Text style={styles.classCounts} numberOfLines={2}>
                  {classCounts}
                </Text>
              ) : null}
            </View>
            <View style={styles.teamTabs}>
              {viewTabs.map((tab) => {
                const active = viewKey === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    style={[styles.teamTab, active && styles.teamTabActive]}
                    onPress={() => setViewKey(tab.key)}
                  >
                    <Text
                      style={[
                        styles.teamTabText,
                        active && styles.teamTabTextActive,
                      ]}
                    >
                      {isPhone ? tab.short : tab.label}
                    </Text>
                    <Text
                      style={[
                        styles.teamTabCount,
                        active && styles.teamTabTextActive,
                      ]}
                    >
                      {tabCount(tab.key)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {showingPools ? (
            <View
              style={[
                styles.columns,
                !poolSideBySide && styles.columnsStack,
              ]}
            >
              {renderPoolList('available', availablePlayers)}
              {renderPoolList('unavailable', unavailablePlayers)}
            </View>
          ) : !loading && depthReady && squadPlayers.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>No players on {teamLabel}</Text>
              <Text style={styles.emptyText}>
                Assign players to this squad on Assign Squads.
              </Text>
            </View>
          ) : (
            <View
              style={[styles.columns, !sideBySide && styles.columnsStack]}
            >
              <View
                style={[
                  styles.leftCol,
                  sideBySide && styles.leftColSide,
                  sideBySide && !isDesktop && styles.leftColTablet,
                  !sideBySide && styles.colFull,
                ]}
              >
                <View style={styles.colHeader}>
                  <Text style={styles.colTitle}>Starting XI</Text>
                  <View style={styles.colHeaderRight}>
                    <Text style={styles.colCount}>{starterCount}/11</Text>
                  </View>
                </View>
                {!isPhone ? (
                  <Text style={styles.colHint}>
                    Last names from the depth chart
                  </Text>
                ) : null}
                <View
                  style={[
                    styles.pitchWrap,
                    pitchCompact && styles.pitchWrapCompact,
                    sideBySide && !isDesktop && styles.pitchWrapTabletSide,
                  ]}
                >
                  <FormationPitchPicker
                    labelByNumber={labelByNumber}
                    density={pitchCompact ? 'compact' : 'default'}
                  />
                </View>
              </View>

              <View
                style={[
                  styles.rightCol,
                  sideBySide && styles.rightColSide,
                  !sideBySide && styles.colFull,
                ]}
              >
                <View style={styles.colHeader}>
                  <Text style={styles.colTitle}>Subs</Text>
                  <Text style={styles.colCount}>{subs.length}</Text>
                </View>
                {!isPhone ? (
                  <Text style={styles.colHint}>
                    Bench order · numbered from 12
                  </Text>
                ) : null}
                {subs.length === 0 ? (
                  <View style={styles.empty}>
                    <Text style={styles.emptyText}>
                      No substitutes for {teamLabel}.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.subsList}>
                    {subs.map((player, index) => {
                      const meta = playerMeta(player);
                      return (
                        <View
                          key={player.id}
                          style={[
                            styles.subRow,
                            isPhone && styles.subRowPhone,
                          ]}
                        >
                          <Text style={styles.subRank}>{index + 12}</Text>
                          <View style={styles.subInfo}>
                            <Text style={styles.subName} numberOfLines={1}>
                              {player.last_name}
                              {player.first_name
                                ? `, ${player.first_name}`
                                : ''}
                            </Text>
                            {meta ? (
                              <Text style={styles.subMeta} numberOfLines={1}>
                                {meta}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.pagePadding,
    paddingTop: 12,
    paddingBottom: 48,
    alignItems: 'center',
  },
  scrollContentCompact: {
    paddingHorizontal: layout.pagePaddingCompact,
  },
  content: {
    width: '100%',
    maxWidth: layout.pageMaxWidth,
    gap: 14,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    minWidth: 180,
    gap: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
  },
  classCounts: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  teamTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  teamTab: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    minWidth: 52,
    gap: 2,
  },
  teamTabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  teamTabText: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 13,
  },
  teamTabCount: {
    fontWeight: '700',
    color: colors.muted,
    fontSize: 12,
  },
  teamTabTextActive: {
    color: colors.primaryText,
  },
  error: {
    color: colors.danger,
  },
  columns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'flex-start',
  },
  columnsStack: {
    flexDirection: 'column',
  },
  poolCol: {
    gap: 4,
  },
  poolColSide: {
    flex: 1,
    flexBasis: 280,
    minWidth: 240,
  },
  leftCol: {
    gap: 4,
  },
  leftColSide: {
    flexGrow: 1,
    flexBasis: 320,
    minWidth: 280,
    maxWidth: 520,
  },
  leftColTablet: {
    flexGrow: 0,
    flexBasis: 300,
    minWidth: 260,
    maxWidth: 320,
  },
  pitchWrap: {
    width: '100%',
  },
  pitchWrapCompact: {
    maxWidth: 360,
    alignSelf: 'stretch',
  },
  pitchWrapTabletSide: {
    maxWidth: 300,
    alignSelf: 'flex-start',
  },
  rightCol: {
    gap: 4,
  },
  rightColSide: {
    flexGrow: 1,
    flexBasis: 240,
    minWidth: 220,
    maxWidth: 360,
  },
  colFull: {
    width: '100%',
    maxWidth: '100%',
  },
  colHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  colHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  colTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  colCount: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
  },
  colHint: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 4,
  },
  subsList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subRowPhone: {
    paddingVertical: 12,
    minHeight: 48,
  },
  rowPinned: {
    backgroundColor: colors.warningBg,
  },
  subRank: {
    width: 28,
    fontWeight: '800',
    color: colors.muted,
    fontSize: 14,
  },
  rankPinned: {
    color: '#c9a227',
  },
  subInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  subName: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 15,
  },
  subMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  emptyBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    padding: 24,
    gap: 6,
  },
  empty: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    padding: 16,
  },
  emptyTitle: {
    fontWeight: '800',
    color: colors.text,
    fontSize: 16,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
  },
});
