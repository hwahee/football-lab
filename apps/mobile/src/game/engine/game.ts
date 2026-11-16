/**
 * The game around the plays — NFL rules: kickoffs, four downs, the try after
 * a touchdown, timeouts, the two-minute warning, penalties and overtime.
 *
 * Everything here is a pure function of the previous state, a play's outcome
 * and the dice: `applyOutcome` scores the play and moves the chains, and
 * `settleClock` runs the clock between plays (unless someone calls timeout).
 * Both return `notes` — what the scoreboard should announce.
 *
 * Where this departs from the rule book (docs/game.md lists them): no
 * returns on punts beyond the net-distance roll, no fumble returns, no onside
 * kicks, a fixed menu of five penalties that are accepted or declined
 * automatically, and no challenges or injuries.
 */
import type { Rng } from './rng';
import type { PlaySim } from './sim';
import { createTeam } from './teams';
import {
  HASH_X,
  isSpecial,
  type OffPlayId,
  type PlayOutcome,
  type Scrimmage,
  type Team,
  type TeamId,
} from './types';

type GameMode = 'ai' | 'pvp';
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];
/** Seconds per quarter on offer; 900 is the real thing. */
export const QUARTER_LENGTHS = [300, 600, 900] as const;

export interface GameConfig {
  mode: GameMode;
  difficulty: Difficulty;
  /** Seconds per quarter. */
  quarterSeconds: number;
}

interface TeamStats {
  plays: number;
  rushYards: number;
  passYards: number;
  turnovers: number;
  firstDowns: number;
  penalties: number;
}

/** kickoff: `possession` kicks · scrimmage: `possession` has the ball · try: `possession` just scored a touchdown. */
export type Stage = 'kickoff' | 'scrimmage' | 'try';

export interface GameState {
  config: GameConfig;
  teams: Record<TeamId, Team>;
  score: Record<TeamId, number>;
  /** 1–4, and 5 for overtime. */
  quarter: number;
  /** Seconds left in the period. */
  clock: number;
  stage: Stage;
  possession: TeamId;
  /** Yards from the offense's own goal line (1–99). */
  ballOn: number;
  /** Across the field, between the hashes. */
  ballX: number;
  down: number;
  toGo: number;
  /** Yard line a kickoff is kicked from (35, or 20 after a safety). */
  kickFrom: number;
  secondHalfReceiver: TeamId;
  timeouts: Record<TeamId, number>;
  /** Seconds that will run off before the next snap unless a timeout stops them. */
  pendingRunoff: number;
  /** Possessions each team has completed in overtime; null in regulation. */
  overtime: Record<TeamId, number> | null;
  over: boolean;
  stats: Record<TeamId, TeamStats>;
}

type Foul = 'falseStart' | 'offside' | 'holding' | 'passInterference' | 'defensiveHolding';

export type Note =
  | { type: 'firstDown' }
  | { type: 'turnoverOnDowns' }
  | { type: 'touchdown'; team: TeamId }
  | { type: 'try'; points: number; kick: boolean }
  | { type: 'fieldGoal'; good: boolean }
  | { type: 'safety'; team: TeamId }
  | { type: 'turnover'; kind: 'interception' | 'fumble' }
  | { type: 'punt'; touchback: boolean }
  | { type: 'kickoff'; touchback: boolean }
  | { type: 'penalty'; foul: Foul; on: TeamId; yards: number; accepted: boolean }
  | { type: 'timeout'; team: TeamId }
  | { type: 'twoMinuteWarning' }
  | { type: 'quarterEnd'; quarter: number }
  | { type: 'halftime' }
  | { type: 'overtime' }
  | { type: 'final' };

const DRIVE_TOUCHBACK = 20;
/** Seconds between the whistle and the next snap while the clock runs. */
const RUNOFF = 38;
const TWO_MINUTES = 120;
const TIMEOUTS_PER_HALF = 3;
const TIMEOUTS_IN_OVERTIME = 2;
/** The try: a kick snapped from the 15, or one play from the 2. */
const KICK_TRY_SPOT = 85;
const TWO_POINT_SPOT = 98;

