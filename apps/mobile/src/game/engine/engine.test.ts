import { describe, expect, test } from 'bun:test';

import { aiDefense, aiOffense, aiWantsTimeout } from './ai';
import {
  applyOutcome,
  canCallTimeout,
  newGame,
  preSnapPenalty,
  settleClock,
  snapSpot,
  type GameConfig,
  type GameState,
} from './game';
import {
  DEFAULT_DEFENSE,
  DEFAULT_OFFENSE,
  defenseAlignment,
  offenseAlignment,
  offsetToward,
} from './playbook';
import { createRng } from './rng';
import { createKickoff, createPlay, fieldGoalChance, runPlay } from './sim';
import {
  DEF_PLAYS,
  DEF_ROLES,
  HALF_WIDTH,
  HASH_X,
  OFF_PLAYS,
  OFF_ROLES,
  type PlayOutcome,
  type TeamId,
} from './types';

const CONFIG: GameConfig = { mode: 'ai', difficulty: 'normal', quarterSeconds: 300 };
const AT = { x: 0, y: 40 };

function outcome(partial: Partial<PlayOutcome>): PlayOutcome {
  return {
    kind: 'tackle',
    spot: 30,
    spotX: 0,
    duration: 5,
    clockStops: false,
    pass: false,
    ...partial,
  };
}

