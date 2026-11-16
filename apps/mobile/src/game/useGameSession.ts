/**
 * The game session: which phase the match is in, whose turn it is at the
 * controls, and the loop that plays a snap out.
 *
 *   menu → kickoff → offense → (handover → defense) → presnap → live → result → … → final
 *
 * `presnap` and `live` are the locked phases: once START is pressed the hook
 * exposes no action that changes anything until the play is over.
 *
 * React state holds only what the UI shows. The running simulation lives in a
 * ref and is read by `getFrame`, which the 3D view calls every frame.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { aiDefense, aiOffense, aiWantsTimeout } from './engine/ai';
import {
  aiTeam,
  applyOutcome,
  newGame,
  otherTeam,
  preSnapPenalty,
  settleClock,
  snapSpot,
  type GameConfig,
  type GameState,
  type Note,
  type Stage,
} from './engine/game';
import {
  DEFAULT_DEFENSE,
  DEFAULT_OFFENSE,
  defenseAlignment,
  isMovable,
  offenseAlignment,
  offsetToward,
  strengthOf,
} from './engine/playbook';
import { createRng, type Rng } from './engine/rng';
import { SIM_DT, createKickoff, createPlay, stepPlay, type PlaySim } from './engine/sim';
import {
  isSpecial,
  type DefRole,
  type DefenseCall,
  type OffRole,
  type OffenseCall,
  type PlayEvent,
  type PlayOutcome,
  type Role,
  type TeamId,
  type Vec,
} from './engine/types';
import type { SceneFrame } from './render/scene';
import { fromWorld, idleFrame, pickRole, playFrame, setupFrame, toWorld, type SetupView } from './view'; // prettier-ignore

type Phase =
  'menu' | 'kickoff' | 'offense' | 'handover' | 'defense' | 'presnap' | 'live' | 'result' | 'final';

export interface LastPlay {
  /** The team that had the ball (or kicked off). */
  offense: TeamId;
  /** What kind of down it was — a kickoff and a try read differently. */
  stage: Stage;
  /** Null when a flag before the snap meant there was no play. */
  outcome: PlayOutcome | null;
  events: PlayEvent[];
  notes: Note[];
  yards: number;
  /** A penalty wiped the play out. */
  nullified: boolean;
  touchback: boolean;
}

interface Session {
  phase: Phase;
  config: GameConfig;
  game: GameState | null;
  /** The team at the controls during offense/defense/handover. */
  turn: TeamId | null;
  offCall: OffenseCall;
  defCall: DefenseCall;
  selected: Role | null;
  /** Events of the play in progress, as they happen. */
  feed: PlayEvent[];
  last: LastPlay | null;
  /** What happened between plays (timeout, two-minute warning, end of a quarter…). */
  notices: Note[];
}

const INITIAL: Session = {
  phase: 'menu',
  config: { mode: 'ai', difficulty: 'normal', quarterSeconds: 180 },
  game: null,
  turn: null,
  offCall: DEFAULT_OFFENSE,
  defCall: DEFAULT_DEFENSE,
  selected: null,
  feed: [],
  last: null,
  notices: [],
};

interface Memory {
  off: OffenseCall;
  def: DefenseCall;
}

/** Seconds the final picture is held before the result panel appears. */
const END_HOLD = 1.1;

/** What the field shows while `game`'s next snap is being set up. */
function setupView(s: Session, game: GameState): SetupView {
  return {
    offense: game.possession,
    at: snapSpot(game, s.offCall.play),
    toGo: game.stage === 'scrimmage' ? game.toGo : null,
    offCall: s.offCall,
    defCall: s.defCall,
    reveal: s.phase === 'offense' ? 'offense' : s.phase === 'defense' ? 'defense' : 'none',
    selected: s.selected,
  };
}

export interface GameSession {
  session: Session;
  /** True while a play is running: nothing may be changed. */
  locked: boolean;
  getFrame: (dt: number) => SceneFrame;
  setConfig: (patch: Partial<GameConfig>) => void;
  startGame: () => void;
  backToMenu: () => void;
  setOffense: (patch: Partial<OffenseCall>) => void;
  setDefense: (patch: Partial<DefenseCall>) => void;
  select: (role: Role | null) => void;
  /** Moves the selected player by a SCREEN-relative step (yards; +x right, +z down). */
  nudge: (dx: number, dz: number) => void;
  resetPlacement: () => void;
  fieldTouch: (phase: 'start' | 'move' | 'end', world: { x: number; z: number }) => void;
  lockIn: () => void;
  ready: () => void;
  start: () => void;
  /** On to the next snap; `timeoutBy` stops the clock first. */
  next: (timeoutBy?: TeamId) => void;
}

