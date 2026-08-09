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
import { parseRosterPhotoText } from '@/lib/parseRosterPhoto';
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { bulkInsertPlayers } from '@/lib/players';
import { formatPositionsShort } from '@/lib/positions';
import { colors } from '@/constants/theme';

type Props = {
  rosterId: string;
  onImported: (count: number) => void;
};

// Show on iOS device builds; OCR module may report support only after native link.
const canScanPhoto = Platform.OS === 'ios';

export function ImportSheet({ rosterId, onImported }: Props) {
  const { activeWorkspaceId } = useActiveRole();
  const [result, setResult] = useState<ImportParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [scanning, setScanning] = useState(false);

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

  async function processPhotoUri(uri: string) {
    if (!isOcrSupported) {
      setError(
        'Photo scan needs a native iOS build (TestFlight). It is not available in Expo Go.'
      );
      return;
    }
    setScanning(true);
    setError(null);
    try {
      const texts = await extractTextFromImage(uri);
      const parsed = parseRosterPhotoText(texts);
      setResult(parsed);
      if (parsed.rows.length === 0) {
        setError(
          parsed.errors[0]?.message ??
            'No players found in this photo. Try a clearer shot of the name and class columns.'
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read photo');
      setResult(null);
    } finally {
      setScanning(false);
    }
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Camera permission is required to photograph a roster list.');
      return;
    }
    const picked = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    await processPhotoUri(picked.assets[0].uri);
  }

  async function choosePhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library permission is required to import from a picture.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    await processPhotoUri(picked.assets[0].uri);
  }

  function openScanMenu() {
    if (scanning) return;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take photo', 'Choose from library'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) void takePhoto();
          if (buttonIndex === 2) void choosePhoto();
        }
      );
      return;
    }
    Alert.alert('Scan photo', 'Import players from a roster picture.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Take photo', onPress: () => void takePhoto() },
      { text: 'Choose from library', onPress: () => void choosePhoto() },
    ]);
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
        <Text style={styles.mono}>positions</Text> (e.g.{' '}
        <Text style={styles.mono}>9,10</Text> or <Text style={styles.mono}>ST,CAM</Text>
        ), <Text style={styles.mono}>position_rank</Text>. Available order is set
        by class (Sr→Fr) then name after import.
      </Text>

      {canScanPhoto ? (
        <Text style={styles.help}>
          On iPhone you can also photograph a printed list with{' '}
          <Text style={styles.mono}>Last, First</Text> and class (
          <Text style={styles.mono}>FR/SO/JR/SR</Text>) columns, then confirm the
          preview before importing.
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
            <Text style={styles.secondaryText}>
              {scanning ? 'Reading photo…' : 'Scan photo'}
            </Text>
          </Pressable>
        ) : null}
      </View>

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
                {result.rows.slice(0, 40).map((row, idx) => (
                  <View
                    key={`${row.first_name}-${row.last_name}-${idx}`}
                    style={styles.row}
                  >
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
                {result.rows.length > 40 ? (
                  <Text style={styles.meta}>
                    …and {result.rows.length - 40} more in this import
                  </Text>
                ) : null}
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
