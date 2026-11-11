/**
 * The game session: which phase the match is in, whose turn it is at the
 * controls, and the loop that plays a snap out.
 *
 *   menu → offense → (handover → defense) → presnap → live → result → …→ final
 *
 * `presnap` and `live` are the locked phases: once START is pressed the hook
 * exposes no action that changes anything until the play is over.
 *
 * React state holds only what the UI shows. The running simulation lives in a
 * ref and is read by `getFrame`, which the 3D view calls every frame.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { aiDefense, aiOffense } from './engine/ai';
import {
  aiTeam,
  applyOutcome,
  newGame,
  otherTeam,
  type GameConfig,
  type GameState,
  type Note,
} from './engine/game';
import {
  DEFAULT_DEFENSE,
  DEFAULT_OFFENSE,
  defenseAlignment,
  isMovable,
  offenseAlignment,
  offsetToward,
} from './engine/playbook';
import { createRng, type Rng } from './engine/rng';
import { SIM_DT, createPlay, stepPlay, type PlaySim } from './engine/sim';
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

type Phase = 'menu' | 'offense' | 'handover' | 'defense' | 'presnap' | 'live' | 'result' | 'final';

interface LastPlay {
  offense: TeamId;
  outcome: PlayOutcome;
  events: PlayEvent[];
  notes: Note[];
  yards: number;
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
}

const INITIAL: Session = {
  phase: 'menu',
  config: { mode: 'ai', difficulty: 'normal', quarterSeconds: 120 },
  game: null,
  turn: null,
  offCall: DEFAULT_OFFENSE,
  defCall: DEFAULT_DEFENSE,
  selected: null,
  feed: [],
  last: null,
};

interface Memory {
  off: OffenseCall;
  def: DefenseCall;
}

/** Seconds the final picture is held before the result panel appears. */
const END_HOLD = 1.1;

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
  next: () => void;
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
  const loop = useRef({ carry: 0, hold: 0, feedCount: 0, done: false, toGo: 10 });
  const dragging = useRef<Role | null>(null);

  const beginDown = useCallback((game: GameState): Partial<Session> => {
    const offense = game.possession;
    const defense = otherTeam(offense);
    sim.current = null;
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
    const offCall = isSpecial(remembered.play) ? { ...remembered, play: 'insideRun' as const } : remembered; // prettier-ignore
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
      return { ...s, game, last: null, feed: [], ...beginDown(game) };
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
      if (s.phase === 'offense') {
        const offset = offsetToward('off', s.offCall, role, point, s.game.ballOn);
        const offCall = { ...s.offCall, offsets: { ...s.offCall.offsets, [role as OffRole]: offset } }; // prettier-ignore
        memory.current[s.turn].off = offCall;
        return { ...s, offCall };
      }
      if (s.phase === 'defense') {
        const offset = offsetToward('def', s.defCall, role, point, s.game.ballOn);
        const defCall = { ...s.defCall, offsets: { ...s.defCall.offsets, [role as DefRole]: offset } }; // prettier-ignore
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
      const spots: Record<string, Vec> =
        s.phase === 'offense'
          ? offenseAlignment(s.offCall, s.game.ballOn)
          : defenseAlignment(s.defCall, s.game.ballOn);
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
        const view: SetupView = {
          offense: s.game.possession,
          ballOn: s.game.ballOn,
          toGo: s.game.toGo,
          offCall: s.offCall,
          defCall: s.defCall,
          reveal: 'none',
          selected: null,
        };
        const role = pickRole(view, s.phase === 'offense' ? 'off' : 'def', point);
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
    if (!game || (s.phase !== 'offense' && s.phase !== 'defense')) return;
    const offense = game.possession;
    const defense = otherTeam(offense);
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
      game.ballOn,
      createRng(rng.current.fork()),
    );
    presnap.current = { t: 0, duration: disguise ? 0.9 : 0.4, disguise };
    loop.current = { carry: 0, hold: 0, feedCount: 0, done: false, toGo: game.toGo };
    dragging.current = null;
    setSession((prev) => ({ ...prev, phase: 'presnap', defCall, selected: null, feed: [] }));
  }, []);

  const lockIn = useCallback(() => {
    const s = latest.current;
    if (s.phase !== 'offense') return;
    // A kick needs no answer from the defense.
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

  const next = useCallback(() => {
    setSession((s) => {
      if (s.phase !== 'result' || !s.game) return s;
      if (s.game.over) return { ...s, phase: 'final', turn: null };
      return { ...s, feed: [], ...beginDown(s.game) };
    });
  }, [beginDown]);

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
            const applied = applyOutcome(game, outcome, rng.current);
            setSession((prev) =>
              prev.phase === 'live'
                ? {
                    ...prev,
                    phase: 'result',
                    game: applied.state,
                    last: {
                      offense: game.possession,
                      outcome,
                      events: [...play.events],
                      notes: applied.notes,
                      yards: applied.yards,
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

    const view: SetupView = {
      offense: game.possession,
      ballOn: game.ballOn,
      toGo: game.toGo,
      offCall: s.offCall,
      defCall: s.defCall,
      reveal: s.phase === 'offense' ? 'offense' : s.phase === 'defense' ? 'defense' : 'none',
      selected: s.selected,
    };
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
    return setupFrame(view);
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
