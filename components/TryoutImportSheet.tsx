import { useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {
  buildTryoutImportPreviewRows,
  formatTimeTrialPreview,
  parseTryoutResultsBuffer,
  type TryoutImportParseResult,
} from '@/lib/importTryoutResults';
import { useRosterData } from '@/lib/RosterDataContext';
import { colors } from '@/constants/theme';

type Props = {
  onImported: (summary: { created: number; present: number }) => void;
};

export function TryoutImportSheet({ onImported }: Props) {
  const { roster, players, importTryoutResults } = useRosterData();
  const dayCount = Math.min(5, Math.max(1, roster?.tryout_day_count ?? 1));
  const [day, setDay] = useState(1);
  const [result, setResult] = useState<TryoutImportParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (day > dayCount) setDay(1);
  }, [day, dayCount]);

  const previewRows = useMemo(
    () =>
      result ? buildTryoutImportPreviewRows(result.rows, players) : [],
    [result, players]
  );

  const newCount = previewRows.filter((r) => r.isNew).length;
  const presentCount = previewRows.filter((r) => r.willMarkPresent).length;
  const matchedCount = previewRows.filter((r) => r.matchedPlayerId).length;

  async function pickFile() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
          'text/comma-separated-values',
          'application/csv',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      const response = await fetch(asset.uri);
      const buffer = await response.arrayBuffer();
      setError(null);
      setResult(parseTryoutResultsBuffer(buffer));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read file');
    }
  }

  async function confirmImport() {
    if (previewRows.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const summary = await importTryoutResults({ day, rows: previewRows });
      onImported(summary);
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const showImportBar = previewRows.length > 0;
  const dayOptions = Array.from({ length: dayCount }, (_, i) => i + 1);

  return (
    <View style={styles.wrap}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.help}>
          Upload a `.xlsx` or `.csv` with headers like{' '}
          <Text style={styles.mono}>last_name</Text>,{' '}
          <Text style={styles.mono}>first_name</Text>,{' '}
          <Text style={styles.mono}>time</Text>. Optional:{' '}
          <Text style={styles.mono}>number</Text>,{' '}
          <Text style={styles.mono}>class</Text>. Other columns are ignored.
          Sheet rows are marked present for the selected day; time is saved as
          their time trial.
        </Text>

        <Text style={styles.sectionLabel}>Tryout day</Text>
        <View style={styles.dayRow}>
          {dayOptions.map((d) => {
            const active = day === d;
            return (
              <Pressable
                key={d}
                style={[styles.dayChip, active && styles.dayChipActive]}
                onPress={() => setDay(d)}
              >
                <Text
                  style={[styles.dayText, active && styles.dayTextActive]}
                >
                  Day {d}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.primaryBtn} onPress={pickFile}>
            <Text style={styles.primaryText}>Choose spreadsheet</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {result ? (
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>Preview · Day {day}</Text>
            <Text style={styles.meta}>
              {presentCount} present · {matchedCount} matched · {newCount} new
              · {result.errors.length} row error
              {result.errors.length === 1 ? '' : 's'}
            </Text>

            {result.errors.length > 0 ? (
              <View style={styles.errorBox}>
                {result.errors.slice(0, 8).map((err) => (
                  <Text
                    key={`${err.row}-${err.message}`}
                    style={styles.errorItem}
                  >
                    {err.row > 0 ? `Row ${err.row}: ` : ''}
                    {err.message}
                  </Text>
                ))}
                {result.errors.length > 8 ? (
                  <Text style={styles.errorItem}>
                    …and {result.errors.length - 8} more
                  </Text>
                ) : null}
              </View>
            ) : null}

            {previewRows.length > 0 ? (
              <View style={styles.table}>
                <View style={[styles.row, styles.headerRow]}>
                  <Text
                    style={[styles.cell, styles.cellNum, styles.headerCell]}
                  >
                    #
                  </Text>
                  <Text
                    style={[styles.cell, styles.cellLast, styles.headerCell]}
                  >
                    Last
                  </Text>
                  <Text
                    style={[styles.cell, styles.cellFirst, styles.headerCell]}
                  >
                    First
                  </Text>
                  <Text
                    style={[styles.cell, styles.cellTime, styles.headerCell]}
                  >
                    Time
                  </Text>
                  <Text
                    style={[styles.cell, styles.cellStatus, styles.headerCell]}
                  >
                    Status
                  </Text>
                </View>
                {previewRows.map((row, idx) => (
                  <View
                    key={`${row.first_name}-${row.last_name}-${idx}`}
                    style={[
                      styles.row,
                      !row.willMarkPresent && styles.rowMuted,
                    ]}
                  >
                    <Text style={[styles.cell, styles.cellNum]}>
                      {row.tryout_number != null
                        ? String(row.tryout_number)
                        : '—'}
                    </Text>
                    <Text style={[styles.cell, styles.cellLast]}>
                      {row.last_name}
                    </Text>
                    <Text style={[styles.cell, styles.cellFirst]}>
                      {row.first_name}
                    </Text>
                    <Text style={[styles.cell, styles.cellTime]}>
                      {row.time_invalid
                        ? 'bad'
                        : formatTimeTrialPreview(row.time_trial_ms)}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.cellStatus,
                        row.willMarkPresent
                          ? styles.statusPresent
                          : row.isNew
                            ? styles.statusNew
                            : styles.statusMatched,
                      ]}
                    >
                      {row.willMarkPresent
                        ? row.isNew
                          ? 'New · In'
                          : 'In'
                        : row.isNew
                          ? 'New'
                          : 'Skip'}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {showImportBar ? (
        <View style={styles.footer}>
          <Pressable
            style={[styles.importBtn, importing && styles.disabled]}
            disabled={importing}
            onPress={confirmImport}
          >
            <Text style={styles.primaryText}>
              {importing
                ? 'Importing…'
                : `Import Day ${day} results (${presentCount} present)`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'stretch',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: 14,
    paddingBottom: 24,
  },
  help: {
    color: colors.muted,
    lineHeight: 20,
  },
  mono: {
    fontFamily: Platform.select({ web: 'monospace', default: undefined }),
    color: colors.text,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
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
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dayChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  dayTextActive: {
    color: colors.primaryText,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
  },
  primaryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  primaryText: {
    color: colors.primaryText,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.55,
  },
  error: {
    color: colors.danger,
  },
  preview: {
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    backgroundColor: colors.surface,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    color: colors.muted,
  },
  errorBox: {
    backgroundColor: colors.dangerBg,
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  errorItem: {
    color: colors.danger,
    fontSize: 13,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowMuted: {
    backgroundColor: '#f3f4f6',
  },
  headerRow: {
    backgroundColor: '#e8eef3',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cell: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    fontSize: 13,
    color: colors.text,
  },
  cellNum: {
    width: 36,
    textAlign: 'center',
    fontWeight: '700',
  },
  cellFirst: {
    flex: 1,
  },
  cellLast: {
    flex: 1.1,
  },
  cellTime: {
    width: 48,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  cellStatus: {
    width: 64,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
  },
  statusPresent: {
    color: colors.primary,
  },
  statusNew: {
    color: colors.primary,
  },
  statusMatched: {
    color: colors.muted,
  },
  headerCell: {
    fontWeight: '700',
    color: colors.muted,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 8 : 4,
    backgroundColor: colors.bg,
  },
  importBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
  },
});
