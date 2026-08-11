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
  /** True while Hold Tryouts is active (Tryout tab visible). */
  tryout_active: boolean;
  /** Configured tryout length 1–5; kept after End tryout. */
  tryout_day_count: number | null;
};

/** Per-day tryout bib number + attendance for one player. */
export type PlayerTryoutDay = {
  day: number;
  tryout_number: number | null;
  attended: boolean;
  /** Elapsed ms from Time Trial Start when Finish was tapped; null if unset. */
  time_trial_ms: number | null;
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

export type RosterInviteStatus = 'pending' | 'accepted' | 'revoked';

export type RosterInvite = {
  id: string;
  roster_id: string;
  email: string;
  role: RosterRole;
  invited_by: string;
  status: RosterInviteStatus;
  created_at: string;
  accepted_at: string | null;
  accepted_user_id: string | null;
};

/** Shared team workspace; legacy kinds kept for typing during migration. */
export type WorkspaceKind =
  | 'shared'
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

export const SQUAD_TEAMS: {
  id: SquadTeam;
  label: string;
  /** Compact UI (depth table Team column). */
  shortLabel: string;
}[] = [
  { id: 'varsity', label: 'Varsity', shortLabel: 'Var' },
  { id: 'jv', label: 'JV', shortLabel: 'JV' },
  { id: 'fr_soph', label: 'Fr/Soph', shortLabel: 'Fr/Soph' },
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
  /**
   * Available/Unavailable order from `player_assignments.team_rank`
   * (not a player-form field).
   */
  team_rank: number | null;
  /** Starred in Available/Unavailable — locked to the top band of that pool. */
  available_pinned: boolean;
  squad_team: PlayerAssignment | null;
  /** Per-day tryout numbers / attendance (empty when unused). */
  tryout_days: PlayerTryoutDay[];
  created_at: string;
  updated_at: string;
};

export type PlayerInput = {
  first_name: string;
  last_name: string;
  school_year: string;
  positions: number[];
};

export const PLAYER_FIELD_LABELS: Record<keyof PlayerInput, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  school_year: 'School year',
  positions: 'Positions',
};

export const SPREADSHEET_HEADERS = [
  'first_name',
  'last_name',
  'school_year',
  'positions',
] as const;
