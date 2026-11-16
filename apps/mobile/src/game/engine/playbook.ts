/**
 * The playbook: 11-man formations, routes and defensive assignments, plus the
 * alignment rules that keep hand-tuned placements legal.
 *
 * A call is a play + options + per-player OFFSETS. The offsets are what the
 * "placement" UI edits; they are added to the play's formation and clamped
 * here, so the simulation only ever sees legal alignments.
 *
 * Personnel is fixed — offense: QB, RB, three receivers, a tight end and five
 * linemen ("11 personnel"); defense: a 4-3 (four linemen, three linebackers,
 * two corners, two safeties). The tight end lines up on the STRONG side (the
 * side the play goes to) and the slot receiver on the other; the defense sets
 * its own strength to match, since a formation is visible before the snap.
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
  type Scrimmage,
  type ScrimmagePlayId,
  type Vec,
} from './types';

/** How far a player may be dragged away from the formation spot (yards). */
const MAX_SHIFT_X = 6;
const MAX_SHIFT_Y = 4;

type RouteId = 'slant' | 'curl' | 'dig' | 'go' | 'post' | 'out' | 'hitch' | 'drag' | 'seam';
type RouteCall = RouteId | 'block';
type BackJob = 'dive' | 'sweep' | 'flat' | 'block' | 'leak' | 'swing';
export type Receiver = 'WR1' | 'WR2' | 'WR3' | 'TE';

export interface OffPlayDef {
  formation: 'iform' | 'gun';
  kind: 'run' | 'pass';
  /** Outside receivers left then right (swapped when the play is flipped), slot, tight end. */
  routes: readonly [RouteCall, RouteCall, RouteCall, RouteCall];
  back: BackJob;
  /** Seconds until the quarterback is set and starts reading. */
  dropTime: number;
  /** Yards behind the line the quarterback sets up at. */
  dropDepth: number;
  /** Seconds until the hand-off (runs) or the end of the fake (play action). */
  meshTime: number;
}

export const OFF_PLAY_DEFS: Record<ScrimmagePlayId, OffPlayDef> = {
  insideRun: { formation: 'iform', kind: 'run', routes: ['block', 'block', 'block', 'block'], back: 'dive', dropTime: 0, dropDepth: 2.5, meshTime: 0.55 }, // prettier-ignore
  outsideRun: { formation: 'iform', kind: 'run', routes: ['block', 'block', 'block', 'block'], back: 'sweep', dropTime: 0, dropDepth: 2.5, meshTime: 0.45 }, // prettier-ignore
  quickSlant: { formation: 'gun', kind: 'pass', routes: ['slant', 'slant', 'out', 'hitch'], back: 'flat', dropTime: 0.9, dropDepth: 6, meshTime: 0 }, // prettier-ignore
  curlFlat: { formation: 'gun', kind: 'pass', routes: ['curl', 'dig', 'drag', 'hitch'], back: 'flat', dropTime: 1.5, dropDepth: 7, meshTime: 0 }, // prettier-ignore
  deepShot: { formation: 'gun', kind: 'pass', routes: ['go', 'post', 'seam', 'block'], back: 'block', dropTime: 2.0, dropDepth: 8, meshTime: 0 }, // prettier-ignore
  playAction: { formation: 'iform', kind: 'pass', routes: ['post', 'go', 'dig', 'block'], back: 'leak', dropTime: 1.9, dropDepth: 7, meshTime: 0.7 }, // prettier-ignore
  screen: { formation: 'gun', kind: 'pass', routes: ['go', 'go', 'seam', 'block'], back: 'swing', dropTime: 1.1, dropDepth: 8, meshTime: 0 }, // prettier-ignore
};

/** Waypoints relative to the receiver's spot; +x is TOWARD the ball. */
const ROUTES: Record<RouteId, { points: readonly Vec[]; settle: boolean }> = {
  slant: { points: [{ x: 0, y: 2 }, { x: 9, y: 9 }], settle: false }, // prettier-ignore
  curl: { points: [{ x: 0, y: 11 }, { x: 1.5, y: 9 }], settle: true }, // prettier-ignore
  dig: { points: [{ x: 0, y: 10 }, { x: 14, y: 10.5 }], settle: false }, // prettier-ignore
  go: { points: [{ x: 0, y: 45 }], settle: false },
  post: { points: [{ x: 0, y: 12 }, { x: 10, y: 32 }], settle: false }, // prettier-ignore
  out: { points: [{ x: 0, y: 5 }, { x: -7, y: 5.5 }], settle: true }, // prettier-ignore
  hitch: { points: [{ x: 0, y: 6 }, { x: 0.6, y: 5 }], settle: true }, // prettier-ignore
  drag: { points: [{ x: 0, y: 1.5 }, { x: 16, y: 3.5 }], settle: false }, // prettier-ignore
  seam: { points: [{ x: 1, y: 42 }], settle: false },
};