/** A game in progress: home has it, 1st & 10 at its own 25. */
function fresh(overrides: Partial<GameState> = {}): GameState {
  return {
    ...newGame(CONFIG, createRng(1)),
    stage: 'scrimmage',
    possession: 'home',
    ballOn: 25,
    ...overrides,
  };
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
  test('eleven a side, inside the field', () => {
    expect(OFF_ROLES).toHaveLength(11);
    expect(DEF_ROLES).toHaveLength(11);
    for (const play of OFF_PLAYS) {
      const spots = offenseAlignment({ ...DEFAULT_OFFENSE, play }, { x: HASH_X, y: 40 });
      for (const spot of Object.values(spots)) expect(Math.abs(spot.x)).toBeLessThan(HALF_WIDTH);
    }
  });

  test('nobody lines up across the line of scrimmage', () => {
    const off = offenseAlignment(
      { ...DEFAULT_OFFENSE, offsets: { WR1: { x: 0, y: 99 }, RB: { x: 99, y: 99 } } },
      AT,
    );
    const def = defenseAlignment({ ...DEFAULT_DEFENSE, offsets: { MLB: { x: 0, y: -99 } } }, AT, 1);
    for (const spot of Object.values(off)) expect(spot.y).toBeLessThan(40);
    for (const spot of Object.values(def)) expect(spot.y).toBeGreaterThan(40);
  });

  test('the center cannot be moved', () => {
    const base = offenseAlignment(DEFAULT_OFFENSE, AT);
    const moved = offenseAlignment({ ...DEFAULT_OFFENSE, offsets: { C: { x: 5, y: -3 } } }, AT);
    expect(moved.C).toEqual(base.C);
  });

  test('the formation follows the ball to the hash; the outside receivers stay wide', () => {
    const middle = offenseAlignment(DEFAULT_OFFENSE, AT);
    const hash = offenseAlignment(DEFAULT_OFFENSE, { x: HASH_X, y: 40 });
    expect(hash.C.x - middle.C.x).toBeCloseTo(HASH_X);
    expect(hash.WR1.x).toBe(middle.WR1.x);
  });

  test('the tight end is on the strong side and the defense sets its strength to match', () => {
    const right = offenseAlignment(DEFAULT_OFFENSE, AT);
    const left = offenseAlignment({ ...DEFAULT_OFFENSE, flip: true }, AT);
    expect(right.TE.x).toBeGreaterThan(0);
    expect(left.TE.x).toBeLessThan(0);
    expect(defenseAlignment(DEFAULT_DEFENSE, AT, 1).SLB.x).toBeGreaterThan(0);
    expect(defenseAlignment(DEFAULT_DEFENSE, AT, -1).SLB.x).toBeLessThan(0);
  });

  test('a drag past the limit does not accumulate', () => {
    const offset = offsetToward('def', DEFAULT_DEFENSE, 'FS', { x: 100, y: 500 }, AT, 1);
    const spot = defenseAlignment({ ...DEFAULT_DEFENSE, offsets: { FS: offset } }, AT, 1).FS;
    expect(spot.x).toBeLessThan(HALF_WIDTH);
    expect(offsetToward('def', DEFAULT_DEFENSE, 'FS', spot, AT, 1)).toEqual(offset);
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
        AT,
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
        for (const at of [
          { x: 0, y: 2 },
          { x: -HASH_X, y: 50 },
          { x: HASH_X, y: 98 },
        ]) {
          const sim = createPlay(
            game.teams.home,
            game.teams.away,
            { ...DEFAULT_OFFENSE, play, flip: at.y === 50 },
            { ...DEFAULT_DEFENSE, play: defense },
            at,
            createRng(rng.fork()),
          );
          expect(sim.players).toHaveLength(22);
          const result = runPlay(sim);
          expect(result.duration).toBeLessThanOrEqual(16.1);
          // An interception ends as one — never as a "tackle" of the defender.
          if (sim.events.some((event) => event.type === 'interception')) {
            expect(['interception', 'defensiveTouchdown']).toContain(result.kind);
          }
          expect(Number.isFinite(result.spot) && Number.isFinite(result.spotX)).toBe(true);
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
      for (let i = 0; i < 150; i++) {
        const sim = createPlay(
          game.teams.home,
          game.teams.away,
          DEFAULT_OFFENSE,
          { ...DEFAULT_DEFENSE, play: defense },
          { x: 0, y: 30 },
          createRng(rng.fork()),
        );
        total += runPlay(sim).spot - 30;
      }
      return total / 150;
    };
    expect(average('runStop')).toBeLessThan(average('prevent'));
  });

  test('kicks: closer is easier; the extra point is a 33-yard kick', () => {
    expect(fieldGoalChance(90)).toBeGreaterThan(fieldGoalChance(60));
    const rng = createRng(8);
    const game = newGame(CONFIG, rng);
    const sim = createPlay(
      game.teams.home,
      game.teams.away,
      { ...DEFAULT_OFFENSE, play: 'extraPoint' },
      DEFAULT_DEFENSE,
      { x: 0, y: 85 },
      rng,
    );
    expect(['fieldGoalGood', 'fieldGoalMiss']).toContain(runPlay(sim).kind);
    const kick = sim.events.find((event) => event.type === 'kick');
    expect(kick?.type === 'kick' ? kick.distance : null).toBe(32);
  });

  test('a kneel-down loses a yard and keeps the clock running', () => {
    const rng = createRng(4);
    const game = newGame(CONFIG, rng);
    const sim = createPlay(
      game.teams.home,
      game.teams.away,
      { ...DEFAULT_OFFENSE, play: 'kneel' },
      DEFAULT_DEFENSE,
      AT,
      rng,
    );
    expect(runPlay(sim)).toMatchObject({ kind: 'tackle', spot: 39, clockStops: false });
  });

  test('a kickoff ends in a touchback, a return or a touchdown', () => {
    const rng = createRng(21);
    const game = newGame(CONFIG, rng);
    let touchbacks = 0;
    for (let i = 0; i < 60; i++) {
      const sim = createKickoff(game.teams.home, game.teams.away, 35, createRng(rng.fork()));
      const result = runPlay(sim);
      expect(['kickoff', 'kickReturnTouchdown']).toContain(result.kind);
      if (sim.kickoff?.touchback) {
        touchbacks++;
        // Receiving team's 35, seen from the kicking team.
        expect(result.spot).toBe(65);
      }
    }
    expect(touchbacks).toBeGreaterThan(15);
    expect(touchbacks).toBeLessThan(50);
  });
});

