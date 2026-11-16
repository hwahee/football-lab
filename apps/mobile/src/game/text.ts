/** Play-by-play wording: engine events and outcomes → localized lines. */
import type { MessageParams } from '@shared/i18n';

import type { MessageKey } from '../i18n/translate';
import type { GameState, Note } from './engine/game';
import type { PlayEvent, Role, TeamId } from './engine/types';
import type { LastPlay } from './useGameSession';

export type Translate = (key: MessageKey, params?: MessageParams) => string;

const percent = (chance: number) => Math.round(chance * 100);

const MIRROR: Partial<Record<Role, Role>> = {
  WR1: 'WR2',
  WR2: 'WR1',
  CB1: 'CB2',
  CB2: 'CB1',
  DE1: 'DE2',
  DE2: 'DE1',
  DT1: 'DT2',
  DT2: 'DT1',
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
    case 'kneel':
      return t(`game.log.${event.type}`);
    case 'bite':
    case 'shed':
      return t(`game.log.${event.type}`, { who: name(event.who) });
    case 'jam':
      return t(event.won ? 'game.log.jam.won' : 'game.log.jam.lost', { who: name(event.who) });
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
      return t(`game.log.${event.type}`, { by: name(event.by), chance: percent(event.chance) });
    case 'escape':
      return t('game.log.escape', { from: name(event.from), chance: percent(event.chance) });
    case 'fumble':
      return t(event.lost ? 'game.log.fumble.lost' : 'game.log.fumble.kept');
    case 'kick':
      return t('game.log.kick', { distance: event.distance, chance: percent(event.chance) });
    case 'punt':
      return t('game.log.punt', { distance: event.distance });
    case 'kickoff':
      return t(event.touchback ? 'game.log.kickoff.touchback' : 'game.log.kickoff');
    case 'return':
      return t('game.log.return', { yards: event.yards });
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

type Mood = 'good' | 'bad' | 'flat';

/** The result headline, and whether it was good news for the team with the ball. */
export function describePlay(t: Translate, last: LastPlay): { headline: string; mood: Mood } {
  const { outcome, yards } = last;
  if (last.nullified || !outcome) return { headline: t('game.result.noPlay'), mood: 'flat' };

  if (last.stage === 'try') {
    if (outcome.kind === 'fieldGoalGood') return { headline: t('game.result.try.kickGood'), mood: 'good' }; // prettier-ignore
    if (outcome.kind === 'fieldGoalMiss') return { headline: t('game.result.try.kickMiss'), mood: 'bad' }; // prettier-ignore
    return outcome.kind === 'touchdown'
      ? { headline: t('game.result.try.twoGood'), mood: 'good' }
      : { headline: t('game.result.try.twoMiss'), mood: 'bad' };
  }

  switch (outcome.kind) {
    case 'tackle':
    case 'outOfBounds':
      if (yards > 0) return { headline: t('game.result.gain', { yards }), mood: yards >= 4 ? 'good' : 'flat' }; // prettier-ignore
      return yards === 0
        ? { headline: t('game.result.noGain'), mood: 'flat' }
        : { headline: t('game.result.loss', { yards: -yards }), mood: 'bad' };
    case 'sack':
      return { headline: t('game.result.sack', { yards: Math.max(0, -yards) }), mood: 'bad' };
    case 'kickoff':
      return {
        headline: t(last.touchback ? 'game.result.touchback' : 'game.result.kickoff'),
        mood: 'flat',
      };
    case 'touchdown':
    case 'fieldGoalGood':
      return { headline: t(`game.result.${outcome.kind}`), mood: 'good' };
    case 'interception':
    case 'fumbleLost':
    case 'safety':
    case 'fieldGoalMiss':
    case 'defensiveTouchdown':
    case 'kickReturnTouchdown':
      return { headline: t(`game.result.${outcome.kind}`), mood: 'bad' };
    case 'incomplete':
    case 'punt':
      return { headline: t(`game.result.${outcome.kind}`), mood: 'flat' };
  }
}

export function describeNote(t: Translate, note: Note): string | null {
  switch (note.type) {
    case 'firstDown':
    case 'turnoverOnDowns':
    case 'halftime':
    case 'final':
    case 'twoMinuteWarning':
    case 'overtime':
      return t(`game.note.${note.type}`);
    case 'safety':
      return t('game.note.safety', { team: teamName(t, note.team) });
    case 'punt':
      return note.touchback ? t('game.note.touchback') : null;
    case 'quarterEnd':
      return t('game.note.quarterEnd', { quarter: note.quarter });
    case 'timeout':
      return t('game.note.timeout', { team: teamName(t, note.team) });
    case 'penalty':
      return t(note.accepted ? 'game.note.penalty' : 'game.note.penalty.declined', {
        foul: t(`game.foul.${note.foul}`),
        team: teamName(t, note.on),
        yards: note.yards,
      });
    // Already the headline.
    case 'touchdown':
    case 'fieldGoal':
    case 'turnover':
    case 'try':
    case 'kickoff':
      return null;
  }
}

export function describeSpot(t: Translate, ballOn: number): string {
  if (ballOn === 50) return t('game.spot.mid');
  return ballOn < 50
    ? t('game.spot.own', { yard: ballOn })
    : t('game.spot.opp', { yard: 100 - ballOn });
}

/** "1ST & 10", "3RD & GOAL" — or what the down is instead (kickoff, try). */
export function describeDown(t: Translate, game: GameState): string {
  if (game.stage === 'kickoff') return t('game.stage.kickoff');
  if (game.stage === 'try') return t('game.stage.try');
  const down = t(`game.down.${Math.min(4, Math.max(1, game.down)) as 1 | 2 | 3 | 4}`);
  return game.ballOn + game.toGo >= 100
    ? t('game.downAndGoal', { down })
    : t('game.downAndDistance', { down, toGo: game.toGo });
}

export function describeQuarter(t: Translate, game: GameState): string {
  if (game.over) return t('game.final');
  return game.quarter >= 5 ? t('game.overtime') : t('game.quarter', { quarter: game.quarter });
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