const CUSHION_DEPTH: Record<Cushion, number> = { tight: 1.5, normal: 5, soft: 8 };
const ZONE_SHIFT: Record<Cushion, number> = { tight: -1.5, normal: 0, soft: 2 };

export type DefJobSpec =
  | { job: 'rush' }
  /** `outside`: a corner takes whichever outside receiver is on his side. */
  | { job: 'man'; target: OffRole | 'outside' }
  | { job: 'zone'; radius: number; deep: boolean }
  /** Attack the line; once the play shows pass, drop into `onPass`. */
  | { job: 'fill'; onPass: OffRole | 'deep' };

const RUSH: DefJobSpec = { job: 'rush' };
const LINE = { DE1: RUSH, DT1: RUSH, DT2: RUSH, DE2: RUSH };
const CORNERS_MAN = {
  CB1: { job: 'man', target: 'outside' },
  CB2: { job: 'man', target: 'outside' },
} as const;

export const DEF_JOBS: Record<DefPlayId, Record<DefRole, DefJobSpec>> = {
  // Cover 1: man across the board, a robber underneath, one safety deep.
  man: {
    ...LINE,
    ...CORNERS_MAN,
    SLB: { job: 'man', target: 'TE' },
    MLB: { job: 'man', target: 'RB' },
    WLB: { job: 'zone', radius: 6, deep: false },
    SS: { job: 'man', target: 'WR3' },
    FS: { job: 'zone', radius: 14, deep: true },
  },
  // Cover 3: three deep, four under.
  zone: {
    ...LINE,
    CB1: { job: 'zone', radius: 9, deep: true },
    CB2: { job: 'zone', radius: 9, deep: true },
    FS: { job: 'zone', radius: 10, deep: true },
    SLB: { job: 'zone', radius: 6.5, deep: false },
    MLB: { job: 'zone', radius: 6, deep: false },
    WLB: { job: 'zone', radius: 6, deep: false },
    SS: { job: 'zone', radius: 6.5, deep: false },
  },
  // Cover 0: six rushers, everyone else alone on a man.
  blitz: {
    ...LINE,
    ...CORNERS_MAN,
    MLB: RUSH,
    WLB: RUSH,
    SLB: { job: 'man', target: 'TE' },
    SS: { job: 'man', target: 'WR3' },
    FS: { job: 'man', target: 'RB' },
  },
  // Eight in the box.
  runStop: {
    ...LINE,
    ...CORNERS_MAN,
    SLB: { job: 'fill', onPass: 'TE' },
    MLB: { job: 'fill', onPass: 'RB' },
    WLB: { job: 'fill', onPass: 'WR3' },
    SS: { job: 'fill', onPass: 'deep' },
    FS: { job: 'zone', radius: 13, deep: true },
  },
  // Four deep, three under, everything kept in front.
  prevent: {
    ...LINE,
    CB1: { job: 'zone', radius: 9, deep: true },
    CB2: { job: 'zone', radius: 9, deep: true },
    FS: { job: 'zone', radius: 11, deep: true },
    SS: { job: 'zone', radius: 11, deep: true },
    SLB: { job: 'zone', radius: 8, deep: false },
    MLB: { job: 'zone', radius: 8, deep: false },
    WLB: { job: 'zone', radius: 8, deep: false },
  },
};

/** Outside receivers and corners line up against the sideline, not the ball. */
const WIDE: ReadonlySet<string> = new Set(['WR1', 'WR2', 'CB1', 'CB2']);
const SPLIT = 21;

const O_LINE = {
  LT: { x: -4, y: -0.6 },
  LG: { x: -2, y: -0.6 },
  C: { x: 0, y: -0.6 },
  RG: { x: 2, y: -0.6 },
  RT: { x: 4, y: -0.6 },
};

