export type Profile = {
  id: string;
  display_name: string | null;
  created_at: string;
};

export type Roster = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
};

/** Membership roles on a tryout roster (one user may hold several). */
export type RosterRole =
  | 'admin'
  | 'varsity_coach'
  | 'jv_coach'
  | 'fr_soph_coach'
  | 'assistant';

export const ROSTER_ROLES: { id: RosterRole; label: string }[] = [
  { id: 'admin', label: 'Admin' },
  { id: 'varsity_coach', label: 'Varsity coach' },
  { id: 'jv_coach', label: 'JV coach' },
  { id: 'fr_soph_coach', label: 'Fr/Soph coach' },
  { id: 'assistant', label: 'Assistant' },
];

export const HEAD_COACH_ROLES: RosterRole[] = [
  'varsity_coach',
  'jv_coach',
  'fr_soph_coach',
];

export type RosterMember = {
  id: string;
  roster_id: string;
  user_id: string;
  role: RosterRole;
  created_at: string;
};

export type RosterMembership = {
  roster: Roster;
  roles: RosterRole[];
  /** True when current user is the roster owner (creator). */
  isOwner: boolean;
};

export type WorkspaceKind =
  | 'personal'
  | 'master_varsity'
  | 'master_jv'
  | 'master_fr_soph';

export type Workspace = {
  id: string;
  roster_id: string;
  kind: WorkspaceKind;
  user_id: string | null;
  created_at: string;
};

/** Playing squads (depth chart / rosters). */
export type SquadTeam = 'varsity' | 'jv' | 'fr_soph';

/** Non-playing assign pool (same ranking UX as Available). */
export type UnavailablePool = 'unavailable';

/** Player assignment: null = Available, unavailable pool, or a playing squad. */
export type PlayerAssignment = SquadTeam | UnavailablePool;

export const SQUAD_TEAMS: { id: SquadTeam; label: string }[] = [
  { id: 'varsity', label: 'Varsity' },
  { id: 'jv', label: 'JV' },
  { id: 'fr_soph', label: 'Fr/Soph' },
];

export const UNAVAILABLE_POOL: UnavailablePool = 'unavailable';

export function isSquadTeam(
  value: PlayerAssignment | null | undefined
): value is SquadTeam {
  return value === 'varsity' || value === 'jv' || value === 'fr_soph';
}

export type Player = {
  id: string;
  roster_id: string;
  first_name: string;
  last_name: string;
  school_year: string;
  /** Legacy display string; prefer `positions`. */
  position: string;
  /** Standard shirt numbers 1–11 (multi-select). */
  positions: number[];
  position_rank: number | null;
  team_rank: number | null;
  /** Starred in Available/Unavailable — locked to the top band of that pool. */
  available_pinned: boolean;
  squad_team: PlayerAssignment | null;
  created_at: string;
  updated_at: string;
};

export type PlayerInput = {
  first_name: string;
  last_name: string;
  school_year: string;
  positions: number[];
  position_rank: number | null;
  team_rank: number | null;
};

export const PLAYER_FIELD_LABELS: Record<keyof PlayerInput, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  school_year: 'School year',
  positions: 'Positions',
  position_rank: 'Position rank',
  team_rank: 'Team rank',
};

export const SPREADSHEET_HEADERS = [
  'first_name',
  'last_name',
  'school_year',
  'positions',
  'position_rank',
  'team_rank',
] as const;
