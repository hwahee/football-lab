/**
 * The game's raw colors — shared by the 3D field (numbers) and the game UI
 * kit (strings), so a team is the same blue on the turf and on the scoreboard.
 */
import type { TeamId } from './engine/types';

export const PALETTE = {
  /** Night-stadium backdrop. */
  night: '#070b14',
  panel: '#111a2c',
  panelRaised: '#1a2640',
  panelEdge: '#2b3b5e',
  ink: '#f2f6ff',
  inkMuted: '#8fa0c2',
  /** Scoreboard LED amber. */
  led: '#ffc233',
  ledDim: '#5c4a1c',
  go: '#2fd16b',
  goEdge: '#168a41',
  danger: '#ff5a5a',
  chalk: '#f4f7f2',
  turfA: '#2f8f46',
  turfB: '#287f3d',
  apron: '#123a22',
  scrimmage: '#3aa0ff',
  firstDown: '#ffd400',
  ballLeather: '#8a4b25',
  home: '#2f7bff',
  homeEdge: '#1b4fb3',
  away: '#ff4d4d',
  awayEdge: '#b32c2c',
} as const;

export const TEAM_COLOR: Record<TeamId, string> = { home: PALETTE.home, away: PALETTE.away };
export const TEAM_EDGE: Record<TeamId, string> = { home: PALETTE.homeEdge, away: PALETTE.awayEdge };

export function hexNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}
