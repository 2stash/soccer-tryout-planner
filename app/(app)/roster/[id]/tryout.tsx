import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { PlayerEditSheet } from '@/components/PlayerEditSheet';
import { useAuth } from '@/lib/AuthContext';
import {
  downloadFullPlayersCsv,
  downloadNamesYearCsv,
} from '@/lib/exportPlayers';
import {
  filterAvailableByGrade,
  type GradeFilter,
} from '@/lib/availableRank';
import { alertRequiresOnline } from '@/lib/offline/gate';
import { useOffline } from '@/lib/offline/OfflineContext';
import { useRosterData } from '@/lib/RosterDataContext';
import { useLayout } from '@/lib/layout';
import { comparePlayersByName } from '@/lib/playerSort';
import {
  CLASS_ORDER_DESC,
  countBySchoolYear,
  schoolYearSortKey,
} from '@/lib/schoolYear';
import type { Player, PlayerAssignment, PlayerInput } from '@/lib/types';
import { colors, layout } from '@/constants/theme';

type DaySelection = 'all' | number;

const GRADE_FILTERS: { key: GradeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...CLASS_ORDER_DESC.map((y) => ({ key: y as GradeFilter, label: y })),
];

const TRYOUT_NUMBERS = Array.from({ length: 99 }, (_, i) => i + 1);

function dayRow(player: Player, day: number) {
  return player.tryout_days?.find((d) => d.day === day);
}

function tryoutNumberForView(player: Player, day: DaySelection): number | null {
  if (day !== 'all') {
    return dayRow(player, day)?.tryout_number ?? null;
  }
  const day1 = dayRow(player, 1)?.tryout_number;
  if (day1 != null) return day1;
  const first = [...(player.tryout_days ?? [])]
    .sort((a, b) => a.day - b.day)
    .find((d) => d.tryout_number != null);
  return first?.tryout_number ?? null;
}

function attendedSummary(player: Player, dayCount: number): string {
  const days = [];
  for (let d = 1; d <= dayCount; d++) {
    if (dayRow(player, d)?.attended) days.push(String(d));
  }
  return days.length ? days.join(' · ') : '—';
}

function matchesTryoutFilter(player: Player, raw: string) {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  const num = (player.tryout_days ?? [])
    .map((d) => (d.tryout_number != null ? String(d.tryout_number) : ''))
    .join(' ');
  return (
    (player.first_name ?? '').toLowerCase().includes(q) ||
    (player.last_name ?? '').toLowerCase().includes(q) ||
    (player.school_year ?? '').toLowerCase().includes(q) ||
    num.includes(q)
  );
}

function sortByYearThenName(list: Player[]): Player[] {
  return [...list].sort((a, b) => {
    const cmp =
      schoolYearSortKey(a.school_year) - schoolYearSortKey(b.school_year);
    if (cmp !== 0) return cmp;
    return comparePlayersByName(a, b);
  });
}

type NumberPickerProps = {
  visible: boolean;
  current: number | null;
  onClose: () => void;
  onSelect: (n: number | null) => void;
};

