/**
 * Navigation param lists — screen params ARE the navigation state; screens
 * derive everything from `route.params` instead of duplicating it in local
 * state (minimal-state rule).
 */
import type { NavigatorScreenParams } from '@react-navigation/native';

/* eslint-disable @typescript-eslint/consistent-type-definitions --
   React Navigation param lists must be type aliases: interfaces lack the
   implicit index signature required by ParamListBase. */

export type MainTabParamList = {
  /**
   * `q` filters the list by title. Set by the `todos.search` voice intent
   * (src/voice) — the search term lives in the route, not in screen state,
   * so a second voice search replaces it rather than merging with it.
   */
  TodosTab: { q?: string } | undefined;
  SettingsTab: undefined;
};

export type RootStackParamList = {
  /** The football game — what the app opens on. */
  Game: undefined;
  /** Everything that is not the game (todos, settings), behind the game's gear button. */
  Main: NavigatorScreenParams<MainTabParamList>;
  /** Design-system gallery — registered in dev builds only. */
  DesignSystem: undefined;
};
