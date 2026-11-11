/**
 * One play, simulated.
 *
 * `createPlay` lines 14 players up from the two calls; `stepPlay` advances
 * them by a time step until `sim.outcome` is set. Players are simple agents
 * (run a route, block, rush, cover, pursue) and every CONTEST between them is
 * a dice roll against a probability built from ratings and geometry:
 *
 *   block vs. rush   → `shed`        receiver vs. corner → `burn` / `jam`
 *   throw vs. cover  → `catch` / `incomplete` / `interception`
 *   runner vs. tackler → `tackle` / `brokenTackle` (+ `fumble`)
 *   rusher vs. passer  → `sack` / `escape`
 *
 * Nothing here reads input: once a play is created its result depends only on
 * the calls and the RNG stream, which is what "no control after START" means.
 * The rolls are recorded in `sim.events` (with the odds) for the play-by-play.
 */
import {
  DEF_JOBS,
  OFF_PLAY_DEFS,
  backPath,
  defenseAlignment,
  manMatchups,
  offenseAlignment,
  receiverRoute,
  type OffPlayDef,
  type RoutePlan,
} from './playbook';
import type { Rng } from './rng';
import {
  DEF_ROLES,
  HALF_WIDTH,
  OFF_ROLES,
  isSpecial,
  type DefRole,
  type DefenseCall,
  type OffRole,
  type OffenseCall,
  type PlayEvent,
  type PlayOutcome,
  type Ratings,
  type Role,
  type Team,
  type Vec,
} from './types';

/** Simulation step the game loop and the tests both use (seconds). */
export const SIM_DT = 1 / 30;

const ROLE_SPEED: Record<Role, number> = {
  QB: 7.4,
  RB: 8.7,
  WR1: 9.0,
  WR2: 9.0,
  C: 6.0,
  LG: 6.0,
  RG: 6.0,
  DE1: 6.9,
  NT: 6.4,
  DE2: 6.9,
  LB: 8.3,
  CB1: 8.9,
  CB2: 8.9,
  FS: 8.7,
};

type OffJob = 'qb' | 'route' | 'passBlock' | 'runBlock' | 'carry' | 'toBall' | 'idle';
type DefJob = 'rush' | 'man' | 'zone' | 'fill' | 'pursue';

interface SimPlayer {
  role: Role;
  side: 'off' | 'def';
  pos: Vec;
  vel: Vec;
  start: Vec;
  maxSpeed: number;
  power: number;
  skill: number;
  job: OffJob | DefJob;
  /** Movement intent for this step: target point + fraction of top speed. */
  want: Vec | null;
  pace: number;
  route: RoutePlan | null;
  routeIdx: number;
  /** Blocker → the defender he is locked up with. */
  blocking: DefRole | null;
  /** Defender → the blocker holding him. */
  engagedBy: OffRole | null;
  nextShedAt: number;
  manTarget: OffRole | null;
  zoneCenter: Vec;
  zoneRadius: number;
  zoneDeep: boolean;
  cushion: number;
  /** The receiver's velocity as this defender has read it so far (lags on cuts). */
  seenVel: Vec;
  /** The receiver a zone defender is currently carrying. */
  zoneThreat: OffRole | null;
  /** When this defender recognizes a ball carrier and starts pursuing. */
  readAt: number;
  biteUntil: number;
  /** Beaten on a move: keeps drifting until this time. */
  lagUntil: number;
  /** On the ground / out of the play until this time. */
  stunnedUntil: number;
  tackleReadyAt: number;
  slowUntil: number;
}

interface SimBall {
  mode: 'held' | 'air' | 'dead';
  carrier: Role | null;
  pos: Vec;
  /** Height above the turf (yards) — the renderer lifts the ball by this. */
  height: number;
  from: Vec;
  to: Vec;
  t0: number;
  t1: number;
  target: OffRole | null;
}

interface SpecialState {
  kickAt: number;
  landAt: number;
  outcome: PlayOutcome;
  kicked: boolean;
  event: PlayEvent;
}