function TryoutNumberPicker({
  visible,
  current,
  onClose,
  onSelect,
}: NumberPickerProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.pickerBackdrop} onPress={onClose}>
        <Pressable style={styles.pickerCard} onPress={() => {}}>
          <Text style={styles.pickerTitle}>Tryout #</Text>
          <Pressable
            style={[styles.clearBtn, current == null && styles.clearBtnActive]}
            onPress={() => {
              onSelect(null);
              onClose();
            }}
          >
            <Text
              style={[
                styles.clearBtnText,
                current == null && styles.clearBtnTextActive,
              ]}
            >
              Clear
            </Text>
          </Pressable>
          <ScrollView
            style={styles.pickerScroll}
            contentContainerStyle={styles.pickerGrid}
            keyboardShouldPersistTaps="handled"
          >
            {TRYOUT_NUMBERS.map((n) => {
              const active = current === n;
              return (
                <Pressable
                  key={n}
                  style={[styles.numChip, active && styles.numChipActive]}
                  onPress={() => {
                    onSelect(n);
                    onClose();
                  }}
                >
                  <Text
                    style={[styles.numText, active && styles.numTextActive]}
                  >
                    {n}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable style={styles.pickerClose} onPress={onClose}>
            <Text style={styles.pickerCloseText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function TryoutScreen() {
  const { session, loading: authLoading, configured } = useAuth();
  const { isPhone, isCompact } = useLayout();
  const { isOnline } = useOffline();
  const {
    rosterId,
    roster,
    players,
    loading,
    error,
    clearError,
    savePlayer,
    removePlayer,
    assignSquad,
    setTryoutNumber,
    setTryoutAttended,
  } = useRosterData();

  const dayCount = Math.min(5, Math.max(1, roster?.tryout_day_count ?? 1));
  const [day, setDay] = useState<DaySelection>(1);
  const [filter, setFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('all');
  const [moreOpen, setMoreOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Player | null>(null);
  const [pickerPlayerId, setPickerPlayerId] = useState<string | null>(null);

  useEffect(() => {
    if (day !== 'all' && typeof day === 'number' && day > dayCount) {
      setDay(1);
    }
  }, [day, dayCount]);

  useEffect(() => {
    if (!loading && roster && !roster.tryout_active) {
      router.replace(`/roster/${rosterId}/players`);
    }
  }, [loading, roster, rosterId]);

  const classCounts = useMemo(() => countBySchoolYear(players), [players]);

  const gradeVisible = useMemo(
    () => filterAvailableByGrade(players, gradeFilter),
    [players, gradeFilter]
  );

  const cardPlayers = useMemo(() => {
    const filtered = gradeVisible.filter((p) => matchesTryoutFilter(p, filter));
    return sortByYearThenName(filtered);
  }, [gradeVisible, filter]);

  const duplicateNumbers = useMemo(() => {
    if (day === 'all') return new Set<number>();
    const counts = new Map<number, number>();
    for (const p of cardPlayers) {
      const n = dayRow(p, day)?.tryout_number;
      if (n == null) continue;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const dups = new Set<number>();
    for (const [n, c] of counts) {
      if (c > 1) dups.add(n);
    }
    return dups;
  }, [cardPlayers, day]);

  const pickerPlayer = pickerPlayerId
    ? players.find((p) => p.id === pickerPlayerId) ?? null
    : null;
  const pickerDay = day === 'all' ? 1 : day;
  const pickerCurrent = pickerPlayer
    ? tryoutNumberForView(pickerPlayer, day === 'all' ? 'all' : pickerDay)
    : null;

  const displayError = localError ?? error;

  function dismissError() {
    setLocalError(null);
    clearError();
  }

  async function handleSave(id: string, input: PlayerInput) {
    setLocalError(null);
    await savePlayer(id, input);
  }

  async function handleAssignSquad(
    playerId: string,
    team: PlayerAssignment | null
  ) {
    setLocalError(null);
    await assignSquad(playerId, team);
  }

  async function handleDeleteFromSheet(player: Player) {
    setLocalError(null);
    await removePlayer(player);
  }

  async function handleNumberSelect(n: number | null) {
    if (!pickerPlayerId) return;
    setLocalError(null);
    try {
      await setTryoutNumber(pickerPlayerId, pickerDay, n);
    } catch (e) {
      setLocalError(
        e instanceof Error ? e.message : 'Failed to update tryout number'
      );
    }
  }

  async function handleToggleAttended(player: Player) {
    if (day === 'all') return;
    const current = dayRow(player, day)?.attended ?? false;
    setLocalError(null);
    try {
      await setTryoutAttended(player.id, day, !current);
    } catch (e) {
      setLocalError(
        e instanceof Error ? e.message : 'Failed to update attendance'
      );
    }
  }

  if (!authLoading && (!configured || !session)) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (!loading && roster && !roster.tryout_active) {
    return <Redirect href={`/roster/${rosterId}/players`} />;
  }

  const dayOptions: { key: DaySelection; label: string }[] = [
    { key: 'all', label: 'All days' },
    ...Array.from({ length: dayCount }, (_, i) => ({
      key: (i + 1) as DaySelection,
      label: `Day ${i + 1}`,
    })),
  ];

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
          <Text style={styles.heading}>
            {roster ? `${roster.name} · Tryout` : 'Tryout'}
          </Text>
          <Text style={styles.sub}>
            Set bib numbers and attendance per day. Tap a name to edit the
            player. Duplicate numbers on the selected day are highlighted.
          </Text>

          <View style={styles.dayRow}>
            {dayOptions.map((opt) => {
              const active = day === opt.key;
              return (
                <Pressable
                  key={String(opt.key)}
                  style={[styles.dayChip, active && styles.dayChipActive]}
                  onPress={() => setDay(opt.key)}
                >
                  <Text
                    style={[styles.dayText, active && styles.dayTextActive]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.toolbar}>
            <TextInput
              style={[styles.search, isCompact && styles.searchCompact]}
              value={filter}
              onChangeText={setFilter}
              placeholder="Filter players…"
              placeholderTextColor={colors.muted}
            />
            <Pressable
              style={[styles.primaryBtn, !isOnline && styles.btnDisabled]}
              onPress={() => {
                if (!isOnline) {
                  alertRequiresOnline('Adding players');
                  return;
                }
                router.push(`/roster/${rosterId}/add`);
              }}
            >
              <Text style={styles.primaryText}>Add</Text>
            </Pressable>
            {isCompact ? (
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => setMoreOpen((v) => !v)}
              >
                <Text style={styles.secondaryText}>More</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  style={[styles.secondaryBtn, !isOnline && styles.btnDisabled]}
                  onPress={() => {
                    if (!isOnline) {
                      alertRequiresOnline('Import');
                      return;
                    }
                    router.push(`/roster/${rosterId}/import`);
                  }}
                >
                  <Text style={styles.secondaryText}>Import</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.secondaryBtn,
                    players.length === 0 && styles.btnDisabled,
                  ]}
                  disabled={players.length === 0}
                  onPress={() =>
                    downloadFullPlayersCsv(players, roster?.name ?? 'roster')
                  }
                >
                  <Text style={styles.secondaryText}>Export full</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.secondaryBtn,
                    players.length === 0 && styles.btnDisabled,
                  ]}
                  disabled={players.length === 0}
                  onPress={() =>
                    downloadNamesYearCsv(players, roster?.name ?? 'roster')
                  }
                >
                  <Text style={styles.secondaryText}>Export names</Text>
                </Pressable>
              </>
            )}
          </View>

          {isCompact && moreOpen ? (
            <View style={styles.morePanel}>
              <Pressable
                style={[styles.moreRow, !isOnline && styles.btnDisabled]}
                onPress={() => {
                  if (!isOnline) {
                    alertRequiresOnline('Import');
                    return;
                  }
                  setMoreOpen(false);
                  router.push(`/roster/${rosterId}/import`);
                }}
              >
                <Text style={styles.moreText}>Import</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.moreRow,
                  players.length === 0 && styles.btnDisabled,
                ]}
                disabled={players.length === 0}
                onPress={() => {
                  downloadFullPlayersCsv(players, roster?.name ?? 'roster');
                  setMoreOpen(false);
                }}
              >
                <Text style={styles.moreText}>Export full CSV</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.moreRow,
                  players.length === 0 && styles.btnDisabled,
                ]}
                disabled={players.length === 0}
                onPress={() => {
                  downloadNamesYearCsv(players, roster?.name ?? 'roster');
                  setMoreOpen(false);
                }}
              >
                <Text style={styles.moreText}>Export names CSV</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.gradeRow}>
            {GRADE_FILTERS.map((tab) => {
              const active = gradeFilter === tab.key;
              const count =
                tab.key === 'all' ? players.length : classCounts[tab.key];
              return (
                <Pressable
                  key={tab.key}
                  style={[styles.gradeChip, active && styles.gradeChipActive]}
                  onPress={() => setGradeFilter(tab.key)}
                >
                  <Text
                    style={[styles.gradeText, active && styles.gradeTextActive]}
                  >
                    {tab.key === 'all'
                      ? `All ${count}`
                      : `${tab.label} ${count}`}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {displayError ? (
            <Pressable onPress={dismissError} style={styles.errorBanner}>
              <Text style={styles.error}>{displayError}</Text>
              <Text style={styles.errorDismiss}>Dismiss</Text>
            </Pressable>
          ) : null}

          <View style={styles.cardList}>
            {loading && players.length === 0 ? (
              <Text style={styles.empty}>Loading players…</Text>
            ) : cardPlayers.length === 0 ? (
              <Text style={styles.empty}>No players match.</Text>
            ) : (
              cardPlayers.map((player, index) => {
                const num = tryoutNumberForView(player, day);
                const isDup =
                  day !== 'all' && num != null && duplicateNumbers.has(num);
                const attended =
                  day !== 'all'
                    ? (dayRow(player, day)?.attended ?? false)
                    : false;
                const denser = !isPhone;

                return (
                  <View
                    key={player.id}
                    style={[
                      styles.card,
                      denser && styles.cardDense,
                      index % 2 === 1 && styles.cardAlt,
                      isDup && styles.cardDup,
                    ]}
                  >
                    <Pressable
                      style={styles.cardIdentity}
                      onPress={() => setEditing(player)}
                    >
                      <Text style={styles.cardName} numberOfLines={1}>
                        {player.last_name}, {player.first_name}
                      </Text>
                      <Text style={styles.cardYear} numberOfLines={1}>
                        {player.school_year || '—'}
                      </Text>
                    </Pressable>

                    <View style={styles.cardControls}>
                      <Pressable
                        style={styles.numBtn}
                        onPress={() => setPickerPlayerId(player.id)}
                      >
                        <Text style={styles.numBtnLabel}>#</Text>
                        <Text style={styles.numBtnValue}>
                          {num != null ? String(num) : '—'}
                        </Text>
                      </Pressable>

                      {day === 'all' ? (
                        <View style={styles.attendedSummary}>
                          <Text style={styles.attendedSummaryLabel}>Days</Text>
                          <Text
                            style={styles.attendedSummaryValue}
                            numberOfLines={1}
                          >
                            {attendedSummary(player, dayCount)}
                          </Text>
                        </View>
                      ) : (
                        <Pressable
                          style={[
                            styles.attendBtn,
                            attended
                              ? styles.attendBtnYes
                              : styles.attendBtnNo,
                          ]}
                          onPress={() => void handleToggleAttended(player)}
                        >
                          <Text
                            style={[
                              styles.attendBtnText,
                              attended
                                ? styles.attendBtnTextYes
                                : styles.attendBtnTextNo,
                            ]}
                          >
                            {attended ? 'Attended' : 'Missed'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>

          <Text style={styles.hint}>
            {loading && players.length === 0
              ? 'Loading players…'
              : `${cardPlayers.length} player${
                  cardPlayers.length === 1 ? '' : 's'
                }${gradeFilter === 'all' ? '' : ` · ${gradeFilter}`}${
                  filter.trim() ? ' (filtered)' : ''
                } · ${day === 'all' ? 'All days' : `Day ${day}`}`}
          </Text>
        </View>
      </ScrollView>

      <PlayerEditSheet
        player={editing}
        visible={Boolean(editing)}
        onClose={() => setEditing(null)}
        onSave={handleSave}
        onAssignSquad={handleAssignSquad}
        onDelete={handleDeleteFromSheet}
      />

      <TryoutNumberPicker
        visible={Boolean(pickerPlayer)}
        current={pickerCurrent}
        onClose={() => setPickerPlayerId(null)}
        onSelect={(n) => {
          void handleNumberSelect(n);
        }}
      />
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
    padding: layout.pagePaddingCompact,
    paddingTop: 12,
    alignItems: 'stretch',
  },
  content: {
    width: '100%',
    maxWidth: layout.pageMaxWidth,
    gap: layout.gap,
  },
  heading: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  sub: {
    color: colors.muted,
    marginTop: -8,
    fontSize: 14,
    fontWeight: '600',
  },
  dayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dayChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dayChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  dayTextActive: {
    color: colors.primaryText,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  search: {
    flexGrow: 1,
    flexBasis: 180,
    minWidth: 140,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
  },
  searchCompact: {
    flexBasis: 120,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: layout.radius,
  },
  primaryText: {
    color: colors.primaryText,
    fontWeight: '800',
    fontSize: 14,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: layout.radius,
  },
  secondaryText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  morePanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  moreRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  moreText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  gradeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  gradeChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  gradeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  gradeText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  gradeTextActive: {
    color: colors.primaryText,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.dangerBg,
    padding: 10,
    borderRadius: layout.radius,
  },
  error: {
    flex: 1,
    color: colors.danger,
    fontWeight: '600',
  },
  errorDismiss: {
    color: colors.danger,
    fontWeight: '800',
    fontSize: 13,
  },
  hint: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: '600',
  },
  cardList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  card: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 10,
    backgroundColor: colors.surface,
  },
  cardDense: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  cardAlt: {
    backgroundColor: '#f7f9fb',
  },
  cardDup: {
    backgroundColor: colors.dangerBg,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },
  cardIdentity: {
    flex: 1,
    gap: 2,
    minWidth: 120,
  },
  cardName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 15,
  },
  cardYear: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  cardControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  numBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: layout.radius,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 64,
  },
  numBtnLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
  },
  numBtnValue: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  attendBtn: {
    borderRadius: layout.radius,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 88,
    alignItems: 'center',
  },
  attendBtnYes: {
    backgroundColor: '#d1fae5',
    borderWidth: 1,
    borderColor: '#059669',
  },
  attendBtnNo: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  attendBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },
  attendBtnTextYes: {
    color: '#047857',
  },
  attendBtnTextNo: {
    color: colors.danger,
  },
  attendedSummary: {
    minWidth: 72,
    gap: 2,
  },
  attendedSummaryLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
  },
  attendedSummaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 32, 0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    maxHeight: '80%',
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
    gap: 10,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  clearBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.bg,
  },
  clearBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  clearBtnText: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 13,
  },
  clearBtnTextActive: {
    color: colors.primaryText,
  },
  pickerScroll: {
    maxHeight: 360,
  },
  pickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  numChip: {
    width: 44,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  numText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  numTextActive: {
    color: colors.primaryText,
  },
  pickerClose: {
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickerCloseText: {
    fontWeight: '700',
    color: colors.text,
  },
});
