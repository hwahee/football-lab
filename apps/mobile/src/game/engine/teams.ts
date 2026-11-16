/** Rosters: every position gets ratings around a role baseline, rolled per game. */
import type { Rng } from './rng';
import { DEF_ROLES, OFF_ROLES, type Ratings, type Role, type Team, type TeamId } from './types';

const LINEMAN: Ratings = { speed: 60, power: 78, skill: 71 };

const BASE: Record<Role, Ratings> = {
  QB: { speed: 70, power: 62, skill: 78 },
  RB: { speed: 78, power: 76, skill: 74 },
  WR1: { speed: 80, power: 58, skill: 78 },
  WR2: { speed: 78, power: 60, skill: 76 },
  WR3: { speed: 79, power: 56, skill: 74 },
  TE: { speed: 72, power: 72, skill: 73 },
  LT: LINEMAN,
  LG: LINEMAN,
  C: LINEMAN,
  RG: LINEMAN,
  RT: LINEMAN,
  DE1: { speed: 72, power: 76, skill: 74 },
  DT1: { speed: 62, power: 80, skill: 72 },
  DT2: { speed: 62, power: 80, skill: 72 },
  DE2: { speed: 72, power: 76, skill: 74 },
  SLB: { speed: 74, power: 76, skill: 75 },
  MLB: { speed: 75, power: 75, skill: 77 },
  WLB: { speed: 77, power: 72, skill: 75 },
  CB1: { speed: 80, power: 58, skill: 77 },
  CB2: { speed: 78, power: 58, skill: 75 },
  FS: { speed: 79, power: 62, skill: 77 },
  SS: { speed: 77, power: 68, skill: 75 },
};

function roll(role: Role, rng: Rng, bonus: number): Ratings {
  const base = BASE[role];
  const vary = (value: number) =>
    Math.round(Math.max(40, Math.min(99, value + rng.gauss() * 4 + bonus)));
  return { speed: vary(base.speed), power: vary(base.power), skill: vary(base.skill) };
}

/** `bonus` shifts every rating — how the AI difficulty levels differ. */
export function createTeam(id: TeamId, rng: Rng, bonus = 0): Team {
  const offense = {} as Team['offense'];
  const defense = {} as Team['defense'];
  for (const role of OFF_ROLES) offense[role] = roll(role, rng, bonus);
  for (const role of DEF_ROLES) defense[role] = roll(role, rng, bonus);
  return { id, offense, defense };
}