describe('game rules: downs and scoring', () => {
  const rng = createRng(1);

  test('a game starts with a kickoff from the 35', () => {
    const game = newGame(CONFIG, createRng(7));
    expect([game.stage, game.kickFrom]).toEqual(['kickoff', 35]);
    expect(game.secondHalfReceiver).toBe(game.possession);
    expect(game.timeouts).toEqual({ home: 3, away: 3 });
  });

  test('a returned kickoff starts the receiving team where it was tackled', () => {
    const start = fresh({ stage: 'kickoff', possession: 'home' });
    const { state } = applyOutcome(start, outcome({ kind: 'kickoff', spot: 72, spotX: 9 }), rng);
    expect([state.stage, state.possession, state.ballOn, state.down]).toEqual([
      'scrimmage',
      'away',
      28,
      1,
    ]);
    // Spotted on the nearest hash, mirrored into the new offense's frame.
    expect(state.ballX).toBeCloseTo(-HASH_X);
  });

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

  test('a touchdown is six, then a try: one for the kick, two from the two', () => {
    const scored = applyOutcome(
      fresh({ ballOn: 90 }),
      outcome({ kind: 'touchdown', spot: 100, clockStops: true }),
      rng,
    ).state;
    expect([scored.score.home, scored.stage, scored.possession]).toEqual([6, 'try', 'home']);
    expect(snapSpot(scored, 'extraPoint').y).toBe(85);
    expect(snapSpot(scored, 'insideRun').y).toBe(98);

    const kicked = applyOutcome(scored, outcome({ kind: 'fieldGoalGood', spot: 85 }), rng);
    expect(kicked.state.score.home).toBe(7);
    expect(kicked.notes).toContainEqual({ type: 'try', points: 1, kick: true });
    // The scoring team kicks off.
    expect([kicked.state.stage, kicked.state.possession]).toEqual(['kickoff', 'home']);

    const two = applyOutcome(scored, outcome({ kind: 'touchdown', spot: 100 }), rng).state;
    expect(two.score.home).toBe(8);
    const stopped = applyOutcome(scored, outcome({ kind: 'tackle', spot: 99 }), rng).state;
    expect(stopped.score.home).toBe(6);
    expect(stopped.clock).toBe(scored.clock);
  });

  test('a field goal is three; a miss gives the ball over at the spot of the kick', () => {
    const good = applyOutcome(fresh({ ballOn: 70 }), outcome({ kind: 'fieldGoalGood' }), rng).state;
    expect([good.score.home, good.stage]).toEqual([3, 'kickoff']);
    const miss = applyOutcome(fresh({ ballOn: 70 }), outcome({ kind: 'fieldGoalMiss' }), rng).state;
    expect([miss.possession, miss.ballOn]).toEqual(['away', 37]);
  });

  test('an interception in the end zone is a touchback; a pick-six scores for the defense', () => {
    const touchback = applyOutcome(
      fresh(),
      outcome({ kind: 'interception', spot: 104, clockStops: true, pass: true }),
      rng,
    ).state;
    expect([touchback.possession, touchback.ballOn]).toEqual(['away', 20]);

    const six = applyOutcome(
      fresh(),
      outcome({ kind: 'defensiveTouchdown', spot: 0, clockStops: true, pass: true }),
      rng,
    ).state;
    expect([six.score.away, six.stage, six.possession]).toEqual([6, 'try', 'away']);
  });

  test('a safety is two points, and the team that gave it up kicks from its 20', () => {
    const { state } = applyOutcome(fresh(), outcome({ kind: 'safety', spot: 0 }), rng);
    expect(state.score.away).toBe(2);
    expect([state.stage, state.possession, state.kickFrom]).toEqual(['kickoff', 'home', 20]);
  });
});

