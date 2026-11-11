import { describe, expect, test } from 'bun:test';

import { aiDefense, aiOffense } from './ai';
import { applyOutcome, newGame, type GameConfig, type GameState } from './game';
import {
  DEFAULT_DEFENSE,
  DEFAULT_OFFENSE,
  defenseAlignment,
  offenseAlignment,
  offsetToward,
} from './playbook';
import { createRng } from './rng';
import { createPlay, fieldGoalChance, runPlay } from './sim';
import { DEF_PLAYS, OFF_PLAYS, type PlayOutcome } from './types';

const CONFIG: GameConfig = { mode: 'ai', difficulty: 'normal', quarterSeconds: 180 };

function outcome(partial: Partial<PlayOutcome>): PlayOutcome {
  return { kind: 'tackle', spot: 30, duration: 5, clockStops: false, pass: false, ...partial };
}

function fresh(overrides: Partial<GameState> = {}): GameState {
  return { ...newGame(CONFIG, createRng(1)), possession: 'home', ...overrides };
}

describe('rng', () => {
  test('the same seed replays the same stream', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  test('pick respects weights', () => {
    const rng = createRng(3);
    let hits = 0;
    for (let i = 0; i < 2000; i++) if (rng.pick([['a', 3], ['b', 1]] as const) === 'a') hits++; // prettier-ignore
    expect(hits).toBeGreaterThan(1350);
    expect(hits).toBeLessThan(1650);
  });
});

describe('playbook alignment', () => {
  test('nobody lines up across the line of scrimmage', () => {
    const off = offenseAlignment(
      { ...DEFAULT_OFFENSE, offsets: { WR1: { x: 0, y: 99 }, RB: { x: 99, y: 99 } } },
      40,
    );
    const def = defenseAlignment({ ...DEFAULT_DEFENSE, offsets: { LB: { x: 0, y: -99 } } }, 40);
    for (const spot of Object.values(off)) expect(spot.y).toBeLessThan(40);
    for (const spot of Object.values(def)) expect(spot.y).toBeGreaterThan(40);
  });

  test('the center cannot be moved', () => {
    const base = offenseAlignment(DEFAULT_OFFENSE, 40);
    const moved = offenseAlignment({ ...DEFAULT_OFFENSE, offsets: { C: { x: 5, y: -3 } } }, 40);
    expect(moved.C).toEqual(base.C);
  });

  test('a drag past the limit does not accumulate', () => {
    const offset = offsetToward('def', DEFAULT_DEFENSE, 'FS', { x: 100, y: 500 }, 40);
    const spot = defenseAlignment({ ...DEFAULT_DEFENSE, offsets: { FS: offset } }, 40).FS;
    expect(spot.x).toBeLessThanOrEqual(19);
    expect(offsetToward('def', DEFAULT_DEFENSE, 'FS', spot, 40)).toEqual(offset);
  });
});

describe('play simulation', () => {
  test('the same seed and calls give the same play', () => {
    const run = () => {
      const rng = createRng(99);
      const game = newGame(CONFIG, rng);
      const sim = createPlay(
        game.teams.home,
        game.teams.away,
        { ...DEFAULT_OFFENSE, play: 'curlFlat' },
        DEFAULT_DEFENSE,
        30,
        rng,
      );
      return { outcome: runPlay(sim), events: sim.events };
    };
    expect(run()).toEqual(run());
  });

  test('every play against every defense ends with a sane outcome', () => {
    const rng = createRng(5);
    const game = newGame(CONFIG, rng);
    for (const play of OFF_PLAYS) {
      for (const defense of DEF_PLAYS) {
        for (const los of [2, 50, 97]) {
          const sim = createPlay(
            game.teams.home,
            game.teams.away,
            { ...DEFAULT_OFFENSE, play, flip: los === 50 },
            { ...DEFAULT_DEFENSE, play: defense },
            los,
            createRng(rng.fork()),
          );
          const result = runPlay(sim);
          expect(result.duration).toBeLessThanOrEqual(16.1);
          expect(Number.isFinite(result.spot)).toBe(true);
          for (const p of sim.players) {
            expect(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y)).toBe(true);
          }
        }
      }
    }
  });

  test('stacking the box stuffs the inside run more than a prevent defense', () => {
    const rng = createRng(11);
    const game = newGame(CONFIG, rng);
    const average = (defense: 'runStop' | 'prevent') => {
      let total = 0;
      for (let i = 0; i < 200; i++) {
        const sim = createPlay(
          game.teams.home,
          game.teams.away,
          DEFAULT_OFFENSE,
          { ...DEFAULT_DEFENSE, play: defense },
          30,
          createRng(rng.fork()),
        );
        total += runPlay(sim).spot - 30;
      }
      return total / 200;
    };
    expect(average('runStop')).toBeLessThan(average('prevent'));
  });

  test('kicks: closer is easier, and a field goal resolves to good or miss', () => {
    expect(fieldGoalChance(90)).toBeGreaterThan(fieldGoalChance(60));
    const rng = createRng(8);
    const game = newGame(CONFIG, rng);
    const sim = createPlay(
      game.teams.home,
      game.teams.away,
      { ...DEFAULT_OFFENSE, play: 'fieldGoal' },
      DEFAULT_DEFENSE,
      80,
      rng,
    );
    expect(['fieldGoalGood', 'fieldGoalMiss']).toContain(runPlay(sim).kind);
    expect(sim.events.some((e) => e.type === 'kick')).toBe(true);
  });
});

