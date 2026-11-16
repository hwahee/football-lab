/**
 * Engine → picture. Turns "what the coaches have called" or "where the play
 * is right now" into a {@link SceneFrame} for the renderer, and maps touches
 * on the field back to engine coordinates.
 *
 * This is the only place that knows which way a team faces: the engine works
 * in the offense's frame, the renderer in world space.
 */
import {
  DEF_JOBS,
  backPath,
  defenseAlignment,
  manMatchups,
  manTargetOf,
  offenseAlignment,
  receiverRoute,
  strengthOf,
} from './engine/playbook';
import type { PlaySim } from './engine/sim';
import {
  DEF_ROLES,
  OFF_ROLES,
  isSpecial,
  type DefRole,
  type DefenseCall,
  type OffRole,
  type OffenseCall,
  type Role,
  type Scrimmage,
  type TeamId,
  type Vec,
} from './engine/types';
import { PALETTE } from './palette';
import type { Overlay, SceneFrame, TokenView } from './render/scene';

const BIG: ReadonlySet<Role> = new Set<Role>(['LT', 'LG', 'C', 'RG', 'RT', 'DE1', 'DT1', 'DT2', 'DE2']); // prettier-ignore

/** Offense-frame point → world (x, z). Home attacks toward -z (up the screen). */
export function toWorld(offense: TeamId, point: Vec): { x: number; z: number } {
  return offense === 'home' ? { x: point.x, z: 50 - point.y } : { x: -point.x, z: point.y - 50 };
}

export function fromWorld(offense: TeamId, x: number, z: number): Vec {
  return offense === 'home' ? { x, y: 50 - z } : { x: -x, y: z + 50 };
}

function other(team: TeamId): TeamId {
  return team === 'home' ? 'away' : 'home';
}

export interface SetupView {
  offense: TeamId;
  /** Where the ball will be snapped. */
  at: Scrimmage;
  /** Yards to the line to gain, or null when there is none (the try). */
  toGo: number | null;
  offCall: OffenseCall;
  defCall: DefenseCall;
  /** Whose plan is drawn on the turf — nobody's while the device changes hands. */
  reveal: 'offense' | 'defense' | 'none';
  selected: Role | null;
  /** 0…1 while the defense shifts from its disguise into the real call. */
  shift?: number;
  /** The look the defense showed before the shift. */
  disguise?: DefenseCall;
}

function token(
  team: TeamId,
  role: Role,
  world: { x: number; z: number },
  extra?: Partial<TokenView>,
): TokenView {
  return {
    key: `${team}:${role}`,
    team,
    x: world.x,
    z: world.z,
    big: BIG.has(role),
    hasBall: false,
    selected: false,
    down: false,
    ...extra,
  };
}

function path(offense: TeamId, points: readonly Vec[], color: string, arrow = true): Overlay {
  return {
    kind: 'path',
    points: points.map((p) => {
      const w = toWorld(offense, p);
      return [w.x, w.z] as const;
    }),
    color,
    arrow,
  };
}

function offenseOverlays(view: SetupView, spots: Record<OffRole, Vec>): Overlay[] {
  const { offense, offCall, at } = view;
  if (isSpecial(offCall.play)) return [];
  const overlays: Overlay[] = [];
  for (const role of ['WR1', 'WR2', 'WR3', 'TE'] as const) {
    const route = receiverRoute(offCall, role, spots[role], at);
    if (route) overlays.push(path(offense, route.points, PALETTE.chalk));
  }
  const back = backPath(offCall, spots.RB, at);
  if (back) overlays.push(path(offense, back.points, PALETTE.led));
  return overlays;
}

function defenseOverlays(
  view: SetupView,
  offSpots: Record<OffRole, Vec>,
  defSpots: Record<DefRole, Vec>,
): Overlay[] {
  const { offense, defCall, at } = view;
  const overlays: Overlay[] = [];
  const matchups = manMatchups(offSpots, defSpots);
  for (const role of DEF_ROLES) {
    const spec = DEF_JOBS[defCall.play][role];
    const spot = defSpots[role];
    if (spec.job === 'zone') {
      const center = toWorld(offense, {
        x: spot.x,
        y: Math.min(107, spot.y + (spec.deep ? 2 : 0)),
      });
      overlays.push({ kind: 'circle', x: center.x, z: center.z, radius: spec.radius * 0.6, color: PALETTE.led }); // prettier-ignore
    } else if (spec.job === 'man') {
      const target = manTargetOf(role, spec, matchups);
      if (target) overlays.push(path(offense, [spot, offSpots[target]], PALETTE.chalk, false));
    } else {
      // Rushers and run-fillers attack the line.
      const to = {
        x: at.x + (spot.x - at.x) * 0.6,
        y: at.y - (spec.job === 'rush' ? 2.5 : -1),
      };
      overlays.push(path(offense, [spot, to], PALETTE.danger));
    }
  }
  return overlays;
}

