import { selectPlural } from './plural.js'
import type { RichText, Widen } from './types.js'

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
    loading: 'Loading…',
    unknownError: 'Whoops... something went wrong',
  },

  newList: {
    title: 'New List',
  },

  /** Book-search language names, by Open Library's three-letter code. */
  bookLanguages: {
    eng: 'English',
    spa: 'Spanish',
    fre: 'French',
    ger: 'German',
    ita: 'Italian',
    por: 'Portuguese',
    dut: 'Dutch',
    rus: 'Russian',
    pol: 'Polish',
    swe: 'Swedish',
    nor: 'Norwegian',
    dan: 'Danish',
    fin: 'Finnish',
    jpn: 'Japanese',
    chi: 'Chinese',
    kor: 'Korean',
  } as Record<string, string | undefined>,

  sourceSearch: {
    searchFailed: 'Search has failed to do its duty',
    defaultPlaceholder: 'Search…',
    /**
     * Nudges toward searching for a *source*, which is not the obvious thing to
     * type. Keyed by media type, and optional — a category with no entry falls
     * back to `defaultPlaceholder`, so adding a category needs nothing here.
     */
    placeholders: {
      movie: 'Find an actor, a director, or a film series',
      music: 'Find a band or an artist',
      book: 'Find an author',
    } as Record<string, string | undefined>,
    /** Book-category-only language filter. */
    languageLabel: 'Language',
    allLanguages: 'All',
    includeUnknown: 'Unknown',
    /** Music-category-only discography-type toggles. */
    discographyTypesLabel: 'Include',
    includeEp: 'EPs',
    includeSingle: 'Singles',
    includeLive: 'Live',
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
    movie: {
      handTitlePlaceholder: 'Vin Diesel movies',
      handItemsPlaceholder:
        'Fast And Furious franchise:\nThe Fast and the Furious\nFast Five\n\n# The Chronicles of Riddick franchise\nPitch Black\nThe Chronicles of Riddick\nRiddick',
    },
    tv: {
      label: 'TV Series',
      handTitlePlaceholder: 'The Big Bang Theory',
      handItemsPlaceholder:
        'Season 1:\nS1E1: Pilot\nS1E2: The Big Bran Hypothesis\nS1E3: The Fuzzy Boots Corollary\n\n# Season 2\nS2E1: The Bad Fish Paradigm\nS2E2: The Codpiece Topology',
      handItemsHint:
        'One episode per line. A line ending in a colon, or starting with #, opens a season that lasts until the next one. Blank lines are ignored',
    },
    animation: {
      handTitlePlaceholder: 'Arcane animated series',
      handItemsPlaceholder:
        'Season 1:\nWelcome to the Playground\nSome Mysteries Are Better Left Unsolved\n\n# Season 2\nHeavy Is the Crown\nWatch It All Burn',
    },
    documentary: {
      handTitlePlaceholder: 'David Attenborough documentaries',
      handItemsPlaceholder:
        'The Blue Planet:\nOcean World\nThe Deep\n\n# Planet Earth\nFrom Pole To Pole\nMountains\nFresh Water',
    },
    wrestling: {
      label: 'Pro Wrestling',
      handTitlePlaceholder: 'The Undertaker PPV matches',
      handItemsPlaceholder:
        'The Streak:\nWrestleMania VII (Jimmy Snuka)\nWrestleMania VIII (Jake Roberts)\n\n# Survivor Series\nSurvivor Series 1990 (Survivor Series match)\nSurvivor Series 1991 (singles match)',
    },
    mma: {
      handTitlePlaceholder: 'UFC title fights',
      handItemsPlaceholder:
        'Heavyweight Title:\nUFC 12 (Coleman vs Severn)\nUFC 14 (Smith vs Coleman)\n\n# Lightweight Title\nUFC 30 (Pulver vs Uno)\nUFC 33 (Pulver vs Hallman)',
    },
    game: {
      handTitlePlaceholder: 'Pokémon franchise games',
      handItemsPlaceholder:
        'First Generation:\nPokémon Red\nPokémon Blue\n\n# Second Generation\nPokémon Gold\nPokémon Silver',
    },
    comic: {
      handTitlePlaceholder: 'Spider-Man Clone Saga',
      handItemsPlaceholder:
        'Phase 1 (Prelude):\nSpider-Man: The Lost Years #1\nSpider-Man: The Lost Years #2\n\n# Phase 2 (The Scarlet Spider)\nThe Amazing Spider-Man #400\nSpider-Man (1990) #57',
      handItemsHint:
        'One issue or volume per line. A line ending in a colon, or starting with #, opens a run that lasts until the next one. Blank lines are ignored',
    },
    book: {
      handTitlePlaceholder: 'Discworld novels',
      handItemsPlaceholder:
        'Rincewind:\nThe Colour of Magic\nThe Light Fantastic\n\n# Death\nMort\nReaper Man',
      handItemsHint:
        'One book per line. A line ending in a colon, or starting with #, opens a series that lasts until the next one. Blank lines are ignored',
    },
    music: {
      handTitlePlaceholder: 'Cannibal Corpse discography',
      handItemsPlaceholder:
        'Studio albums:\nEaten Back to Life\nButchered At Birth\nTomb Of The Mutilated\n\n# EPs and singles\nHammer Smashed Face\nWorm Infested',
      handItemsHint:
        'One release per line. A line ending in a colon, or starting with #, opens a section (an era, a type) that lasts until the next one. Blank lines are ignored',
    },
    youtube: {
      handTitlePlaceholder: 'Dungeon Soup',
      handItemsPlaceholder:
        'Chaotic Good Barbarian, Season 1:\nImmortality Killed The Lich\nHearse of Strahd\n\n# Chaotic Good Barbarian, Season 2\nI HAVE NO LUCK AND I MUST SCREAM\nONI-GIRI',
    },
    mega: {
      handTitlePlaceholder: 'The Witcher - everything',
      handItemsPlaceholder:
        'Books:\nThe Last Wish\nSword of Destiny\n\n# Games\nThe Witcher 1\nThe Witcher 2',
    },
  } as Record<
    string,
    | {
        label?: string
        description?: string
        /** Add by hand's examples for this category (11.16); absent: the neutral ones in `quantum.addByHand`. */
        handTitlePlaceholder?: string
        handItemsPlaceholder?: string
        handItemsHint?: string
      }
    | undefined
  >,

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
    'search.queryRequired': (): string => 'Hey, give me something to search for first',
    'search.unavailable': (p: { category: string }): string => `Search is not available for ${p.category}. You can import a list or create one manually.`,
    'search.unavailableOffline': (p: { category: string }): string => `Search is not available for ${p.category}, and List Vault could not be reached. Try later or create a list by hand.`,
    'list.unknownCategory': (p: { key: string }): string => `All thumbs alert: cannot import list, unknown category ‘${p.key}’. Check your category spelling against CONTRIBUTING.md, that's usually the problem`,
    'list.sourceEmpty': (p: { title: string }): string => `Premature listulation detected: found nothing to import for "${p.title}"`,
    'list.fileInvalid': (): string => `Wrong hole, buddy: your file is a square peg trying to penetrate a round hole, so it cannot be imported. Make sure it's in a properly formatted YAML format and has all required fields`,
    'list.fileSyntax': (p: { line?: number }): string =>
      p.line
        ? `All thumbs alert: cannot import list, syntax error on line ${p.line}`
        : `All thumbs alert: cannot import list, syntax error`,
    'list.fileNoItems': (): string => 'Premature listulation detected: cannot import list, no items found',
    'list.fileMissingTitle': (): string => 'Premature listulation detected: cannot import list, no title found',
    'list.fileItemMissingTitle': (p: { index: number }): string => `Alzheimer's relapse detected: cannot import list, item ${p.index} has no title`,
    'list.fileItemNotesTooLong': (p: { index: number; max: number }): string => `Marcel Proust reincarnation detected: cannot import list, item ${p.index}'s notes are over ${p.max} characters`,
    'list.alreadyExists': (): string => `Fastest hand in the West detected: this list already exists, so nothing was restored`,
    'group.nameEmpty': (): string => 'A man needs a group name.',
    'group.nameTaken': (): string => `Alzheimer's relapse detected: this list already has a group with such name.`,
    'group.notEmpty': (): string => 'You can delete a group only when you embrace its emptiness',
    'group.orderMismatch': (): string => 'The groups changed since you loaded this list, so reload it and try again.',
    'reset.unavailable': (): string => 'This list has no source to reset it to, and you should not be seeing this message',
    'name.tooLong': (p: { max: number }): string => `This name is tooo looong: use ${p.max} characters at most.`,
    'refresh.handMadeList': (): string => 'This list was a hand job, so there is nothing to check against.',
    'refresh.searchUnavailable': (p: { category: string }): string => `Search is not available for ${p.category}.`,
  },

  /** Failures with no code: the network, or a server that said something new. */
  request: {
    /** Told apart from "the server said no" — in development it is the common one. */
    unreachable: 'Cannot reach the server. Is anybody there?',
    failed: (status: number): string => `Request failed (${status})`,
    unknown: 'Whoops... something went wrong',
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
    /** The whole-app error screen (AppErrorBoundary): shown instead of a blank window. */
    crash: {
      headline: 'Whoops... ',
      explanation: 'Listulator hit an unexpected error and shat its pants in profound existential terror. Do not worry, your lists are not affected. Hit Reload to (hopefully) bring the app back.',
      reload: 'Reload',
    },
    meter: {
      /** MeterBar's `role="img"` label — never the cap, the real numbers. */
      label: (done: number, total: number): string => `${done} of ${total} done`,
      noteCapped: (cap: number, perCell: number): string => `${cap} cells ≈ ${perCell} items each`,
      noteUncapped: 'One cell = one item',
      /** The header bar only (U6, owner 2026-09-27): a button's title/aria-label, hinting that a click explains it. */
      explainHint: 'How progress bar cells work',
      detailCapped: (cap: number, perCell: number): string =>
        `The bar caps at ${cap} cells, so each cell stands for about ${perCell} items.`,
      detailUncapped: 'Each cell is one item in this list. Filled cell = done.',
    },
    progress: {
      count: (done: number, total: number, percent: number): string =>
        total ? `${done}/${total} (${percent}%)` : `${done}/${total}`,
      left: (duration: string): string => `${duration} left`,
      allDone: '✓ All Done',
      doneForNow: '✓ Done (for now)',
    },
    status: {
      complete: 'Complete',
      ongoing: 'Ongoing',
    },
    marks: {
      curated: 'Canonical list from List Vault (meatbag-maintained)',
      byHand: 'Hand-made list (meatbag-generated)',
      manual: 'Item added manually',
      /** "NEW" itself is invariant in English (a badge, not a countable noun) — the `other`-only form is still ready for a language that does decline it. */
      newCount: (n: number): string => `${n} ${selectPlural(n, 'en', { other: 'NEW' })}`,
      newItem: 'NEW',
      allDone: '✓ All Done',
    },
    /** Words several components share, and hover hints that used to be written inside them (task 10.32b). */
    common: {
      close: 'Close',
      keep: 'Keep',
      toggleDone: 'Toggle done',
      backToLayer: 'Back to this window',
      clickToEdit: 'Click to edit',
      showKey: 'Show key',
      hideKey: 'Hide key',
    },
    /** The three-way status picker and the sentence under it (the same words the status chip's hover uses). */
    statusPicker: {
      notKnown: 'Schrödinger',
      notKnownNote: 'You have no idea whether the media behind this list will get new stuff or not',
      ongoingNote: 'This list is not over yet (new stuff is coming out)',
      completeNote: 'This list is finished (nothing new will come out)',
    },
    /** AppHeader (task 10.9). */
    appHeader: {
      settings: 'Settings',
      about: 'About',
    },
    /** The About layer (task 11.21). Source names, hosts, links and the TMDB notice are not copy: `screens/about/sources.ts`. */
    about: {
      title: 'About',
      closeLabel: 'Close',
      version: 'Version',
      checkForUpdates: 'Check for updates',
      /** The button is a placeholder until the desktop updater exists (owner, 2026-09-30). */
      updatesLater: 'Checking for updates comes in a later version.',
      licence: 'The app is released under the PolyForm Noncommercial license (free for personal use), List Vault lists under CC BY 4.0, and data from the sources below stays under each source’s own terms. © 2026 Listulator',
      madeBy: 'Made by',
      dataSources: 'Data sources',
      showAttribution: 'Show attribution',
      hideAttribution: 'Hide attribution',
      powers: {
        igdb: 'Games',
        musicbrainz: 'Albums and discographies',
        openLibrary: 'Books',
        comicVine: 'Comics',
        youtube: 'Playlists and channels',
        wikipedia: 'Pro Wrestling and MMA events',
        tmdb: 'Movies, TV series, animation and documentaries',
      },
    },
    /** The Settings layer (task 10.30). Copy is the prototype's; language names stay in their own language. */
    settings: {
      title: 'Settings',
      closeLabel: 'Close',
      theme: 'Theme',
      themeQuantum: 'Quantum',
      skin: 'Skin',
      motion: 'Motion',
      reduceMotion: 'Reduce animation motion',
      language: 'Interface Language',
      languages: {
        en: 'English',
        ru: 'Русский',
        de: 'Deutsch',
      },
      /** API keys (task 10.31, desktop only). Sources, blurbs and steps are the prototype's, IGDB's amended for its secret. */
      keys: {
        title: 'API keys',
        placeholder: 'Your API key',
        clientIdPlaceholder: 'Your Client ID',
        clientSecretPlaceholder: 'Your Client Secret',
        infoLabel: 'What this key is used for',
        how: 'Huh?',
        howTitle: 'How to get this key',
        howHeading: 'Getting Your Key',
        test: 'Test',
        status: {
          untested: 'Untested',
          testing: 'Testing',
          working: 'Working',
          rejected: 'Rejected',
          unreachable: 'Offline',
          failed: 'Failed',
        },
        usedNote: (used: string): string => `Used when you search for ${used}.`,
        missNote:
          'Lists can be built without these keys, but only manually or from meatbag-curated List Vault.',
        sources: {
          tmdb: {
            name: 'TMDB',
            fullName: 'TMDB (The Movie Database)',
            used: 'movies, TV, animation, documentaries',
            host: 'themoviedb.org',
            steps: [
              'Create a free account, then open Settings → API.',
              'Request a Developer key (personal use is approved on the spot):',
			  'App name: any. App URL: http://example.com. Summary: Personal key for Serialized media checklister',
              'Copy the API Key and paste it here.',
            ],
          },
          igdb: {
            name: 'IGDB',
            fullName: 'IGDB (Internet Game Database)',
            used: 'video games',
            host: 'dev.twitch.tv',
            steps: [
              'IGDB runs on Twitch auth. Create a Twitch account and make sure you have Two Factor Authentication enabled.',
              'Go to Twitch Developer Portal → Applications and register a new app:',
			  'Name: any. OAuth Redirect URLs: http://localhost. Category: Application Integration. Client type: Confidential',
              'Click Manage next to your app and generate a New Secret',
			  'Copy both Client ID and Client Secret, then paste both here.',
            ],
          },
          comicVine: {
            name: 'Comic Vine',
            fullName: 'Comic Vine',
            used: 'comics',
            host: 'comicvine.gamespot.com/api',
            steps: [
              'Create a GameSpot account and sign in.',
              'Open the API page above, your key will be printed at the top.',
              'Copy it and paste it here.',
            ],
          },
          youtube: {
            name: 'YouTube',
            fullName: 'YouTube',
            used: 'YouTube playlists and channels',
            host: 'console.cloud.google.com',
            steps: [
              'Log in to your Google account, then create a project in the Google Cloud console (Select a project → New project):',
			  'Project name: any. Parent resource: any.',
              'Go to API & Services → Enabled APIs & services → click Enable APIs and services',
			  'Find and enable YouTube Data API v3, then click Credentials → Create credentials → API key:',
              'Name: any. API restrictions: YouTube Data API v3. Application restrictions: none.',
			  'Copy your API key and paste it here.',
            ],
          },
        },
      },
    },
    skin: {
      button: 'Skin',
      kicker: 'Skin',
      changed: (label: string): string => `Switched to the ${label} skin.`,
      labels: {
        'dark-orange': 'Destiny',
        'dark-green': 'Jupiter',
        'dark-blue': 'Deluge',
        'dark-violet': 'Romans',
        'light-bone': 'Jouhou',
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
      title: 'Choose Your Fighter',
      subline: 'Media categories supported by the app. Numbers show how many lists you have.',
      /** First run only — nothing exists yet, so the picker is the base layer. */
      firstRunTitle: 'No Progress Tracked. Let\'s Start!',
      firstRunSubline: 'Each media category has a main data source plus List Vault. Lists can also be imported or entered manually. Mega is for cross-medium franchises.',
      /** A category whose registry entry has no search source. */
      byHand: 'by hand',
      countTitle: 'Lists already tracked in this category',
      closeLabel: 'Close',
    },
    search: {
      queryLabel: (source: string): string => `Search ${source} or List Vault`,
      searchButton: 'Search',
      resultsCount: (n: number): string => `${n} ${selectPlural(n, 'en', { one: 'result', other: 'results' })}`,
      itemsKicker: 'items',
      countLoading: 'Counting…',
      expandRow: (title: string): string => `Show details for ${title}`,
      previewButton: 'Preview',
      /** The covered layer's tab label while a Preview is open. */
      previewTab: (title: string): string => `Preview: ${title}`,
      addButton: 'Add List',
      nothingToAdd: 'Curiously, this list has no items to add',
      /** A source that cannot list its items before import (design: "Preview degrades honestly"). */
      previewUnavailable:
        "This source is too shy to list its items. Just add the list and delete it later if it's a wrong one.",
      curatedTitle: 'Canonical List',
      curatedProvenance: 'From: List Vault · Created and maintained by meatbags exclusively for Listulator',
      sourceProvenance: (source: string): string => `From: ${source}`,
      /** Where a curated-only category (Mega) searches: the tile footer and the Search tab. */
      librarySource: 'List Vault',
      importing: 'Building the list…',
      searching: 'Searching…',
      /** Search needs a key the user has not supplied — hard error (design: ErrorBlock, "no key"). */
      noKeyHeadline: (source: string): string => `Nothing found in List Vault, and search in ${source} needs an API key to work`,
      noKeyDesktop: (category: string): string =>
        `Add your API key in Settings to search the main data source for ${category}. Until then you can add items by hand or rely on canonical lists from List Vault`,
      /** There is no keys section on the web (C7) — keys are the server's, in its `.env`. */
      noKeyWeb: (category: string): string =>
        `Searching the main data source for ${category} needs an API key in the server's .env file. Until then you can add items by hand or rely on canonical lists from List Vault`,
      /** No key *and* the curated library unreachable — naming only the key would send the user hunting for half the answer. */
      offlineHeadline: (category: string): string => `Can't search ${category} right now`,
      offlineDesktop: (category: string): string =>
        `Searching ${category} needs an API key (add yours in Settings), and List Vault could not be reached. Check your internet connection, add your API key if you want to search the main data source for ${category}, or add items by hand`,
      offlineWeb: (category: string): string =>
        `Searching ${category} needs an API key in the server's .env file, and List Vault could not be reached. Check your internet connection, add your API key if you want to search the main data source for ${category}, or add items by hand`,
      /** A library-only category (Mega) has no key: only the connection can be at fault. */
      libraryOnlyOffline: (category: string): string =>
        `List Vault is the only place for searching in ${category}, and it could not be reached. Check your internet connection and try again, or add items by hand`,
      /** Results came back, but the curated half of them could not be searched. */
      libraryUnreachable:
        "Couldn't reach the List Vault, so canonical lists are missing from these results",
      nothingFoundLibraryDown:
        'List Vault could not be reached, so canonical lists were not searched.',
      openSettings: 'Open Settings',
      nothingFoundHeadline: 'Nothing Found',
      nothingFoundBody: 'You sure it\'s a thing? Anyway, try to spell stuff differently, or create a list manually.',
      nothingToImportHeadline: 'Nothing To Import',
      retry: 'Retry',
      dismiss: 'Dismiss',
    },
    addByHand: {
      titleLabel: 'Title',
      titlePlaceholder: 'My list',
      descriptionLabel: 'Description',
      descriptionPlaceholder: 'Optional',
      itemsLabel: 'Items',
      itemsPlaceholder: 'First item\nSecond item\n\nA group:\nThird item\nFourth item',
      itemsHint: 'Lines ending in a colon or starting with # open a group that lasts until the next one. Blank lines are ignored',
      statusLabel: 'Status',
      create: 'Create List',
      creating: 'Creating…',
      /** The live count beside Create; groups are only mentioned when there are some. */
      count: (items: number, groups: number): string => {
        const itemText = `${items} ${selectPlural(items, 'en', { one: 'item', other: 'items' })}`
        if (groups === 0) return itemText

        return `${itemText} in ${groups} ${selectPlural(groups, 'en', { one: 'group', other: 'groups' })}`
      },
      noItems: 'No items (can add later)',
      assumedDuration: (duration: string): string =>
        `Each will get a default duration of ${duration}`,
      createFailed: 'Could not create the list for whatever reason',
    },
    /** The helper sheets under Home's "Need help?" row (tasks 10.26–10.29); copy is the prototype's. */
    helper: {
      topPick: 'Top pick',
      openList: 'Open List',
      notThat: 'Not That',
      /** Announced when every pick has been turned down and the strongest is offered again. */
      backToStrongest: '…Time is a flat circle…',
      nothingUnfinished: 'You have finished everything -- time to add a new list!',
      loading: 'Rummaging…',
      failed: 'Couldn\'t find anything to suggest',
      retry: 'Try Again',
      surprise: {
        title: 'Surprise, MFer!',
        explain: "Random canonical list you're not tracking yet. Millions of flies can't be wrong, eh?",
        any: 'Any',
        category: 'CATEGORY',
        spin: 'Spin To Win!',
        spinAgain: 'Spin Again',
        spinning: 'Spinning…',
        thisOne: 'This One',
        note: 'Choose your categories and try your luck!',
        nothingHere: 'Nothing left here: you are tracking everything',
        anyTitle: (n: number): string => `${n} ${selectPlural(n, 'en', { one: 'candidate', other: 'candidates' })} across all categories`,
        shelfTitle: (n: number): string => `${n} ${selectPlural(n, 'en', { one: 'candidate', other: 'candidates' })} in this category`,
        pool: (n: number, shelves: number): string =>
          `${n} ${selectPlural(n, 'en', { one: 'candidate', other: 'candidates' })}${
            shelves === 0 ? ' across all categories' : shelves === 1 ? ' in this category' : ` in ${shelves} categories`
          }`,
        meta: (category: string, count: number | undefined): string =>
          [category, count === undefined ? null : `${count} ${selectPlural(count, 'en', { one: 'item', other: 'items' })}`, 'canonical list']
            .filter(Boolean)
            .join(' · '),
        landed: (title: string): string => `Landed on ${title}`,
        /** Toast when the chosen shelves hold nothing left to spin. */
        nothingLeft: (shelves: number): string =>
          `Nothing left${shelves === 0 ? ' across every category' : shelves === 1 ? ' in this category' : ` in ${shelves} categories`}: you already track every canonical list there.`,
        unreachable: 'Could not reach the List Vault.',
        curatedTip: 'Canonical list created and maintained by meatbags',
      },
      justOneFix: {
        title: 'Just One Fix',
        explain: 'A quick dopamine hit from the shortest unfinished thing you track',
        why: (time: string): string => `Shortest unfinished item you have -- ${time} and it's done.`,
      },
      finalizer: {
        title: 'Finish Him!',
        explain: 'Tie up loose ends from lists that are closest to being finished',
        why: (percent: number, left: string): string => `Closest to the finish line: ${percent}% done, ${left} left.`,
        whyComplete: 'This list is Complete, so there will be no Round 2',
        whyOngoing: 'This list is still Ongoing, but nothing finishable is closer.',
      },
      tired: {
        title: 'And Now For Something Completely Different',
        explain: 'Tired of grinding a list and want something else from a different medium?',
        tiredOf: "I'm tired of going through",
        pickList: 'Pick a list',
        pickTitle: 'Pick the list you are tired of',
        pickerKicker: 'OR?',
        pickerCount: (shown: number, total: number): string => `${shown} of ${total}`,
        pickerFilter: 'Find the culprit…',
        pickerNone: (query: string): string => `No list matches “${query}”.`,
        /** Nothing from another medium has anything left to offer. */
        nothingElse: 'Nothing else to offer: everything unfinished is in the same medium.',
        /** The one-line why, built from what made the pick (neglect, progress). */
        whyBase: 'Different medium',
        whyNeglected: 'and you haven\'t touched it in a while',
        whyProgress: (percent: number, left: string): string => `${percent}% done, ${left} left`,
        whyFallback: 'Different medium: the best match among what\'s left.',
      },
    },
    /** The platform chip's popover (design: PlatformChip). */
    platformCard: {
      one: 'Platform',
      many: (n: number): string => `Platforms · ${n}`,
      /** The chip's accessible name: what it opens. */
      chipLabel: (title: string): string => `Platforms for ${title}`,
      edit: 'Edit',
      editLabel: (title: string): string => `Edit platforms for ${title}`,
    },
    list: {
      loading: 'Loading the list…',
      /** A tick, or another edit, the server would not take — shown as the list's error strip. */
      saveFailed: 'Couldn\'t save this change',
      loadFailedHeadline: "Can't open this list",
      retry: 'Retry',
      empty: 'No items... yet',
      /** Header actions that arrive with later tasks: shown, disabled, and honest about it. */
      comingSoon: 'Coming soon',
      noGroup: 'No group',
      /** The Group field's hint while it has focus: a name typed there makes a group (owner). */
      typeToCreate: 'Type to create new',
      /** U5: an item's tags by hand — the Platform field and panel, and the short fixed-set dropdown. */
      tags: {
        platform: 'Platform',
        notSet: 'Not set',
        fieldLabel: (label: string, value: string): string => `${label}: ${value}`,
        fieldTip: 'Choose platforms',
        panelLabel: 'Choose platforms',
        head: (named: number): string => (named > 1 ? `Platforms · ${named}` : 'Platform'),
        clear: 'Clear',
        clearTip: 'Remove every platform',
        notSetNote: 'Not set. Pick a platform:',
        removeTip: (name: string): string => `Remove ${name}`,
        search: (n: number): string => `Search ${n} platforms`,
        inList: 'From this list',
        common: 'Most common',
        matches: (n: number): string => `Matches · ${n}`,
        moreFoot: (shown: number, total: number): string => `Showing ${shown} of ${total} -- keep typing`,
        noMatch: (query: string): string => `No platform matches for “${query}”. Try a platform code or another name`,
        sourceSays: (codes: string): string => (codes ? `Source: ${codes}` : 'Source is silent'),
        /** U5: the add row's picker for the next item. */
        nextItem: 'Default Platforms',
        nextItemNote: 'Define default platforms for manually added items in this list',
        nextField: (value: string): string => `Default platforms for manually added items: ${value}`,
        nextTip: 'Default platforms for manually added items',
        resetToSource: 'Reset',
        none: 'None',
        /** The row's [+] for an untagged item, once the list has tags. */
        addPlatforms: (title: string): string => `Set platforms for ${title}`,
        addPlatformsTip: 'No platform, click to pick',
        addChoice: (label: string, title: string): string => `Set ${label.toLowerCase()} for ${title}`,
        addChoiceTip: (label: string): string => `No ${label.toLowerCase()} -- click to set one`,
      },
      itemActions: {
        details: (title: string): string => `Details for ${title}`,
        /** The drag handle's hover text (10.23), in the prototype's words. */
        dragOnList: 'Drag to move across the list',
        dragWithin: (group: string): string => `Drag to reorder within ${group}`,
        dragGroup: 'Drag to move the whole group across the list',
        /** An empty group's own delete button (prototype: "🗑 empty"). */
        deleteGroupLabel: 'empty',
        deleteGroupAria: 'Delete this empty group',
        deleteGroupTip: 'Delete this empty group: it holds no items',
        groupRemoved: (name: string): string => `Deleted group ${name}`,
        groupRestored: (name: string): string => `Restored group ${name}`,
        renameGroupAria: (name: string): string => `Rename group ${name}`,
        groupNameLabel: 'Group name',
        groupRenamed: (from: string, to: string): string => `Renamed group ${from} to ${to}`,
        groupRenameFailed: (name: string): string => `Could not rename group ${name}`,
        groupCreated: (name: string): string => `Created group ${name}`,
        groupRemoveFailed: (name: string): string => `Could not delete group ${name}`,
        /** Deleting a group that has items: a trash button and a confirmation stating the cost (owner, 2026-09-27). */
        deleteGroupWithItems: (name: string): string => `Delete group ${name}`,
        groupDeleteKicker: 'Delete Group',
        groupDeleteQuestion: (name: string): string => `Delete “${name}”?`,
        groupDeleteNote: (n: number, done: number): string => `${n} ${selectPlural(n, 'en', { one: 'item', other: 'items' })}${done > 0 ? `, ${done} done,` : ''} in this group will be deleted as well`,
        groupDeleteConfirm: 'Delete',
        groupRemovedWithItems: (name: string, n: number): string => `Deleted group ${name} with ${n} ${selectPlural(n, 'en', { one: 'item', other: 'items' })}`,
        edit: (title: string): string => `Edit ${title}`,
        remove: (title: string): string => `Delete ${title}`,
        infoKicker: 'Details',
        estimated: 'This runtime is a rough estimate',
        editTitle: 'Title',
        editMinutes: 'Duration (Minutes)',
        editGroup: 'Group',
        discard: 'Don\'t Save',
        save: 'Save',
        saved: (title: string): string => `Saved changes to ${title}`,
        undo: 'Undo',
        removed: (title: string): string => `Deleted ${title}`,
        restored: (title: string): string => `Restored ${title}`,
        added: (title: string, group: string | null): string => group ? `Added ${title} to ${group}` : `Added ${title}`,
        removeFailed: (title: string): string => `Couldn't delete ${title}`,
        // 10.33: the click-away Undo pulses the row; this is what a screen reader hears for it.
        editUndone: (title: string): string => `Reverted last edit to ${title}`,
        editFailed: 'Couldn\'t save those changes',
        undoFailed: 'Couldn\'t undo that',
      },
      addItem: {
        titleLabel: 'Title',
        titlePlaceholder: 'Add an item…',
        minutesLabel: 'Minutes',
        groupLabel: 'Group',
        add: 'Add',
        addGroup: 'Add Group',
        adding: 'Adding…',
        failed: 'Couldn\'t add this item',
      },
      createGroup: (name: string): string => `+ Create “${name}”`,
      editList: 'Edit List',
      /** The ✎ popover beside the name (10.22). */
      /** The Order popover: Sort, and Reset to the source (10.22). */
      orderMenu: {
        kicker: 'Reset List',
        resetQuestion: 'Reset this list to its virgin state?',
        /** Where the list goes back to, by where it came from. */
        resetLead: {
          canonical: 'Back to the canonical list from the List Vault',
          file: 'Back to the file you imported',
          api: 'Back to the list you got from search',
        },
        computing: 'Working out what would change…',
        previewFailed: (message: string): string => `Could not work out what would change (${message}). Resetting will still put the list back to the source.`,
        /** Each part of the cost, said only when it applies. */
        removed: (n: number): string => `${n} ${selectPlural(n, 'en', { one: 'item', other: 'items' })} you added will be removed`,
        restored: (n: number): string => `${n} ${selectPlural(n, 'en', { one: 'item', other: 'items' })} you removed will come back`,
        cleared: (n: number): string => `${n} done ${selectPlural(n, 'en', { one: 'mark', other: 'marks' })} will be cleared`,
        joinCost: (parts: readonly string[]): string =>
          parts.length <= 1
            ? `${parts[0]}.`
            : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`,
        noCost: 'Stuff you added, removed or marked done is not affected.',
        resetEverything: 'Reset',
        sorted: 'Sorted by date — groups moved as blocks.',
        orderRestored: 'Source order restored.',
        resetDone: 'Reset to the source — order, name, description and flag.',
        undone: 'Reset undone',
        orderUndone: 'Order Restored',
        sortFailed: 'Couldn\'t sort this list',
        resetFailed: 'Couldn\'t reset this list',
        undoFailed: 'Couldn\'t undo that',
      },
      /** Moving rows (10.23), in the prototype's words. */
      moves: {
        movedTo: (title: string, position: number, total: number, group?: string): string => `${title} moved to ${position} of ${total}${group ? ` in ${group}` : ''}`,
        atEdge: (side: 'top' | 'bottom', group?: string): string => `Already at the ${side} of ${group ?? 'the list'}`,
        movedOnList: 'Item moved',
        movedInside: (group: string): string => `Item moved inside ${group}.`,
        /** Defensive: only spoken if the list changes mid-drag (the drag already refuses cross-group targets). */
        onlyInsideGroup: 'Reordering only works inside one group',
        undone: 'Move undone',
        saveFailed: 'Couldn\'t save that move',
        undoFailed: 'Couldn\'t undo that move',
      },
      /** The ⋯ menu (10.22). */
      moreMenu: {
        kicker: 'List Actions',
        edit: 'Edit List',
        export: 'Export List',
        reorder: 'Reorder List',
        reset: 'Reset List',
        delete: 'Delete List',
        exportKicker: 'Export List',
        exportNote:
          'Save this list in YAML format. Progress is not included. Useful for canonical list submissions and list sharing.',
        download: 'Download File',
        copy: 'Copy To Clipboard',
        reorderKicker: 'Reorder List',
        reorderQuestion: 'Reorder this list?',
        reorderHint:
          'Groups are moved as blocks by their earliest item. Each group is reordered inside too',
        reorderNote: 'This one-time action does not block manual reordering later.',
        cancel: 'Cancel',
        sortNow: 'Sort by release date',
        restoreSourceOrder: 'Restore source order',
        restoreHint: 'Restore source order puts the items back the way the source lists them.',
        deleteKicker: 'Delete List',
        deleteQuestion: (title: string): string => `Delete “${title}”?`,
        deleteNote: (items: number, done: number): string =>
          items === 0
            ? 'The list is empty.'
            : `${items} ${selectPlural(items, 'en', { one: 'item', other: 'items' })} (${done} done) will be gone like a turd in the wind`,
        keep: 'Keep List',
        confirmDelete: 'Delete List',
        itemCount: (n: number): string => `${n} ${selectPlural(n, 'en', { one: 'item', other: 'items' })}`,
        saved: (fileName: string, items: number): string => `Saved ${fileName} — ${items} ${selectPlural(items, 'en', { one: 'item', other: 'items' })}.`,
        copied: 'YAML list copied to your clipboard',
        copyFailed: 'Couldn\'t copy to clipboard. Try Download File instead?',
        exportFailed: 'Angry customs control detected: couldn\'t export this list',
        deleted: (title: string): string => `Deleted “${title}”.`,
        restored: (title: string): string => `Restored ${title}`,
        deleteFailed: 'Sudden iddqd detected: couldn\'t delete this list',
        restoreFailed: 'Necromancy failure detected: couldn\'t restore the list',
      },
      editPopover: {
        kicker: 'Edit List',
        title: 'Title',
        description: 'Description (optional)',
        descriptionPlaceholder: 'Good place for info like what\'s included in the list and what\'s not',
        status: 'Status (optional)',
        renamed: (title: string): string => `Renamed to “${title}”.`,
        descriptionUpdated: 'Description updated',
        statusMarked: (status: 'complete' | 'ongoing'): string => `List status changed to ${status === 'complete' ? 'Complete' : 'Ongoing'}.`,
        statusCleared: 'List status got schrödingered',
        listSaved: 'List updated',
        reverted: (title: string): string => `Reverted to ${title}`,
        saveFailed: 'Couldn\'t save your changes to this list',
        undoFailed: 'Couldn\'t undo that',
      },
      /** The jump rail beside the spine: groups only, when there is more than one. */
      rail: {
        title: 'Jump to',
        hide: 'Collapse group jumper',
        show: 'Enlarge group jumper',
        resize: 'Resize group jumper',
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
        all: 'All',
        clearTip: 'Show items of all types',
        hideOption: (name: string): string => `Hide ${name}`,
        alsoShowOption: (name: string): string => `Filter by ${name}`,
        /** A facet's kicker, by the label the registry gives it. */
        /** U4: a facet too wide for the bar becomes a dropdown naming its picks. */
        facetPicks: (named: readonly string[], more: number): string => more > 0 ? `${named.join(', ')} +${more}` : named.join(', '),
        facetDropdownLabel: (facet: string, summary: string): string => `${facet}: ${summary}`,
        facetPickTip: 'Choose types to filter by',
        facetCount: (facet: string, n: number): string => `${facet} · ${n}`,
        facetLabels: {
          Type: 'Type',
          Medium: 'Medium',
          Language: 'Language',
          Platform: 'Platform',
          Recording: 'Recording',
        } as Record<string, string | undefined>,
        /** An option's button text, by the label the facet derives; anything not named shows as it is (a platform code, a language). */
        optionLabels: {
          Untagged: '(unknown)',
          MULTI: 'MULTI',
          Movie: 'Movie',
          TV: 'TV',
          Animation: 'Animation',
          Documentary: 'Documentary',
          Wrestling: 'Wrestling',
          MMA: 'MMA',
          Game: 'Game',
          Comic: 'Comic',
          Book: 'Book',
          Music: 'Music',
          YouTube: 'YouTube',
          Album: 'Album',
          EP: 'EP',
          Single: 'Single',
          Mini: 'Mini',
          Live: 'Live',
          Compilation: 'Compilation',
        } as Record<string, string | undefined>,
        collapseAll: 'Collapse',
        expandAll: 'Expand',
        collapseAllTip: 'Fold every group below',
        expandAllTip: 'Open every group below',
      },
      /** Under the add band of a list fetched from a source: where it arrived from, linked (owner, 2026-09-30). The source's name sits between the two. */
      linkBack: { before: 'The original list arrived from ', after: '; you may have changed it since.' },
      /** Beside the link-back, where the source caps how long its data may be stored (YouTube 30 days, TMDB 180): how often the stored copy is refreshed (12.5). */
      sourceCopyNotice: (p: { days: number; source: string }): string => `Its source copy is refreshed every ${p.days} days, as ${p.source} requires.`,
      checkForUpdates: 'Check for updates',
      order: 'Order',
      more: 'More',
      close: 'Close',
      /** Check for updates, the found band and the NEW marks (10.25, 10.22c). */
      updates: {
        checkFailed: 'Couldn\'t check for updates',
        checking: 'Checking for updates…',
        nothingNew: 'No updates found',
        addFailed: 'Couldn\'t add updates',
        /** The band an explicit check raises; nothing is added until Update List. */
        foundBand: (n: number): string => `${n} new ${selectPlural(n, 'en', { one: 'item', other: 'items' })} found`,
        updateList: 'Update List',
        dismissFound: 'Dismiss',
        appliedToast: (n: number): string => `Added ${n} new ${selectPlural(n, 'en', { one: 'item', other: 'items' })}`,
        /** The list's own banner (design prototype): the sentence, then Mark all seen. */
        newBand: (n: number): string => `${n} new ${selectPlural(n, 'en', { one: 'item was', other: 'items were' })} added`,
        markAllSeen: 'Mark All As Seen',
        markedSeen: 'All new items marked as seen',
        markSeenFailed: 'Couldn\'t mark all new items as seen',
      },
    },
    preview: {
      title: 'List Preview',
      closeLabel: 'Close',
      loading: 'Listing the items…',
      /** Count and total runtime; `≈` when some runtimes are the category's default. */
      summary: (count: number, duration: string, estimated: boolean): string => `${count} ${selectPlural(count, 'en', { one: 'item', other: 'items' })} · ${estimated ? '≈ ' : ''}${duration}`,
      addButton: 'Add This List',
      adding: 'Building the list…',
      nothingToAdd: 'Nothing to add: this list is empty like a billionaire\'s conscience',
      loadFailedHeadline: "Can't preview this list",
      retry: 'Retry',
      footer: (provenance: string): string => `${provenance}`,
      expandGroup: (label: string): string => `Expand ${label}`,
      collapseGroup: (label: string): string => `Collapse ${label}`,
    },
    importFile: {
      chooseFile: 'Choose File…',
      boxLabel: 'Or Paste YAML Here',
      boxPlaceholder:
        'title: All Jackie Chan Movies\ncategory: movie\nitems:\n  - { title: Drunken Master, year: 1978 }',
      import: 'Import',
      importing: 'Importing…',
      /** Facts about the text as it arrived; never a verdict. */
      readOutFile: (name: string, size: string, lines: string): string => `${name} · ${size} · ${lines}`,
      readOutPasted: (lines: string): string => `Pasted · ${lines}`,
      lines: (n: number): string => `${n} ${selectPlural(n, 'en', { one: 'line', other: 'lines' })}`,
      footer: 'Use Export feature in a list to create a YAML list file',
      /** U3: the file names another category than the screen's. */
      otherCategoryKicker: 'Wrong Hole',
      otherCategoryQuestion: (fileCategory: string): string => `Import to ${fileCategory}?`,
      otherCategoryNote: (current: string, fileCategory: string): RichText => [
        'We are in ',
        { strong: current },
        ", and the list you're importing is from ",
        { strong: fileCategory },
        '.',
      ],
      back: 'Back',
      importFailed: 'Couldn\'t import this file, so list cannot be created',
    },
    createList: {
      title: (category: string): string => `New ${category} List`,
      // The source name is dropped in every language; the signature stays because callers still pass it.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      searchTab: (_source: string): string => 'Search',
      handTab: 'Use Hands',
      importTab: 'Import',
      closeLabel: 'Close',
    },
    home: {
      title: 'My Lists',
      newList: 'New List',
      checkForUpdates: 'Check for updates',
      checkingUpdates: 'Checking for updates…',
      loadFailed: 'Couldn\'t load your lists',
      retry: 'Retry',
      listCount: (n: number): string =>
        `${n} ${selectPlural(n, 'en', { one: 'list', other: 'lists' })}`,
      /** The mono summary line under the title — `null` time means an empty account, nothing left to say about time. */
      summary: (listCount: string, done: number, total: number, timeLeft: string | null): string =>
        timeLeft
          ? `${listCount} · ${done} of ${total} items done · ${timeLeft} left`
          : `${listCount} · ${done} of ${total} items done`,
      needHelp: 'Need help?',
      helpButtons: {
        tiredBoss: "I'm Tired, Boss",
        finalizer: 'Finalizer',
        justOneFix: 'Just One Fix',
        surpriseMe: 'Surprise Me',
      },
      orphanedTitle: 'Uncategorised',
      orphanedNote: 'category no longer exists',
      /** The name is bold in the sentence; this is what follows it. */
      pendingBand: (n: number): string => ` has ${n} new ${selectPlural(n, 'en', { one: 'item', other: 'items' })}`,
      updateList: 'Update List',
      dismissUpdate: 'Dismiss',
      noNewUpstream: 'Nothing new up there.',
      updateApplied: (n: number, title: string): string => `Added ${n} new ${selectPlural(n, 'en', { one: 'item', other: 'items' })} to “${title}”.`,
      updateFailed: 'Couldn\'t update this list',
      /** Lists a check could not reach, said once at the end. */
      checkPartial: (titles: readonly string[]): string => `Couldn't check ${titles.length} ${selectPlural(titles.length, 'en', { one: 'list', other: 'lists' })}: ${titles.join(', ')}`,
      /** The whole check failed before it could look at anything. */
      checkUpdatesFailed: 'Couldn\'t check for updates',
    },
  },
} as const

/**
 * Widened from `typeof en` (which, under `as const`, types every string
 * value as its own literal) to a structural shape another language's
 * *different words* can actually satisfy.
 */
export type Locale = Widen<typeof en>
