# Soccer Tryout Planner

Web-first Expo (React Native) app for soccer tryout and team planning. Players sync through Supabase so web windows and mobile clients stay up to date.

## Features (v1)

- Email/password auth (Supabase)
- **Dashboard** to create teams / tryouts
- **All Players** — inline edit, import, delete
- **Depth Chart** — pick a position (1–11), filter All/Varsity/JV/Fr-Soph; reorder middle list (top = starter, below = subs) per squad × position; right panel shows XI starters then an ordered Subs/bench list
- **Assign Squads** — put players on Varsity, JV, or Fr/Soph
- **Squad Planner** — 4-3-3 pitch board (GK→ST) auto-filled from player positions; multi-position players appear in multiple slots; players with no positions listed separately
- Live sync via Supabase Realtime

Player fields: first name, last name, school year, positions (1–11 multi-select), position rank, team rank, squad team.

Standard positions: 1 GK, 2 RB, 3 LB, 4 CB, 5 CB, 6 CDM, 7 RW, 8 CM, 9 ST, 10 CAM, 11 LW.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com)
2. Open the SQL Editor and run:
   - [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql)
   - [`supabase/migrations/002_squad_team.sql`](supabase/migrations/002_squad_team.sql)
   - [`supabase/migrations/003_player_positions.sql`](supabase/migrations/003_player_positions.sql)
   - [`supabase/migrations/004_formation_assignments.sql`](supabase/migrations/004_formation_assignments.sql)
   - [`supabase/migrations/005_depth_chart.sql`](supabase/migrations/005_depth_chart.sql)
   - [`supabase/migrations/006_sub_order.sql`](supabase/migrations/006_sub_order.sql)
3. Copy the project URL and anon key from **Project Settings → API**

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

### 4. Run (web first)

```bash
npm run web
```

Then open the printed localhost URL. Sign up, create a roster, add or import players.

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