function offenseFormation(call: OffenseCall): Record<OffRole, Vec> {
  const side = call.flip ? -1 : 1;
  const tightEnd = { x: side * 6, y: -0.6 };
  if (call.play === 'kneel') {
    // Victory formation.
    return {
      ...O_LINE,
      TE: tightEnd,
      WR3: { x: -side * 6, y: -0.6 },
      WR1: { x: -3, y: -2.6 },
      WR2: { x: 3, y: -2.6 },
      RB: { x: 0, y: -6 },
      QB: { x: 0, y: -1.6 },
    };
  }
  if (isSpecial(call.play)) {
    // Kick formation: everyone tight, wings behind the ends, the kicker deep.
    const punt = call.play === 'punt';
    return {
      ...O_LINE,
      TE: tightEnd,
      WR3: { x: -side * 6, y: -0.6 },
      WR1: { x: -7.6, y: -1.6 },
      WR2: { x: 7.6, y: -1.6 },
      // Personal protector on a punt, holder on a place kick.
      RB: punt ? { x: side * 2, y: -5 } : { x: 0.7, y: -7.2 },
      QB: { x: 0, y: punt ? -14 : -8.2 },
    };
  }
  const gun = OFF_PLAY_DEFS[call.play].formation === 'gun';
  return {
    ...O_LINE,
    TE: tightEnd,
    WR1: { x: -SPLIT, y: -0.6 },
    WR2: { x: SPLIT, y: -0.6 },
    // The slot stands off the line, between the tackle and the outside receiver.
    WR3: { x: -side * 11, y: -1.4 },
    QB: { x: 0, y: gun ? -5 : -1.6 },
    RB: gun ? { x: side * 2.6, y: -5 } : { x: 0, y: -6.5 },
  };
}

