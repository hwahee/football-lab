/**
 * The game around the plays: score, downs, clock and possession.
 *
 * `applyOutcome` is a pure function — the previous state and a play's outcome
 * in, the next state and a list of `notes` (what the scoreboard should
 * announce) out. Simplified rules, on purpose:
 *   - no kickoffs: every drive after a score or at the half starts at the 25
 *   - the extra point after a touchdown is kicked automatically (a 94% roll)
 *   - an interception is down where it is caught (no returns)
 *   - a tied game ends as a draw
 */
import type { Rng } from './rng';
import { createTeam } from './teams';
import type { PlayOutcome, Team, TeamId } from './types';

type GameMode = 'ai' | 'pvp';
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];
export const QUARTER_LENGTHS = [120, 180, 300] as const;

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
}

export interface GameState {
  config: GameConfig;
  teams: Record<TeamId, Team>;
  score: Record<TeamId, number>;
  quarter: number;
  /** Seconds left in the quarter. */
  clock: number;
  possession: TeamId;
  /** Yards from the offense's own goal line (1–99). */
  ballOn: number;
  down: number;
  toGo: number;
  secondHalfReceiver: TeamId;
  over: boolean;
  stats: Record<TeamId, TeamStats>;
}

export type Note =
  | { type: 'firstDown' }
  | { type: 'turnoverOnDowns' }
  | { type: 'touchdown'; team: TeamId }
  | { type: 'extraPoint'; good: boolean }
  | { type: 'fieldGoal'; good: boolean }
  | { type: 'safety'; team: TeamId }
  | { type: 'turnover'; kind: 'interception' | 'fumble' }
  | { type: 'punt'; touchback: boolean }
  | { type: 'quarterEnd'; quarter: number }
  | { type: 'halftime' }
  | { type: 'final' };

const EXTRA_POINT_CHANCE = 0.94;
const DRIVE_START = 25;
/** Seconds that run off between plays while the clock is moving. */
const RUNOFF = 20;

export function otherTeam(team: TeamId): TeamId {
  return team === 'home' ? 'away' : 'home';
}

const AI_BONUS: Record<Difficulty, number> = { easy: -5, normal: 0, hard: 5 };

function emptyStats(): TeamStats {
  return { plays: 0, rushYards: 0, passYards: 0, turnovers: 0, firstDowns: 0 };
}

export function newGame(config: GameConfig, rng: Rng): GameState {
  const first: TeamId = rng.chance(0.5) ? 'home' : 'away';
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
    possession: first,
    ballOn: DRIVE_START,
    down: 1,
    toGo: 10,
    secondHalfReceiver: otherTeam(first),
    over: false,
    stats: { home: emptyStats(), away: emptyStats() },
  };
}

function clampSpot(spot: number): number {
  return Math.max(1, Math.min(99, Math.round(spot)));
}

/** The side controlled by the AI, if any. */
export function aiTeam(state: GameState): TeamId | null {
  return state.config.mode === 'ai' ? 'away' : null;
}

export interface Applied {
  state: GameState;
  notes: Note[];
  /** Net yards on a scrimmage play (0 for kicks and turnovers). */
  yards: number;
}

export function applyOutcome(prev: GameState, outcome: PlayOutcome, rng: Rng): Applied {
  const offense = prev.possession;
  const defense = otherTeam(offense);
  const notes: Note[] = [];
  const state: GameState = {
    ...prev,
    score: { ...prev.score },
    stats: { home: { ...prev.stats.home }, away: { ...prev.stats.away } },
  };
  const stats = state.stats[offense];
  let yards = 0;

  const startDrive = (team: TeamId, ballOn: number) => {
    state.possession = team;
    state.ballOn = clampSpot(ballOn);
    state.down = 1;
    state.toGo = Math.min(10, 100 - state.ballOn);
  };
  const gain = (spot: number) => {
    yards = clampSpot(spot) - prev.ballOn;
    stats.plays += 1;
    if (outcome.pass) stats.passYards += yards;
    else stats.rushYards += yards;
  };

  switch (outcome.kind) {
    case 'touchdown': {
      gain(100);
      yards = 100 - prev.ballOn;
      state.score[offense] += 6;
      notes.push({ type: 'touchdown', team: offense });
      const good = rng.chance(EXTRA_POINT_CHANCE);
      if (good) state.score[offense] += 1;
      notes.push({ type: 'extraPoint', good });
      startDrive(defense, DRIVE_START);
      break;
    }
    case 'safety':
      stats.plays += 1;
      state.score[defense] += 2;
      notes.push({ type: 'safety', team: defense });
      // The team that gave up the safety kicks the ball away.
      startDrive(defense, 35);
      break;
    case 'interception':
    case 'fumbleLost':
      stats.plays += 1;
      stats.turnovers += 1;
      notes.push({
        type: 'turnover',
        kind: outcome.kind === 'interception' ? 'interception' : 'fumble',
      });
      // Caught in the end zone = touchback.
      startDrive(defense, outcome.spot >= 100 ? 20 : 100 - outcome.spot);
      break;
    case 'punt': {
      const touchback = outcome.spot >= 100;
      notes.push({ type: 'punt', touchback });
      startDrive(defense, touchback ? 20 : 100 - outcome.spot);
      break;
    }
    case 'fieldGoalGood':
      state.score[offense] += 3;
      notes.push({ type: 'fieldGoal', good: true });
      startDrive(defense, DRIVE_START);
      break;
    case 'fieldGoalMiss':
      notes.push({ type: 'fieldGoal', good: false });
      startDrive(defense, Math.max(20, 100 - prev.ballOn));
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
      if (state.ballOn >= line) {
        state.down = 1;
        state.toGo = Math.min(10, 100 - state.ballOn);
        stats.firstDowns += 1;
        notes.push({ type: 'firstDown' });
      } else {
        state.down += 1;
        state.toGo = line - state.ballOn;
      }
      break;
    }
  }

  if (state.possession === offense && state.down > 4) {
    notes.push({ type: 'turnoverOnDowns' });
    startDrive(defense, 100 - state.ballOn);
  }

  // ── clock ──────────────────────────────────────────────────────────────────
  state.clock -= Math.ceil(outcome.duration) + (outcome.clockStops ? 0 : RUNOFF);
  if (state.clock <= 0) {
    if (state.quarter === 4) {
      state.clock = 0;
      state.over = true;
      notes.push({ type: 'final' });
    } else {
      notes.push(
        state.quarter === 2 ? { type: 'halftime' } : { type: 'quarterEnd', quarter: state.quarter },
      );
      if (state.quarter === 2) startDrive(state.secondHalfReceiver, DRIVE_START);
      state.quarter += 1;
      state.clock = state.config.quarterSeconds;
    }
  }
  return { state, notes, yards };
}
