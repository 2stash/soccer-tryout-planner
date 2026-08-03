/**
 * Export current roster players to importable CSV files.
 * Usage: node scripts/export-players.mjs [rosterId]
 */
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnv() {
  const path = join(root, '.env');
  if (!existsSync(path)) throw new Error('Missing .env');
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

function formatPositions(positions) {
  if (!Array.isArray(positions) || positions.length === 0) return '';
  return positions.join(',');
}

async function main() {
  const env = loadEnv();
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('EXPO_PUBLIC_SUPABASE_URL / ANON_KEY missing');

  const args = process.argv.slice(2);
  const accessToken =
    process.env.SUPABASE_ACCESS_TOKEN ||
    env.SUPABASE_ACCESS_TOKEN ||
    args.find((a) => a.startsWith('--token='))?.slice('--token='.length);
  const rosterIdArg = args.find((a) => !a.startsWith('--'));

  const supabase = createClient(url, key, {
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rosters, error: rosterError } = await supabase
    .from('rosters')
    .select('id, name, created_at')
    .order('created_at', { ascending: false });
  if (rosterError) throw rosterError;
  if (!rosters?.length) {
    throw new Error(
      'No rosters found (need a signed-in session). Easiest: use Export full / Export names on the All Players tab. Or run with --token=ACCESS_TOKEN from your browser localStorage auth session.'
    );
  }

  const roster = rosterIdArg
    ? rosters.find((r) => r.id === rosterIdArg)
    : rosters[0];
  if (!roster) throw new Error(`Roster not found: ${rosterIdArg}`);

  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('*')
    .eq('roster_id', roster.id)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true });

  if (playersError) throw playersError;
  if (!players?.length) throw new Error('No players on this roster');

  const outDir = join(root, 'exports');
  mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = String(roster.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

  const fullRows = players.map((p) => ({
    first_name: p.first_name ?? '',
    last_name: p.last_name ?? '',
    school_year: p.school_year ?? '',
    positions: formatPositions(p.positions),
    position_rank: p.position_rank ?? '',
    team_rank: p.team_rank ?? '',
  }));

  const minimalRows = players.map((p) => ({
    first_name: p.first_name ?? '',
    last_name: p.last_name ?? '',
    school_year: p.school_year ?? '',
  }));

  const fullPath = join(outDir, `${safeName}-full-${stamp}.csv`);
  const minimalPath = join(outDir, `${safeName}-names-year-${stamp}.csv`);

  writeFileSync(
    fullPath,
    toCsv(
      [
        'first_name',
        'last_name',
        'school_year',
        'positions',
        'position_rank',
        'team_rank',
      ],
      fullRows
    ),
    'utf8'
  );

  writeFileSync(
    minimalPath,
    toCsv(['first_name', 'last_name', 'school_year'], minimalRows),
    'utf8'
  );

  // Reference backup (not for the Import UI): includes squad assignment.
  const backupPath = join(outDir, `${safeName}-backup-${stamp}.json`);
  writeFileSync(
    backupPath,
    JSON.stringify(
      {
        roster: { id: roster.id, name: roster.name },
        exported_at: new Date().toISOString(),
        players: players.map((p) => ({
          first_name: p.first_name,
          last_name: p.last_name,
          school_year: p.school_year,
          positions: p.positions,
          position_rank: p.position_rank,
          team_rank: p.team_rank,
          squad_team: p.squad_team,
        })),
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`Roster: ${roster.name} (${roster.id})`);
  console.log(`Players: ${players.length}`);
  console.log(`Full import CSV: ${fullPath}`);
  console.log(`Names+year CSV: ${minimalPath}`);
  console.log(`JSON backup (incl. squad_team): ${backupPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
