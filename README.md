# Soccer Tryout Planner

Web-first Expo (React Native) app for soccer tryout and team planning. Players sync through Supabase so web windows and mobile clients stay up to date.

## Features (v1)

- Email/password auth (Supabase)
- **Dashboard** to create teams / tryouts; accept pending coach invites
- **Team** — Admin invites coaches by email + role (pending until they sign in and Accept); self-assign for testing
- **All Players** — inline edit, import, delete
- **Depth Chart** — pick a position (1–11), filter All/Varsity/JV/Fr-Soph; reorder middle list (top = starter, below = subs) per squad × position; right panel shows XI starters then an ordered Subs/bench list
- **Assign Squads** — put players on Varsity, JV, or Fr/Soph
- **Squad Planner** — 4-3-3 pitch board (GK→ST) auto-filled from player positions; multi-position players appear in multiple slots; players with no positions listed separately
- Live sync via Supabase Realtime
- Offline edits with outbox sync
- Desktop web deploy via Vercel

Player fields: first name, last name, school year, positions (1–11 multi-select), position rank, team rank, squad team.

Standard positions: 1 GK, 2 RB, 3 LB, 4 CB, 5 CB, 6 CDM, 7 RW, 8 CM, 9 ST, 10 CAM, 11 LW.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com)
2. Open the SQL Editor and run every file in [`supabase/migrations/`](supabase/migrations/) in order (`001` … `013`)
3. Copy the project URL and anon key from **Project Settings → API**

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
# Optional locally; set on Vercel for production redirects
# EXPO_PUBLIC_APP_URL=http://localhost:8081
```

### 4. Run (web first)

```bash
npm run web
```

Then open the printed localhost URL. Sign up, create a roster, add or import players.

### 5. Deploy desktop (Vercel + GitHub)

The app exports a static web build (`expo.web.output: "static"`).

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repo
3. Framework preset: **Other** (or leave unset; [`vercel.json`](vercel.json) sets the build)
4. Add environment variables (Production):
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_APP_URL` = your Vercel URL, e.g. `https://your-app.vercel.app` (no trailing slash)
5. Deploy

Local export check:

```bash
npm run export:web
npx expo serve
```

**Supabase Auth URLs** (Dashboard → Authentication → URL configuration):

- Site URL: your Vercel production URL
- Redirect URLs: add `https://your-app.vercel.app/**` and `https://your-app.vercel.app/reset-password` (keep localhost for dev)

Do not commit `.env`. Never put the service role key in Vercel client env.

### Coach invites (no outbound email yet)

1. Admin opens a roster → **Team**
2. Enter coach email + role → **Create invite**
3. Coach signs up / signs in with **that same email**
4. Dashboard shows **Pending invites** → **Accept**

### Mobile later

Same codebase:

```bash
npm run android
# or on macOS:
npm run ios
```

## Spreadsheet import format

Header row required. Column names (aliases accepted):

| Column | Required |
|--------|----------|
| first_name | yes |
| last_name | yes |
| school_year | no |
| position | no |
| position_rank | no |
| team_rank | no |

Example CSV:

```csv
first_name,last_name,school_year,position,position_rank,team_rank
Alex,Rivera,10,Midfielder,2,5
Jordan,Lee,11,Forward,1,3
```

## Project layout

```
app/                 Expo Router screens
components/          PlayerForm, PlayerTable, ImportSheet
lib/                 Supabase client, auth, CRUD, import parser
supabase/migrations  Postgres schema + RLS
```
