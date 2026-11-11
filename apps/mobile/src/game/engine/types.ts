/**
 * Shared vocabulary of the football engine.
 *
 * COORDINATES — everything in the engine is in the OFFENSE FRAME, in yards:
 *   x: across the field, -HALF_WIDTH (left) … +HALF_WIDTH (right)
 *   y: downfield. 0 = the offense's own goal line, 100 = the goal line it is
 *      attacking; the end zones are y < 0 and y > 100.
 * The renderer converts to world space (render/scene.ts); the engine never
 * knows which way a team faces on screen.
 */
export const HALF_WIDTH = 20;
export const END_ZONE = 10;

export interface Vec {
  x: number;
  y: number;
}

export type TeamId = 'home' | 'away';

export const OFF_ROLES = ['QB', 'RB', 'C', 'LG', 'RG', 'WR1', 'WR2'] as const;
export type OffRole = (typeof OFF_ROLES)[number];

export const DEF_ROLES = ['DE1', 'NT', 'DE2', 'LB', 'CB1', 'CB2', 'FS'] as const;
export type DefRole = (typeof DEF_ROLES)[number];

export type Role = OffRole | DefRole;

/** 0–100 each. speed → top speed, power → blocking/shedding/breaking tackles, skill → hands/coverage/tackling/accuracy. */
export interface Ratings {
  speed: number;
  power: number;
  skill: number;
}

export interface Team {
  id: TeamId;
  offense: Record<OffRole, Ratings>;
  defense: Record<DefRole, Ratings>;
}

export const OFF_PLAYS = [
  'insideRun',
  'outsideRun',
  'quickSlant',
  'curlFlat',
  'deepShot',
  'playAction',
  'screen',
] as const;
export const SPECIAL_PLAYS = ['punt', 'fieldGoal'] as const;
export type ScrimmagePlayId = (typeof OFF_PLAYS)[number];
export type SpecialPlayId = (typeof SPECIAL_PLAYS)[number];
export type OffPlayId = ScrimmagePlayId | SpecialPlayId;

export const DEF_PLAYS = ['man', 'zone', 'blitz', 'runStop', 'prevent'] as const;
export type DefPlayId = (typeof DEF_PLAYS)[number];

export const RISKS = ['safe', 'balanced', 'aggressive'] as const;
/** How tight a window the quarterback is willing to throw into. */
export type Risk = (typeof RISKS)[number];

export const CUSHIONS = ['tight', 'normal', 'soft'] as const;
/** How far off the receivers the corners line up. */
export type Cushion = (typeof CUSHIONS)[number];

export interface OffenseCall {
  play: OffPlayId;
  /** Mirror the play to the left. */
  flip: boolean;
  risk: Risk;
  /** Per-player alignment tweaks, added to the play's formation. */
  offsets: Partial<Record<OffRole, Vec>>;
}

export interface DefenseCall {
  play: DefPlayId;
  cushion: Cushion;
  offsets: Partial<Record<DefRole, Vec>>;
}

export function isSpecial(play: OffPlayId): play is SpecialPlayId {
  return play === 'punt' || play === 'fieldGoal';
}

export function isRunPlay(play: OffPlayId): boolean {
  return play === 'insideRun' || play === 'outsideRun';
}

/** What happened during a play, in order — the UI turns these into the play-by-play. */
export type PlayEvent = { t: number } & (
  | { type: 'handoff' }
  | { type: 'fake' }
  | { type: 'bite'; who: DefRole }
  | { type: 'jam'; who: DefRole; won: boolean }
  | { type: 'burn'; who: DefRole; by: OffRole }
  | { type: 'shed'; who: DefRole }
  | { type: 'pressure' }
  | { type: 'scramble' }
  | { type: 'throw'; target: OffRole; chance: number; distance: number }
  | { type: 'throwAway' }
  | { type: 'catch'; target: OffRole; chance: number }
  | { type: 'incomplete'; target: OffRole; chance: number; brokenUp: boolean }
  | { type: 'interception'; by: DefRole; chance: number }
  | { type: 'sack'; by: DefRole; chance: number }
  | { type: 'escape'; from: DefRole; chance: number }
  | { type: 'tackle'; by: DefRole; chance: number }
  | { type: 'brokenTackle'; by: DefRole; chance: number }
  | { type: 'fumble'; lost: boolean }
  | { type: 'outOfBounds' }
  | { type: 'touchdown' }
  | { type: 'safety' }
  | { type: 'kick'; chance: number; distance: number }
  | { type: 'punt'; distance: number }
);

export type OutcomeKind =
  | 'tackle'
  | 'outOfBounds'
  | 'touchdown'
  | 'incomplete'
  | 'sack'
  | 'interception'
  | 'fumbleLost'
  | 'safety'
  | 'punt'
  | 'fieldGoalGood'
  | 'fieldGoalMiss';

export interface PlayOutcome {
  kind: OutcomeKind;
  /** Where the ball ended up (offense frame). */
  spot: number;
  /** Seconds the play took. */
  duration: number;
  /** Incompletions, out of bounds, scores and changes of possession stop the clock. */
  clockStops: boolean;
  pass: boolean;
}