export function otherTeam(team: TeamId): TeamId {
  return team === 'home' ? 'away' : 'home';
}

const AI_BONUS: Record<Difficulty, number> = { easy: -5, normal: 0, hard: 5 };

function emptyStats(): TeamStats {
  return { plays: 0, rushYards: 0, passYards: 0, turnovers: 0, firstDowns: 0, penalties: 0 };
}

export function newGame(config: GameConfig, rng: Rng): GameState {
  // Coin toss: the winner receives, the other team gets the ball after halftime.
  const receiver: TeamId = rng.chance(0.5) ? 'home' : 'away';
  return {
    config,
    teams: {
      home: createTeam('home', rng),
      // Against the AI, the difficulty is the visitors' talent level.
      away: createTeam('away', rng, config.mode === 'ai' ? AI_BONUS[config.difficulty] : 0),
    },
    score: { home: 0, away: 0 },
    quarter: 1,
    clock: config.quarterSeconds,
    stage: 'kickoff',
    possession: otherTeam(receiver),
    ballOn: 35,
    ballX: 0,
    down: 1,
    toGo: 10,
    kickFrom: 35,
    secondHalfReceiver: otherTeam(receiver),
    timeouts: { home: TIMEOUTS_PER_HALF, away: TIMEOUTS_PER_HALF },
    pendingRunoff: 0,
    overtime: null,
    over: false,
    stats: { home: emptyStats(), away: emptyStats() },
  };
}

function clampSpot(spot: number): number {
  return Math.max(1, Math.min(99, Math.round(spot)));
}

function clampHash(x: number): number {
  return Math.max(-HASH_X, Math.min(HASH_X, x));
}

/** The side controlled by the AI, if any. */
export function aiTeam(state: GameState): TeamId | null {
  return state.config.mode === 'ai' ? 'away' : null;
}

/** Where the next play is snapped from, given the play called (the try has two spots). */
export function snapSpot(state: GameState, play: OffPlayId): Scrimmage {
  if (state.stage === 'try') {
    return { x: 0, y: play === 'extraPoint' ? KICK_TRY_SPOT : TWO_POINT_SPOT };
  }
  return { x: state.ballX, y: state.ballOn };
}

export interface Applied {
  state: GameState;
  notes: Note[];
  /** Net yards on a scrimmage play (0 for kicks and turnovers). */
  yards: number;
  /** An accepted penalty wiped the play out. */
  nullified: boolean;
}

function copy(prev: GameState): GameState {
  return {
    ...prev,
    score: { ...prev.score },
    timeouts: { ...prev.timeouts },
    overtime: prev.overtime ? { ...prev.overtime } : null,
    stats: { home: { ...prev.stats.home }, away: { ...prev.stats.away } },
  };
}

function startDrive(state: GameState, team: TeamId, ballOn: number, ballX = 0): void {
  state.stage = 'scrimmage';
  state.possession = team;
  state.ballOn = clampSpot(ballOn);
  state.ballX = clampHash(ballX);
  state.down = 1;
  state.toGo = Math.min(10, 100 - state.ballOn);
}

function setKickoff(state: GameState, kicking: TeamId, from = 35): void {
  state.stage = 'kickoff';
  state.possession = kicking;
  state.kickFrom = from;
  state.ballOn = from;
  state.ballX = 0;
  state.down = 1;
  state.toGo = 10;
}

/** The clock stops for a play that goes out of bounds only late in a half. */
function outOfBoundsStops(state: GameState): boolean {
  return (
    (state.quarter === 2 && state.clock <= TWO_MINUTES) ||
    (state.quarter >= 4 && state.clock <= 300)
  );
}

