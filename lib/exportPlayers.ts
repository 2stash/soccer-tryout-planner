import type { Player } from '@/lib/types';
import { Platform } from 'react-native';

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: Record<string, string | number | null | undefined>[]) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function downloadTextFile(filename: string, contents: string, mime = 'text/csv;charset=utf-8') {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    throw new Error('CSV download is available on web.');
  }
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'roster';
}

/** Full importable player fields (matches Import spreadsheet headers). */
export function buildFullPlayersCsv(players: Player[]): string {
  const headers = [
    'first_name',
    'last_name',
    'school_year',
    'positions',
    'position_rank',
    'team_rank',
  ];
  const rows = [...players]
    .sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(
        `${b.last_name} ${b.first_name}`,
        undefined,
        { sensitivity: 'base' }
      )
    )
    .map((p) => ({
      first_name: p.first_name ?? '',
      last_name: p.last_name ?? '',
      school_year: p.school_year ?? '',
      positions: (p.positions ?? []).join(','),
      position_rank: p.position_rank ?? '',
      team_rank: p.team_rank ?? '',
    }));
  return toCsv(headers, rows);
}

/** Minimal import: names + school year only. */
export function buildNamesYearCsv(players: Player[]): string {
  const headers = ['first_name', 'last_name', 'school_year'];
  const rows = [...players]
    .sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(
        `${b.last_name} ${b.first_name}`,
        undefined,
        { sensitivity: 'base' }
      )
    )
    .map((p) => ({
      first_name: p.first_name ?? '',
      last_name: p.last_name ?? '',
      school_year: p.school_year ?? '',
    }));
  return toCsv(headers, rows);
}

export function downloadFullPlayersCsv(players: Player[], rosterName: string) {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(
    `${slug(rosterName)}-full-${stamp}.csv`,
    buildFullPlayersCsv(players)
  );
}

export function downloadNamesYearCsv(players: Player[], rosterName: string) {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(
    `${slug(rosterName)}-names-year-${stamp}.csv`,
    buildNamesYearCsv(players)
  );
}
