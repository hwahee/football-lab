/**
 * The playbook: formations, routes and defensive assignments, plus the
 * alignment rules that keep hand-tuned placements legal.
 *
 * A call is a play + options + per-player OFFSETS. The offsets are what the
 * "placement" UI edits; they are added to the play's formation and clamped
 * here, so the simulation only ever sees legal alignments.
 */
import {
  DEF_ROLES,
  HALF_WIDTH,
  OFF_ROLES,
  isSpecial,
  type Cushion,
  type DefPlayId,
  type DefRole,
  type DefenseCall,
  type OffRole,
  type OffenseCall,
  type ScrimmagePlayId,
  type Vec,
} from './types';

/** How far a player may be dragged away from the formation spot (yards). */
const MAX_SHIFT_X = 6;
const MAX_SHIFT_Y = 4;

type RouteId = 'slant' | 'curl' | 'dig' | 'go' | 'post' | 'block';
type BackJob = 'dive' | 'sweep' | 'flat' | 'block' | 'leak' | 'swing';

export interface OffPlayDef {
  formation: 'iform' | 'gun';
  kind: 'run' | 'pass';
  /** Receiver routes, left then right (swapped when the play is flipped). */
  routes: readonly [RouteId, RouteId];
  back: BackJob;
  /** Seconds until the quarterback is set and starts reading. */
  dropTime: number;
  /** Yards behind the line the quarterback sets up at. */
  dropDepth: number;
  /** Seconds until the hand-off (runs) or the end of the fake (play action). */
  meshTime: number;
}

export const OFF_PLAY_DEFS: Record<ScrimmagePlayId, OffPlayDef> = {
  insideRun: { formation: 'iform', kind: 'run', routes: ['block', 'block'], back: 'dive', dropTime: 0, dropDepth: 2.5, meshTime: 0.55 }, // prettier-ignore
  outsideRun: { formation: 'iform', kind: 'run', routes: ['block', 'block'], back: 'sweep', dropTime: 0, dropDepth: 2.5, meshTime: 0.45 }, // prettier-ignore
  quickSlant: { formation: 'gun', kind: 'pass', routes: ['slant', 'slant'], back: 'flat', dropTime: 0.9, dropDepth: 6, meshTime: 0 }, // prettier-ignore
  curlFlat: { formation: 'gun', kind: 'pass', routes: ['curl', 'dig'], back: 'flat', dropTime: 1.5, dropDepth: 7, meshTime: 0 }, // prettier-ignore
  deepShot: { formation: 'gun', kind: 'pass', routes: ['go', 'post'], back: 'block', dropTime: 2.0, dropDepth: 8, meshTime: 0 }, // prettier-ignore
  playAction: { formation: 'iform', kind: 'pass', routes: ['post', 'go'], back: 'leak', dropTime: 1.9, dropDepth: 7, meshTime: 0.7 }, // prettier-ignore
  screen: { formation: 'gun', kind: 'pass', routes: ['go', 'go'], back: 'swing', dropTime: 1.1, dropDepth: 8, meshTime: 0 }, // prettier-ignore
};

/** Waypoints relative to the receiver's spot; +x is TOWARD the middle of the field. */
const ROUTES: Record<Exclude<RouteId, 'block'>, { points: readonly Vec[]; settle: boolean }> = {
  slant: { points: [{ x: 0, y: 2 }, { x: 9, y: 9 }], settle: false }, // prettier-ignore
  curl: { points: [{ x: 0, y: 11 }, { x: 1.5, y: 9 }], settle: true }, // prettier-ignore
  dig: { points: [{ x: 0, y: 10 }, { x: 13, y: 10.5 }], settle: false }, // prettier-ignore
  go: { points: [{ x: 0, y: 45 }], settle: false },
  post: { points: [{ x: 0, y: 12 }, { x: 10, y: 32 }], settle: false }, // prettier-ignore
};

const CUSHION_DEPTH: Record<Cushion, number> = { tight: 1.5, normal: 5, soft: 8 };
const ZONE_SHIFT: Record<Cushion, number> = { tight: -1.5, normal: 0, soft: 2 };

export type DefJobSpec =
  | { job: 'rush' }
  | { job: 'man'; target: 'receiver' | 'back' }
  | { job: 'zone'; radius: number; deep: boolean }
  | { job: 'fill' };