/** The field while a coach is choosing: formations, plus the plan of whoever is looking. */
export function setupFrame(view: SetupView): SceneFrame {
  const { offense, at, offCall, defCall } = view;
  const defense = other(offense);
  const strong = strengthOf(offCall);
  const offSpots = offenseAlignment(offCall, at);
  const defSpots = defenseAlignment(defCall, at, strong);
  if (view.disguise && view.shift !== undefined) {
    const from = defenseAlignment(view.disguise, at, strong);
    const k = view.shift * view.shift * (3 - 2 * view.shift);
    for (const role of DEF_ROLES) {
      defSpots[role] = {
        x: from[role].x + (defSpots[role].x - from[role].x) * k,
        y: from[role].y + (defSpots[role].y - from[role].y) * k,
      };
    }
  }
  const tokens: TokenView[] = [
    ...OFF_ROLES.map((role) =>
      token(offense, role, toWorld(offense, offSpots[role]), {
        selected: view.selected === role,
        hasBall: role === 'C',
      }),
    ),
    ...DEF_ROLES.map((role) =>
      token(defense, role, toWorld(offense, defSpots[role]), { selected: view.selected === role }),
    ),
  ];
  const overlays =
    view.reveal === 'offense'
      ? offenseOverlays(view, offSpots)
      : view.reveal === 'defense'
        ? defenseOverlays(view, offSpots, defSpots)
        : [];
  const scrimmage = toWorld(offense, { x: 0, y: at.y });
  const ahead = offense === 'home' ? -1 : 1;
  return {
    tokens,
    ball: null,
    scrimmageZ: scrimmage.z,
    firstDownZ:
      view.toGo === null ? null : toWorld(offense, { x: 0, y: Math.min(100, at.y + view.toGo) }).z,
    overlays,
    overlayKey: JSON.stringify(overlays),
    // Show more of what lies ahead of the offense than behind it.
    focusZ: scrimmage.z + ahead * 6,
    snapCamera: false,
  };
}

/** The field during (and right after) a play or a kickoff. */
export function playFrame(sim: PlaySim, offense: TeamId, toGo: number | null): SceneFrame {
  const defense = other(offense);
  const tokens = sim.players.map((p) =>
    token(p.side === 'off' ? offense : defense, p.role, toWorld(offense, p.pos), {
      hasBall: sim.ball.mode !== 'air' && sim.ball.carrier === p.role,
      down: sim.t < p.stunnedUntil && !p.blocking,
    }),
  );
  const ball = toWorld(offense, sim.ball.pos);
  // The camera leads the ball toward wherever it is being carried.
  const upfield = sim.kickoff?.caught || sim.returning ? 1 : -1;
  const ahead = (offense === 'home' ? 1 : -1) * upfield;
  const lines = sim.kickoff === null;
  return {
    tokens,
    ball: { x: ball.x, z: ball.z, height: sim.ball.height },
    scrimmageZ: lines ? toWorld(offense, { x: 0, y: sim.los }).z : null,
    firstDownZ:
      lines && toGo !== null
        ? toWorld(offense, { x: 0, y: Math.min(100, sim.los + toGo) }).z
        : null,
    overlays: [],
    overlayKey: '',
    focusZ: ball.z + ahead * 6,
    snapCamera: false,
  };
}

/** A formation at midfield — the backdrop of the start menu. */
export function idleFrame(offCall: OffenseCall, defCall: DefenseCall): SceneFrame {
  return {
    ...setupFrame({
      offense: 'home',
      at: { x: 0, y: 50 },
      toGo: null,
      offCall,
      defCall,
      reveal: 'offense',
      selected: null,
    }),
    scrimmageZ: null,
  };
}

/** The player of `side` nearest to a touched point, if one is close enough to mean it. */
export function pickRole(
  view: SetupView,
  side: 'off' | 'def',
  point: Vec,
  reach = 2.6,
): Role | null {
  const spots: Record<string, Vec> =
    side === 'off'
      ? offenseAlignment(view.offCall, view.at)
      : defenseAlignment(view.defCall, view.at, strengthOf(view.offCall));
  let best: Role | null = null;
  let bestDistance = reach;
  for (const [role, spot] of Object.entries(spots)) {
    const d = Math.hypot(spot.x - point.x, spot.y - point.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = role as Role;
    }
  }
  return best;
}