describe('game rules: the clock', () => {
  const rng = createRng(1);

  test('after a tackle 38 seconds are due to run off; an incompletion stops the clock', () => {
    const tackled = applyOutcome(fresh(), outcome({ duration: 4.2 }), rng).state;
    expect([tackled.clock, tackled.pendingRunoff]).toEqual([295, 38]);
    expect(settleClock(tackled, null, rng).state.clock).toBe(257);

    const dropped = applyOutcome(
      fresh(),
      outcome({ kind: 'incomplete', duration: 4.2, clockStops: true }),
      rng,
    ).state;
    expect([dropped.clock, dropped.pendingRunoff]).toEqual([295, 0]);
  });

  test('a timeout saves the runoff and costs one of three', () => {
    const tackled = applyOutcome(fresh(), outcome({}), rng).state;
    expect(canCallTimeout(tackled, 'away')).toBe(true);
    const { state, notes } = settleClock(tackled, 'away', rng);
    expect([state.clock, state.timeouts.away]).toEqual([295, 2]);
    expect(notes).toContainEqual({ type: 'timeout', team: 'away' });
    expect(canCallTimeout(state, 'away')).toBe(false);
  });

  test('going out of bounds stops the clock only late in a half', () => {
    const early = applyOutcome(fresh({ quarter: 1 }), outcome({ kind: 'outOfBounds' }), rng);
    expect(early.state.pendingRunoff).toBe(38);
    const late = applyOutcome(
      fresh({ quarter: 2, clock: 90 }),
      outcome({ kind: 'outOfBounds' }),
      rng,
    );
    expect(late.state.pendingRunoff).toBe(0);
  });

  test('the two-minute warning stops the clock at 2:00', () => {
    const during = applyOutcome(fresh({ quarter: 4, clock: 123 }), outcome({}), rng);
    expect(during.notes).toContainEqual({ type: 'twoMinuteWarning' });
    expect(during.state.pendingRunoff).toBe(0);

    const between = settleClock(fresh({ quarter: 2, clock: 135, pendingRunoff: 30 }), null, rng);
    expect(between.state.clock).toBe(120);
    expect(between.notes).toContainEqual({ type: 'twoMinuteWarning' });
  });

  test('a trailing offense always gets one more snap; a leading one runs the clock out', () => {
    const base = { quarter: 4, clock: 12, pendingRunoff: 30 };
    const trailing = settleClock(fresh({ ...base, score: { home: 0, away: 3 } }), null, rng).state;
    expect([trailing.clock, trailing.over]).toEqual([1, false]);
    const leading = settleClock(fresh({ ...base, score: { home: 3, away: 0 } }), null, rng).state;
    expect(leading.over).toBe(true);
  });

  test('halftime: fresh timeouts and a kickoff to the team that kicked off the game', () => {
    const start = fresh({
      quarter: 2,
      clock: 3,
      secondHalfReceiver: 'away',
      timeouts: { home: 0, away: 1 },
    });
    const { state, notes } = applyOutcome(start, outcome({}), rng);
    expect(notes).toContainEqual({ type: 'halftime' });
    expect([state.quarter, state.stage, state.possession]).toEqual([3, 'kickoff', 'home']);
    expect(state.timeouts).toEqual({ home: 3, away: 3 });
  });

  test('a touchdown as time expires still gets its try before the period ends', () => {
    const scored = applyOutcome(
      fresh({ quarter: 4, clock: 3, score: { home: 0, away: 7 } }),
      outcome({ kind: 'touchdown', spot: 100, clockStops: true }),
      rng,
    ).state;
    expect([scored.over, scored.stage, scored.clock]).toEqual([false, 'try', 0]);
    const tied = applyOutcome(scored, outcome({ kind: 'fieldGoalGood' }), rng);
    // 7–7 at the end of regulation: overtime.
    expect(tied.notes).toContainEqual({ type: 'overtime' });
    expect([tied.state.quarter, tied.state.stage, tied.state.over]).toEqual([5, 'kickoff', false]);
    expect(tied.state.timeouts).toEqual({ home: 2, away: 2 });
  });
});

describe('game rules: overtime', () => {
  const rng = createRng(1);
  const overtime = (overrides: Partial<GameState>) =>
    fresh({ quarter: 5, clock: 200, overtime: { home: 0, away: 0 }, ...overrides });

  test('a touchdown on the first possession does not end it: the other team gets the ball', () => {
    const scored = applyOutcome(
      overtime({ ballOn: 90 }),
      outcome({ kind: 'touchdown', spot: 100, clockStops: true }),
      rng,
    ).state;
    const kicked = applyOutcome(scored, outcome({ kind: 'fieldGoalGood' }), rng).state;
    expect([kicked.over, kicked.stage]).toEqual([false, 'kickoff']);
  });

  test('once both teams have had it, the next lead wins', () => {
    const start = overtime({ overtime: { home: 1, away: 0 }, possession: 'away', ballOn: 70 });
    const { state, notes } = applyOutcome(start, outcome({ kind: 'fieldGoalGood' }), rng);
    expect(state.over).toBe(true);
    expect(notes).toContainEqual({ type: 'final' });
  });

  test('a defensive score on the first possession ends it at once', () => {
    const { state } = applyOutcome(overtime({}), outcome({ kind: 'safety', spot: 0 }), rng);
    expect(state.over).toBe(true);
  });

  test('still tied when the period runs out: a draw', () => {
    const { state } = applyOutcome(overtime({ clock: 2 }), outcome({}), rng);
    expect([state.over, state.score.home, state.score.away]).toEqual([true, 0, 0]);
  });
});