export interface PlaySim {
  t: number;
  los: number;
  off: OffenseCall;
  def: DefenseCall;
  playDef: OffPlayDef | null;
  players: SimPlayer[];
  ball: SimBall;
  events: PlayEvent[];
  outcome: PlayOutcome | null;
  rng: Rng;
  handedOff: boolean;
  scrambling: boolean;
  hurried: boolean;
  pressureLogged: boolean;
  biteRolled: boolean;
  jamRolled: boolean;
  fillConverted: boolean;
  nextReadAt: number;
  chaseAt: number;
  throwPressured: boolean;
  special: SpecialState | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function makePlayer(role: Role, side: 'off' | 'def', start: Vec, ratings: Ratings): SimPlayer {
  return {
    role,
    side,
    pos: { ...start },
    vel: { x: 0, y: 0 },
    start: { ...start },
    maxSpeed: ROLE_SPEED[role] * (1 + (ratings.speed - 75) * 0.004),
    power: ratings.power,
    skill: ratings.skill,
    job: 'idle',
    want: null,
    pace: 1,
    route: null,
    routeIdx: 1,
    blocking: null,
    engagedBy: null,
    nextShedAt: 0,
    manTarget: null,
    zoneCenter: { ...start },
    zoneRadius: 0,
    zoneDeep: false,
    cushion: 0,
    seenVel: { x: 0, y: 0 },
    zoneThreat: null,
    readAt: Infinity,
    biteUntil: 0,
    lagUntil: 0,
    stunnedUntil: 0,
    tackleReadyAt: 0,
    slowUntil: 0,
  };
}

/** Field-goal odds by kick distance (line of scrimmage + 17 yards). */
export function fieldGoalChance(los: number): number {
  const d = 100 - los + 17;
  let p = 0.98;
  p -= clamp(d - 25, 0, 15) * 0.006;
  p -= clamp(d - 40, 0, 10) * 0.019;
  p -= Math.max(0, d - 50) * 0.04;
  return clamp(p, 0.01, 0.99);
}

export function fieldGoalDistance(los: number): number {
  return Math.round(100 - los + 17);
}

export function createPlay(
  offense: Team,
  defense: Team,
  off: OffenseCall,
  def: DefenseCall,
  los: number,
  rng: Rng,
): PlaySim {
  const offSpots = offenseAlignment(off, los);
  const defSpots = defenseAlignment(def, los);
  const players: SimPlayer[] = [
    ...OFF_ROLES.map((role) => makePlayer(role, 'off', offSpots[role], offense.offense[role])),
    ...DEF_ROLES.map((role) => makePlayer(role, 'def', defSpots[role], defense.defense[role])),
  ];
  const qb = players[0]!;
  const sim: PlaySim = {
    t: 0,
    los,
    off,
    def,
    playDef: isSpecial(off.play) ? null : OFF_PLAY_DEFS[off.play],
    players,
    ball: {
      mode: 'held',
      carrier: 'QB',
      pos: { ...qb.pos },
      height: 1,
      from: { ...qb.pos },
      to: { ...qb.pos },
      t0: 0,
      t1: 0,
      target: null,
    },
    events: [],
    outcome: null,
    rng,
    handedOff: false,
    scrambling: false,
    hurried: false,
    pressureLogged: false,
    biteRolled: false,
    jamRolled: false,
    fillConverted: false,
    nextReadAt: 0,
    chaseAt: Infinity,
    throwPressured: false,
    special: null,
  };

  if (isSpecial(off.play)) {
    setUpSpecial(sim);
    return sim;
  }
  const playDef = OFF_PLAY_DEFS[off.play];
  const run = playDef.kind === 'run';

  // ── offense jobs ───────────────────────────────────────────────────────────
  for (const p of players) {
    if (p.side !== 'off') continue;
    switch (p.role) {
      case 'QB':
        p.job = 'qb';
        break;
      case 'RB': {
        p.route = backPath(off, p.start, los);
        p.job = p.route ? 'route' : 'passBlock';
        break;
      }
      case 'WR1':
      case 'WR2': {
        p.route = receiverRoute(off, p.role, p.start);
        p.job = p.route ? 'route' : 'runBlock';
        break;
      }
      default:
        p.job = run ? 'runBlock' : 'passBlock';
    }
  }

  // ── defense jobs ───────────────────────────────────────────────────────────
  const matchups = manMatchups(offSpots, defSpots);
  for (const p of players) {
    if (p.side !== 'def') continue;
    const role = p.role as DefRole;
    const spec = DEF_JOBS[def.play][role];
    p.job = spec.job;
    if (spec.job === 'man') {
      p.manTarget =
        spec.target === 'back' ? 'RB' : role === 'CB1' || role === 'CB2' ? matchups[role] : 'RB';
      const target = players.find((o) => o.role === p.manTarget)!;
      p.cushion = Math.max(0.8, p.start.y - target.start.y);
    } else if (spec.job === 'zone') {
      // The zone is centered where the player was PLACED — moving him moves it.
      p.zoneCenter = { x: p.start.x, y: Math.min(107, p.start.y + (spec.deep ? 2 : 0)) };
      p.zoneRadius = spec.radius;
      p.zoneDeep = spec.deep;
    }
  }
  return sim;
}

function setUpSpecial(sim: PlaySim): void {
  const { rng, los } = sim;
  const kicker = sim.players[0]!;
  for (const p of sim.players) p.job = p.side === 'off' ? 'idle' : 'rush';
  if (sim.off.play === 'punt') {
    const gross = clamp(41 + rng.gauss() * 6, 24, 58);
    const net = gross - rng.range(0, 9);
    const spot = los + net;
    const to = { x: rng.range(-9, 9), y: Math.min(spot, 106) };
    sim.ball.to = to;
    sim.special = {
      kickAt: 1.0,
      landAt: 1.0 + 2.2 + net / 30,
      kicked: false,
      event: { t: 1.0, type: 'punt', distance: Math.round(net) },
      outcome: { kind: 'punt', spot, duration: 6, clockStops: true, pass: false },
    };
  } else {
    const chance = fieldGoalChance(los);
    const distance = fieldGoalDistance(los);
    const good = rng.chance(chance);
    const wide = rng.chance(0.5) ? 1 : -1;
    const short = !good && distance > 52 && rng.chance(0.5);
    sim.ball.to = good
      ? { x: rng.range(-2, 2), y: 110 }
      : short
        ? { x: rng.range(-3, 3), y: 96 }
        : { x: wide * rng.range(4.5, 8), y: 110 };
    sim.special = {
      kickAt: 1.1,
      landAt: 1.1 + 1.2 + distance / 45,
      kicked: false,
      event: { t: 1.1, type: 'kick', chance, distance },
      outcome: {
        kind: good ? 'fieldGoalGood' : 'fieldGoalMiss',
        spot: los,
        duration: 5,
        clockStops: true,
        pass: false,
      },
    };
  }
  sim.ball.from = { ...kicker.pos };
}

function stepSpecial(sim: PlaySim, dt: number): void {
  const special = sim.special!;
  const { ball } = sim;
  // The rush closes on the line; the kick is already decided.
  for (const p of sim.players) {
    if (p.side !== 'def' || p.start.y > sim.los + 3) continue;
    p.pos.y = Math.max(sim.los + 0.4, p.pos.y - 1.2 * dt);
  }
  if (!special.kicked && sim.t >= special.kickAt) {
    special.kicked = true;
    sim.events.push(special.event);
    ball.mode = 'air';
    ball.carrier = null;
    ball.t0 = sim.t;
    ball.t1 = special.landAt;
  }
  if (ball.mode === 'air') flyBall(sim, sim.off.play === 'punt' ? 9 : 5);
  if (sim.t >= special.landAt) {
    ball.mode = 'dead';
    ball.height = 0;
    sim.outcome = special.outcome;
  }
}

function flyBall(sim: PlaySim, apex: number): void {
  const { ball } = sim;
  const k = clamp((sim.t - ball.t0) / Math.max(0.01, ball.t1 - ball.t0), 0, 1);
  ball.pos.x = ball.from.x + (ball.to.x - ball.from.x) * k;
  ball.pos.y = ball.from.y + (ball.to.y - ball.from.y) * k;
  ball.height = 1 + 4 * apex * k * (1 - k);
}

function get(sim: PlaySim, role: Role): SimPlayer {
  // 14 players — a scan is cheaper than keeping a map in sync.
  for (const p of sim.players) if (p.role === role) return p;
  throw new Error(`unknown role ${role}`);
}

function active(sim: PlaySim, p: SimPlayer): boolean {
  return p.engagedBy === null && sim.t >= p.stunnedUntil;
}

function log(sim: PlaySim, event: PlayEvent): void {
  sim.events.push(event);
}

function finish(sim: PlaySim, outcome: Omit<PlayOutcome, 'duration' | 'pass'>): void {
  sim.ball.mode = 'dead';
  sim.outcome = {
    ...outcome,
    duration: sim.t,
    pass: sim.playDef?.kind === 'pass',
  };
}

/** Defenders learn there is a ball carrier, each after his own reaction time. */
function reveal(sim: PlaySim, quick: number | null): void {
  for (const p of sim.players) {
    if (p.side !== 'def') continue;
    const react =
      quick ??
      (p.job === 'rush'
        ? 0
        : p.job === 'fill'
          ? 0.1
          : p.job === 'man'
            ? p.manTarget === sim.ball.carrier
              ? 0.2
              : 0.6
            : p.zoneDeep
              ? 0.45
              : 0.3);
    p.readAt = Math.min(p.readAt, sim.t + react);
  }
}

function carrierOf(sim: PlaySim): SimPlayer | null {
  return sim.ball.mode === 'held' && sim.ball.carrier ? get(sim, sim.ball.carrier) : null;
}

/** Odds a throw to `point` is caught, given how close the coverage is. */
function catchChance(
  sim: PlaySim,
  receiver: SimPlayer,
  separation: number,
  distance: number,
  pressured: boolean,
  hurried: boolean,
): number {
  const qb = get(sim, 'QB');
  return clamp(
    0.4 +
      0.14 * Math.min(separation, 3.5) -
      0.008 * Math.max(0, distance - 8) +
      (qb.skill - 75) * 0.004 +
      (receiver.skill - 75) * 0.003 -
      (pressured ? 0.1 : 0) -
      (hurried ? 0.12 : 0),
    0.04,
    0.96,
  );
}

function nearestDefender(
  sim: PlaySim,
  point: Vec,
  closingTime = 0,
): { player: SimPlayer | null; distance: number } {
  let best: SimPlayer | null = null;
  let bestDistance = Infinity;
  for (const p of sim.players) {
    if (p.side !== 'def' || !active(sim, p)) continue;
    // While the ball is in the air a defender closes part of the gap.
    const d = Math.max(0, dist(p.pos, point) - 0.45 * closingTime * p.maxSpeed);
    if (d < bestDistance) {
      bestDistance = d;
      best = p;
    }
  }
  return { player: best, distance: bestDistance };
}

function followRoute(sim: PlaySim, p: SimPlayer): void {
  const route = p.route;
  if (!route) return;
  const last = route.points.length - 1;
  if (p.routeIdx <= last) {
    const target = route.points[p.routeIdx]!;
    if (dist(p.pos, target) < 0.7) {
      p.routeIdx += 1;
      // A cut is where a man defender can lose his receiver.
      if (p.routeIdx <= last && p.routeIdx >= 2) rollBurn(sim, p);
    }
  }
  if (p.routeIdx <= last) {
    p.want = route.points[p.routeIdx]!;
    p.pace = 1;
    return;
  }
  if (route.settle) {
    p.want = null;
    return;
  }
  // Keep running along the last leg, bending upfield at the sideline.
  const a = route.points[last - 1] ?? p.start;
  const b = route.points[last]!;
  const len = Math.max(0.01, dist(a, b));
  let dx = (b.x - a.x) / len;
  const dy = Math.max(0.15, (b.y - a.y) / len);
  if (Math.abs(p.pos.x + dx * 3) > HALF_WIDTH - 2) dx = 0;
  p.want = { x: p.pos.x + dx * 5, y: Math.min(108, p.pos.y + dy * 5) };
  p.pace = 1;
}

function rollBurn(sim: PlaySim, receiver: SimPlayer): void {
  for (const d of sim.players) {
    if (d.side !== 'def' || d.job !== 'man' || d.manTarget !== receiver.role) continue;
    if (!active(sim, d) || sim.t < d.biteUntil) continue;
    const base = sim.def.cushion === 'tight' ? 0.34 : sim.def.cushion === 'normal' ? 0.24 : 0.14;
    const chance = clamp(base + (receiver.skill - d.skill) * 0.006, 0.04, 0.7);
    if (sim.rng.chance(chance)) {
      d.lagUntil = sim.t + 0.45;
      log(sim, { t: sim.t, type: 'burn', who: d.role as DefRole, by: receiver.role });
    }
  }
}

function openFieldTarget(sim: PlaySim, carrier: SimPlayer): Vec {
  let pushX = 0;
  for (const d of sim.players) {
    if (d.side !== 'def' || !active(sim, d)) continue;
    const dy = d.pos.y - carrier.pos.y;
    const dx = d.pos.x - carrier.pos.x;
    const gap = Math.hypot(dx, dy);
    if (dy < -1 || gap > 8) continue;
    // Lean away from each tackler ahead, harder the closer he is.
    pushX += (dx === 0 ? 0.5 : -Math.sign(dx)) * (1.6 / Math.max(0.6, gap)) * (dy > 0 ? 1 : 0.5);
  }
  // …and away from the sidelines.
  if (carrier.pos.x > HALF_WIDTH - 3.5) pushX -= (carrier.pos.x - (HALF_WIDTH - 3.5)) * 0.7;
  if (carrier.pos.x < -(HALF_WIDTH - 3.5)) pushX += (-(HALF_WIDTH - 3.5) - carrier.pos.x) * 0.7;
  pushX = clamp(pushX, -1.6, 1.6);
  return { x: carrier.pos.x + pushX * 4, y: carrier.pos.y + 4 };
}

function planOffense(sim: PlaySim): void {
  const { t, los } = sim;
  const playDef = sim.playDef!;
  const qb = get(sim, 'QB');
  const side = sim.off.flip ? -1 : 1;
  const carrier = carrierOf(sim);

  for (const p of sim.players) {
    if (p.side !== 'off') continue;
    p.want = null;
    p.pace = 1;
    if (t < p.stunnedUntil || p.blocking) continue;

    switch (p.job as OffJob) {
      case 'qb': {
        if (playDef.kind === 'run') {
          // Meet the back, hand off, get out of the way.
          p.want = sim.handedOff
            ? { x: p.start.x - side * 2, y: los - 5 }
            : { x: p.start.x + side * 0.4, y: los - playDef.dropDepth };
          p.pace = sim.handedOff ? 0.4 : 0.7;
          break;
        }
        const faking = playDef.meshTime > 0 && t < playDef.meshTime;
        p.want = faking
          ? { x: p.start.x + side * 0.6, y: los - 3 }
          : { x: p.start.x, y: los - playDef.dropDepth };
        p.pace = 0.8;
        // Slide away from a free rusher once set.
        if (t >= playDef.dropTime) {
          const threat = nearestDefender(sim, p.pos);
          if (threat.player && threat.distance < 4) {
            const away = Math.sign(p.pos.x - threat.player.pos.x) || 1;
            p.want = { x: clamp(p.pos.x + away * 2, -HALF_WIDTH + 2, HALF_WIDTH - 2), y: p.pos.y };
            p.pace = 0.6;
          }
        }
        break;
      }
      case 'route': {
        followRoute(sim, p);
        // Coming out of the fake, the back picks up a free rusher in his path.
        if (p.role === 'RB' && sim.off.play === 'playAction' && t < playDef.meshTime + 0.4) {
          for (const d of sim.players) {
            if (d.side !== 'def' || d.job !== 'rush' || !active(sim, d)) continue;
            if (dist(d.pos, p.pos) > 1.8) continue;
            p.job = 'passBlock';
            p.blocking = d.role as DefRole;
            d.engagedBy = 'RB';
            d.nextShedAt = t + 0.4;
            break;
          }
        }
        break;
      }
      case 'toBall':
        p.want = sim.ball.to;
        break;
      case 'carry': {
        // A back follows his track to the hole first, then it is open field.
        const tracking =
          p.role === 'RB' &&
          playDef.kind === 'run' &&
          p.route !== null &&
          p.routeIdx < p.route.points.length &&
          t < playDef.meshTime + 1.5;
        if (tracking) followRoute(sim, p);
        else p.want = openFieldTarget(sim, p);
        // Running with the ball is a touch slower than running free.
        p.pace = t < p.slowUntil ? 0.55 : 0.94;
        break;
      }
      case 'passBlock':
      case 'runBlock': {
        const pass = p.job === 'passBlock';
        const protect = carrier ?? qb;
        let target: SimPlayer | null = null;
        let best = Infinity;
        for (const d of sim.players) {
          if (d.side !== 'def' || d.engagedBy !== null || t < d.stunnedUntil) continue;
          const gap = dist(d.pos, p.pos);
          if (pass) {
            // Only rushers matter in protection.
            if (d.job !== 'rush' && !(d.job === 'pursue' && dist(d.pos, qb.pos) < 8)) continue;
            if (gap > 7) continue;
          } else if (gap > 7) {
            continue;
          }
          // Prefer whoever is closest to the man being protected.
          const score = gap + 0.35 * dist(d.pos, protect.pos);
          if (score < best) {
            best = score;
            target = d;
          }
        }
        if (target) {
          const gap = dist(target.pos, p.pos);
          if (gap < 1.25) {
            p.blocking = target.role as DefRole;
            target.engagedBy = p.role as OffRole;
            target.nextShedAt = t + 0.4;
            p.vel = { x: 0, y: 0 };
            target.vel = { x: 0, y: 0 };
          } else if (pass && gap > 3) {
            // Stay between the rusher and the passer.
            p.want = {
              x: target.pos.x + (qb.pos.x - target.pos.x) * 0.45,
              y: target.pos.y + (qb.pos.y - target.pos.y) * 0.45,
            };
            p.pace = 0.7;
          } else {
            p.want = target.pos;
            p.pace = 0.85;
          }
        } else if (!pass) {
          // Nobody to hit: lead the way.
          const lead = carrier && carrier !== p ? carrier.pos.y + 4 : los + 5;
          p.want = { x: p.pos.x + (carrier ? (carrier.pos.x - p.pos.x) * 0.3 : 0), y: Math.min(108, Math.max(p.pos.y, lead)) }; // prettier-ignore
          p.pace = 0.7;
        }
        break;
      }
      case 'idle':
        break;
    }
  }

  // ── timed events ───────────────────────────────────────────────────────────
  const back = get(sim, 'RB');
  if (playDef.kind === 'run' && !sim.handedOff && t >= playDef.meshTime) {
    sim.handedOff = true;
    sim.ball.carrier = 'RB';
    back.job = 'carry';
    log(sim, { t, type: 'handoff' });
    reveal(sim, null);
  }
  if (sim.off.play === 'playAction' && !sim.biteRolled && t >= 0.3) {
    sim.biteRolled = true;
    log(sim, { t, type: 'fake' });
    for (const d of sim.players) {
      if (d.side !== 'def' || (d.role !== 'LB' && d.role !== 'FS') || d.job === 'rush') continue;
      const base = d.job === 'fill' ? 0.7 : d.job === 'man' ? 0.4 : d.zoneDeep ? 0.3 : 0.45;
      const chance = clamp(base * (sim.def.play === 'prevent' ? 0.4 : 1) - (d.skill - 75) * 0.006, 0.03, 0.9); // prettier-ignore
      if (sim.rng.chance(chance)) {
        d.biteUntil = playDef.meshTime + 0.45;
        log(sim, { t, type: 'bite', who: d.role as DefRole });
      }
    }
  }
  if (sim.off.play === 'screen' && t >= 0.9) {
    // The line lets the rush through and gets out in front of the back.
    for (const p of sim.players) {
      if (p.side !== 'off' || p.job !== 'passBlock' || p.role === 'RB') continue;
      if (p.blocking) {
        const d = get(sim, p.blocking);
        d.engagedBy = null;
        d.lagUntil = t + 0.15;
        p.blocking = null;
      }
      p.job = 'runBlock';
    }
  }
}

function planQuarterback(sim: PlaySim): void {
  const { t, los, rng } = sim;
  const playDef = sim.playDef!;
  const qb = get(sim, 'QB');
  if (playDef.kind !== 'pass' || sim.ball.mode !== 'held' || sim.ball.carrier !== 'QB') return;
  if (qb.job !== 'qb' || t < qb.stunnedUntil) return;

  const threat = nearestDefender(sim, qb.pos);
  const pressured = threat.distance < 3.2;
  if (pressured && !sim.pressureLogged && t > 0.6) {
    sim.pressureLogged = true;
    log(sim, { t, type: 'pressure' });
  }
  if (t < sim.nextReadAt) return;
  sim.nextReadAt = t + 0.2;
  // Before he is set, he only gets rid of it if he SEES the rusher coming.
  const collapsing = threat.distance < 2.4 && t > 0.6 && rng.chance(0.7);
  if (!(t >= playDef.dropTime || sim.hurried || collapsing)) return;

  const sinceSet = Math.max(0, t - playDef.dropTime);
  const base = sim.off.risk === 'safe' ? 0.68 : sim.off.risk === 'balanced' ? 0.56 : 0.44;
  const depthWeight = sim.off.risk === 'safe' ? 0.25 : sim.off.risk === 'balanced' ? 0.6 : 1.1;
  const threshold = Math.max(
    0.3,
    base - 0.05 * Math.floor(sinceSet / 0.4) - (pressured ? 0.08 : 0) - (sim.hurried ? 0.15 : 0),
  );

  let pick: { receiver: SimPlayer; point: Vec; chance: number; distance: number; flight: number } | null = null; // prettier-ignore
  let bestScore = 0;
  for (const r of sim.players) {
    if (r.side !== 'off' || r.job !== 'route' || t < 0.7 || t < r.stunnedUntil) continue;
    // A screen is thrown to the back, on time.
    if (sim.off.play === 'screen' && r.role !== 'RB' && t < 2.6) continue;
    if (sim.off.play === 'playAction' && r.role === 'RB' && t < playDef.meshTime + 0.5) continue;
    const rough = dist(qb.pos, r.pos);
    const flight = 0.3 + rough / 22;
    const point = {
      x: clamp(r.pos.x + r.vel.x * flight, -(HALF_WIDTH - 1), HALF_WIDTH - 1),
      y: Math.min(108.5, r.pos.y + r.vel.y * flight),
    };
    const distance = dist(qb.pos, point);
    if (distance > 58) continue;
    const separation = nearestDefender(sim, point, flight).distance;
    const chance = catchChance(sim, r, separation, distance, pressured, sim.hurried);
    if (chance < threshold) continue;
    const score = chance * (1 + (depthWeight * Math.max(0, point.y - los)) / 15);
    if (score > bestScore) {
      bestScore = score;
      pick = { receiver: r, point, chance, distance, flight: 0.3 + distance / 22 };
    }
  }

  if (pick) {
    const { ball } = sim;
    ball.mode = 'air';
    ball.carrier = null;
    ball.from = { ...qb.pos };
    ball.to = pick.point;
    ball.t0 = t;
    ball.t1 = t + pick.flight;
    ball.target = pick.receiver.role as OffRole;
    pick.receiver.job = 'toBall';
    sim.chaseAt = t + 0.3;
    sim.throwPressured = pressured || sim.hurried;
    log(sim, {
      t,
      type: 'throw',
      target: pick.receiver.role as OffRole,
      chance: pick.chance,
      distance: Math.round(pick.distance),
    });
    return;
  }

  // Nobody open: hold on, until the pocket or the clock says otherwise.
  if (sim.hurried || sinceSet > 2.6) {
    if (rng.chance(0.55)) {
      qb.job = 'carry';
      sim.scrambling = true;
      log(sim, { t, type: 'scramble' });
      reveal(sim, 0.3);
    } else {
      log(sim, { t, type: 'throwAway' });
      finish(sim, { kind: 'incomplete', spot: los, clockStops: true });
    }
  }
}

function planDefense(sim: PlaySim): void {
  const { t, los } = sim;
  const { ball } = sim;
  const carrier = carrierOf(sim);
  const qb = get(sim, 'QB');
  const back = get(sim, 'RB');
  const passPlay = sim.playDef!.kind === 'pass';
  const ballBehindLine = carrier !== null && carrier.role === 'QB' && !sim.scrambling;

  // Run-stoppers who see a pass drop into coverage.
  if (!sim.fillConverted && passPlay && t > 0.75 && ballBehindLine) {
    sim.fillConverted = true;
    for (const d of sim.players) {
      if (d.side !== 'def' || d.job !== 'fill') continue;
      if (d.role === 'LB') {
        d.job = 'man';
        d.manTarget = 'RB';
        d.cushion = 1;
      } else {
        d.job = 'zone';
        d.zoneCenter = { x: d.start.x * 0.3, y: Math.min(107, los + 12) };
        d.zoneRadius = 12;
        d.zoneDeep = true;
      }
    }
  }
  // Press coverage: a jam at the line is its own little contest.
  if (!sim.jamRolled && t >= 0.25) {
    sim.jamRolled = true;
    for (const d of sim.players) {
      if (d.side !== 'def' || d.job !== 'man' || !d.manTarget || d.cushion > 2.5) continue;
      const r = get(sim, d.manTarget);
      if (r.job !== 'route' || r.role === 'RB') continue;
      const roll = sim.rng.next();
      const edge = (d.power + d.skill - r.power - r.skill) * 0.003;
      if (roll < 0.3 + edge) {
        r.stunnedUntil = t + 0.35;
        log(sim, { t, type: 'jam', who: d.role as DefRole, won: true });
      } else if (roll > 0.72 + edge) {
        d.lagUntil = t + 0.5;
        log(sim, { t, type: 'jam', who: d.role as DefRole, won: false });
      }
    }
  }

  for (const d of sim.players) {
    if (d.side !== 'def') continue;
    d.want = null;
    d.pace = 1;
    if (!active(sim, d) || t < d.lagUntil) continue;

    // Fooled by the fake: attack the back until the fake is over.
    if (t < d.biteUntil) {
      d.want = { x: back.pos.x, y: Math.max(los + 0.5, back.pos.y) };
      continue;
    }
    if (d.biteUntil > 0 && t >= d.biteUntil) {
      d.biteUntil = 0;
      d.lagUntil = t + 0.25;
      continue;
    }

    // Ball in the air: break on it if it is anywhere near.
    if (ball.mode === 'air') {
      // Zone eyes are on the passer; a man defender stays with his receiver.
      const covering = d.job === 'man' ? d.manTarget === ball.target : d.job !== 'rush';
      if (t >= sim.chaseAt && covering && dist(d.pos, ball.to) < (d.job === 'zone' ? 12 : 8)) {
        d.want = ball.to;
        continue;
      }
    } else if (carrier && (t >= d.readAt || d.job === 'pursue')) {
      // Take an angle: aim where the runner will be.
      let lead = 0;
      for (let i = 0; i < 3; i++) {
        const ax = carrier.pos.x + carrier.vel.x * lead;
        const ay = carrier.pos.y + carrier.vel.y * lead;
        lead = clamp(Math.hypot(ax - d.pos.x, ay - d.pos.y) / d.maxSpeed, 0, 1.6);
      }
      d.want = {
        x: clamp(carrier.pos.x + carrier.vel.x * lead, -HALF_WIDTH, HALF_WIDTH),
        y: carrier.pos.y + carrier.vel.y * lead,
      };
      continue;
    }

    switch (d.job as DefJob) {
      case 'rush':
      case 'pursue':
        // Rush lanes are traffic: nobody gets to the passer at a dead sprint.
        d.want = ball.mode === 'air' ? ball.to : (carrier ?? qb).pos;
        d.pace = ball.mode === 'air' ? 0.6 : d.pos.y > los ? 0.8 : 1;
        break;
      case 'man': {
        const r = get(sim, d.manTarget!);
        if (r.job !== 'route' && r.job !== 'toBall' && r.job !== 'carry') {
          // His man stayed in to block: hold the spot and watch the passer.
          d.want = { x: d.start.x, y: Math.max(los + 2.5, d.start.y - 1) };
          d.pace = 0.5;
          break;
        }
        const cushion = Math.max(0.5, d.cushion - 1.3 * t);
        const inside = r.pos.x > 0.5 ? -0.5 : r.pos.x < -0.5 ? 0.5 : 0;
        // He mirrors the receiver's movement as he has READ it; a cut opens a
        // gap until the read catches up.
        const k = Math.min(1, SIM_DT / 0.38);
        d.seenVel.x += (r.vel.x - d.seenVel.x) * k;
        d.seenVel.y += (r.vel.y - d.seenVel.y) * k;
        d.want = {
          x: r.pos.x + inside + (d.seenVel.x - r.vel.x) * 0.5,
          y: r.pos.y + cushion + (d.seenVel.y - r.vel.y) * 0.5,
        };
        d.pace = 0.95;
        break;
      }
      case 'zone': {
        let threat: SimPlayer | null = null;
        let best = Infinity;
        for (const r of sim.players) {
          if (r.side !== 'off' || (r.job !== 'route' && r.job !== 'toBall')) continue;
          const gap = dist(r.pos, d.zoneCenter);
          if (d.zoneDeep) {
            // Deep help: the deepest man on his side of the field.
            if (Math.abs(r.pos.x - d.zoneCenter.x) > d.zoneRadius || r.pos.y < d.zoneCenter.y - 12)
              continue;
            if (-r.pos.y < best) {
              best = -r.pos.y;
              threat = r;
            }
          } else if (gap < d.zoneRadius + 2 && gap < best) {
            best = gap;
            threat = r;
          }
        }
        // With nobody left in his zone, an underneath defender runs with the
        // man who just went DEEP out of it; a crosser is passed on.
        if (!d.zoneDeep) {
          if (threat) {
            d.zoneThreat = threat.role as OffRole;
          } else if (d.zoneThreat) {
            const r = get(sim, d.zoneThreat);
            const running = r.job === 'route' || r.job === 'toBall';
            if (running && r.pos.y > d.zoneCenter.y + d.zoneRadius * 0.6) threat = r;
            else d.zoneThreat = null;
          }
        }
        if (!threat) {
          d.want = d.zoneCenter;
          d.pace = 0.7;
        } else if (d.zoneDeep) {
          d.want = {
            x: d.zoneCenter.x + (threat.pos.x - d.zoneCenter.x) * 0.7,
            y: Math.min(108, Math.max(d.zoneCenter.y, threat.pos.y + 2.5)),
          };
        } else if (dist(threat.pos, d.zoneCenter) > d.zoneRadius + 2) {
          d.want = { x: threat.pos.x, y: threat.pos.y - 0.5 };
          d.pace = 0.95;
        } else {
          d.want = {
            x: d.zoneCenter.x + (threat.pos.x - d.zoneCenter.x) * 0.65,
            y: d.zoneCenter.y + (threat.pos.y - d.zoneCenter.y) * 0.65 + 0.8,
          };
        }
        break;
      }
      case 'fill':
        d.want = { x: d.start.x * 0.7, y: los + 1.3 };
        d.pace = 0.8;
        break;
    }
  }
}

function stepEngagements(sim: PlaySim, dt: number): void {
  const { t } = sim;
  const qb = get(sim, 'QB');
  const carrier = carrierOf(sim);
  const runner = carrier === null || carrier.role === 'QB' ? null : carrier;
  for (const b of sim.players) {
    if (b.side !== 'off' || !b.blocking) continue;
    const d = get(sim, b.blocking);
    const pass = b.job === 'passBlock';
    // Push: the rusher drives the pocket back; a run blocker drives his man off the ball.
    let dirX = 0;
    let dirY = 1;
    let speed: number;
    if (pass) {
      const gap = Math.max(0.01, dist(d.pos, qb.pos));
      dirX = (qb.pos.x - d.pos.x) / gap;
      dirY = (qb.pos.y - d.pos.y) / gap;
      speed = clamp(0.7 + (d.power - b.power) * 0.03, 0.2, 1.6);
    } else {
      speed = clamp(0.6 + (b.power - d.power) * 0.03, -0.5, 1.5);
    }
    d.pos.x += dirX * speed * dt;
    d.pos.y += dirY * speed * dt;
    b.pos.x = d.pos.x + dirX * 0.9 * (pass ? 1 : -1);
    b.pos.y = d.pos.y + dirY * 0.9 * (pass ? 1 : -1);

    if (t < d.nextShedAt) continue;
    d.nextShedAt = t + 0.4;
    const receiverBlock = b.role === 'WR1' || b.role === 'WR2' || b.role === 'RB';
    let chance = (pass ? 0.07 : 0.09) + (receiverBlock ? 0.16 : 0) + (d.power - b.power) * 0.004;
    // A runner going by is the moment to get off the block.
    if (runner && dist(runner.pos, d.pos) < 2.6) chance += 0.25;
    if (sim.rng.chance(clamp(chance, 0.02, 0.6))) {
      b.blocking = null;
      b.stunnedUntil = t + 1.0;
      d.engagedBy = null;
      d.lagUntil = t + 0.1;
      // Only worth a line while the passer still has the ball.
      if (pass && sim.ball.mode === 'held' && sim.ball.carrier === 'QB')
        log(sim, { t, type: 'shed', who: d.role as DefRole });
    }
  }
}

function move(sim: PlaySim, dt: number): void {
  const { t } = sim;
  for (const p of sim.players) {
    if (p.blocking || p.engagedBy) continue;
    if (t < p.stunnedUntil) {
      p.vel.x *= 0.8;
      p.vel.y *= 0.8;
    } else if (t >= p.lagUntil) {
      let vx = 0;
      let vy = 0;
      if (p.want) {
        const dx = p.want.x - p.pos.x;
        const dy = p.want.y - p.pos.y;
        const gap = Math.hypot(dx, dy);
        if (gap > 0.15) {
          // Ease into a spot instead of overshooting it.
          const speed = Math.min(p.maxSpeed * p.pace, gap * 6);
          vx = (dx / gap) * speed;
          vy = (dy / gap) * speed;
        }
      }
      const ax = vx - p.vel.x;
      const ay = vy - p.vel.y;
      const change = Math.hypot(ax, ay);
      const limit = 26 * dt;
      const k = change > limit ? limit / change : 1;
      p.vel.x += ax * k;
      p.vel.y += ay * k;
    }
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.pos.y = clamp(p.pos.y, -9.8, 109.8);
    if (sim.ball.carrier !== p.role) p.pos.x = clamp(p.pos.x, -HALF_WIDTH - 1, HALF_WIDTH + 1);
  }
  // Bodies do not overlap.
  const { players } = sim;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i]!;
      const b = players[j]!;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const gap = Math.hypot(dx, dy);
      const aLocked = a.blocking !== null || a.engagedBy !== null;
      const bLocked = b.blocking !== null || b.engagedBy !== null;
      // A scrum is easier to slip past than a free man.
      const reach = aLocked || bLocked ? 0.55 : 0.9;
      if (gap >= reach || gap < 0.0001) continue;
      const push = (reach - gap) / 2;
      if (!aLocked) {
        a.pos.x -= (dx / gap) * push;
        a.pos.y -= (dy / gap) * push;
      }
      if (!bLocked) {
        b.pos.x += (dx / gap) * push;
        b.pos.y += (dy / gap) * push;
      }
    }
  }
}

