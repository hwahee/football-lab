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
/** An NFL field is 53⅓ yards wide. */
export const HALF_WIDTH = 80 / 3;
export const END_ZONE = 10;
/** The hash marks are 18 feet 6 inches apart; the ball is never spotted outside them. */
export const HASH_X = 37 / 12;

export interface Vec {
  x: number;
  y: number;
}

export type TeamId = 'home' | 'away';

export const OFF_ROLES = [
  'QB',
  'RB',
  'WR1',
  'WR2',
  'WR3',
  'TE',
  'LT',
  'LG',
  'C',
  'RG',
  'RT',
] as const;
export type OffRole = (typeof OFF_ROLES)[number];

/** A 4-3 front: four linemen, strong-side / middle / weak-side linebackers, two corners, two safeties. */
export const DEF_ROLES = [
  'DE1',
  'DT1',
  'DT2',
  'DE2',
  'SLB',
  'MLB',
  'WLB',
  'CB1',
  'CB2',
  'FS',
  'SS',
] as const;
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
export type ScrimmagePlayId = (typeof OFF_PLAYS)[number];
/** Plays the defense has no call against: the kicks, and taking a knee. */
export type SpecialPlayId = 'punt' | 'fieldGoal' | 'extraPoint' | 'kneel';
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
  return isKick(play) || play === 'kneel';
}

function isKick(play: OffPlayId): boolean {
  return play === 'punt' || play === 'fieldGoal' || play === 'extraPoint';
}

/** Where the ball is snapped from: the yard line and how far off-center (between the hashes). */
export interface Scrimmage {
  /** Yards from the offense's own goal line. */
  y: number;
  /** Across the field; within ±HASH_X. */
  x: number;
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
  | { type: 'kickoff'; touchback: boolean }
  | { type: 'return'; yards: number }
  | { type: 'kneel' }
);

type OutcomeKind =
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
  | 'fieldGoalMiss'
  /** The kickoff is over: `spot` is where the receiving team is down (kicking team's frame). */
  | 'kickoff'
  | 'kickReturnTouchdown'
  /** An interception run all the way back. */
  | 'defensiveTouchdown';

export interface PlayOutcome {
  kind: OutcomeKind;
  /** Where the ball ended up (offense frame). */
  spot: number;
  /** …and how far off-center (not yet clamped to the hashes). */
  spotX: number;
  /** Seconds the play took. */
  duration: number;
  /** Incompletions, out of bounds, scores and changes of possession stop the clock. */
  clockStops: boolean;
  pass: boolean;
}