function endPeriod(state: GameState, notes: Note[], rng: Rng): void {
  state.pendingRunoff = 0;
  if (state.quarter === 1 || state.quarter === 3) {
    // Teams change ends; the situation carries over.
    notes.push({ type: 'quarterEnd', quarter: state.quarter });
    state.quarter += 1;
    state.clock = state.config.quarterSeconds;
    return;
  }
  if (state.quarter === 2) {
    notes.push({ type: 'halftime' });
    state.quarter = 3;
    state.clock = state.config.quarterSeconds;
    state.timeouts = { home: TIMEOUTS_PER_HALF, away: TIMEOUTS_PER_HALF };
    setKickoff(state, otherTeam(state.secondHalfReceiver));
    return;
  }
  if (state.quarter === 4 && state.score.home === state.score.away) {
    // Overtime: a new coin toss, one shortened period, two timeouts each.
    notes.push({ type: 'overtime' });
    state.quarter = 5;
    state.clock = Math.round((state.config.quarterSeconds * 2) / 3);
    state.timeouts = { home: TIMEOUTS_IN_OVERTIME, away: TIMEOUTS_IN_OVERTIME };
    state.overtime = { home: 0, away: 0 };
    setKickoff(state, rng.chance(0.5) ? 'home' : 'away');
    return;
  }
  state.clock = 0;
  state.over = true;
  notes.push({ type: 'final' });
}

/**
 * Overtime ends as soon as one team leads and either both have had the ball,
 * or the leader scored without ever having it (a defensive score).
 */
function overtimeDecided(state: GameState): boolean {
  const ot = state.overtime;
  if (!ot || state.stage === 'try' || state.score.home === state.score.away) return false;
  const leader: TeamId = state.score.home > state.score.away ? 'home' : 'away';
  return ot[leader] === 0 || (ot.home >= 1 && ot.away >= 1);
}

interface Flag {
  foul: Foul;
  /** True when the offense committed it. */
  onOffense: boolean;
  yards: number;
  /** Spot foul: the ball goes to this yard line. */
  spot?: number;
  automaticFirstDown: boolean;
}

/** Moves the ball for an accepted penalty; the down is replayed. */
function enforce(state: GameState, prev: GameState, flag: Flag): number {
  const offense = prev.possession;
  let yards: number;
  if (flag.onOffense) {
    // Never more than half the distance to the goal line.
    yards = Math.min(flag.yards, Math.floor(prev.ballOn / 2));
    state.ballOn = clampSpot(prev.ballOn - yards);
    state.toGo = prev.toGo + (prev.ballOn - state.ballOn);
    state.down = prev.down;
  } else {
    yards =
      flag.spot !== undefined
        ? Math.max(1, clampSpot(flag.spot) - prev.ballOn)
        : Math.min(flag.yards, Math.ceil((100 - prev.ballOn) / 2));
    state.ballOn = clampSpot(prev.ballOn + yards);
    const gained = state.ballOn - prev.ballOn;
    if (flag.automaticFirstDown || gained >= prev.toGo) {
      state.down = 1;
      state.toGo = Math.min(10, 100 - state.ballOn);
      state.stats[offense].firstDowns += 1;
    } else {
      state.down = prev.down;
      state.toGo = prev.toGo - gained;
    }
  }
  state.stage = 'scrimmage';
  state.possession = offense;
  state.ballX = prev.ballX;
  state.stats[flag.onOffense ? offense : otherTeam(offense)].penalties += 1;
  return yards;
}

/**
 * A flag before the snap (false start, or the defense jumping offside): the
 * play never happens. Returns null when everybody stayed set.
 */
