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
        /** The drag handle's hover text (10.23), in the prototype's words. */
        dragOnList: 'Drag to move this item on the list',
        dragWithin: (group: string): string => `Drag to reorder within ${group}`,
        dragGroup: 'Drag to move this group on the list',
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
      /** The ✎ popover beside the name (10.22). */
      /** The Order popover: Sort, and Reset to the source (10.22). */
      orderMenu: {
        kicker: 'Reset list',
        resetQuestion: 'Reset this list to the source?',
        /** Where the list goes back to, by where it came from. */
        resetLead: {
          canonical: 'Back to the live file in the community library. Anything the file has now is what you get.',
          file: 'Back to the file you imported.',
          api: 'Back to how this list arrived.',
        },
        computing: 'Working out what would change…',
        previewFailed: (message: string): string =>
          `Could not work out what would change (${message}). Resetting will still put the list back to the source.`,
        /** Each part of the cost, said only when it applies. */
        removed: (n: number): string =>
          `${n} ${selectPlural(n, 'en', { one: 'item', other: 'items' })} you added will be removed`,
        restored: (n: number): string =>
          `${n} ${selectPlural(n, 'en', { one: 'item', other: 'items' })} you removed will come back`,
        cleared: (n: number): string =>
          `${n} done ${selectPlural(n, 'en', { one: 'mark', other: 'marks' })} will be cleared`,
        joinCost: (parts: readonly string[]): string =>
          parts.length <= 1
            ? `${parts[0]}.`
            : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`,
        noCost: 'Nothing you added, removed or marked done is affected.',
        undoNote: 'Undo is offered for 8 seconds.',
        resetOrder: 'Reset the order',
        resetEverything: 'Reset everything',
        sorted: 'Sorted by date — groups moved as blocks.',
        orderReset: 'Order reset.',
        resetDone: 'Reset to the source — order, name, description and flag.',
        undone: 'Reset undone',
        orderUndone: 'Order restored',
        sortFailed: 'Could not sort this list',
        resetFailed: 'Could not reset this list',
        undoFailed: 'Could not undo that',
      },
      /** Moving rows (10.23), in the prototype's words. */
      moves: {
        movedTo: (title: string, position: number, total: number, group?: string): string =>
          `${title} moved to ${position} of ${total}${group ? ` in ${group}` : ''}`,
        atEdge: (side: 'top' | 'bottom', group?: string): string =>
          `Already at the ${side} of ${group ?? 'the list'}`,
        movedOnList: 'Moved on the list.',
        movedInside: (group: string): string => `Moved inside ${group}.`,
        movedRows: (n: number): string => `Moved ${n} ${selectPlural(n, 'en', { one: 'row', other: 'rows' })}.`,
        onlyInsideGroup: 'Reordering only works inside one group',
        undone: 'Move undone',
        saveFailed: 'Could not save that move',
        undoFailed: 'Could not undo that move',
      },
      /** The ⋯ menu (10.22). */
      moreMenu: {
        kicker: 'List actions',
        edit: 'Edit List',
        export: 'Export List',
        reorder: 'Reorder List',
        reset: 'Reset List',
        delete: 'Delete List',
        exportKicker: 'Export list',
        exportNote:
          'Save this list in YAML format. Your progress is never included. Useful for canonical list submissions.',
        download: 'Download File',
        copy: 'Copy To Clipboard',
        reorderKicker: 'Reorder list',
        reorderQuestion: 'Sort this list chronologically?',
        reorderHint:
          'Groups move as blocks, by their earliest item. Nothing is dissolved, nothing inside a group is shuffled.',
        reorderNote: 'A one-off action — the list does not stay sorted. Undo is offered for 8 seconds.',
        cancel: 'Cancel',
        sortNow: 'Sort now',
        deleteKicker: 'Delete list',
        deleteQuestion: (title: string): string => `Delete “${title}”?`,
        deleteNote: (items: number, done: number): string =>
          items === 0
            ? 'The list is empty. Undo is offered for 8 seconds.'
            : `${items} ${selectPlural(items, 'en', { one: 'item', other: 'items' })} and ${done} marked done go with it. Undo is offered for 8 seconds.`,
        keep: 'Keep',
        confirmDelete: 'Delete list',
        itemCount: (n: number): string =>
          `${n} ${selectPlural(n, 'en', { one: 'item', other: 'items' })}`,
        saved: (fileName: string, items: number): string =>
          `Saved ${fileName} — ${items} ${selectPlural(items, 'en', { one: 'item', other: 'items' })}.`,
        copied: 'YAML copied to the clipboard.',
        copyFailed: 'Could not copy — try Download File instead.',
        exportFailed: 'Could not export this list',
        deleted: (title: string): string => `Deleted “${title}”.`,
        restored: (title: string): string => `Restored ${title}`,
        deleteFailed: 'Could not delete this list',
        restoreFailed: 'Could not restore that list',
      },
      editPopover: {
        kicker: 'Edit list',
        title: 'Title',
        description: 'Description (optional)',
        descriptionPlaceholder: 'What this list is — a line or two',
        status: 'Status (optional)',
        renamed: (title: string): string => `Renamed to “${title}”.`,
        descriptionUpdated: 'Description updated.',
        statusMarked: (status: 'complete' | 'ongoing'): string =>
          `Marked ${status === 'complete' ? 'complete' : 'ongoing'}.`,
        statusCleared: 'Status cleared.',
        reverted: (title: string): string => `Reverted to ${title}`,
        saveFailed: 'Could not save your changes to the list',
        undoFailed: 'Could not undo that',
      },
      /** The filter bar under the header: a text field, the category's facets, fold-all and a note. */
      filter: {
        label: 'Filter items',
        placeholder: 'Filter items…',
        total: (n: number): string => `${n} ${selectPlural(n, 'en', { one: 'item', other: 'items' })}`,
        shown: (shown: number, total: number): string => `${shown} of ${total} shown`,
        /** A group's count while filtering. */
        groupShown: (shown: number, total: number): string => `${shown} of ${total}`,
        nothing: (text: string): string => (text.trim() ? `Nothing matches “${text.trim()}”.` : 'Nothing matches this filter.'),
        collapseAll: 'Collapse all',
        expandAll: 'Expand all',
        collapseAllTip: 'Fold every group',
        expandAllTip: 'Open every group',
      },
      checkForUpdates: 'Check for updates',
      order: 'Order',
      more: 'More',
      close: 'Close',
      /** Check for updates, the found band and the NEW marks (10.25, 10.22c). */
      updates: {
        checkFailed: 'Could not check for updates',
        nothingNew: 'No new items upstream.',
        addFailed: 'Could not add them',
        /** The band an explicit check raises; nothing is added until Update List. */
        foundBand: (n: number): string =>
          `${n} new ${selectPlural(n, 'en', { one: 'item', other: 'items' })} found.`,
        updateList: 'Update List',
        dismissFound: 'Dismiss',
        appliedToast: (n: number): string =>
          `Added ${n} new ${selectPlural(n, 'en', { one: 'item', other: 'items' })}.`,
        /** The list's own banner (design prototype): the sentence, then Mark all seen. */
        newBand: (n: number): string =>
          `${n} new ${selectPlural(n, 'en', { one: 'item was', other: 'items were' })} added. Sorted something manually? Check if it's affected`,
        markAllSeen: 'Mark all seen',
        markedSeen: 'All marked as seen',
        markSeenFailed: 'Could not mark them as seen',
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
      /** The name is bold in the sentence; this is what follows it. */
      pendingBand: (n: number): string =>
        ` has ${n} new ${selectPlural(n, 'en', { one: 'item', other: 'items' })}.`,
      updateList: 'Update List',
      dismissUpdate: 'Dismiss',
      noNewUpstream: 'No new items upstream.',
      updateApplied: (n: number, title: string): string =>
        `Added ${n} new ${selectPlural(n, 'en', { one: 'item', other: 'items' })} to “${title}”.`,
      updateFailed: 'Could not update this list',
      /** Lists a check could not reach, said once at the end. */
      checkPartial: (titles: readonly string[]): string =>
        `Could not check ${titles.length} ${selectPlural(titles.length, 'en', { one: 'list', other: 'lists' })}: ${titles.join(', ')}`,
      /** The whole check failed before it could look at anything. */
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