describe('game rules: penalties', () => {
  test('a false start costs five yards and the down is replayed', () => {
    const start = fresh({ down: 2, toGo: 7, ballOn: 40 });
    const flagged = Array.from({ length: 400 }, (_, seed) =>
      preSnapPenalty(start, 'insideRun', createRng(seed + 1)),
    ).find((applied) =>
      applied?.notes.some((n) => n.type === 'penalty' && n.foul === 'falseStart'),
    );
    if (!flagged) throw new Error('no false start in 400 seeds');
    expect(flagged.nullified).toBe(true);
    expect([flagged.state.ballOn, flagged.state.down, flagged.state.toGo]).toEqual([35, 2, 12]);
  });

  test('penalties near the goal line are half the distance', () => {
    const start = fresh({ ballOn: 6 });
    for (let seed = 1; seed < 400; seed++) {
      const applied = preSnapPenalty(start, 'insideRun', createRng(seed));
      const note = applied?.notes.find((n) => n.type === 'penalty');
      if (note?.type === 'penalty' && note.foul === 'falseStart') {
        expect([note.yards, applied!.state.ballOn]).toEqual([3, 3]);
        return;
      }
    }
    throw new Error('no false start in 400 seeds');
  });

  test('flags are thrown during real plays, and an accepted one wipes the play out', () => {
    const rng = createRng(77);
    const game = fresh();
    let accepted = 0;
    for (let i = 0; i < 400; i++) {
      const call = { ...DEFAULT_OFFENSE, play: 'curlFlat' as const };
      const sim = createPlay(game.teams.home, game.teams.away, call, DEFAULT_DEFENSE, AT, createRng(rng.fork())); // prettier-ignore
      const applied = applyOutcome(game, runPlay(sim), rng, sim);
      const note = applied.notes.find((n) => n.type === 'penalty');
      if (note?.type === 'penalty' && note.accepted) {
        accepted++;
        expect(applied.nullified).toBe(true);
        expect(applied.state.possession).toBe('home');
        expect(applied.state.score).toEqual(game.score);
      }
    }
    expect(accepted).toBeGreaterThan(3);
  });
});

/** Coach vs coach: the same loop the app runs, without a screen. */
function playGame(seed: number, config: GameConfig) {
  const rng = createRng(seed);
  let state = newGame(config, rng);
  let snaps = 0;
  while (!state.over && snaps < 1500) {
    const offense = state.teams[state.possession];
    const defense = state.teams[state.possession === 'home' ? 'away' : 'home'];
    snaps++;
    if (state.stage === 'kickoff') {
      const sim = createKickoff(offense, defense, state.kickFrom, rng);
      state = applyOutcome(state, runPlay(sim), rng, sim).state;
    } else {
      const call = aiOffense(state, rng);
      const flag = preSnapPenalty(state, call.play, rng);
      if (flag) {
        state = flag.state;
        continue;
      }
      const sim = createPlay(offense, defense, call, aiDefense(state, rng), snapSpot(state, call.play), rng); // prettier-ignore
      state = applyOutcome(state, runPlay(sim), rng, sim).state;
    }
    const caller = (['home', 'away'] as TeamId[]).find((team) => aiWantsTimeout(state, team));
    state = settleClock(state, caller ?? null, rng).state;

    expect(state.ballOn).toBeGreaterThanOrEqual(1);
    expect(state.ballOn).toBeLessThanOrEqual(99);
    expect(Math.abs(state.ballX)).toBeLessThanOrEqual(HASH_X + 1e-9);
    expect(state.down).toBeLessThanOrEqual(4);
    expect(state.toGo).toBeGreaterThan(0);
    expect(state.clock).toBeGreaterThanOrEqual(0);
  }
  return { state, snaps };
}

describe('a whole game, coach vs coach', () => {
  test('plays to the final whistle with plausible numbers', () => {
    for (const seed of [2026, 7, 99]) {
      const { state, snaps } = playGame(seed, CONFIG);
      expect(state.over).toBe(true);
      expect(snaps).toBeGreaterThan(40);
      expect(snaps).toBeLessThan(400);
      expect(state.score.home + state.score.away).toBeLessThan(120);
      // Only overtime can end level, and only by running out of time.
      if (state.score.home === state.score.away) expect(state.quarter).toBe(5);
    }
  });
});
