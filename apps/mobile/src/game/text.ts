/** Play-by-play wording: engine events and outcomes → localized lines. */
import type { MessageParams } from '@shared/i18n';

import type { MessageKey } from '../i18n/translate';
import type { GameState, Note } from './engine/game';
import type { OutcomeKind, PlayEvent, Role, TeamId } from './engine/types';

export type Translate = (key: MessageKey, params?: MessageParams) => string;

const percent = (chance: number) => Math.round(chance * 100);

const MIRROR: Partial<Record<Role, Role>> = {
  WR1: 'WR2',
  WR2: 'WR1',
  CB1: 'CB2',
  CB2: 'CB1',
  DE1: 'DE2',
  DE2: 'DE1',
};

/**
 * A position's label. "Left" and "right" in the labels mean left and right ON
 * SCREEN, so when the away team has the ball (it attacks down the screen, and
 * everything is mirrored) pass `mirrored` to swap the sided positions.
 */
export function roleName(t: Translate, role: Role, mirrored = false): string {
  return t(`game.role.${mirrored ? (MIRROR[role] ?? role) : role}`);
}

export function teamName(t: Translate, team: TeamId): string {
  return t(`game.team.${team}`);
}

export function describeEvent(t: Translate, event: PlayEvent, mirrored = false): string {
  const name = (role: Role) => roleName(t, role, mirrored);
  switch (event.type) {
    case 'handoff':
    case 'fake':
    case 'pressure':
    case 'scramble':
    case 'throwAway':
    case 'outOfBounds':
    case 'touchdown':
    case 'safety':
      return t(`game.log.${event.type}`);
    case 'bite':
    case 'shed':
      return t(`game.log.${event.type}`, { who: name(event.who) });
    case 'jam':
      return t(event.won ? 'game.log.jam.won' : 'game.log.jam.lost', { who: name(event.who) }); // prettier-ignore
    case 'burn':
      return t('game.log.burn', { who: name(event.who), by: name(event.by) });
    case 'throw':
      return t('game.log.throw', {
        target: name(event.target),
        distance: event.distance,
        chance: percent(event.chance),
      });
    case 'catch':
      return t('game.log.catch', { chance: percent(event.chance) });
    case 'incomplete':
      return t(event.brokenUp ? 'game.log.brokenUp' : 'game.log.incomplete', {
        chance: percent(event.chance),
      });
    case 'interception':
    case 'sack':
    case 'tackle':
    case 'brokenTackle':
      return t(`game.log.${event.type}`, { by: name(event.by), chance: percent(event.chance) }); // prettier-ignore
    case 'escape':
      return t('game.log.escape', { from: name(event.from), chance: percent(event.chance) });
    case 'fumble':
      return t(event.lost ? 'game.log.fumble.lost' : 'game.log.fumble.kept');
    case 'kick':
      return t('game.log.kick', { distance: event.distance, chance: percent(event.chance) });
    case 'punt':
      return t('game.log.punt', { distance: event.distance });
  }
}

/** Events that decide a play get the highlight color in the log. */
export function isBigEvent(event: PlayEvent): boolean {
  return (
    event.type === 'touchdown' ||
    event.type === 'interception' ||
    event.type === 'sack' ||
    event.type === 'safety' ||
    event.type === 'catch' ||
    (event.type === 'fumble' && event.lost)
  );
}

export function describeOutcome(t: Translate, kind: OutcomeKind, yards: number): string {
  switch (kind) {
    case 'tackle':
    case 'outOfBounds':
      if (yards > 0) return t('game.result.gain', { yards });
      return yards === 0 ? t('game.result.noGain') : t('game.result.loss', { yards: -yards });
    case 'sack':
      return t('game.result.sack', { yards: Math.max(0, -yards) });
    default:
      return t(`game.result.${kind}`);
  }
}

/** Was the play good for the offense? Colors the headline. */
export function outcomeMood(kind: OutcomeKind, yards: number): 'good' | 'bad' | 'flat' {
  if (kind === 'touchdown' || kind === 'fieldGoalGood') return 'good';
  if (kind === 'interception' || kind === 'fumbleLost' || kind === 'safety' || kind === 'sack' || kind === 'fieldGoalMiss') return 'bad'; // prettier-ignore
  if (kind === 'tackle' || kind === 'outOfBounds') return yards >= 4 ? 'good' : yards < 0 ? 'bad' : 'flat'; // prettier-ignore
  return 'flat';
}

export function describeNote(t: Translate, note: Note): string | null {
  switch (note.type) {
    case 'firstDown':
    case 'turnoverOnDowns':
    case 'halftime':
    case 'final':
      return t(`game.note.${note.type}`);
    case 'extraPoint':
      return t(note.good ? 'game.note.extraPoint.good' : 'game.note.extraPoint.miss');
    case 'safety':
      return t('game.note.safety', { team: teamName(t, note.team) });
    case 'punt':
      return note.touchback ? t('game.note.touchback') : null;
    case 'quarterEnd':
      return t('game.note.quarterEnd', { quarter: note.quarter });
    // Already the headline.
    case 'touchdown':
    case 'fieldGoal':
    case 'turnover':
      return null;
  }
}

export function describeSpot(t: Translate, ballOn: number): string {
  if (ballOn === 50) return t('game.spot.mid');
  return ballOn < 50 ? t('game.spot.own', { yard: ballOn }) : t('game.spot.opp', { yard: 100 - ballOn }); // prettier-ignore
}

export function describeDown(t: Translate, game: GameState): string {
  const down = t(`game.down.${Math.min(4, Math.max(1, game.down)) as 1 | 2 | 3 | 4}`);
  return game.ballOn + game.toGo >= 100
    ? t('game.downAndGoal', { down })
    : t('game.downAndDistance', { down, toGo: game.toGo });
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
