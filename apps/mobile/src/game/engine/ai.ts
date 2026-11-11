/**
 * The computer coach. It calls plays the way the situation suggests — by
 * weighted dice, so it stays unpredictable — and nudges a few alignments so
 * its formations are not always textbook.
 *
 * It never looks at the opponent's call: both sides commit before the snap.
 */
import type { GameState } from './game';
import { DEFAULT_DEFENSE, DEFAULT_OFFENSE } from './playbook';
import type { Rng } from './rng';
import { fieldGoalDistance } from './sim';
import type {
  Cushion,
  DefPlayId,
  DefenseCall,
  OffPlayId,
  OffenseCall,
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

export function aiOffense(state: GameState, rng: Rng): OffenseCall {
  const { down, toGo, ballOn, quarter, clock } = state;
  const lastSeconds = (quarter === 2 || quarter === 4) && clock <= 8;
  let play: OffPlayId | null = null;
  if (lastSeconds && fieldGoalDistance(ballOn) <= 55) play = 'fieldGoal';
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
  if (rng.chance(0.5)) call.offsets.LB = { x: rng.range(-2.5, 2.5), y: rng.range(-0.5, 1) };
  if (rng.chance(0.4)) call.offsets.FS = { x: rng.range(-4, 4), y: rng.range(-2, 2) };
  return call;
}