function resolveThrow(sim: PlaySim): void {
  const { ball, rng, t } = sim;
  const receiver = get(sim, ball.target!);
  const role = receiver.role as OffRole;
  const distance = dist(ball.from, ball.to);
  const cover = nearestDefender(sim, ball.to);
  const reachable = dist(receiver.pos, ball.to) < 2.2 && t >= receiver.stunnedUntil;
  const chance = reachable
    ? catchChance(sim, receiver, cover.distance, distance, sim.throwPressured, false)
    : 0;
  let pick = 0;
  if (cover.player && cover.distance < 1.3) {
    pick =
      0.012 +
      (0.04 * (1.3 - cover.distance)) / 1.3 +
      (cover.player.skill - 75) * 0.002 +
      (sim.off.risk === 'aggressive' ? 0.02 : 0);
  } else if (cover.player && cover.distance < 2.6) {
    pick = 0.006;
  }
  pick = clamp(pick, 0, 0.3);
  const roll = rng.next();
  if (roll < chance) {
    ball.mode = 'held';
    ball.carrier = role;
    ball.height = 1;
    receiver.job = 'carry';
    receiver.pos = { ...ball.to };
    // Securing the catch costs a step — the trailing defender's chance.
    receiver.slowUntil = t + 0.45;
    log(sim, { t, type: 'catch', target: role, chance });
    reveal(sim, 0.15);
    // Everyone else turns into a blocker.
    for (const p of sim.players) {
      if (p.side === 'off' && (p.job === 'route' || p.job === 'passBlock') && !p.blocking)
        p.job = 'runBlock';
    }
    return;
  }
  if (cover.player && roll < chance + pick) {
    log(sim, { t, type: 'interception', by: cover.player.role as DefRole, chance: pick });
    finish(sim, { kind: 'interception', spot: ball.to.y, clockStops: true });
    return;
  }
  log(sim, { t, type: 'incomplete', target: role, chance, brokenUp: cover.distance < 1.5 });
  finish(sim, { kind: 'incomplete', spot: sim.los, clockStops: true });
}

