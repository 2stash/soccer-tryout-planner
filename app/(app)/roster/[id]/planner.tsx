import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { useRosterData } from '@/lib/RosterDataContext';
import { useLayout } from '@/lib/layout';
import type { Player, SquadTeam } from '@/lib/types';
import { SQUAD_TEAMS } from '@/lib/types';
import {
  formatPositionsShort,
  getDepthPositionGroup,
  getDepthStarterCount,
  normalizePositions,
} from '@/lib/positions';
import { comparePlayersByName } from '@/lib/playerSort';
import { playersForBoardSlot } from '@/lib/depthChart';
import { FORMATION_433, slotTitle } from '@/lib/formation';
import { PitchBoard } from '@/components/PitchBoard';
import { colors, layout } from '@/constants/theme';

export default function SquadPlannerPitchScreen() {
  const { session, loading: authLoading, configured } = useAuth();
  const { isPhone, isCompact, isDesktop } = useLayout();
  const {
    roster,
    players,
    depthCache,
    depthReady,
    loading,
    error,
    changePositions,
    clearError,
  } = useRosterData();

  const plannerTabs = useMemo(
    () => SQUAD_TEAMS.map((t) => ({ key: t.id as SquadTeam, label: t.label })),
    []
  );

  const [tab, setTab] = useState<SquadTeam>('varsity');
  useEffect(() => {
    if (!plannerTabs.some((t) => t.key === tab)) {
      setTab(plannerTabs[0]?.key ?? 'varsity');
    }
  }, [plannerTabs, tab]);

  const squadTeam = tab;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const squadPlayers = useMemo(
    () => players.filter((p) => p.squad_team === squadTeam),
    [players, squadTeam]
  );

  const depthEntries = depthCache[squadTeam]?.depthEntries ?? [];

  const noPosition = useMemo(
    () =>
      squadPlayers
        .filter((p) => normalizePositions(p.positions).length === 0)
        .sort(comparePlayersByName),
    [squadPlayers]
  );

  const slotGroups = useMemo(() => {
    return FORMATION_433.map((slot) => ({
      slot,
      players: playersForBoardSlot(squadPlayers, depthEntries, slot.number),
    }));
  }, [squadPlayers, depthEntries]);

  if (!authLoading && (!configured || !session)) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  async function handleRemoveFromSlot(player: Player, slotNumber: number) {
    setBusyId(`${player.id}:${slotNumber}`);
    setLocalError(null);
    clearError();
    try {
      // CB (4/5) shares one pool — remove the whole depth group.
      const group = new Set<number>(getDepthPositionGroup(slotNumber));
      const next = normalizePositions(player.positions).filter(
        (n) => !group.has(n)
      );
      await changePositions(player.id, next);
    } catch (e) {
      setLocalError(
        e instanceof Error ? e.message : 'Failed to update positions'
      );
    } finally {
      setBusyId(null);
    }
  }

  const teamLabel =
    SQUAD_TEAMS.find((t) => t.id === squadTeam)?.label ?? squadTeam;
  const displayError = localError ?? error;

  function renderPhoneLists() {
    return (
      <>
        <View style={styles.slotList}>
          {slotGroups.map(({ slot, players: inSlot }) => {
            // Each CB board card is one starter slot; other positions use depth count.
            const startersOnCard =
              slot.number === 4 || slot.number === 5
                ? 1
                : getDepthStarterCount(slot.number);
            return (
              <View key={slot.number} style={styles.slotBlock}>
                <View style={styles.slotHeader}>
                  <Text style={styles.slotTitle}>{slotTitle(slot.number)}</Text>
                  <Text style={styles.slotCount}>{inSlot.length}</Text>
                </View>
                {inSlot.length === 0 ? (
                  <Text style={styles.emptySlot}>Empty</Text>
                ) : (
                  inSlot.map((player, index) => {
                    const busy = busyId === `${player.id}:${slot.number}`;
                    const isStarter = index < startersOnCard;
                    return (
                      <View
                        key={`${slot.number}-${player.id}`}
                        style={[styles.playerRow, busy && styles.rowBusy]}
                      >
                        <Text style={styles.depth}>{index + 1}</Text>
                        <View style={styles.playerInfo}>
                          <Text style={styles.playerName} numberOfLines={1}>
                            {player.last_name}, {player.first_name}
                          </Text>
                          <Text style={styles.playerMeta}>
                            {[
                              isStarter ? 'Starter' : 'Sub',
                              player.school_year,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </View>
                        <Pressable
                          style={styles.removeBtn}
                          disabled={Boolean(busyId)}
                          onPress={() =>
                            void handleRemoveFromSlot(player, slot.number)
                          }
                          hitSlop={6}
                        >
                          <Text style={styles.removeText}>−</Text>
                        </Pressable>
                      </View>
                    );
                  })
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.bench}>
          <Text style={styles.benchTitle}>
            No pitch position ({noPosition.length})
          </Text>
          <Text style={styles.benchHint}>
            Set positions on Assign Positions and they appear in the lists above.
          </Text>
          {noPosition.length === 0 ? (
            <Text style={styles.emptyText}>
              Every player on this squad has at least one position.
            </Text>
          ) : (
            noPosition.map((player) => (
              <Text key={player.id} style={styles.benchPlayer}>
                {player.last_name}, {player.first_name}
                {player.school_year ? ` · ${player.school_year}` : ''}
              </Text>
            ))
          )}
        </View>
      </>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          isCompact && styles.contentCompact,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>
          {roster ? `${roster.name} · Squad Planner` : 'Squad Planner'}
        </Text>
        <Text style={styles.sub}>
          {isPhone
            ? 'Same depth order as Depth Chart. Tap − to remove a position.'
            : 'Same depth order as Depth Chart / Assign Positions. Multi-position players appear in every matching slot.'}
        </Text>

        <View style={styles.teamTabs}>
          {plannerTabs.map((item) => {
            const active = tab === item.key;
            const count = players.filter((p) => p.squad_team === item.key)
              .length;
            return (
              <Pressable
                key={item.key}
                style={[styles.teamTab, active && styles.teamTabActive]}
                onPress={() => setTab(item.key)}
              >
                <Text
                  style={[
                    styles.teamTabText,
                    active && styles.teamTabTextActive,
                  ]}
                >
                  {item.label}
                </Text>
                <Text
                  style={[
                    styles.teamTabCount,
                    active && styles.teamTabTextActive,
                  ]}
                >
                  {count}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {displayError ? <Text style={styles.error}>{displayError}</Text> : null}
        {busyId && !isPhone ? (
          <Text style={styles.busy}>Updating…</Text>
        ) : null}

        {!loading && depthReady && squadPlayers.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>No players on {teamLabel}</Text>
            <Text style={styles.emptyText}>
              Use Assign Squads to put players on this team first.
            </Text>
          </View>
        ) : isPhone ? (
          renderPhoneLists()
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <PitchBoard
                squadPlayers={depthReady ? squadPlayers : []}
                depthEntries={depthReady ? depthEntries : []}
                density={isDesktop ? 'default' : 'compact'}
                onRemoveFromSlot={(player, slotNumber) =>
                  void handleRemoveFromSlot(player, slotNumber)
                }
              />
            </ScrollView>

            <View style={styles.bench}>
              <Text style={styles.benchTitle}>
                No pitch position ({depthReady ? noPosition.length : 0})
              </Text>
              <Text style={styles.benchHint}>
                On {teamLabel}, but no position set yet on Assign Positions. Set one
                or more positions and they will appear on the field
                automatically.
              </Text>

              {!depthReady ? (
                <Text style={styles.emptyText}>Loading pitch…</Text>
              ) : noPosition.length === 0 ? (
                <Text style={styles.emptyText}>
                  Every player on this squad has at least one position.
                </Text>
              ) : (
                noPosition.map((player) => (
                  <Text key={player.id} style={styles.benchPlayer}>
                    {player.first_name} {player.last_name}
                    {player.school_year ? ` · ${player.school_year}` : ''}
                    {formatPositionsShort(player.positions)
                      ? ` · ${formatPositionsShort(player.positions)}`
                      : ''}
                  </Text>
                ))
              )}
            </View>
          </>
        )}
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
  content: {
    padding: layout.pagePadding,
    gap: 14,
    paddingBottom: 48,
  },
  contentCompact: {
    paddingHorizontal: layout.pagePaddingCompact,
  },
  heading: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  sub: {
    color: colors.muted,
    marginTop: -6,
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
  busy: {
    color: colors.muted,
    fontSize: 13,
  },
  emptyBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 20,
    gap: 6,
  },
  emptyTitle: {
    fontWeight: '800',
    color: colors.text,
  },
  emptyText: {
    color: colors.muted,
  },
  slotList: {
    gap: 10,
  },
  slotBlock: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    padding: 12,
    gap: 4,
  },
  slotHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  slotTitle: {
    fontWeight: '800',
    fontSize: 15,
    color: colors.text,
  },
  slotCount: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.muted,
  },
  emptySlot: {
    color: colors.muted,
    fontSize: 13,
    paddingVertical: 6,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    minHeight: 44,
  },
  rowBusy: {
    opacity: 0.55,
  },
  depth: {
    width: 22,
    fontWeight: '800',
    color: colors.muted,
    fontSize: 13,
  },
  playerInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  playerName: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 15,
  },
  playerMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  removeBtn: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fbfcfd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: {
    color: colors.danger,
    fontWeight: '800',
    fontSize: 18,
    lineHeight: 20,
  },
  bench: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 6,
  },
  benchTitle: {
    fontWeight: '800',
    color: colors.text,
  },
  benchHint: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: 4,
  },
  benchPlayer: {
    color: colors.text,
    fontWeight: '600',
  },
});