export function preSnapPenalty(prev: GameState, play: OffPlayId, rng: Rng): Applied | null {
  if (prev.stage !== 'scrimmage' || play === 'kneel') return null;
  const roll = rng.next();
  const flag: Flag | null =
    roll < 0.018
      ? { foul: 'falseStart', onOffense: true, yards: 5, automaticFirstDown: false }
      : roll < 0.03
        ? { foul: 'offside', onOffense: false, yards: 5, automaticFirstDown: false }
        : null;
  if (!flag) return null;
  const state = copy(prev);
  const yards = enforce(state, prev, flag);
  // A dead-ball foul stops the clock.
  state.pendingRunoff = 0;
  const on = flag.onOffense ? prev.possession : otherTeam(prev.possession);
  return {
    state,
    notes: [{ type: 'penalty', foul: flag.foul, on, yards, accepted: true }],
    yards: 0,
    nullified: true,
  };
}

function goodForOffense(outcome: PlayOutcome, prev: GameState): boolean {
  if (outcome.kind === 'touchdown') return true;
  if (outcome.kind !== 'tackle' && outcome.kind !== 'outOfBounds') return false;
  return outcome.spot >= prev.ballOn + prev.toGo;
}

function turnedOver(outcome: PlayOutcome): boolean {
  return (
    outcome.kind === 'interception' ||
    outcome.kind === 'fumbleLost' ||
    outcome.kind === 'safety' ||
    outcome.kind === 'defensiveTouchdown'
  );
}

/** Rolls for a flag during a scrimmage play, and decides whether it is accepted. */
function liveBallFlag(
  prev: GameState,
  outcome: PlayOutcome,
  sim: PlaySim,
  rng: Rng,
): { flag: Flag; accepted: boolean } | null {
  if (isSpecial(sim.off.play)) return null;
  const last = sim.events[sim.events.length - 1];
  const contested = last?.type === 'incomplete' && last.brokenUp;
  if (contested && rng.chance(0.07)) {
    // Pass interference: the ball goes to the spot of the foul (the 1 if in the end zone).
    const spot = Math.max(prev.ballOn + 1, Math.min(99, sim.ball.to.y));
    return {
      flag: {
        foul: 'passInterference',
        onOffense: false,
        yards: 0,
        spot,
        automaticFirstDown: true,
      },
      accepted: true,
    };
  }
  const roll = rng.next();
  if (roll < 0.03) {
    // The defense takes the yards unless the play itself went better for it.
    const failedLateDown = prev.down >= 3 && !goodForOffense(outcome, prev);
    return {
      flag: { foul: 'holding', onOffense: true, yards: 10, automaticFirstDown: false },
      accepted: !turnedOver(outcome) && !failedLateDown,
    };
  }
  if (roll < 0.042 && outcome.pass) {
    return {
      flag: { foul: 'defensiveHolding', onOffense: false, yards: 5, automaticFirstDown: true },
      accepted: !goodForOffense(outcome, prev),
    };
  }
  return null;
}

/**
 * Scores a finished play. Pass the simulation to have penalties rolled; without
 * it (unit tests of the rules) the play always stands.
 */
