import { selectPlural } from './plural.js'
import type { Widen } from './types.js'

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
 * Count-varying entries go through `selectPlural` (task 10.8b) so a
 * language needing more than English's one/other split — Russian's
 * one/few/many — has somewhere to put the extra forms, not just the ones
 * named here (`listCount`, `itemCount`, `marks.newCount`, and `duration` in
 * `ru.ts`). The rest of the file's count-based strings (`foundCount`,
 * `heldBack`, `updatedCount`) still hand-roll their own `n === 1` — not
 * every such string needed moving for this task, only these.
 *
 * Category labels live in the server's registry (`media_type` is an open
 * registry — SPEC.md §5), so `categories` here holds *optional overrides only*.
 * A new category must never require an entry in this file.
 */

export const en = {
  app: {
    /** Split so the second half can take the accent colour. */
    brandLead: 'LIST',
    brandTail: 'ULATOR',
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
    /** Generic per-item display tag (SPEC.md §4) — a release type, a language, a medium, etc. */
    tagBadgeHint: (tag: string): string => `Tag: ${tag}`,
    expandGroup: (label: string): string => `Expand ${label}`,
    collapseGroup: (label: string): string => `Collapse ${label}`,
    reorderFailed: 'Could not save the new order',
    dragHandle: 'Drag to reorder',
    moveUp: (title: string): string => `Move ${title} up`,
    moveDown: (title: string): string => `Move ${title} down`,
  },

  newList: {
    title: 'New list',
  },

  sourceSearch: {
    searchFailed: 'Search failed',
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
    /** Book-category-only language filter. */
    languageLabel: 'Language',
    allLanguages: 'All',
    includeUnknown: 'Also include books with no language listed',
    /** Music-category-only discography-type toggles. */
    discographyTypesLabel: 'Also include',
    includeEp: 'EPs',
    includeSingle: 'Singles',
    includeLive: 'Live albums',
    includeCompilation: 'Compilations',
  },

  /**
   * Optional per-category overrides. The server's registry supplies every
   * label and description, and `media_type` is open, so a new category must
   * work without being named here. These two exist only because the design
   * handoff words them differently from the registry ("TV Series", "Pro
   * Wrestling") — the registry's own `label` is deliberately not renamed
   * (task 10.11, C1).
   */
  categories: {
    tv: { label: 'TV Series' },
    wrestling: { label: 'Pro Wrestling' },
  } as Record<string, { label?: string; description?: string } | undefined>,

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
    'search.unavailableOffline': (p: { category: string }): string =>
      `Search is not available for ${p.category}, and the community library could not be reached. Add items by hand.`,
    'list.unknownCategory': (p: { key: string }): string =>
      `Unknown category ‘${p.key}’, list cannot be imported.`,
    'list.sourceEmpty': (p: { title: string }): string =>
      `Found nothing to import for "${p.title}".`,
    'list.fileInvalid': (): string =>
      "That file isn't in the list format, list cannot be imported.",
    'list.fileSyntax': (p: { line?: number }): string =>
      p.line
        ? `Syntax error on line ${p.line}, list cannot be imported.`
        : 'Syntax error, list cannot be imported.',
    'list.fileNoItems': (): string => 'No items found, list cannot be imported.',
    'list.fileMissingTitle': (): string => 'No title found, list cannot be imported.',
    'list.fileItemMissingTitle': (p: { index: number }): string =>
      `Item ${p.index} has no title, list cannot be imported.`,
    'list.fileItemNotesTooLong': (p: { index: number; max: number }): string =>
      `Item ${p.index}'s notes are over ${p.max} characters, list cannot be imported.`,
    'list.alreadyExists': (): string =>
      'That list already exists again — nothing was restored.',
    'group.nameEmpty': (): string => 'A group needs a name.',
    'group.nameTaken': (): string => 'This list already has a group called that.',
    'group.notEmpty': (): string =>
      'Only an empty group can be deleted — move or remove its items first.',
    'group.orderMismatch': (): string =>
      'The groups changed since you loaded this list — reload it and try again.',
    'reset.unavailable': (): string =>
      'This list has no source to reset to — it was made by hand, or arrived before its source was kept.',
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

  /** Quantum progress and marks primitives (task 10.6). */
  quantum: {
    meter: {
      /** MeterBar's `role="img"` label — never the cap, the real numbers. */
      label: (done: number, total: number): string => `${done} of ${total} done`,
      noteCapped: (cap: number, perCell: number): string => `${cap} cells ≈ ${perCell} items each`,
      noteUncapped: 'One cell = one item',
    },
    progress: {
      count: (done: number, total: number, percent: number): string =>
        total ? `${done}/${total} (${percent}%)` : `${done}/${total}`,
      left: (duration: string): string => `${duration} left`,
      allDone: '✓ All done',
      doneForNow: '✓ Done for now',
    },
    status: {
      complete: 'Complete',
      ongoing: 'Ongoing',
    },
    marks: {
      curated: 'Curated list — kept by hand in the community library',
      byHand: 'Made by hand — no source behind it',
      manual: 'Added by hand — not restorable from the source',
      /** "NEW" itself is invariant in English (a badge, not a countable noun) — the `other`-only form is still ready for a language that does decline it. */
      newCount: (n: number): string => `${n} ${selectPlural(n, 'en', { other: 'NEW' })}`,
      newItem: 'NEW',
      allDone: '✓ All done',
    },
    /** AppHeader (task 10.9). */
    appHeader: {
      settings: 'Settings',
      /** Until task 10.30 builds the Settings layer. */
      settingsComingSoon: 'Settings is coming soon',
    },
    skin: {
      button: 'Skin',
      kicker: 'Skin',
      changed: (label: string): string => `Switched to the ${label} skin.`,
      labels: {
        'dark-orange': 'Dark orange',
        'dark-green': 'Dark green',
        'dark-blue': 'Dark blue',
        'dark-violet': 'Dark violet',
        'light-bone': 'Light bone',
      },
    },
    /**
     * The temporary layer stack hosting old screens (task 10.9). A list
     * layer's tab has no real title to show without fetching one — a
     * title-aware tab is task 10.20's job, once List detail is a real
     * Quantum screen instead of a hosted old one.
     */
    layerStack: {
      untitledListTab: 'List',
    },
    /** Home / My Lists (task 10.10), replacing the old hosted `Overview`. */
    categoryPicker: {
      title: 'Pick A Category',
      subline:
        'Categories are built in. Counts show how many lists you have in each category.',
      /** First run only — nothing exists yet, so the picker is the base layer. */
      firstRunTitle: 'Nothing tracked yet — pick a shelf and fill it',
      firstRunSubline:
        'Each category builds lists from its own source. Mega is for cross-medium franchises — one shelf for the films, the games and the comics together.',
      /** A category whose registry entry has no search source. */
      byHand: 'by hand',
      countTitle: 'Lists already on this shelf',
      closeLabel: 'Close',
    },
    search: {
      queryLabel: (source: string): string => `Search ${source}`,
      searchButton: 'Search',
      resultsCount: (n: number): string =>
        `${n} ${selectPlural(n, 'en', { one: 'result', other: 'results' })}`,
      itemsKicker: 'items',
      countLoading: 'Counting items…',
      expandRow: (title: string): string => `Show details for ${title}`,
      previewButton: 'Preview',
      /** The covered layer's tab label while a Preview is open. */
      previewTab: (title: string): string => `Preview: ${title}`,
      addButton: 'Add list',
      nothingToAdd: 'Nothing to add — this source has no items to import',
      /** A source that cannot list its items before import (design: "Preview degrades honestly"). */
      previewUnavailable:
        "This source can't list its items before import. Add the list — deleting a wrong one costs a click.",
      curatedTitle: 'Curated list',
      curatedProvenance: 'Curated · kept by hand in the community library',
      sourceProvenance: (source: string): string => `From ${source}`,
      importing: 'Building the list…',
      searching: 'Searching…',
      /** Search needs a key the user has not supplied — hard error (design: ErrorBlock, "no key"). */
      noKeyHeadline: (source: string): string => `Search needs a ${source} key`,
      noKeyDesktop: (category: string): string =>
        `Add your key in Settings to search ${category}. Until then you can add items by hand.`,
      /** There is no keys section on the web (C7) — keys are the server's, in its `.env`. */
      noKeyWeb: (category: string): string =>
        `Searching ${category} needs an API key in the server's .env file. Until then you can add items by hand.`,
      /** No key *and* the curated library unreachable — naming only the key would send the user hunting for half the answer. */
      offlineHeadline: (category: string): string => `Can't search ${category} right now`,
      offlineDesktop: (category: string): string =>
        `Searching ${category} needs an API key (add yours in Settings), and the community library of curated lists could not be reached. Check your connection, or add items by hand.`,
      offlineWeb: (category: string): string =>
        `Searching ${category} needs an API key in the server's .env file, and the community library of curated lists could not be reached. Check the connection, or add items by hand.`,
      /** Results came back, but the curated half of them could not be searched. */
      libraryUnreachable:
        "Couldn't reach the community library, so curated lists are missing from these results.",
      nothingFoundLibraryDown:
        ' The community library could not be reached, so curated lists were not searched.',
      openSettings: 'Open Settings',
      settingsComingSoon: 'Settings is coming soon',
      nothingFoundHeadline: 'Nothing found',
      nothingFoundBody: 'Try a different spelling, or add by hand.',
      nothingToImportHeadline: 'Nothing to import',
      retry: 'Retry',
      dismiss: 'Dismiss',
    },
    addByHand: {
      titleLabel: 'List title',
      titlePlaceholder: 'All Jackie Chan movies',
      descriptionLabel: 'Description',
      descriptionPlaceholder: 'Optional',
      itemsLabel: 'Items — one per line',
      itemsPlaceholder: 'Early films:\nDrunken Master\nPolice Story\n\nLate films:\nRush Hour',
      itemsHint: 'A line ending in a colon, or starting with #, opens a group.',
      statusLabel: 'Status',
      create: 'Create list',
      creating: 'Creating…',
      /** The live count beside Create; groups are only mentioned when there are some. */
      count: (items: number, groups: number): string => {
        const itemText = `${items} ${selectPlural(items, 'en', { one: 'item', other: 'items' })}`
        if (groups === 0) return itemText

        return `${itemText} in ${groups} ${selectPlural(groups, 'en', { one: 'group', other: 'groups' })}`
      },
      noItems: 'No items yet — you can add them later.',
      assumedDuration: (duration: string): string =>
        `Each is assumed to take about ${duration}, which you can correct later.`,
      createFailed: 'Could not create the list',
    },
    list: {
      loading: 'Loading the list…',
      loadFailedHeadline: "Can't open this list",
      retry: 'Retry',
      empty: 'No items yet.',
      /** Header actions that arrive with later tasks: shown, disabled, and honest about it. */
      comingSoon: 'Coming soon',
      noGroup: 'No group',
      itemActions: {
        details: (title: string): string => `Details for ${title}`,
        edit: (title: string): string => `Edit ${title}`,
        remove: (title: string): string => `Remove ${title}`,
        infoKicker: 'Details',
        estimated: 'The runtime is an estimate — edit the item to set the real one.',
        editTitle: 'Title',
        editMinutes: 'Minutes',
        editGroup: 'Group',
        discard: 'Discard',
        save: 'Save',
        saved: (title: string): string => `Saved changes to ${title}`,
        undo: 'Undo',
        removed: (title: string): string => `Removed ${title}`,
        restored: (title: string): string => `Restored ${title}`,
        added: (title: string, group: string | null): string =>
          group ? `Added ${title} to ${group}` : `Added ${title}`,
        removeFailed: (title: string): string => `Could not remove ${title}`,
        editFailed: 'Could not save those changes',
        undoFailed: 'Could not undo that',
      },
      addItem: {
        titleLabel: 'Title',
        titlePlaceholder: 'Add an item…',
        minutesLabel: 'Minutes',
        groupLabel: 'Group',
        add: 'Add',
        adding: 'Adding…',
        failed: 'Could not add that item',
      },
      createGroup: (name: string): string => `+ Create “${name}”`,
      editList: 'Edit list',
      checkForUpdates: 'Check for updates',
      order: 'Order',
      more: 'More',
      /** Check for updates and the NEW marks (10.25). */
      updates: {
        checking: 'Checking…',
        /** The button's label when the Home banner sent you here with an update already known. */
        updateList: 'Update list',
        checkFailed: 'Could not check for updates',
        addFailed: 'Could not add them',
        kicker: 'Updates',
        upToDate: (upstreamCount: number): string =>
          `Up to date — nothing new in the source's ${upstreamCount}.`,
        heldBack: (n: number): string =>
          ` ${n} ${selectPlural(n, 'en', { one: 'entry you deleted is', other: 'entries you deleted are' })} being held back.`,
        foundCount: (n: number): string =>
          `${n} ${selectPlural(n, 'en', { one: 'entry', other: 'entries' })}`,
        /** With the box ticked these are things you deleted, not things the source gained. */
        foundToPutBack: 'to put back:',
        foundNew: 'new since this list was built:',
        andMore: (n: number): string => ` … and ${n} more`,
        addToList: (n: number): string => `Add ${n} to this list`,
        adding: 'Adding…',
        reAddDeleted: 'Re-add deleted entries',
        /** The list's own banner (design prototype): the sentence, then Mark all seen. */
        newBand: (n: number): string =>
          `${n} new ${selectPlural(n, 'en', { one: 'item was', other: 'items were' })} added. Sorted something manually? Check if it's affected`,
        markAllSeen: 'Mark all seen',
        markedSeen: 'All marked as seen',
        markSeenFailed: 'Could not mark them as seen',
        added: (n: number): string =>
          `Added ${n} ${selectPlural(n, 'en', { one: 'item', other: 'items' })}`,
      },
    },
    preview: {
      title: 'Preview',
      closeLabel: 'Close',
      loading: 'Listing the items…',
      /** Count and total runtime; `≈` when some runtimes are the category's default. */
      summary: (count: number, duration: string, estimated: boolean): string =>
        `${count} ${selectPlural(count, 'en', { one: 'item', other: 'items' })} · ${estimated ? '≈ ' : ''}${duration}`,
      addButton: 'Add list',
      adding: 'Building the list…',
      nothingToAdd: 'Nothing to add — this source has no items to import',
      loadFailedHeadline: "Can't preview this list",
      retry: 'Retry',
      footer: (provenance: string): string =>
        `${provenance}. Add list makes exactly this list.`,
      expandGroup: (label: string): string => `Expand ${label}`,
      collapseGroup: (label: string): string => `Collapse ${label}`,
    },
    importFile: {
      chooseFile: 'Choose file…',
      boxLabel: 'YAML',
      boxPlaceholder:
        'title: All Jackie Chan Movies\ncategory: movie\nitems:\n  - { title: Drunken Master, year: 1978 }',
      import: 'Import',
      importing: 'Importing…',
      /** Facts about the text as it arrived; never a verdict. */
      readOutFile: (name: string, size: string, lines: string): string =>
        `${name} · ${size} · ${lines}`,
      readOutPasted: (lines: string): string => `Pasted · ${lines}`,
      lines: (n: number): string =>
        `${n} ${selectPlural(n, 'en', { one: 'line', other: 'lines' })}`,
      footer:
        'Listulator lists travel as YAML files. Export writes one; Import reads it back as a new list.',
      importFailed: 'Could not import that file, list cannot be imported.',
    },
    createList: {
      title: (category: string): string => `New ${category} list`,
      searchTab: (source: string): string => `Search ${source}`,
      handTab: 'Add by hand',
      importTab: 'Import a file',
      closeLabel: 'Close',
    },
    home: {
      title: 'My Lists',
      newList: 'New List',
      checkForUpdates: 'Check for updates',
      checkingUpdates: 'Checking…',
      loadFailed: 'Could not load your lists',
      retry: 'Retry',
      listCount: (n: number): string =>
        `${n} ${selectPlural(n, 'en', { one: 'list', other: 'lists' })}`,
      /** The mono summary line under the title — `null` time means an empty account, nothing left to say about time. */
      summary: (listCount: string, done: number, total: number, timeLeft: string | null): string =>
        timeLeft
          ? `${listCount} · ${done} of ${total} done · ${timeLeft} left`
          : `${listCount} · ${done} of ${total} done`,
      needHelp: 'Need help?',
      helpButtons: {
        tiredBoss: "I'm Tired, Boss",
        finalizer: 'Finalizer',
        justOneFix: 'Just One Fix',
        surpriseMe: 'Surprise Me',
      },
      /** Until tasks 10.26–10.29 build each one for real — same convention as AppHeader's Settings button. */
      helpComingSoon: (label: string): string => `${label} is coming soon`,
      orphanedTitle: 'Uncategorised',
      orphanedNote: 'category no longer exists',
      /**
       * Task 7.6's "an update is available" notification. Deliberately not
       * "updated" — the user flagged that as confusing during click-through
       * ("updated = already changed, so why are you bothering me").
       */
      updatedCount: (n: number): string =>
        n === 1 ? '1 list has an update available: ' : `${n} lists have updates available: `,
      dismissUpdatesBanner: 'Dismiss',
      /** The automatic on-open check stays silent on failure (see `Home.tsx`) — this is only for the explicit "Check for updates" button, surfaced as a Toast. */
      checkUpdatesFailed: 'Could not check for updates',
    },
  },
} as const

/**
 * Widened from `typeof en` (which, under `as const`, types every string
 * value as its own literal) to a structural shape another language's
 * *different words* can actually satisfy.
 */
export type Locale = Widen<typeof en>