function resolveContact(sim: PlaySim): void {
  const { t, rng } = sim;
  const carrier = carrierOf(sim);
  if (!carrier) return;

  if (carrier.pos.y >= 100) {
    log(sim, { t, type: 'touchdown' });
    finish(sim, { kind: 'touchdown', spot: 100, clockStops: true });
    return;
  }
  if (Math.abs(carrier.pos.x) >= HALF_WIDTH) {
    log(sim, { t, type: 'outOfBounds' });
    if (carrier.pos.y <= 0) {
      log(sim, { t, type: 'safety' });
      finish(sim, { kind: 'safety', spot: 0, clockStops: true });
    } else {
      finish(sim, { kind: 'outOfBounds', spot: carrier.pos.y, clockStops: true });
    }
    return;
  }
  if (carrier.pos.y > sim.los) reveal(sim, 0);

  const inPocket = carrier.role === 'QB' && carrier.job === 'qb' && sim.playDef!.kind === 'pass';
  for (const d of sim.players) {
    if (d.side !== 'def' || !active(sim, d) || t < d.tackleReadyAt) continue;
    if (dist(d.pos, carrier.pos) > 1.05) continue;
    d.tackleReadyAt = t + 0.7;
    const by = d.role as DefRole;

    let chance: number;
    if (inPocket) {
      chance = clamp(0.62 + (d.skill - carrier.skill) * 0.004, 0.35, 0.9);
    } else {
      let help = 0;
      for (const o of sim.players) {
        if (o !== d && o.side === 'def' && active(sim, o) && dist(o.pos, carrier.pos) < 2.5) help++;
      }
      chance = clamp(
        0.76 + (d.skill - (carrier.power + carrier.skill) / 2) * 0.005 + 0.08 * help,
        0.3,
        0.96,
      );
    }

    if (!rng.chance(chance)) {
      d.stunnedUntil = t + 1.1;
      carrier.slowUntil = t + 0.35;
      if (inPocket) {
        sim.hurried = true;
        sim.nextReadAt = t;
        log(sim, { t, type: 'escape', from: by, chance });
      } else {
        log(sim, { t, type: 'brokenTackle', by, chance });
      }
      continue;
    }

    const spot = carrier.pos.y;
    log(sim, inPocket ? { t, type: 'sack', by, chance } : { t, type: 'tackle', by, chance });
    if (rng.chance(inPocket ? 0.03 : 0.012)) {
      const lost = rng.chance(0.5);
      log(sim, { t, type: 'fumble', lost });
      if (lost) {
        finish(sim, { kind: 'fumbleLost', spot: clamp(spot, 1, 99), clockStops: true });
        return;
      }
    }
    if (spot <= 0) {
      log(sim, { t, type: 'safety' });
      finish(sim, { kind: 'safety', spot: 0, clockStops: true });
    } else {
      finish(sim, { kind: inPocket ? 'sack' : 'tackle', spot, clockStops: false });
    }
    return;
  }
}