export const DEF_JOBS: Record<DefPlayId, Record<DefRole, DefJobSpec>> = {
  man: {
    DE1: { job: 'rush' },
    NT: { job: 'rush' },
    DE2: { job: 'rush' },
    LB: { job: 'man', target: 'back' },
    CB1: { job: 'man', target: 'receiver' },
    CB2: { job: 'man', target: 'receiver' },
    FS: { job: 'zone', radius: 13, deep: true },
  },
  zone: {
    DE1: { job: 'rush' },
    NT: { job: 'rush' },
    DE2: { job: 'rush' },
    LB: { job: 'zone', radius: 7, deep: false },
    CB1: { job: 'zone', radius: 7.5, deep: false },
    CB2: { job: 'zone', radius: 7.5, deep: false },
    FS: { job: 'zone', radius: 16, deep: true },
  },
  blitz: {
    DE1: { job: 'rush' },
    NT: { job: 'rush' },
    DE2: { job: 'rush' },
    LB: { job: 'rush' },
    CB1: { job: 'man', target: 'receiver' },
    CB2: { job: 'man', target: 'receiver' },
    FS: { job: 'man', target: 'back' },
  },
  runStop: {
    DE1: { job: 'rush' },
    NT: { job: 'rush' },
    DE2: { job: 'rush' },
    LB: { job: 'fill' },
    CB1: { job: 'man', target: 'receiver' },
    CB2: { job: 'man', target: 'receiver' },
    FS: { job: 'fill' },
  },
  prevent: {
    DE1: { job: 'rush' },
    NT: { job: 'rush' },
    DE2: { job: 'rush' },
    LB: { job: 'zone', radius: 8, deep: false },
    CB1: { job: 'zone', radius: 11, deep: true },
    CB2: { job: 'zone', radius: 11, deep: true },
    FS: { job: 'zone', radius: 14, deep: true },
  },
};

function offenseFormation(call: OffenseCall): Record<OffRole, Vec> {
  const side = call.flip ? -1 : 1;
  const gun = !isSpecial(call.play) && OFF_PLAY_DEFS[call.play].formation === 'gun';
  if (isSpecial(call.play)) {
    // Kick formation: tight line, kicker deep.
    return {
      C: { x: 0, y: -0.6 },
      LG: { x: -2.3, y: -0.6 },
      RG: { x: 2.3, y: -0.6 },
      WR1: { x: -4.6, y: -0.6 },
      WR2: { x: 4.6, y: -0.6 },
      RB: { x: 2.5, y: -3 },
      QB: { x: 0, y: call.play === 'punt' ? -12 : -7 },
    };
  }
  return {
    C: { x: 0, y: -0.6 },
    LG: { x: -2.3, y: -0.6 },
    RG: { x: 2.3, y: -0.6 },
    WR1: { x: -14, y: -0.6 },
    WR2: { x: 14, y: -0.6 },
    QB: { x: 0, y: gun ? -5 : -1.6 },
    RB: gun ? { x: 2.6 * side, y: -5 } : { x: 0, y: -6 },
  };
}

