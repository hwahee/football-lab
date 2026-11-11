/**
 * Central testID registry — the ONLY source of testID strings
 * (docs/ui-automation.md documents the full convention).
 *
 * Rules:
 *   - Interactive design-system components REQUIRE a `testID` prop; the
 *     value must come from here, never an inline string.
 *   - Naming: `{screen}.{section}.{element}`, kebab-case.
 *   - Per-entity elements are factory functions: `TESTID.todos.item(id)`.
 *   - Maestro flows import nothing (YAML), so keep these strings stable —
 *     they are the automation contract.
 */
export const TESTID = {
  boot: {
    screen: 'boot.screen',
    adSlot: 'boot.ad.slot',
    adSkip: 'boot.ad.skip',
  },
  maintenance: {
    screen: 'maintenance.screen',
    retry: 'maintenance.retry',
  },
  update: {
    forceScreen: 'update.force.screen',
    forceStoreButton: 'update.force.store-button',
    promptSheet: 'update.prompt.sheet',
    promptAction: 'update.prompt.action',
    promptLater: 'update.prompt.later',
  },
  game: {
    screen: 'game.screen',
    field: 'game.field',
    settings: 'game.settings',
    scoreboard: 'game.scoreboard',
    kickoff: 'game.menu.kickoff',
    menuOption: (group: string, value: string) => `game.menu.${group}.${value}`,
    tab: (value: string) => `game.tab.${value}`,
    play: (id: string) => `game.play.${id}`,
    option: (group: string, value: string) => `game.option.${group}.${value}`,
    player: (role: string) => `game.player.${role}`,
    nudge: (direction: string) => `game.nudge.${direction}`,
    resetPlacement: 'game.placement.reset',
    /** The one button after which nothing can be touched until the play ends. */
    start: 'game.start',
    lockIn: 'game.lock-in',
    ready: 'game.handover.ready',
    next: 'game.result.next',
    newGame: 'game.final.new-game',
    result: 'game.result',
    live: 'game.live',
  },
  tabs: {
    todos: 'tabs.todos',
    settings: 'tabs.settings',
  },
  offline: {
    banner: 'offline.banner',
  },
  notice: {
    banner: 'notice.banner',
  },
  todos: {
    screen: 'todos.screen',
    createInput: 'todos.create.input',
    createSubmit: 'todos.create.submit',
    list: 'todos.list',
    loading: 'todos.loading',
    error: 'todos.error',
    errorRetry: 'todos.error.retry',
    empty: 'todos.empty',
    footerLoading: 'todos.footer.loading',
    /** Shown when a voice search set `?q=` on the route. */
    searchBanner: 'todos.search.banner',
    searchClear: 'todos.search.clear',
    filter: (status: 'all' | 'open' | 'done') => `todos.filter.${status}`,
    item: (id: string) => `todos.item.${id}`,
    itemToggle: (id: string) => `todos.item.${id}.toggle`,
    itemDelete: (id: string) => `todos.item.${id}.delete`,
  },
  settings: {
    screen: 'settings.screen',
    locale: (value: 'system' | 'en' | 'ko') => `settings.locale.${value}`,
    themeMode: (value: 'system' | 'light' | 'dark') => `settings.theme.${value}`,
    design: (value: 'standard' | 'contrast' | 'office' | 'kids') => `settings.design.${value}`,
    designSystemLink: 'settings.design-system-link',
    checkUpdate: 'settings.check-update',
  },
  designSystem: {
    screen: 'design-system.screen',
    section: (name: string) => `design-system.section.${name}`,
    /** Same strings as the web registry (src/client/testing/testids.ts). */
    overlay: {
      openModal: 'design-system.overlay.open-modal',
      openSheet: 'design-system.overlay.open-sheet',
      openSidebar: 'design-system.overlay.open-sidebar',
      modal: 'design-system.overlay.modal',
      sheet: 'design-system.overlay.sheet',
      sidebar: 'design-system.overlay.sidebar',
      /* Opened from inside the modal — the nesting the stack has to survive. */
      nest: 'design-system.overlay.nest',
      confirm: 'design-system.overlay.confirm',
      confirmYes: 'design-system.overlay.confirm.yes',
      confirmNo: 'design-system.overlay.confirm.no',
      save: 'design-system.overlay.save',
      cancel: 'design-system.overlay.save.cancel',
      sheetApply: 'design-system.overlay.sheet.apply',
      sidebarPick: 'design-system.overlay.sidebar.pick',
      result: 'design-system.overlay.result',
      /* The declarative door — an inline sidebar is layout, not a popup. */
      inline: 'design-system.overlay.inline',
      inlineToggle: 'design-system.overlay.inline.toggle',
    },
  },
} as const;