/** Advances the play by `dt` seconds. No-op once `sim.outcome` is set. */
export function stepPlay(sim: PlaySim, dt: number = SIM_DT): void {
  if (sim.outcome) return;
  sim.t += dt;
  if (sim.special) {
    stepSpecial(sim, dt);
    return;
  }

  planOffense(sim);
  planQuarterback(sim);
  if (sim.outcome) return;
  planDefense(sim);
  stepEngagements(sim, dt);
  move(sim, dt);

  const { ball } = sim;
  if (ball.mode === 'air') {
    flyBall(sim, 0.4 + dist(ball.from, ball.to) * 0.035);
    if (sim.t >= ball.t1) resolveThrow(sim);
  }
  if (ball.mode === 'held' && ball.carrier) {
    const carrier = get(sim, ball.carrier);
    ball.pos.x = carrier.pos.x;
    ball.pos.y = carrier.pos.y;
    ball.height = 1;
  }
  if (sim.outcome) return;
  resolveContact(sim);

  // A play cannot last forever: whoever has the ball is ruled down.
  if (!sim.outcome && sim.t > 16) {
    const carrier = carrierOf(sim);
    finish(sim, {
      kind: carrier ? 'tackle' : 'incomplete',
      spot: carrier ? clamp(carrier.pos.y, 1, 99) : sim.los,
      clockStops: !carrier,
    });
  }
}

/** Runs a play to its end (tests, balance checks). */
export function runPlay(sim: PlaySim): PlayOutcome {
  while (!sim.outcome) stepPlay(sim, SIM_DT);
  return sim.outcome;
}
