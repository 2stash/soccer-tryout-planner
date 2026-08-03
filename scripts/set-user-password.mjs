/**
 * Set a user's password via the Supabase Admin API (bypasses reset-email rate limits).
 *
 * Prerequisites:
 *   - EXPO_PUBLIC_SUPABASE_URL in .env
 *   - SUPABASE_SERVICE_ROLE_KEY in .env or environment
 *     (Supabase → Project Settings → API → service_role)
 *
 * Usage:
 *   node scripts/set-user-password.mjs you@email.com "NewPassword123"
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnv() {
  const path = join(root, '.env');
  if (!existsSync(path)) return {};
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

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.argv[3];

  if (!email || !password) {
    console.error(
      'Usage: node scripts/set-user-password.mjs you@email.com "NewPassword123"'
    );
    process.exit(1);
  }

  if (password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }

  const fileEnv = loadEnv();
  const url =
    process.env.EXPO_PUBLIC_SUPABASE_URL || fileEnv.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL in .env');
    process.exit(1);
  }
  if (!serviceKey) {
    console.error(
      'Missing SUPABASE_SERVICE_ROLE_KEY.\n' +
        'Add it to .env from Supabase → Project Settings → API → service_role\n' +
        '(or set it in the shell for one run).'
    );
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let page = 1;
  let user = null;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    user = data.users.find((u) => u.email?.toLowerCase() === email) ?? null;
    if (user || data.users.length === 0) break;
    page += 1;
    if (page > 20) break;
  }

  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(
    user.id,
    { password }
  );
  if (updateError) throw updateError;

  console.log(`Password updated for ${email}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