export function applyOutcome(
  prev: GameState,
  outcome: PlayOutcome,
  rng: Rng,
  sim?: PlaySim,
): Applied {
  const offense = prev.possession;
  const defense = otherTeam(offense);
  const notes: Note[] = [];
  const state = copy(prev);
  const stats = state.stats[offense];
  let yards = 0;
  let nullified = false;
  /** Does the clock keep running into the next snap? */
  let running = !outcome.clockStops;
  let elapsed = Math.ceil(outcome.duration);

  const possessionEnded = (team: TeamId) => {
    if (state.overtime) state.overtime[team] += 1;
  };
  const gain = (spot: number) => {
    yards = clampSpot(spot) - prev.ballOn;
    stats.plays += 1;
    if (outcome.pass) stats.passYards += yards;
    else stats.rushYards += yards;
  };

  const penalty = sim && prev.stage === 'scrimmage' ? liveBallFlag(prev, outcome, sim, rng) : null;
  if (penalty) {
    const on = penalty.flag.onOffense ? offense : defense;
    if (penalty.accepted) {
      const moved = enforce(state, prev, penalty.flag);
      notes.push({ type: 'penalty', foul: penalty.flag.foul, on, yards: moved, accepted: true });
      nullified = true;
      running = false;
    } else {
      notes.push({ type: 'penalty', foul: penalty.flag.foul, on, yards: 0, accepted: false });
    }
  }

  if (nullified) {
    // The play is wiped out; only the time it took stays off the clock.
  } else if (prev.stage === 'kickoff') {
    const receiving = defense;
    elapsed = outcome.kind === 'kickReturnTouchdown' ? elapsed : Math.min(elapsed, 6);
    if (outcome.kind === 'kickReturnTouchdown') {
      state.score[receiving] += 6;
      notes.push({ type: 'touchdown', team: receiving });
      state.stage = 'try';
      state.possession = receiving;
      state.ballOn = TWO_POINT_SPOT;
      state.ballX = 0;
    } else {
      const touchback = sim?.kickoff?.touchback ?? false;
      if (touchback) elapsed = 0;
      notes.push({ type: 'kickoff', touchback });
      startDrive(state, receiving, 100 - outcome.spot, -outcome.spotX);
    }
  } else if (prev.stage === 'try') {
    // One untimed down: a kick is worth one, crossing the goal line two.
    elapsed = 0;
    running = false;
    const kick = outcome.kind === 'fieldGoalGood' || outcome.kind === 'fieldGoalMiss';
    const points = outcome.kind === 'fieldGoalGood' ? 1 : outcome.kind === 'touchdown' ? 2 : 0;
    state.score[offense] += points;
    notes.push({ type: 'try', points, kick });
    setKickoff(state, offense);
  } else {
    switch (outcome.kind) {
      case 'touchdown':
        gain(100);
        yards = 100 - prev.ballOn;
        state.score[offense] += 6;
        notes.push({ type: 'touchdown', team: offense });
        possessionEnded(offense);
        state.stage = 'try';
        state.ballOn = TWO_POINT_SPOT;
        state.ballX = 0;
        break;
      case 'defensiveTouchdown':
        stats.plays += 1;
        stats.turnovers += 1;
        notes.push({ type: 'turnover', kind: 'interception' });
        notes.push({ type: 'touchdown', team: defense });
        state.score[defense] += 6;
        possessionEnded(offense);
        state.stage = 'try';
        state.possession = defense;
        state.ballOn = TWO_POINT_SPOT;
        state.ballX = 0;
        break;
      case 'safety':
        stats.plays += 1;
        state.score[defense] += 2;
        notes.push({ type: 'safety', team: defense });
        possessionEnded(offense);
        // The team that gave up the safety kicks from its own 20.
        setKickoff(state, offense, 20);
        break;
      case 'interception':
      case 'fumbleLost':
        stats.plays += 1;
        stats.turnovers += 1;
        notes.push({
          type: 'turnover',
          kind: outcome.kind === 'interception' ? 'interception' : 'fumble',
        });
        possessionEnded(offense);
        // Down in the end zone = touchback.
        startDrive(
          state,
          defense,
          outcome.spot >= 100 ? DRIVE_TOUCHBACK : 100 - outcome.spot,
          -outcome.spotX,
        );
        break;
      case 'punt': {
        const touchback = outcome.spot >= 100;
        notes.push({ type: 'punt', touchback });
        possessionEnded(offense);
        startDrive(
          state,
          defense,
          touchback ? DRIVE_TOUCHBACK : 100 - outcome.spot,
          -outcome.spotX,
        );
        break;
      }
      case 'fieldGoalGood':
        state.score[offense] += 3;
        notes.push({ type: 'fieldGoal', good: true });
        possessionEnded(offense);
        setKickoff(state, offense);
        break;
      case 'fieldGoalMiss':
        notes.push({ type: 'fieldGoal', good: false });
        possessionEnded(offense);
        // The other team takes over at the spot of the kick, or its 20 if that is better.
        startDrive(state, defense, Math.max(DRIVE_TOUCHBACK, 100 - (prev.ballOn - 7)), -prev.ballX);
        break;
      case 'incomplete':
        stats.plays += 1;
        state.down += 1;
        break;
      case 'tackle':
      case 'outOfBounds':
      case 'sack': {
        gain(outcome.spot);
        const line = prev.ballOn + prev.toGo;
        state.ballOn = clampSpot(outcome.spot);
        state.ballX = clampHash(outcome.spotX);
        if (state.ballOn >= line) {
          state.down = 1;
          state.toGo = Math.min(10, 100 - state.ballOn);
          stats.firstDowns += 1;
          notes.push({ type: 'firstDown' });
        } else {
          state.down += 1;
          state.toGo = line - state.ballOn;
        }
        if (outcome.kind === 'outOfBounds') running = !outOfBoundsStops(prev);
        break;
      }
      // Kickoff outcomes cannot happen from scrimmage.
      case 'kickoff':
      case 'kickReturnTouchdown':
        break;
    }
    if (state.stage === 'scrimmage' && state.possession === offense && state.down > 4) {
      notes.push({ type: 'turnoverOnDowns' });
      possessionEnded(offense);
      startDrive(state, defense, 100 - state.ballOn, -state.ballX);
      running = false;
    }
  }

  // ── clock ──────────────────────────────────────────────────────────────────
  const late = prev.quarter === 2 || prev.quarter === 4;
  state.clock = prev.clock - elapsed;
  if (late && prev.clock > TWO_MINUTES && state.clock <= TWO_MINUTES && state.clock > 0) {
    notes.push({ type: 'twoMinuteWarning' });
    running = false;
  }
  // A change of possession or a score always stops the clock.
  if (state.stage !== 'scrimmage' || state.possession !== offense) running = false;
  state.pendingRunoff = running ? RUNOFF : 0;

  if (overtimeDecided(state)) {
    state.over = true;
    state.pendingRunoff = 0;
    notes.push({ type: 'final' });
  } else if (state.clock <= 0) {
    state.clock = 0;
    state.pendingRunoff = 0;
    // A touchdown as time expires still gets its try.
    if (state.stage !== 'try') endPeriod(state, notes, rng);
  }
  return { state, notes, yards, nullified };
}