describe('game rules', () => {
  const rng = createRng(1);

  test('a gain short of the line advances the down', () => {
    const { state, yards } = applyOutcome(fresh(), outcome({ spot: 29 }), rng);
    expect(yards).toBe(4);
    expect([state.down, state.toGo, state.ballOn]).toEqual([2, 6, 29]);
  });

  test('reaching the line is a first down', () => {
    const { state, notes } = applyOutcome(fresh(), outcome({ spot: 36 }), rng);
    expect([state.down, state.toGo]).toEqual([1, 10]);
    expect(notes).toContainEqual({ type: 'firstDown' });
  });

  test('failing on fourth down turns the ball over where it lies', () => {
    const { state, notes } = applyOutcome(fresh({ down: 4 }), outcome({ spot: 28 }), rng);
    expect(notes).toContainEqual({ type: 'turnoverOnDowns' });
    expect([state.possession, state.ballOn, state.down]).toEqual(['away', 72, 1]);
  });

  test('a touchdown scores six plus the kick and gives the ball back', () => {
    const { state, notes } = applyOutcome(
      fresh({ ballOn: 90 }),
      outcome({ kind: 'touchdown', spot: 100, clockStops: true }),
      createRng(2),
    );
    const kick = notes.find((n) => n.type === 'extraPoint');
    expect(state.score.home).toBe(kick?.type === 'extraPoint' && kick.good ? 7 : 6);
    expect([state.possession, state.ballOn]).toEqual(['away', 25]);
  });

  test('an interception in the end zone is a touchback', () => {
    const { state } = applyOutcome(
      fresh(),
      outcome({ kind: 'interception', spot: 104, clockStops: true, pass: true }),
      rng,
    );
    expect([state.possession, state.ballOn]).toEqual(['away', 20]);
  });

  test('a safety is two points for the defense', () => {
    const { state } = applyOutcome(fresh(), outcome({ kind: 'safety', spot: 0 }), rng);
    expect(state.score.away).toBe(2);
    expect(state.possession).toBe('away');
  });

  test('the clock runs after a tackle and stops after an incompletion', () => {
    const tackled = applyOutcome(fresh(), outcome({ duration: 4.2 }), rng).state;
    const dropped = applyOutcome(
      fresh(),
      outcome({ kind: 'incomplete', duration: 4.2, clockStops: true }),
      rng,
    ).state;
    expect(tackled.clock).toBe(180 - 5 - 20);
    expect(dropped.clock).toBe(180 - 5);
  });

  test('halftime hands the ball to the other team; the fourth quarter ends the game', () => {
    const start = fresh({ quarter: 2, clock: 3, secondHalfReceiver: 'away' });
    const half = applyOutcome(start, outcome({}), rng);
    expect(half.notes).toContainEqual({ type: 'halftime' });
    expect([half.state.quarter, half.state.possession, half.state.ballOn]).toEqual([3, 'away', 25]);

    const end = applyOutcome(fresh({ quarter: 4, clock: 3 }), outcome({}), rng);
    expect(end.state.over).toBe(true);
    expect(end.notes).toContainEqual({ type: 'final' });
  });
});

describe('a whole game, coach vs coach', () => {
  test('plays to the final whistle with plausible numbers', () => {
    const rng = createRng(2026);
    let state = newGame(CONFIG, rng);
    let plays = 0;
    while (!state.over && plays < 500) {
      const offense = state.teams[state.possession];
      const defense = state.teams[state.possession === 'home' ? 'away' : 'home'];
      const sim = createPlay(offense, defense, aiOffense(state, rng), aiDefense(state, rng), state.ballOn, rng); // prettier-ignore
      state = applyOutcome(state, runPlay(sim), rng).state;
      plays++;
      expect(state.ballOn).toBeGreaterThanOrEqual(1);
      expect(state.ballOn).toBeLessThanOrEqual(99);
      expect(state.down).toBeLessThanOrEqual(4);
      expect(state.toGo).toBeGreaterThan(0);
    }
    expect(state.over).toBe(true);
    expect(plays).toBeGreaterThan(20);
    expect(plays).toBeLessThan(200);
    expect(state.score.home + state.score.away).toBeLessThan(150);
  });
});
