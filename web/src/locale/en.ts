/**
 * Every word the interface says, in English.
 *
 * One file so messaging can be adjusted without hunting through components,
 * and so a second language is a second file rather than a refactor.
 *
 * **Anything that varies is a function, not a string with a placeholder.**
 * English alone needs "1 entry" against "2 entries", "a month ago" against
 * "3 months ago"; other languages need more branches, not fewer. Keeping the
 * rule beside the words is what stops each surface reinventing it, and the
 * argument types mean a missed parameter fails to compile.
 *
 * Category labels live in the server's registry (`media_type` is an open
 * registry — SPEC.md §5), so `categories` here holds *optional overrides only*.
 * A new category must never require an entry in this file.
 */

export const en = {
  app: {
    /** Split so the second half can take the accent colour. */
    brandLead: 'DULDU',
    brandTail: 'LATOR',
    themeLabel: 'Theme',
    loading: 'Loading…',
    unknownError: 'Something went wrong',
  },

  themes: {
    dn: 'Dark grey',
    dark: 'Dark',
    brown: 'Brown',
    orange: 'Orange',
    bone: 'Bone white',
    white: 'White',
  },

  overview: {
    title: 'Your lists',
    newList: 'New list',
    loadFailed: 'Could not load lists',
    firstRun:
      'Nothing tracked yet. Pick a category and add your first list — all the Jackie Chan movies, a discography, a game franchise. The point is finishing them.',
    emptyCategory: 'Nothing here yet.',
    addList: 'Add a list',
    listCount: (n: number): string => `${n} ${n === 1 ? 'list' : 'lists'}`,
    alsoPrefix: 'also: ',
    alsoSuffix: ' — nothing tracked in these yet',
    orphanedTitle: 'Uncategorised',
    orphanedNote: 'category no longer exists',
    /** Screen-reader text for the progress bar. */
    percentComplete: (percent: number): string => `${percent}% complete`,
    timeLeft: (duration: string): string => `${duration} left`,
    allDone: 'done',
    noItems: 'empty',
    /**
     * Task 7.6: the "an update is available" notification. Deliberately not
     * "updated" — the user flagged that as confusing during click-through
     * ("updated = already changed, so why are you bothering me").
     */
    checkUpdates: 'Check for updates',
    checkingUpdates: 'Checking…',
    checkUpdatesFailed: 'Could not check for updates',
    updatedCount: (n: number): string =>
      n === 1 ? '1 list has an update available: ' : `${n} lists have updates available: `,
    dismissUpdatesBanner: 'Dismiss',
    updatedBadge: 'Update available',
  },

  suggestions: {
    heading: 'What now?',
    buttons: {
      'tired-boss': "I'm tired, boss",
      suggest: 'Suggest',
      quickie: 'Quickie',
    },
    /** What each button promises, shown with its answer. */
    promises: {
      'tired-boss': 'Something else you could actually finish',
      suggest: 'Something fresh you have been ignoring',
      quickie: 'The one you can finish soonest',
    },
    tiredOfLabel: 'What are you tired of?',
    submit: 'Show me something else',
    thinking: 'Thinking…',
    failed: 'Could not get a suggestion',
    next: 'Next: ',
    alternativesPrefix: 'or: ',
    noneToSwitchTo: 'Nothing else to switch to — every other list is finished or empty.',
    noneAtAll: 'Nothing to suggest. Every list is finished or empty.',
    percentDone: (percent: number): string => `${percent}% done`,
    timeLeft: (duration: string): string => `${duration} left`,
  },

  listDetail: {
    back: '← All lists',
    loadFailed: 'Could not load this list',
    saveFailed: 'Could not save that change',
    removeFailed: (title: string): string => `Could not remove "${title}"`,
    deleteListConfirm: (title: string): string => `Delete "${title}" and all its items?`,
    deleteList: 'Delete list',
    confirmDeleteList: 'Yes, delete',
    deletingList: 'Deleting…',
    deleteListFailed: 'Could not delete this list',
    removeItem: (title: string): string => `Remove ${title}`,
    reAddDeleted: 'Re-add deleted entries',
    reAddDeletedHint:
      'Deleting an item stops a rescan offering it back. Tick this to include everything you have deleted.',
    checkForUpdates: 'Check for updates',
    /** Replaces checkForUpdates when arriving with an update already known to be available. */
    updateList: 'Update list',
    checking: 'Checking…',
    checkFailed: 'Could not check for updates',
    /** Task 7.6: confirms why this list was highlighted from Overview. */
    updateAvailableNotice: 'An update is available for this list.',
    addFailed: 'Could not add them',
    upToDate: (upstreamCount: number): string =>
      `Up to date — nothing new in the source's ${upstreamCount}.`,
    heldBack: (n: number): string =>
      ` ${n} ${n === 1 ? 'entry you deleted is' : 'entries you deleted are'} being held back.`,
    foundCount: (n: number): string => `${n} ${n === 1 ? 'entry' : 'entries'}`,
    /** With the box ticked these are things you deleted, not things the source gained. */
    foundToPutBack: 'to put back:',
    foundNew: 'new since this list was built:',
    andMore: (n: number): string => ` … and ${n} more`,
    addToList: (n: number): string => `Add ${n} to this list`,
    finished: 'Finished',
    nothingToDo: 'Nothing to do yet',
    empty: 'This list has no items yet.',
    percentComplete: (percent: number): string => `${percent}% complete`,
    timeLeft: (duration: string): string => `${duration} left`,
    addItemTitleLabel: 'Title',
    addItemDurationLabel: 'Minutes (leave blank to guess)',
    /** Generic on purpose — the underlying field works for a TV season, a comic story arc, etc. */
    groupLabel: 'Group (optional, e.g. Season 1)',
    addItem: 'Add item',
    addingItem: 'Adding…',
    addItemFailed: 'Could not add that item',
    editItem: (title: string): string => `Edit ${title}`,
    saveItem: 'Save',
    savingItem: 'Saving…',
    cancelEdit: 'Cancel',
    updateItemFailed: 'Could not save that item',
    /** Placeholder styling per the user's own suggestion — task 6.2. */
    manualItemBadge: '[M]',
    manualItemHint: 'Added by hand, not from a search import',
    expandGroup: (label: string): string => `Expand ${label}`,
    collapseGroup: (label: string): string => `Collapse ${label}`,
    reorderFailed: 'Could not save the new order',
    dragHandle: 'Drag to reorder',
    moveUp: (title: string): string => `Move ${title} up`,
    moveDown: (title: string): string => `Move ${title} down`,
  },

  newList: {
    title: 'New list',
    createFailed: 'Could not create the list',
    categoryLabel: 'Category',
    /** Marks a category you can only fill in by hand. */
    noSearchSuffix: ' — add by hand',
    builtInHint:
      'Categories are built in — if one is missing, it has to be added to the app itself.',
    byHandHeading: 'Add by hand',
    orByHandHeading: 'Or add by hand',
    listTitleLabel: 'List title',
    listTitlePlaceholder: 'All Jackie Chan movies',
    itemsLabel: 'Items — one per line',
    itemsPlaceholder: 'Drunken Master\nPolice Story\nProject A',
    itemCount: (n: number): string => `${n} ${n === 1 ? 'item' : 'items'}.`,
    itemsOptional: 'Optional — you can add items later.',
    assumedDuration: (duration: string): string =>
      ` Each is assumed to take about ${duration}, which you can correct later.`,
    create: 'Create list',
    creating: 'Creating…',
  },

  sourceSearch: {
    heading: (category: string): string => `Search ${category}`,
    inputLabel: (category: string): string => `Search ${category}`,
    search: 'Search',
    searching: 'Searching…',
    searchFailed: 'Search failed',
    buildFailed: 'Could not build that list',
    building: 'Building the list — this can take a few seconds…',
    nothingFound: 'Nothing found. Try a different spelling, or add by hand below.',
    defaultPlaceholder: 'Search…',
    /**
     * Nudges toward searching for a *source*, which is not the obvious thing to
     * type. Keyed by media type, and optional — a category with no entry falls
     * back to `defaultPlaceholder`, so adding a category needs nothing here.
     */
    placeholders: {
      movie: 'An actor, director, or a film series…',
      music: 'A band or artist…',
      book: 'An author…',
    } as Record<string, string | undefined>,
  },

  customListImport: {
    heading: 'Import a list file',
    hint: 'A YAML file with its own title, category, and items — see CONTRIBUTING.md for the format. The category picker above does not apply here.',
    chooseFileLabel: 'Choose a .yaml file…',
    pasteLabel: 'Or paste it here',
    pastePlaceholder:
      'title: All Jackie Chan Movies\ncategory: movie\nitems:\n  - { title: Drunken Master, year: 1978 }',
    import: 'Import',
    importing: 'Importing…',
    importFailed: 'Could not import that file',
  },

  /**
   * Optional per-category overrides. Empty by default: the server's registry
   * supplies every label and description, and `media_type` is open, so a new
   * category must work without being named here.
   */
  categories: {} as Record<string, { label?: string; description?: string } | undefined>,

  /**
   * Errors the server raises, keyed by the code it sends. The server names the
   * situation (`server/src/apiErrors.ts`); the sentence is written here, so a
   * message is never worded in two places.
   *
   * A code with no entry here falls through to whatever the response carried,
   * and then to `request.failed` — so the two sides drifting degrades the
   * wording rather than breaking the page.
   */
  errors: {
    'search.queryRequired': (): string => 'Give me something to search for.',
    'search.unavailable': (p: { category: string }): string =>
      `Search is not available for ${p.category}. Add items by hand.`,
    'list.unknownCategory': (p: { key: string }): string => `Unknown category "${p.key}".`,
    'list.sourceEmpty': (p: { title: string }): string =>
      `Found nothing to import for "${p.title}".`,
    'list.fileInvalid': (): string =>
      "That file isn't a valid list — check it matches the format in CONTRIBUTING.md.",
    'list.fileMissingTitle': (): string => 'This list needs a title.',
    'list.fileItemMissingTitle': (p: { index: number }): string =>
      `Item ${p.index} is missing a title.`,
    'refresh.handMadeList': (): string =>
      'This list was made by hand, so there is nothing to check against.',
    'refresh.searchUnavailable': (p: { category: string }): string =>
      `Search is not available for ${p.category}.`,
  },

  /** Failures with no code: the network, or a server that said something new. */
  request: {
    /** Told apart from "the server said no" — in development it is the common one. */
    unreachable: 'Cannot reach the server. Is it running?',
    failed: (status: number): string => `Request failed (${status})`,
    unknown: 'Something went wrong.',
  },

  /** `time_to_consume_minutes` for display. Minutes are the storage unit. */
  duration: {
    minutes: (m: number): string => `${m}m`,
    hours: (h: number): string => `${h}h`,
    hoursMinutes: (h: number, m: number): string => `${h}h ${m}m`,
  },

  /**
   * "When did I last touch this", used to explain why a suggestion was picked.
   * Deliberately vague at the long end — "8 months ago" says everything
   * "on 3 January" does, and reads faster.
   */
  timeAgo: {
    never: 'never touched',
    today: 'today',
    yesterday: 'yesterday',
    days: (n: number): string => `${n} days ago`,
    aMonth: 'a month ago',
    months: (n: number): string => `${n} months ago`,
    aYear: 'a year ago',
    years: (n: number): string => `${n} years ago`,
  },
} as const

export type Locale = typeof en
