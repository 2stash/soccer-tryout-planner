import type { PositionNumber } from '@/lib/positions';
import { getPosition } from '@/lib/positions';

/** A placeable card on the pitch (left = GK, right = ST). */
export type FormationSlot = {
  number: PositionNumber;
  /** 0–1 from left (goal) to right (attack) */
  x: number;
  /** 0–1 from top (left side of field) to bottom (right side of field) */
  y: number;
};

/**
 * 4-3-3 wide, attacking left → right.
 * Top of screen = left flank; bottom = right flank.
 * Two CB cards (4 and 5): one starter each, then subs split between them.
 */
export const FORMATION_433: FormationSlot[] = [
  { number: 1, x: 0.07, y: 0.5 },
  { number: 3, x: 0.26, y: 0.12 },
  { number: 4, x: 0.26, y: 0.38 },
  { number: 5, x: 0.26, y: 0.62 },
  { number: 2, x: 0.26, y: 0.88 },
  { number: 6, x: 0.46, y: 0.5 },
  { number: 8, x: 0.62, y: 0.32 },
  { number: 10, x: 0.62, y: 0.68 },
  { number: 11, x: 0.84, y: 0.12 },
  { number: 9, x: 0.84, y: 0.5 },
  { number: 7, x: 0.84, y: 0.88 },
];

/**
 * 4-4-2 flat, vertical pitch (attack at top, GK at bottom).
 * x = left→right across the field; y = top→bottom.
 */
export const FORMATION_442_VERTICAL: FormationSlot[] = [
  { number: 9, x: 0.34, y: 0.1 },
  { number: 10, x: 0.66, y: 0.1 },
  { number: 11, x: 0.14, y: 0.36 },
  { number: 8, x: 0.38, y: 0.36 },
  { number: 6, x: 0.62, y: 0.36 },
  { number: 7, x: 0.86, y: 0.36 },
  { number: 3, x: 0.14, y: 0.62 },
  { number: 4, x: 0.38, y: 0.62 },
  { number: 5, x: 0.62, y: 0.62 },
  { number: 2, x: 0.86, y: 0.62 },
  { number: 1, x: 0.5, y: 0.88 },
];


export function slotTitle(number: PositionNumber): string {
  const pos = getPosition(number);
  if (!pos) return String(number);
  return pos.abbr;
}

export function slotSubtitle(number: PositionNumber): string {
  return getPosition(number)?.name ?? '';
}

export type FormationAssignment = {
  id: string;
  roster_id: string;
  squad_team: 'varsity' | 'jv' | 'fr_soph';
  slot_number: number;
  player_id: string;
  depth_order: number;
  created_at: string;
};