export function useGameSession(): GameSession {
  const [session, setSession] = useState<Session>(INITIAL);
  // The frame loop and the touch handlers read the latest state without re-subscribing.
  const latest = useRef(session);
  useEffect(() => {
    latest.current = session;
  });

  const rng = useRef<Rng>(createRng(1));
  const sim = useRef<PlaySim | null>(null);
  const memory = useRef<Record<TeamId, Memory>>({
    home: { off: DEFAULT_OFFENSE, def: DEFAULT_DEFENSE },
    away: { off: DEFAULT_OFFENSE, def: DEFAULT_DEFENSE },
  });
  const presnap = useRef({ t: 0, duration: 0.4, disguise: null as DefenseCall | null });
  const loop = useRef<{
    carry: number;
    hold: number;
    feedCount: number;
    done: boolean;
    /** Yards to the line to gain when the play started (null: kickoff or try). */
    toGo: number | null;
  }>({ carry: 0, hold: 0, feedCount: 0, done: false, toGo: 10 });
  const dragging = useRef<Role | null>(null);

  /** Sets the board up for the next snap of `game`. */
  const beginDown = useCallback((game: GameState): Partial<Session> => {
    sim.current = null;
    if (game.over) return { phase: 'final', turn: null, selected: null };
    if (game.stage === 'kickoff') return { phase: 'kickoff', turn: null, selected: null };
    const offense = game.possession;
    const defense = otherTeam(offense);
    if (aiTeam(game) === offense) {
      // The computer has the ball: its formation is on the field, its play is not.
      return {
        phase: 'defense',
        turn: defense,
        offCall: aiOffense(game, rng.current),
        defCall: memory.current[defense].def,
        selected: null,
      };
    }
    const remembered = memory.current[offense].off;
    // After a touchdown the default is the kick; otherwise never start on a special play.
    const play =
      game.stage === 'try'
        ? ('extraPoint' as const)
        : isSpecial(remembered.play)
          ? ('insideRun' as const)
          : remembered.play;
    const offCall = { ...remembered, play };
    memory.current[offense].off = offCall;
    // Until the defense commits, it shows a neutral look.
    return { phase: 'offense', turn: offense, offCall, defCall: DEFAULT_DEFENSE, selected: null };
  }, []);

  const setConfig = useCallback((patch: Partial<GameConfig>) => {
    setSession((s) => (s.phase === 'menu' ? { ...s, config: { ...s.config, ...patch } } : s));
  }, []);

  const startGame = useCallback(() => {
    setSession((s) => {
      if (s.phase !== 'menu') return s;
      rng.current = createRng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
      memory.current = {
        home: { off: DEFAULT_OFFENSE, def: DEFAULT_DEFENSE },
        away: { off: DEFAULT_OFFENSE, def: DEFAULT_DEFENSE },
      };
      const game = newGame(s.config, rng.current);
      return { ...s, game, last: null, feed: [], notices: [], ...beginDown(game) };
    });
  }, [beginDown]);

  const backToMenu = useCallback(() => {
    sim.current = null;
    setSession((s) => ({ ...INITIAL, config: s.config }));
  }, []);

  const setOffense = useCallback((patch: Partial<OffenseCall>) => {
    setSession((s) => {
      if (s.phase !== 'offense' || !s.turn) return s;
      const offCall = { ...s.offCall, ...patch };
      memory.current[s.turn].off = offCall;
      return { ...s, offCall };
    });
  }, []);

  const setDefense = useCallback((patch: Partial<DefenseCall>) => {
    setSession((s) => {
      if (s.phase !== 'defense' || !s.turn) return s;
      const defCall = { ...s.defCall, ...patch };
      memory.current[s.turn].def = defCall;
      return { ...s, defCall };
    });
  }, []);

  const select = useCallback((role: Role | null) => {
    setSession((s) =>
      s.phase === 'offense' || s.phase === 'defense' ? { ...s, selected: role } : s,
    );
  }, []);

  /** Puts `role` at an offense-frame point (clamped to a legal spot). */
  const moveTo = useCallback((role: Role, point: Vec) => {
    setSession((s) => {
      if (!s.game || !s.turn || !isMovable(role)) return s;
      const at = snapSpot(s.game, s.offCall.play);
      const strong = strengthOf(s.offCall);
      if (s.phase === 'offense') {
        const offset = offsetToward('off', s.offCall, role, point, at, strong);
        const offCall = {
          ...s.offCall,
          offsets: { ...s.offCall.offsets, [role as OffRole]: offset },
        };
        memory.current[s.turn].off = offCall;
        return { ...s, offCall };
      }
      if (s.phase === 'defense') {
        const offset = offsetToward('def', s.defCall, role, point, at, strong);
        const defCall = {
          ...s.defCall,
          offsets: { ...s.defCall.offsets, [role as DefRole]: offset },
        };
        memory.current[s.turn].def = defCall;
        return { ...s, defCall };
      }
      return s;
    });
  }, []);

  const nudge = useCallback(
    (dx: number, dz: number) => {
      const s = latest.current;
      if (!s.game || !s.selected || (s.phase !== 'offense' && s.phase !== 'defense')) return;
      const offense = s.game.possession;
      const at = snapSpot(s.game, s.offCall.play);
      const spots: Record<string, Vec> =
        s.phase === 'offense'
          ? offenseAlignment(s.offCall, at)
          : defenseAlignment(s.defCall, at, strengthOf(s.offCall));
      const spot = spots[s.selected];
      if (!spot) return;
      const world = toWorld(offense, spot);
      moveTo(s.selected, fromWorld(offense, world.x + dx, world.z + dz));
    },
    [moveTo],
  );

  const resetPlacement = useCallback(() => {
    setSession((s) => {
      if (!s.turn) return s;
      if (s.phase === 'offense') {
        const offCall = { ...s.offCall, offsets: {} };
        memory.current[s.turn].off = offCall;
        return { ...s, offCall };
      }
      if (s.phase === 'defense') {
        const defCall = { ...s.defCall, offsets: {} };
        memory.current[s.turn].def = defCall;
        return { ...s, defCall };
      }
      return s;
    });
  }, []);

  const fieldTouch = useCallback(
    (phase: 'start' | 'move' | 'end', world: { x: number; z: number }) => {
      const s = latest.current;
      if (!s.game || (s.phase !== 'offense' && s.phase !== 'defense')) return;
      if (phase === 'end') {
        dragging.current = null;
        return;
      }
      const point = fromWorld(s.game.possession, world.x, world.z);
      if (phase === 'start') {
        const role = pickRole(setupView(s, s.game), s.phase === 'offense' ? 'off' : 'def', point);
        dragging.current = role && isMovable(role) ? role : null;
        if (role) select(role);
        return;
      }
      if (dragging.current) moveTo(dragging.current, point);
    },
    [moveTo, select],
  );

  const start = useCallback(() => {
    const s = latest.current;
    const game = s.game;
    if (!game) return;
    const offense = game.possession;
    const defense = otherTeam(offense);
    dragging.current = null;

    if (s.phase === 'kickoff') {
      sim.current = createKickoff(
        game.teams[offense],
        game.teams[defense],
        game.kickFrom,
        createRng(rng.current.fork()),
      );
      loop.current = { carry: 0, hold: 0, feedCount: 0, done: false, toGo: null };
      setSession((prev) => ({ ...prev, phase: 'live', selected: null, feed: [], notices: [] }));
      return;
    }
    if (s.phase !== 'offense' && s.phase !== 'defense') return;

    // A flag before the snap: there is no play, just yards.
    const flag = preSnapPenalty(game, s.offCall.play, rng.current);
    if (flag) {
      sim.current = null;
      setSession((prev) => ({
        ...prev,
        phase: 'result',
        game: flag.state,
        selected: null,
        feed: [],
        notices: [],
        last: {
          offense,
          stage: game.stage,
          outcome: null,
          events: [],
          notes: flag.notes,
          yards: 0,
          nullified: true,
          touchback: false,
        },
      }));
      return;
    }

    let defCall = s.defCall;
    let disguise: DefenseCall | null = null;
    if (s.phase === 'offense') {
      // Nobody chose a defense on screen: the computer does (or, on a
      // two-player kick, there is nothing to choose).
      defCall = aiTeam(game) === defense ? aiDefense(game, rng.current) : DEFAULT_DEFENSE;
      disguise = DEFAULT_DEFENSE;
    }
    sim.current = createPlay(
      game.teams[offense],
      game.teams[defense],
      s.offCall,
      defCall,
      snapSpot(game, s.offCall.play),
      createRng(rng.current.fork()),
    );
    presnap.current = { t: 0, duration: disguise ? 0.9 : 0.4, disguise };
    loop.current = {
      carry: 0,
      hold: 0,
      feedCount: 0,
      done: false,
      toGo: game.stage === 'scrimmage' ? game.toGo : null,
    };
    setSession((prev) => ({
      ...prev,
      phase: 'presnap',
      defCall,
      selected: null,
      feed: [],
      notices: [],
    }));
  }, []);

  const lockIn = useCallback(() => {
    const s = latest.current;
    if (s.phase !== 'offense') return;
    // A kick or a kneel-down needs no answer from the defense.
    if (isSpecial(s.offCall.play)) start();
    else setSession((prev) => ({ ...prev, phase: 'handover', selected: null }));
  }, [start]);

  const ready = useCallback(() => {
    setSession((s) => {
      if (s.phase !== 'handover' || !s.game) return s;
      const defense = otherTeam(s.game.possession);
      return { ...s, phase: 'defense', turn: defense, defCall: memory.current[defense].def };
    });
  }, []);

  const next = useCallback(
    (timeoutBy?: TeamId) => {
      setSession((s) => {
        if (s.phase !== 'result' || !s.game) return s;
        // The clock runs between plays unless somebody stops it — the
        // computer gets the same chance to call timeout as the player.
        const ai = aiTeam(s.game);
        const caller = timeoutBy ?? (ai && aiWantsTimeout(s.game, ai) ? ai : null);
        const settled = settleClock(s.game, caller, rng.current);
        return {
          ...s,
          game: settled.state,
          notices: settled.notes,
          feed: [],
          ...beginDown(settled.state),
        };
      });
    },
    [beginDown],
  );

  const getFrame = useCallback((dt: number): SceneFrame => {
    const s = latest.current;
    const game = s.game;
    if (!game || s.phase === 'menu') return idleFrame(DEFAULT_OFFENSE, DEFAULT_DEFENSE);

    const play = sim.current;
    if (play && (s.phase === 'live' || s.phase === 'result' || s.phase === 'final')) {
      const state = loop.current;
      if (s.phase === 'live' && !state.done) {
        state.carry += dt;
        // Fixed steps keep the dice independent of the frame rate.
        for (let i = 0; i < 5 && state.carry >= SIM_DT && !play.outcome; i++) {
          stepPlay(play, SIM_DT);
          state.carry -= SIM_DT;
        }
        if (play.events.length !== state.feedCount) {
          state.feedCount = play.events.length;
          const feed = [...play.events];
          setSession((prev) => (prev.phase === 'live' ? { ...prev, feed } : prev));
        }
        if (play.outcome) {
          state.hold += dt;
          if (state.hold >= END_HOLD) {
            state.done = true;
            const outcome = play.outcome;
            const applied = applyOutcome(game, outcome, rng.current, play);
            setSession((prev) =>
              prev.phase === 'live'
                ? {
                    ...prev,
                    phase: 'result',
                    game: applied.state,
                    last: {
                      offense: game.possession,
                      stage: game.stage,
                      outcome,
                      events: [...play.events],
                      notes: applied.notes,
                      yards: applied.yards,
                      nullified: applied.nullified,
                      touchback: play.kickoff?.touchback ?? false,
                    },
                  }
                : prev,
            );
          }
        }
      }
      // After the play the game state has moved on; the picture stays on the play.
      const offense = s.phase === 'live' ? game.possession : (s.last?.offense ?? game.possession);
      return playFrame(play, offense, state.toGo);
    }

    if (s.phase === 'kickoff') {
      // Nothing to line up yet: an empty field around the kicking tee.
      const frame = idleFrame(DEFAULT_OFFENSE, DEFAULT_DEFENSE);
      const tee = toWorld(game.possession, { x: 0, y: game.kickFrom });
      return {
        ...frame,
        tokens: [],
        overlays: [],
        overlayKey: '',
        ball: { x: tee.x, z: tee.z, height: 0 },
        focusZ: tee.z + (game.possession === 'home' ? -8 : 8),
      };
    }

    const view = setupView(s, game);
    if (s.phase === 'presnap') {
      const shift = presnap.current;
      shift.t += dt;
      const k = Math.min(1, shift.t / shift.duration);
      if (k >= 1 && !loop.current.done) {
        setSession((prev) => (prev.phase === 'presnap' ? { ...prev, phase: 'live' } : prev));
      }
      return setupFrame({
        ...view,
        reveal: 'none',
        shift: k,
        disguise: shift.disguise ?? s.defCall,
      });
    }
    // Between plays the board shows the next snap, not the last one.
    return setupFrame(
      s.phase === 'result' || s.phase === 'final' ? { ...view, reveal: 'none' } : view,
    );
  }, []);

  return {
    session,
    locked: session.phase === 'presnap' || session.phase === 'live',
    getFrame,
    setConfig,
    startGame,
    backToMenu,
    setOffense,
    setDefense,
    select,
    nudge,
    resetPlacement,
    fieldTouch,
    lockIn,
    ready,
    start,
    next,
  };
}
