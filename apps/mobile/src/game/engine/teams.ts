/** Rosters: every position gets ratings around a role baseline, rolled per game. */
import type { Rng } from './rng';
import { DEF_ROLES, OFF_ROLES, type Ratings, type Role, type Team, type TeamId } from './types';

const BASE: Record<Role, Ratings> = {
  QB: { speed: 70, power: 62, skill: 78 },
  RB: { speed: 78, power: 76, skill: 74 },
  WR1: { speed: 80, power: 58, skill: 78 },
  WR2: { speed: 78, power: 60, skill: 76 },
  C: { speed: 60, power: 78, skill: 72 },
  LG: { speed: 60, power: 78, skill: 70 },
  RG: { speed: 60, power: 78, skill: 70 },
  DE1: { speed: 72, power: 76, skill: 74 },
  NT: { speed: 62, power: 80, skill: 72 },
  DE2: { speed: 72, power: 76, skill: 74 },
  LB: { speed: 76, power: 74, skill: 77 },
  CB1: { speed: 80, power: 58, skill: 77 },
  CB2: { speed: 78, power: 58, skill: 75 },
  FS: { speed: 78, power: 64, skill: 77 },
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
