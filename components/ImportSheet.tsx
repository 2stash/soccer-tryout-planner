import { useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  extractTextFromImage,
  isSupported as isOcrSupported,
} from 'expo-text-extractor';
import {
  parseSpreadsheetBuffer,
  type ImportParseResult,
} from '@/lib/importSpreadsheet';
import {
  buildImportPreviewRows,
  mergeImportParseResults,
} from '@/lib/importPreview';
import { parseRosterPhotoText } from '@/lib/parseRosterPhoto';
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { useRosterData } from '@/lib/RosterDataContext';
import { bulkInsertPlayers } from '@/lib/players';
import { colors } from '@/constants/theme';

type Props = {
  rosterId: string;
  onImported: (count: number) => void;
};

// Show on iOS device builds; OCR module may report support only after native link.
const canScanPhoto = Platform.OS === 'ios';

function askTakeAnotherPhoto(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert('Add another photo?', 'Scan another page of the roster list.', [
      { text: 'Done', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Take another', onPress: () => resolve(true) },
    ]);
  });
}

export function ImportSheet({ rosterId, onImported }: Props) {
  const { activeWorkspaceId } = useActiveRole();
  const { players } = useRosterData();
  const [result, setResult] = useState<ImportParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<string | null>(null);

  const previewRows = result
    ? buildImportPreviewRows(result.rows, players)
    : [];
  const newRows = previewRows.filter((row) => !row.isDuplicate);
  const duplicateCount = previewRows.length - newRows.length;

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

  async function processPhotoUris(uris: string[]) {
    if (!isOcrSupported) {
      setError(
        'Photo scan needs a native iOS build (TestFlight). It is not available in Expo Go.'
      );
      return;
    }
    if (uris.length === 0) return;

    setScanning(true);
    setError(null);
    try {
      const parts: ImportParseResult[] = [];
      for (let i = 0; i < uris.length; i++) {
        setScanProgress(
          uris.length === 1
            ? 'Reading photo…'
            : `Reading photo ${i + 1} of ${uris.length}…`
        );
        const texts = await extractTextFromImage(uris[i]);
        parts.push(parseRosterPhotoText(texts));
      }
      const parsed = mergeImportParseResults(parts);
      setResult(parsed);
      if (parsed.rows.length === 0) {
        setError(
          parsed.errors[0]?.message ??
            'No players found in these photos. Try clearer shots of the name and class columns.'
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read photo');
      setResult(null);
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  }

  async function takePhotos() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Camera permission is required to photograph a roster list.');
      return;
    }

    const uris: string[] = [];
    while (true) {
      const picked = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
      });
      if (picked.canceled || !picked.assets?.[0]?.uri) break;
      uris.push(picked.assets[0].uri);
      const more = await askTakeAnotherPhoto();
      if (!more) break;
    }

    if (uris.length === 0) return;
    await processPhotoUris(uris);
  }

  async function choosePhotos() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library permission is required to import from a picture.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: 0,
    });
    if (picked.canceled || !picked.assets?.length) return;
    await processPhotoUris(picked.assets.map((a) => a.uri));
  }

  function openScanMenu() {
    if (scanning) return;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take photos', 'Choose from library'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) void takePhotos();
          if (buttonIndex === 2) void choosePhotos();
        }
      );
      return;
    }
    Alert.alert('Scan photo', 'Import players from roster pictures.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Take photos', onPress: () => void takePhotos() },
      { text: 'Choose from library', onPress: () => void choosePhotos() },
    ]);
  }

  async function confirmImport() {
    if (newRows.length === 0) return;
    if (!activeWorkspaceId) {
      setError('No active workspace for this role.');
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const inserted = await bulkInsertPlayers(
        rosterId,
        newRows.map(
          ({
            first_name,
            last_name,
            school_year,
            positions,
            position_rank,
            team_rank,
          }) => ({
            first_name,
            last_name,
            school_year,
            positions,
            position_rank,
            team_rank,
          })
        ),
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

  const showImportBar = previewRows.length > 0;
  const scanLabel = scanProgress ?? (scanning ? 'Reading photo…' : 'Scan photos');

  return (
    <View style={styles.wrap}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.help}>
          Upload a `.xlsx` or `.csv` with a header row. Required columns:{' '}
          <Text style={styles.mono}>first_name</Text>,{' '}
          <Text style={styles.mono}>last_name</Text>. Optional:{' '}
          <Text style={styles.mono}>school_year</Text>. Names already on this
          team are marked as duplicates and skipped on import.
        </Text>

        {canScanPhoto ? (
          <Text style={styles.help}>
            On iPhone you can photograph one or more pages of a printed{' '}
            <Text style={styles.mono}>Last, First</Text> + class list, then
            confirm the preview before importing.
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            style={[styles.primaryBtn, scanning && styles.disabled]}
            disabled={scanning}
            onPress={pickFile}
          >
            <Text style={styles.primaryText}>Choose spreadsheet</Text>
          </Pressable>
          {canScanPhoto ? (
            <Pressable
              style={[styles.secondaryBtn, scanning && styles.disabled]}
              disabled={scanning}
              onPress={openScanMenu}
            >
              <Text style={styles.secondaryText}>{scanLabel}</Text>
            </Pressable>
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {result ? (
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>Preview</Text>
            <Text style={styles.meta}>
              {newRows.length} new · {duplicateCount} duplicate
              {duplicateCount === 1 ? '' : 's'} · {result.errors.length} row
              error{result.errors.length === 1 ? '' : 's'}
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
                    style={[styles.cell, styles.cellFirst, styles.headerCell]}
                  >
                    First
                  </Text>
                  <Text
                    style={[styles.cell, styles.cellLast, styles.headerCell]}
                  >
                    Last
                  </Text>
                  <Text
                    style={[styles.cell, styles.cellYear, styles.headerCell]}
                  >
                    Year
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
                    style={[styles.row, row.isDuplicate && styles.rowDuplicate]}
                  >
                    <Text
                      style={[
                        styles.cell,
                        styles.cellFirst,
                        row.isDuplicate && styles.cellMuted,
                      ]}
                    >
                      {row.first_name}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.cellLast,
                        row.isDuplicate && styles.cellMuted,
                      ]}
                    >
                      {row.last_name}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.cellYear,
                        row.isDuplicate && styles.cellMuted,
                      ]}
                    >
                      {row.school_year || '—'}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.cellStatus,
                        row.isDuplicate ? styles.statusDup : styles.statusNew,
                      ]}
                    >
                      {row.isDuplicate ? 'Duplicate' : 'New'}
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
            style={[
              styles.importBtn,
              (importing || newRows.length === 0) && styles.disabled,
            ]}
            disabled={importing || newRows.length === 0}
            onPress={confirmImport}
          >
            <Text style={styles.primaryText}>
              {importing
                ? 'Importing…'
                : newRows.length === 0
                  ? 'No new players to import'
                  : `Import ${newRows.length} new player${
                      newRows.length === 1 ? '' : 's'
                    }`}
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
  secondaryBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  secondaryText: {
    color: colors.text,
    fontWeight: '700',
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
  rowDuplicate: {
    backgroundColor: '#f3f4f6',
  },
  headerRow: {
    backgroundColor: '#e8eef3',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cell: {
    paddingVertical: 8,
    paddingHorizontal: 6,
    fontSize: 14,
    color: colors.text,
  },
  cellMuted: {
    color: colors.muted,
  },
  cellFirst: {
    flex: 1.05,
  },
  cellLast: {
    flex: 1.15,
  },
  cellYear: {
    flex: 0.65,
  },
  cellStatus: {
    flex: 0.95,
    fontSize: 12,
    fontWeight: '700',
  },
  statusNew: {
    color: colors.primary,
  },
  statusDup: {
    color: colors.muted,
  },
  headerCell: {
    fontWeight: '700',
    color: colors.muted,
    fontSize: 12,
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
