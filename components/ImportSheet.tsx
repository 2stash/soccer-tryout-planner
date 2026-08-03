import { useState } from 'react';
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
  parseSpreadsheetBuffer,
  type ImportParseResult,
} from '@/lib/importSpreadsheet';
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { bulkInsertPlayers } from '@/lib/players';
import { formatPositionsShort } from '@/lib/positions';
import { colors } from '@/constants/theme';

type Props = {
  rosterId: string;
  onImported: (count: number) => void;
};

export function ImportSheet({ rosterId, onImported }: Props) {
  const { activeWorkspaceId } = useActiveRole();
  const [result, setResult] = useState<ImportParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

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
      setResult(parseSpreadsheetBuffer(buffer));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read file');
    }
  }

  async function confirmImport() {
    if (!result || result.rows.length === 0) return;
    if (!activeWorkspaceId) {
      setError('No active workspace for this role.');
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const inserted = await bulkInsertPlayers(
        rosterId,
        result.rows,
        activeWorkspaceId
      );
      onImported(inserted.length);
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.help}>
        Upload a `.xlsx` or `.csv` with a header row. Required columns:{' '}
        <Text style={styles.mono}>first_name</Text>,{' '}
        <Text style={styles.mono}>last_name</Text>. Optional:{' '}
        <Text style={styles.mono}>school_year</Text>,{' '}
        <Text style={styles.mono}>positions</Text> (e.g. <Text style={styles.mono}>9,10</Text> or{' '}
        <Text style={styles.mono}>ST,CAM</Text>),{' '}
        <Text style={styles.mono}>position_rank</Text>. Available order is set
        by class (Sr→Fr) then name after import.
      </Text>

      <Pressable style={styles.primaryBtn} onPress={pickFile}>
        <Text style={styles.primaryText}>Choose spreadsheet</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {result ? (
        <View style={styles.preview}>
          <Text style={styles.previewTitle}>Preview</Text>
          <Text style={styles.meta}>
            Headers found: {result.headersFound.join(', ') || '—'}
          </Text>
          <Text style={styles.meta}>
            Valid rows: {result.rows.length} · Row errors: {result.errors.length}
          </Text>

          {result.errors.length > 0 ? (
            <View style={styles.errorBox}>
              {result.errors.slice(0, 8).map((err) => (
                <Text key={`${err.row}-${err.message}`} style={styles.errorItem}>
                  Row {err.row}: {err.message}
                </Text>
              ))}
              {result.errors.length > 8 ? (
                <Text style={styles.errorItem}>
                  …and {result.errors.length - 8} more
                </Text>
              ) : null}
            </View>
          ) : null}

          {result.rows.length > 0 ? (
            <ScrollView horizontal style={styles.tableScroll}>
              <View>
                <View style={[styles.row, styles.headerRow]}>
                  {['First', 'Last', 'Year', 'Pos', 'Pos #', 'Team #'].map((h) => (
                    <Text key={h} style={[styles.cell, styles.headerCell]}>
                      {h}
                    </Text>
                  ))}
                </View>
                {result.rows.slice(0, 12).map((row, idx) => (
                  <View key={`${row.first_name}-${row.last_name}-${idx}`} style={styles.row}>
                    <Text style={styles.cell}>{row.first_name}</Text>
                    <Text style={styles.cell}>{row.last_name}</Text>
                    <Text style={styles.cell}>{row.school_year || '—'}</Text>
                    <Text style={styles.cell}>
                      {formatPositionsShort(row.positions) || '—'}
                    </Text>
                    <Text style={styles.cell}>{row.position_rank ?? '—'}</Text>
                    <Text style={styles.cell}>{row.team_rank ?? '—'}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : null}

          <Pressable
            style={[
              styles.primaryBtn,
              (importing || result.rows.length === 0) && styles.disabled,
            ]}
            disabled={importing || result.rows.length === 0}
            onPress={confirmImport}
          >
            <Text style={styles.primaryText}>
              {importing
                ? 'Importing…'
                : `Import ${result.rows.length} player${result.rows.length === 1 ? '' : 's'}`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 14,
    maxWidth: 720,
    width: '100%',
  },
  help: {
    color: colors.muted,
    lineHeight: 20,
  },
  mono: {
    fontFamily: Platform.select({ web: 'monospace', default: undefined }),
    color: colors.text,
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
  tableScroll: {
    maxHeight: 280,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerRow: {
    backgroundColor: '#e8eef3',
  },
  cell: {
    width: 100,
    paddingVertical: 8,
    paddingHorizontal: 6,
    fontSize: 13,
    color: colors.text,
  },
  headerCell: {
    fontWeight: '700',
    color: colors.muted,
    fontSize: 12,
    textTransform: 'uppercase',
  },
});
