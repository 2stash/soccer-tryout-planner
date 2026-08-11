import { Alert, Platform, Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Player, PlayerAssignment } from '@/lib/types';
import { SQUAD_TEAMS, UNAVAILABLE_POOL } from '@/lib/types';

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(
  headers: string[],
  rows: Record<string, string | number | null | undefined>[]
) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function slug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'roster'
  );
}

function sortByLastFirst(players: Player[]): Player[] {
  return [...players].sort((a, b) =>
    `${a.last_name} ${a.first_name}`.localeCompare(
      `${b.last_name} ${b.first_name}`,
      undefined,
      { sensitivity: 'base' }
    )
  );
}

/** Human label for export: Available / Unavailable / Varsity / JV / Fr/Soph. */
export function assignedTeamLabel(
  squadTeam: PlayerAssignment | null | undefined
): string {
  if (squadTeam == null) return 'Available';
  if (squadTeam === UNAVAILABLE_POOL) return 'Unavailable';
  return SQUAD_TEAMS.find((t) => t.id === squadTeam)?.label ?? String(squadTeam);
}

function downloadTextFileWeb(filename: string, contents: string) {
  if (typeof document === 'undefined') {
    throw new Error('CSV download is not available in this environment.');
  }
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function shareTextFileNative(filename: string, contents: string) {
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(contents);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      dialogTitle: filename,
      UTI: 'public.comma-separated-values-text',
    });
    return;
  }

  await Share.share({
    title: filename,
    message: contents,
  });
}

async function saveOrShareCsv(filename: string, contents: string) {
  if (Platform.OS === 'web') {
    downloadTextFileWeb(filename, contents);
    return;
  }
  await shareTextFileNative(filename, contents);
}

function alertExportError(e: unknown) {
  Alert.alert(
    'Export failed',
    e instanceof Error ? e.message : 'Could not export CSV.'
  );
}

/** Full roster export: last name, first name, year, assigned team. */
export function buildFullPlayersCsv(players: Player[]): string {
  const headers = ['last_name', 'first_name', 'year', 'assigned_team'];
  const rows = sortByLastFirst(players).map((p) => ({
    last_name: p.last_name ?? '',
    first_name: p.first_name ?? '',
    year: p.school_year ?? '',
    assigned_team: assignedTeamLabel(p.squad_team),
  }));
  return toCsv(headers, rows);
}

/** Minimal export: names + school year only. */
export function buildNamesYearCsv(players: Player[]): string {
  const headers = ['first_name', 'last_name', 'school_year'];
  const rows = sortByLastFirst(players).map((p) => ({
    first_name: p.first_name ?? '',
    last_name: p.last_name ?? '',
    school_year: p.school_year ?? '',
  }));
  return toCsv(headers, rows);
}

export async function downloadFullPlayersCsv(
  players: Player[],
  rosterName: string
): Promise<void> {
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    await saveOrShareCsv(
      `${slug(rosterName)}-full-${stamp}.csv`,
      buildFullPlayersCsv(players)
    );
  } catch (e) {
    alertExportError(e);
  }
}

export async function downloadNamesYearCsv(
  players: Player[],
  rosterName: string
): Promise<void> {
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    await saveOrShareCsv(
      `${slug(rosterName)}-names-year-${stamp}.csv`,
      buildNamesYearCsv(players)
    );
  } catch (e) {
    alertExportError(e);
  }
}