function defenseFormation(play: DefPlayId, cushion: Cushion): Record<DefRole, Vec> {
  const c = CUSHION_DEPTH[cushion];
  const z = ZONE_SHIFT[cushion];
  const line = { DE1: { x: -3.6, y: 1 }, NT: { x: 0, y: 1 }, DE2: { x: 3.6, y: 1 } };
  switch (play) {
    case 'man':
      return { ...line, LB: { x: 0, y: 4.5 }, CB1: { x: -14, y: c }, CB2: { x: 14, y: c }, FS: { x: 0, y: 13 } }; // prettier-ignore
    case 'zone':
      return { ...line, LB: { x: 0, y: 5 }, CB1: { x: -11, y: 6 + z }, CB2: { x: 11, y: 6 + z }, FS: { x: 0, y: 14 } }; // prettier-ignore
    case 'blitz':
      return { ...line, LB: { x: 1.5, y: 2.5 }, CB1: { x: -14, y: c }, CB2: { x: 14, y: c }, FS: { x: 0, y: 9 } }; // prettier-ignore
    case 'runStop':
      return { ...line, LB: { x: -1.6, y: 2.6 }, CB1: { x: -14, y: c }, CB2: { x: 14, y: c }, FS: { x: 2.4, y: 4.5 } }; // prettier-ignore
    case 'prevent':
      return { ...line, LB: { x: 0, y: 8 }, CB1: { x: -11, y: 15 + z }, CB2: { x: 11, y: 15 + z }, FS: { x: 0, y: 22 } }; // prettier-ignore
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** The center snaps the ball, so it cannot be moved. */
export function isMovable(role: OffRole | DefRole): boolean {
  return role !== 'C';
}

function place(base: Vec, offset: Vec | undefined, los: number, side: 'off' | 'def'): Vec {
  const dx = clamp(offset?.x ?? 0, -MAX_SHIFT_X, MAX_SHIFT_X);
  const dy = clamp(offset?.y ?? 0, -MAX_SHIFT_Y, MAX_SHIFT_Y);
  const x = clamp(base.x + dx, -(HALF_WIDTH - 1), HALF_WIDTH - 1);
  // Nobody may line up across the line of scrimmage or outside the field.
  const y =
    side === 'off'
      ? clamp(los + base.y + dy, -9, los - 0.6)
      : clamp(los + base.y + dy, los + 1, 109);
  return { x, y };
}

/** Where every offensive player lines up (absolute, offense frame). */
export function offenseAlignment(call: OffenseCall, los: number): Record<OffRole, Vec> {
  const formation = offenseFormation(call);
  const out = {} as Record<OffRole, Vec>;
  for (const role of OFF_ROLES) {
    out[role] = place(
      formation[role],
      isMovable(role) ? call.offsets[role] : undefined,
      los,
      'off',
    );
  }
  return out;
}

/** Where every defender lines up (absolute, offense frame). */
export function defenseAlignment(call: DefenseCall, los: number): Record<DefRole, Vec> {
  const formation = defenseFormation(call.play, call.cushion);
  const out = {} as Record<DefRole, Vec>;
  for (const role of DEF_ROLES) out[role] = place(formation[role], call.offsets[role], los, 'def');
  return out;
}

/**
 * Moves one player to `target` and returns the offset that actually applies —
 * i.e. after clamping, so a drag that hits a limit does not keep accumulating.
 */
export function offsetToward(
  side: 'off' | 'def',
  call: OffenseCall | DefenseCall,
  role: OffRole | DefRole,
  target: Vec,
  los: number,
): Vec {
  const base =
    side === 'off'
      ? offenseFormation(call as OffenseCall)[role as OffRole]
      : defenseFormation((call as DefenseCall).play, (call as DefenseCall).cushion)[
          role as DefRole
        ];
  const placed = place(base, { x: target.x - base.x, y: target.y - los - base.y }, los, side);
  return { x: placed.x - base.x, y: placed.y - los - base.y };
}

export const DEFAULT_OFFENSE: OffenseCall = { play: 'insideRun', flip: false, risk: 'balanced', offsets: {} }; // prettier-ignore
export const DEFAULT_DEFENSE: DefenseCall = { play: 'man', cushion: 'normal', offsets: {} };

export interface RoutePlan {
  /** Absolute waypoints, starting at the player's spot. */
  points: Vec[];
  /** Stop at the last point instead of running on. */
  settle: boolean;
}

/** The pass route a receiver runs from `start`, or null when he blocks. */
export function receiverRoute(
  call: OffenseCall,
  role: 'WR1' | 'WR2',
  start: Vec,
): RoutePlan | null {
  if (isSpecial(call.play)) return null;
  const def = OFF_PLAY_DEFS[call.play];
  const [left, right] = call.flip ? [def.routes[1], def.routes[0]] : def.routes;
  const id = role === 'WR1' ? left : right;
  if (id === 'block') return null;
  const inside = start.x <= 0 ? 1 : -1;
  const route = ROUTES[id];
  return {
    points: [
      start,
      ...route.points.map((p) => ({
        x: clamp(start.x + p.x * inside, -(HALF_WIDTH - 1.5), HALF_WIDTH - 1.5),
        y: Math.min(108, start.y + p.y),
      })),
    ],
    settle: route.settle,
  };
}

/** The running back's path: a pass route, a run track, or null when he pass-blocks. */
export function backPath(call: OffenseCall, start: Vec, los: number): RoutePlan | null {
  if (isSpecial(call.play)) return null;
  const side = call.flip ? -1 : 1;
  const top = (y: number) => Math.min(108, y);
  const wide = (x: number) => clamp(x, -(HALF_WIDTH - 1.5), HALF_WIDTH - 1.5);
  switch (OFF_PLAY_DEFS[call.play].back) {
    case 'dive':
      return { points: [start, { x: 0.9 * side, y: los - 1.5 }, { x: 1.2 * side, y: top(los + 3) }], settle: false }; // prettier-ignore
    case 'sweep':
      return { points: [start, { x: wide(9 * side), y: los - 3.5 }, { x: wide(13 * side), y: top(los + 2) }], settle: false }; // prettier-ignore
    case 'flat':
      return { points: [start, { x: wide(start.x + 6 * side), y: los + 0.5 }, { x: wide(start.x + 10 * side), y: top(los + 5) }], settle: false }; // prettier-ignore
    case 'leak':
      return { points: [start, { x: 1.5 * side, y: los - 2.5 }, { x: wide(7 * side), y: top(los + 3) }, { x: wide(9 * side), y: top(los + 9) }], settle: false }; // prettier-ignore
    case 'swing':
      return { points: [start, { x: wide(start.x + 6.5 * side), y: los - 3 }], settle: true };
    case 'block':
      return null;
  }
}

/** Receivers paired with corners left-to-right, so shuffled alignments still match up. */
export function manMatchups(
  offense: Record<OffRole, Vec>,
  defense: Record<DefRole, Vec>,
): Record<'CB1' | 'CB2', 'WR1' | 'WR2'> {
  const leftWr = offense.WR1.x <= offense.WR2.x ? 'WR1' : 'WR2';
  const rightWr = leftWr === 'WR1' ? 'WR2' : 'WR1';
  return defense.CB1.x <= defense.CB2.x
    ? { CB1: leftWr, CB2: rightWr }
    : { CB1: rightWr, CB2: leftWr };
}
