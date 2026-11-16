/**
 * The computer coach. It calls plays the way the situation suggests — by
 * weighted dice, so it stays unpredictable — and nudges a few alignments so
 * its formations are not always textbook.
 *
 * It never looks at the opponent's call: both sides commit before the snap.
 */
import { canCallTimeout, otherTeam, type GameState } from './game';
import { DEFAULT_DEFENSE, DEFAULT_OFFENSE } from './playbook';
import type { Rng } from './rng';
import { fieldGoalDistance } from './sim';
import type {
  Cushion,
  DefPlayId,
  DefenseCall,
  OffPlayId,
  OffenseCall,
  TeamId,
  Risk,
  ScrimmagePlayId,
} from './types';

/** easy: nearly random calls · hard: sticks to what the situation favors. */
function sharpen<T>(weights: readonly (readonly [T, number])[], state: GameState) {
  const power = state.config.difficulty === 'easy' ? 0.35 : state.config.difficulty === 'hard' ? 1.5 : 1; // prettier-ignore
  return weights.map(([item, weight]) => [item, Math.pow(weight, power)] as const);
}

function fourthDown(state: GameState, rng: Rng): OffPlayId | null {
  const { ballOn, toGo, quarter, clock } = state;
  const deficit = state.score[state.possession === 'home' ? 'away' : 'home'] - state.score[state.possession]; // prettier-ignore
  const kick = fieldGoalDistance(ballOn);
  const desperate = quarter === 4 && clock < 100 && deficit > 0;
  if (desperate) return deficit <= 3 && kick <= 55 ? 'fieldGoal' : null;
  if (kick <= 50) return toGo <= 1 && ballOn >= 95 && rng.chance(0.5) ? null : 'fieldGoal';
  if (toGo <= 2 && ballOn >= 45 && rng.chance(0.6)) return null;
  if (ballOn >= 60 && toGo <= 4) return null;
  return 'punt';
}

/** After a touchdown: kick the point, or go for two when the score says so. */
function tryCall(state: GameState): OffPlayId | null {
  const lead = state.score[state.possession] - state.score[otherTeam(state.possession)];
  const late = state.quarter >= 4;
  // Down 2 (tie it), down 5 (get within a field goal), up 1 (make it a field-goal game).
  return late && (lead === -2 || lead === -5 || lead === 1) ? null : 'extraPoint';
}

/** Ahead late with the defense out of timeouts: take a knee and let the clock die. */
function canKneelOut(state: GameState): boolean {
  const defense = otherTeam(state.possession);
  const ahead = state.score[state.possession] > state.score[defense];
  const snapsLeft = 4 - state.down;
  return (
    ahead && state.quarter >= 4 && state.timeouts[defense] === 0 && state.clock <= snapsLeft * 40
  );
}

export function aiOffense(state: GameState, rng: Rng): OffenseCall {
  const { down, toGo, ballOn, quarter, clock } = state;
  const lastSeconds = (quarter === 2 || quarter >= 4) && clock <= 8;
  let play: OffPlayId | null = null;
  if (state.stage === 'try') play = tryCall(state);
  else if (canKneelOut(state)) play = 'kneel';
  else if (lastSeconds && fieldGoalDistance(ballOn) <= 55) play = 'fieldGoal';
  else if (down === 4) play = fourthDown(state, rng);

  if (play === null) {
    const weights: readonly (readonly [ScrimmagePlayId, number])[] =
      toGo <= 3
        ? [['insideRun', 4], ['outsideRun', 2.5], ['quickSlant', 2], ['playAction', 1.5], ['curlFlat', 1], ['screen', 0.7], ['deepShot', 0.5]] // prettier-ignore
        : toGo <= 7
          ? [['insideRun', 2], ['outsideRun', 2], ['quickSlant', 2.5], ['curlFlat', 2.5], ['playAction', 1.5], ['screen', 1.2], ['deepShot', 1]] // prettier-ignore
          : [['insideRun', 0.8], ['outsideRun', 1], ['quickSlant', 2], ['curlFlat', 3], ['deepShot', 2], ['playAction', 1.5], ['screen', 1.5]]; // prettier-ignore
    play = rng.pick(sharpen(weights, state));
  }

  const risk: Risk =
    down >= 3 && toGo >= 8
      ? 'aggressive'
      : rng.pick([['safe', 1], ['balanced', 2.5], ['aggressive', 1]] as const); // prettier-ignore
  const call: OffenseCall = { ...DEFAULT_OFFENSE, play, flip: rng.chance(0.5), risk, offsets: {} };
  // Vary the receiver splits and the back's depth a little.
  if (rng.chance(0.6)) call.offsets.WR1 = { x: rng.range(-2, 4), y: 0 };
  if (rng.chance(0.6)) call.offsets.WR2 = { x: rng.range(-4, 2), y: 0 };
  if (rng.chance(0.4)) call.offsets.WR3 = { x: rng.range(-3, 3), y: 0 };
  if (rng.chance(0.3)) call.offsets.RB = { x: rng.range(-1.5, 1.5), y: rng.range(-1, 1) };
  return call;
}

export function aiDefense(state: GameState, rng: Rng): DefenseCall {
  const { down, toGo, ballOn } = state;
  const weights: readonly (readonly [DefPlayId, number])[] =
    toGo <= 3
      ? [['runStop', 4], ['man', 2.5], ['blitz', 2], ['zone', 1], ['prevent', 0.1]] // prettier-ignore
      : toGo <= 7
        ? [['man', 3], ['zone', 2.5], ['blitz', 1.5], ['runStop', 1.5], ['prevent', 0.3]] // prettier-ignore
        : [['zone', 3], ['man', 2.5], ['prevent', down >= 3 ? 2.5 : 1], ['blitz', 1.5], ['runStop', 0.4]]; // prettier-ignore
  const play = rng.pick(sharpen(weights, state));
  const cushion: Cushion =
    ballOn >= 90
      ? 'tight'
      : toGo >= 10
        ? rng.pick([['normal', 2], ['soft', 2], ['tight', 0.5]] as const) // prettier-ignore
        : rng.pick([['tight', 1.5], ['normal', 2.5], ['soft', 0.7]] as const); // prettier-ignore
  const call: DefenseCall = { ...DEFAULT_DEFENSE, play, cushion, offsets: {} };
  if (rng.chance(0.5)) call.offsets.MLB = { x: rng.range(-2.5, 2.5), y: rng.range(-0.5, 1) };
  if (rng.chance(0.4)) call.offsets.FS = { x: rng.range(-4, 4), y: rng.range(-2, 2) };
  return call;
}

/** Whether the computer burns a timeout to save the seconds about to run off. */
export function aiWantsTimeout(state: GameState, team: TeamId): boolean {
  if (!canCallTimeout(state, team) || state.stage !== 'scrimmage') return false;
  const behindOrTied = state.score[team] <= state.score[otherTeam(team)];
  const endOfHalf = state.quarter === 2 && state.clock <= 60;
  const endOfGame = state.quarter >= 4 && state.clock <= 150;
  if (state.possession === team) {
    // With the ball: only when it still needs points and time is short.
    return behindOrTied && (endOfGame || endOfHalf) && state.clock <= 60;
  }
  // On defense: stop the clock to get the ball back.
  return behindOrTied && endOfGame;
}