function defenseFormation(play: DefPlayId, cushion: Cushion, strong: 1 | -1): Record<DefRole, Vec> {
  const c = CUSHION_DEPTH[cushion];
  const z = ZONE_SHIFT[cushion];
  const line = {
    DE1: { x: -5.4, y: 1 },
    DT1: { x: -1.5, y: 1 },
    DT2: { x: 1.5, y: 1 },
    DE2: { x: 5.4, y: 1 },
  };
  const corners = (depth: number, x = SPLIT) => ({
    CB1: { x: -x, y: depth },
    CB2: { x, y: depth },
  });
  const slot = -strong * 11;
  switch (play) {
    case 'man':
      return {
        ...line,
        ...corners(c),
        SLB: { x: strong * 6, y: 4 },
        MLB: { x: 0, y: 4.8 },
        WLB: { x: -strong * 4, y: 5 },
        SS: { x: slot, y: Math.min(6, c + 1) },
        FS: { x: 0, y: 14 },
      };
    case 'zone':
      return {
        ...line,
        ...corners(7 + z, 19),
        SLB: { x: strong * 11, y: 5 },
        MLB: { x: strong * 3.5, y: 5.5 },
        WLB: { x: -strong * 3.5, y: 5.5 },
        SS: { x: -strong * 11, y: 5 },
        FS: { x: 0, y: 14 },
      };
    case 'blitz':
      return {
        ...line,
        ...corners(c),
        SLB: { x: strong * 6, y: 3.5 },
        MLB: { x: strong * 1, y: 2.6 },
        WLB: { x: -strong * 3.4, y: 2.6 },
        SS: { x: slot, y: Math.min(5, c + 1) },
        FS: { x: 0, y: 9 },
      };
    case 'runStop':
      return {
        ...line,
        ...corners(c),
        SLB: { x: strong * 5, y: 2.6 },
        MLB: { x: 0, y: 3 },
        WLB: { x: -strong * 4, y: 3 },
        SS: { x: -strong * 7.5, y: 3.5 },
        FS: { x: 0, y: 11 },
      };
    case 'prevent':
      return {
        ...line,
        ...corners(15 + z, 19),
        SLB: { x: strong * 10, y: 9 },
        MLB: { x: 0, y: 10 },
        WLB: { x: -strong * 10, y: 9 },
        FS: { x: strong * 6.5, y: 22 },
        SS: { x: -strong * 6.5, y: 22 },
      };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** The center snaps the ball, so it cannot be moved. */
export function isMovable(role: OffRole | DefRole): boolean {
  return role !== 'C';
}

function place(
  role: string,
  base: Vec,
  offset: Vec | undefined,
  at: Scrimmage,
  side: 'off' | 'def',
): Vec {
  const dx = clamp(offset?.x ?? 0, -MAX_SHIFT_X, MAX_SHIFT_X);
  const dy = clamp(offset?.y ?? 0, -MAX_SHIFT_Y, MAX_SHIFT_Y);
  const shift = WIDE.has(role) ? 0 : at.x;
  const x = clamp(base.x + shift + dx, -(HALF_WIDTH - 1), HALF_WIDTH - 1);
  // Nobody may line up across the line of scrimmage or outside the field.
  const y =
    side === 'off'
      ? clamp(at.y + base.y + dy, -9, at.y - 0.6)
      : clamp(at.y + base.y + dy, at.y + 1, 109);
  return { x, y };
}

/** Which side the offense's formation is strong to — all the defense may know of the call. */
export function strengthOf(call: OffenseCall): 1 | -1 {
  return call.flip ? -1 : 1;
}

/** Where every offensive player lines up (absolute, offense frame). */
export function offenseAlignment(call: OffenseCall, at: Scrimmage): Record<OffRole, Vec> {
  const formation = offenseFormation(call);
  const out = {} as Record<OffRole, Vec>;
  for (const role of OFF_ROLES) {
    out[role] = place(
      role,
      formation[role],
      isMovable(role) ? call.offsets[role] : undefined,
      at,
      'off',
    );
  }
  return out;
}

/** Where every defender lines up (absolute, offense frame). */
export function defenseAlignment(
  call: DefenseCall,
  at: Scrimmage,
  strong: 1 | -1,
): Record<DefRole, Vec> {
  const formation = defenseFormation(call.play, call.cushion, strong);
  const out = {} as Record<DefRole, Vec>;
  for (const role of DEF_ROLES) {
    out[role] = place(role, formation[role], call.offsets[role], at, 'def');
  }
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
  at: Scrimmage,
  strong: 1 | -1,
): Vec {
  const base =
    side === 'off'
      ? offenseFormation(call as OffenseCall)[role as OffRole]
      : defenseFormation((call as DefenseCall).play, (call as DefenseCall).cushion, strong)[
          role as DefRole
        ];
  const shift = WIDE.has(role) ? 0 : at.x;
  const wanted = { x: target.x - base.x - shift, y: target.y - at.y - base.y };
  const placed = place(role, base, wanted, at, side);
  return { x: placed.x - base.x - shift, y: placed.y - at.y - base.y };
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
  role: Receiver,
  start: Vec,
  at: Scrimmage,
): RoutePlan | null {
  if (isSpecial(call.play)) return null;
  const [left, right, slot, tight] = OFF_PLAY_DEFS[call.play].routes;
  const id =
    role === 'WR3' ? slot : role === 'TE' ? tight : (role === 'WR1') !== call.flip ? left : right;
  if (id === 'block') return null;
  const inside = start.x <= at.x ? 1 : -1;
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
export function backPath(call: OffenseCall, start: Vec, at: Scrimmage): RoutePlan | null {
  if (isSpecial(call.play)) return null;
  const side = call.flip ? -1 : 1;
  const los = at.y;
  const top = (y: number) => Math.min(108, y);
  const wide = (x: number) => clamp(x, -(HALF_WIDTH - 1.5), HALF_WIDTH - 1.5);
  switch (OFF_PLAY_DEFS[call.play].back) {
    case 'dive':
      return { points: [start, { x: at.x + 1 * side, y: los - 1.5 }, { x: at.x + 1.2 * side, y: top(los + 3) }], settle: false }; // prettier-ignore
    case 'sweep':
      return { points: [start, { x: wide(at.x + 10 * side), y: los - 3.5 }, { x: wide(at.x + 15 * side), y: top(los + 2) }], settle: false }; // prettier-ignore
    case 'flat':
      return { points: [start, { x: wide(start.x + 7 * side), y: los + 0.5 }, { x: wide(start.x + 12 * side), y: top(los + 5) }], settle: false }; // prettier-ignore
    case 'leak':
      return { points: [start, { x: at.x + 1.5 * side, y: los - 2.5 }, { x: wide(at.x + 8 * side), y: top(los + 3) }, { x: wide(at.x + 10 * side), y: top(los + 9) }], settle: false }; // prettier-ignore
    case 'swing':
      return { points: [start, { x: wide(start.x + 7.5 * side), y: los - 3 }], settle: true };
    case 'block':
      return null;
  }
}

/** Outside receivers paired with corners left-to-right, so shuffled alignments still match up. */
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

/** The man a defender covers under `spec`, if it is a man assignment. */
export function manTargetOf(
  role: DefRole,
  spec: DefJobSpec,
  matchups: Record<'CB1' | 'CB2', 'WR1' | 'WR2'>,
): OffRole | null {
  if (spec.job !== 'man') return null;
  if (spec.target !== 'outside') return spec.target;
  return role === 'CB1' || role === 'CB2' ? matchups[role] : null;
}