/** True when a timeout would save time right now. */
export function canCallTimeout(state: GameState, team: TeamId): boolean {
  return !state.over && state.pendingRunoff > 0 && state.timeouts[team] > 0;
}

/**
 * Runs the clock between plays. A timeout stops it; otherwise up to 38 seconds
 * come off. An offense that is not ahead hurries, so it always gets one more
 * snap; an offense that is ahead lets the period run out.
 */
export function settleClock(
  prev: GameState,
  timeoutBy: TeamId | null,
  rng: Rng,
): { state: GameState; notes: Note[] } {
  const notes: Note[] = [];
  if (prev.over || prev.pendingRunoff <= 0) return { state: prev, notes };
  const state = copy(prev);
  state.pendingRunoff = 0;
  if (timeoutBy && prev.timeouts[timeoutBy] > 0) {
    state.timeouts[timeoutBy] -= 1;
    notes.push({ type: 'timeout', team: timeoutBy });
    return { state, notes };
  }
  let runoff = prev.pendingRunoff;
  const late = prev.quarter === 2 || prev.quarter === 4;
  if (late && prev.clock > TWO_MINUTES && prev.clock - runoff <= TWO_MINUTES) {
    runoff = prev.clock - TWO_MINUTES;
    notes.push({ type: 'twoMinuteWarning' });
  }
  const offense = prev.possession;
  const ahead = prev.score[offense] > prev.score[otherTeam(offense)];
  if (!ahead) runoff = Math.min(runoff, Math.max(0, prev.clock - 1));
  state.clock = prev.clock - runoff;
  if (state.clock <= 0) {
    state.clock = 0;
    endPeriod(state, notes, rng);
  }
  return { state, notes };
}
