import { selectPlural } from './plural.js'
import type { RichText } from './types.js'
import type { Locale } from './en.js'

/**
 * German — a full translation (task 10.32b), typed as a whole `Locale` so a key
 * added to `en.ts` without a German counterpart fails to compile.
 *
 * **Register:** «du», short imperatives ("Füge … hinzu"), matching the casual
 * voice of the English; the prototype's playful helper-sheet lines keep their
 * attitude. An "item" is an «Eintrag». Movie/series names and platform codes
 * are data and stay as they are. A machine-assisted draft until the owner has
 * reviewed it — see docs/DECISIONS.md (10.32b).
 *
 * German has two plural forms (one / other), like English.
 */
const entries = (n: number): string =>
  `${n} ${selectPlural(n, 'de', { one: 'Eintrag', other: 'Einträge' })}`
const lists = (n: number): string =>
  `${n} ${selectPlural(n, 'de', { one: 'Liste', other: 'Listen' })}`
const candidates = (n: number): string =>
  `${n} ${selectPlural(n, 'de', { one: 'Kandidat', other: 'Kandidaten' })}`
const lines = (n: number): string =>
  `${n} ${selectPlural(n, 'de', { one: 'Zeile', other: 'Zeilen' })}`
const newEntries = (n: number): string =>
  `${n} ${selectPlural(n, 'de', { one: 'neuer Eintrag', other: 'neue Einträge' })}`

/** The part after "Nichts mehr übrig" for a category count. */
const acrossShelves = (shelves: number): string =>
  shelves === 0 ? 'in allen Kategorien' : shelves === 1 ? 'in dieser Kategorie' : `in den gewählten Kategorien (${shelves})`

export const de: Locale = {
  app: {
    loading: 'Lädt…',
    unknownError: 'Ups... etwas ist schiefgelaufen',
  },

  newList: {
    title: 'Neue Liste',
  },

  bookLanguages: {
    eng: 'Englisch',
    spa: 'Spanisch',
    fre: 'Französisch',
    ger: 'Deutsch',
    ita: 'Italienisch',
    por: 'Portugiesisch',
    dut: 'Niederländisch',
    rus: 'Russisch',
    pol: 'Polnisch',
    swe: 'Schwedisch',
    nor: 'Norwegisch',
    dan: 'Dänisch',
    fin: 'Finnisch',
    jpn: 'Japanisch',
    chi: 'Chinesisch',
    kor: 'Koreanisch',
  },

  sourceSearch: {
    searchFailed: 'Die Suche hat ihre Pflicht nicht erfüllt',
    defaultPlaceholder: 'Suchen…',
    placeholders: {
      movie: 'Finde einen Schauspieler, einen Regisseur oder eine Filmreihe',
      music: 'Finde eine Band oder einen Künstler',
      book: 'Finde einen Autor',
    },
    languageLabel: 'Sprache',
    allLanguages: 'Alle',
    includeUnknown: 'Unbekannt',
    discographyTypesLabel: 'Einschließen',
    includeEp: 'EPs',
    includeSingle: 'Singles',
    includeLive: 'Live-Alben',
    includeCompilation: 'Compilations',
  },

  categories: {
    movie: {
      label: 'Filme',
      handTitlePlaceholder: 'Filme von Alfred Hitchcock',
      handItemsPlaceholder:
        'Frühe Filme:\nDer Mieter\nErpressung\n\n# Hollywood\nRebecca\nDas Fenster zum Hof\nVertigo',
    },
    tv: {
      label: 'Serien',
      handTitlePlaceholder: 'Breaking Bad',
      handItemsPlaceholder:
        'Staffel 1:\nPilotfolge\nDie Katze im Sack\n…und der Sack ist im Fluss\n\n# Staffel 2\n737\nGrilliert',
      handItemsHint:
        'Eine Folge pro Zeile. Eine Zeile, die mit einem Doppelpunkt endet oder mit # beginnt, eröffnet eine Staffel, die bis zur nächsten gilt. Leere Zeilen werden ignoriert',
    },
    animation: {
      label: 'Animation',
      handTitlePlaceholder: 'Filme von Studio Ghibli',
      handItemsPlaceholder:
        'Miyazaki:\nChihiros Reise ins Zauberland\nPrinzessin Mononoke\n\n# Takahata\nDas Grab der Glühwürmchen\nPom Poko',
    },
    documentary: {
      label: 'Dokumentationen',
      handTitlePlaceholder: 'Dokumentationen von Ken Burns',
      handItemsPlaceholder:
        'Kriege:\nDer Bürgerkrieg\nDer Krieg\n\n# Kultur\nBaseball\nJazz\nCountry Music',
    },
    wrestling: {
      label: 'Pro-Wrestling',
      handTitlePlaceholder: 'WrestleMania-Hauptkämpfe',
      handItemsPlaceholder:
        'Frühe Jahre:\nWrestleMania I\nWrestleMania III\n\n# Attitude Era\nWrestleMania XIV\nWrestleMania 2000',
    },
    mma: {
      label: 'MMA',
      handTitlePlaceholder: 'UFC-Titelkämpfe',
      handItemsPlaceholder:
        'Frühes UFC:\nUFC 1\nUFC 2\n\n# Moderne Ära\nUFC 100\nUFC 200',
    },
    game: {
      label: 'Spiele',
      handTitlePlaceholder: 'Alle Zelda-Spiele',
      handItemsPlaceholder:
        '2D:\nThe Legend of Zelda\nA Link to the Past\n\n# 3D\nOcarina of Time\nBreath of the Wild',
    },
    comic: {
      label: 'Comics',
      handTitlePlaceholder: 'Sandman',
      handItemsPlaceholder:
        'Band 1:\nPräludien & Nocturnes\n\n# Band 2\nDas Puppenhaus\nTraumland',
      handItemsHint:
        'Eine Ausgabe oder ein Band pro Zeile. Eine Zeile, die mit einem Doppelpunkt endet oder mit # beginnt, eröffnet eine Reihe, die bis zur nächsten gilt. Leere Zeilen werden ignoriert',
    },
    book: {
      label: 'Bücher',
      handTitlePlaceholder: 'Scheibenwelt-Romane',
      handItemsPlaceholder:
        'Rincewind:\nDie Farben der Magie\nDas Licht der Phantasie\n\n# Tod\nMort\nGevatter Tod',
      handItemsHint:
        'Ein Buch pro Zeile. Eine Zeile, die mit einem Doppelpunkt endet oder mit # beginnt, eröffnet eine Reihe, die bis zur nächsten gilt. Leere Zeilen werden ignoriert',
    },
    music: {
      label: 'Musik',
      handTitlePlaceholder: 'Radiohead-Alben',
      handItemsPlaceholder:
        'Studioalben:\nPablo Honey\nThe Bends\nOK Computer\n\n# EPs\nAirbag / How Am I Driving?',
      handItemsHint:
        'Ein Album pro Zeile. Eine Zeile, die mit einem Doppelpunkt endet oder mit # beginnt, eröffnet einen Abschnitt (eine Ära, eine Art), der bis zum nächsten gilt. Leere Zeilen werden ignoriert',
    },
    youtube: {
      label: 'YouTube',
      handTitlePlaceholder: 'Crash Course Weltgeschichte',
      handItemsPlaceholder:
        'Antike:\nDie Agrarrevolution\nDie Indus-Kultur\n\n# Mittelalter\nDie Mongolen',
    },
    mega: {
      label: 'Mega',
      description:
        'Franchises, die mehrere Medien zugleich umspannen — Filme, Serien und Animation zusammen, in Erscheinungsreihenfolge. Marvel und Star Trek gehören hierher; eine einzelne Serie oder Filmreihe nicht.',
      handTitlePlaceholder: 'Marvel Cinematic Universe',
      handItemsPlaceholder:
        'Phase 1:\nIron Man\nDer unglaubliche Hulk\n\n# Phase 2\nIron Man 3\nThor – The Dark Kingdom',
    },
  },

  errors: {
    'search.queryRequired': (): string => 'Hey, gib erst mal etwas zum Suchen ein',
    'search.unavailable': (p: { category: string }): string => `Die Suche ist für „${p.category}“ nicht verfügbar. Du kannst eine Liste importieren oder von Hand anlegen.`,
    'search.unavailableOffline': (p: { category: string }): string => `Die Suche ist für „${p.category}“ nicht verfügbar, und der List Vault war nicht erreichbar. Versuche es später erneut oder lege die Liste von Hand an.`,
    'list.unknownCategory': (p: { key: string }): string => `Zwei linke Hände erkannt: Liste kann nicht importiert werden, unbekannte Kategorie ‘${p.key}’. Vergleiche die Schreibweise der Kategorie mit CONTRIBUTING.md, das ist meistens das Problem`,
    'list.sourceEmpty': (p: { title: string }): string => `Vorzeitige Listulation erkannt: Für „${p.title}“ gibt es nichts zu importieren`,
    'list.fileInvalid': (): string => 'Falsches Loch, Kumpel: Deine Datei ist ein eckiger Pflock, der in ein rundes Loch will, deshalb lässt sie sich nicht importieren. Achte darauf, dass sie korrektes YAML ist und alle Pflichtfelder enthält',
    'list.fileSyntax': (p: { line?: number }): string => p.line ? `Zwei linke Hände erkannt: Liste kann nicht importiert werden, Syntaxfehler in Zeile ${p.line}` : 'Zwei linke Hände erkannt: Liste kann nicht importiert werden, Syntaxfehler',
    'list.fileNoItems': (): string => 'Vorzeitige Listulation erkannt: Liste kann nicht importiert werden, keine Einträge gefunden',
    'list.fileMissingTitle': (): string => 'Vorzeitige Listulation erkannt: Liste kann nicht importiert werden, kein Titel gefunden',
    'list.fileItemMissingTitle': (p: { index: number }): string => `Alzheimer-Rückfall erkannt: Liste kann nicht importiert werden, Eintrag ${p.index} hat keinen Titel`,
    'list.fileItemNotesTooLong': (p: { index: number; max: number }): string => `Marcel-Proust-Reinkarnation erkannt: Liste kann nicht importiert werden, die Notizen von Eintrag ${p.index} sind länger als ${p.max} Zeichen`,
    'list.alreadyExists': (): string => 'Schnellste Hand im Wilden Westen erkannt: Diese Liste gibt es schon, deshalb wurde nichts wiederhergestellt',
    'group.nameEmpty': (): string => 'Ein Mann braucht einen Gruppennamen.',
    'group.nameTaken': (): string => 'Alzheimer-Rückfall erkannt: In dieser Liste gibt es bereits eine Gruppe mit diesem Namen.',
    'group.notEmpty': (): string => 'Eine Gruppe kann man nur löschen, wenn man ihre Leere annimmt',
    'group.orderMismatch': (): string =>
      'Die Gruppen haben sich geändert, seit du die Liste geladen hast — lade sie neu und versuche es noch einmal.',
    'name.tooLong': (p: { max: number }): string => `Dieser Name ist zu lang: höchstens ${p.max} Zeichen.`,
    'reset.unavailable': (): string => 'Diese Liste hat keine Quelle, auf die sie zurückgesetzt werden könnte, und du solltest diese Meldung gar nicht sehen',
    'refresh.handMadeList': (): string => 'Diese Liste ist ein Handjob, also gibt es nichts zum Abgleichen.',
    'refresh.searchUnavailable': (p: { category: string }): string =>
      `Die Suche ist für „${p.category}“ nicht verfügbar.`,
  },

  request: {
    unreachable: 'Server nicht erreichbar. Ist da jemand?',
    failed: (status: number): string => `Anfrage fehlgeschlagen (${status})`,
    unknown: 'Ups... etwas ist schiefgelaufen',
  },

  duration: {
    // Abbreviated, as English is ("1h 30m"): a spelled-out "1 Stunde 30 Minuten" clipped Home's time column.
    minutes: (m: number): string => `${m} Min.`,
    hours: (h: number): string => `${h} Std.`,
    hoursMinutes: (h: number, m: number): string => `${h} Std. ${m} Min.`,
  },

  timeAgo: {
    never: 'noch nie geöffnet',
    today: 'heute',
    yesterday: 'gestern',
    days: (n: number): string => `vor ${n} ${selectPlural(n, 'de', { one: 'Tag', other: 'Tagen' })}`,
    aMonth: 'vor einem Monat',
    months: (n: number): string => `vor ${n} ${selectPlural(n, 'de', { one: 'Monat', other: 'Monaten' })}`,
    aYear: 'vor einem Jahr',
    years: (n: number): string => `vor ${n} ${selectPlural(n, 'de', { one: 'Jahr', other: 'Jahren' })}`,
  },

  quantum: {
    crash: {
      headline: 'Ups... ',
      explanation: 'Listulator ist auf einen unerwarteten Fehler gestoßen und hat sich vor tiefem existenziellem Grauen in die Hose gemacht. Keine Sorge, deine Listen sind nicht betroffen. Klicke auf „Neu laden“, um die App (hoffentlich) zurückzubringen.',
      reload: 'Neu laden',
    },
    meter: {
      label: (done: number, total: number): string => `${done} von ${total} erledigt`,
      noteCapped: (cap: number, perCell: number): string => `${cap} Zellen ≈ je ${perCell} Einträge`,
      noteUncapped: 'Eine Zelle = ein Eintrag',
      explainHint: 'So funktionieren die Zellen der Fortschrittsanzeige',
      detailCapped: (cap: number, perCell: number): string => `Der Balken endet bei ${cap} Zellen, also steht jede Zelle für etwa ${perCell} Einträge.`,
      detailUncapped: 'Jede Zelle ist ein Eintrag dieser Liste. Gefüllte Zelle = erledigt.',
    },
    progress: {
      count: (done: number, total: number, percent: number): string =>
        total ? `${done}/${total} (${percent} %)` : `${done}/${total}`,
      left: (duration: string): string => `noch ${duration}`,
      allDone: '✓ Alles erledigt',
      doneForNow: '✓ Erledigt (vorerst)',
    },
    status: {
      complete: 'Abgeschlossen',
      ongoing: 'Laufend',
    },
    marks: {
      curated: 'Kanonische Liste aus dem List Vault (von Fleischsäcken gepflegt)',
      byHand: 'Handgemachte Liste (von Fleischsäcken erzeugt)',
      manual: 'Manuell hinzugefügter Eintrag',
      newCount: (n: number): string => `${n} NEU`,
      newItem: 'NEU',
      allDone: '✓ Alles erledigt',
    },
    common: {
      close: 'Schließen',
      keep: 'Behalten',
      toggleDone: 'Als erledigt markieren',
      backToLayer: 'Zurück zu diesem Fenster',
      clickToEdit: 'Zum Bearbeiten klicken',
      showKey: 'Schlüssel anzeigen',
      hideKey: 'Schlüssel verbergen',
    },
    statusPicker: {
      notKnown: 'Schrödinger',
      notKnownNote: 'Du hast keine Ahnung, ob es zu diesem Medium noch Neues gibt',
      ongoingNote: 'Diese Liste ist noch nicht zu Ende (es kommt Neues heraus)',
      completeNote: 'Diese Liste ist abgeschlossen (es kommt nichts Neues mehr)',
    },
    appHeader: {
      settings: 'Einstellungen',
      about: 'Über Listulator',
    },
    about: {
      title: 'Über Listulator',
      closeLabel: 'Schließen',
      version: 'Version',
      checkForUpdates: 'Nach Updates suchen',
      updatesLater: 'Die Update-Suche kommt in einer späteren Version.',
      licence: 'Veröffentlicht unter der PolyForm-Noncommercial-Lizenz (kostenlos für den privaten Gebrauch). © 2026 Listulator',
      madeBy: 'Gemacht von',
      dataSources: 'Datenquellen',
      showAttribution: 'Quellenhinweis anzeigen',
      hideAttribution: 'Quellenhinweis ausblenden',
      powers: {
        igdb: 'Spiele',
        musicbrainz: 'Alben und Diskografien',
        openLibrary: 'Bücher',
        comicVine: 'Comics',
        youtube: 'Playlists und Kanäle',
        wikipedia: 'Wrestling- und MMA-Events',
        tmdb: 'Filme, Serien, Animation und Dokumentarfilme',
      },
    },
    settings: {
      title: 'Einstellungen',
      closeLabel: 'Schließen',
      theme: 'Design',
      themeQuantum: 'Quantum',
      skin: 'Farbschema',
      motion: 'Animation',
      reduceMotion: 'Weniger Animationen',
      language: 'Sprache der Oberfläche',
      languages: {
        en: 'English',
        ru: 'Русский',
        de: 'Deutsch',
      },
      keys: {
        title: 'API-Schlüssel',
        placeholder: 'Dein API-Schlüssel',
        clientIdPlaceholder: 'Deine Client-ID',
        clientSecretPlaceholder: 'Dein Client-Secret',
        infoLabel: 'Wofür dieser Schlüssel verwendet wird',
        how: 'Hä?',
        howTitle: 'So bekommst du diesen Schlüssel',
        howHeading: 'Schlüssel besorgen',
        test: 'Testen',
        status: {
          untested: 'Ungetestet',
          testing: 'Test läuft',
          working: 'Funktioniert',
          rejected: 'Abgelehnt',
          unreachable: 'Offline',
          failed: 'Fehlgeschlagen',
        },
        usedNote: (used: string): string => `Wird verwendet, wenn du nach ${used} suchst.`,
        missNote:
          'Listen lassen sich auch ohne diese Schlüssel anlegen, aber nur von Hand oder aus dem von Fleischsäcken kuratierten List Vault.',
        sources: {
          tmdb: {
            name: 'TMDB',
            fullName: 'TMDB (The Movie Database)',
            used: 'Filme, Serien, Animation, Dokumentationen',
            host: 'themoviedb.org',
            steps: [
              'Lege ein kostenloses Konto an und öffne Settings → API.',
              'Beantrage einen Developer-Schlüssel (für den privaten Gebrauch wird er sofort genehmigt):',
              'App name: beliebig. App URL: http://example.com. Summary: Personal key for Serialized media checklister',
              'Kopiere den API Key und füge ihn hier ein.',
            ],
          },
          igdb: {
            name: 'IGDB',
            fullName: 'IGDB (Internet Game Database)',
            used: 'Videospiele',
            host: 'dev.twitch.tv',
            steps: [
              'IGDB läuft über die Twitch-Anmeldung. Lege ein Twitch-Konto an und aktiviere die Zwei-Faktor-Authentifizierung.',
              'Öffne das Twitch Developer Portal → Applications und registriere eine neue App:',
              'Name: beliebig. OAuth Redirect URLs: http://localhost. Category: Application Integration. Client type: Confidential',
              'Klicke neben deiner App auf Manage und erzeuge ein New Secret',
              'Kopiere Client-ID und Client-Secret und füge beides hier ein.',
            ],
          },
          comicVine: {
            name: 'Comic Vine',
            fullName: 'Comic Vine',
            used: 'Comics',
            host: 'comicvine.gamespot.com/api',
            steps: [
              'Lege ein GameSpot-Konto an und melde dich an.',
              'Öffne die API-Seite — dein Schlüssel steht ganz oben.',
              'Kopiere ihn und füge ihn hier ein.',
            ],
          },
          youtube: {
            name: 'YouTube',
            fullName: 'YouTube',
            used: 'YouTube-Playlists und -Kanäle',
            host: 'console.cloud.google.com',
            steps: [
              'Melde dich bei deinem Google-Konto an und lege in der Google-Cloud-Konsole ein Projekt an (Select a project → New project):',
              'Project name: beliebig. Parent resource: beliebig.',
              'Gehe zu API & Services → Enabled APIs & services → klicke auf Enable APIs and services',
              'Suche YouTube Data API v3 und aktiviere sie, dann klicke auf Credentials → Create credentials → API key:',
              'Name: beliebig. API restrictions: YouTube Data API v3. Application restrictions: none.',
              'Kopiere deinen API-Schlüssel und füge ihn hier ein.',
            ],
          },
        },
      },
    },
    skin: {
      button: 'Farbschema',
      kicker: 'Farbschema',
      changed: (label: string): string => `Farbschema gewechselt: ${label}.`,
      labels: {
        'dark-orange': 'Schicksal',
        'dark-green': 'Jupiter',
        'dark-blue': 'Sintflut',
        'dark-violet': 'Römer',
        'light-bone': 'Jouhou',
      },
    },
    layerStack: {
      untitledListTab: 'Liste',
    },
    categoryPicker: {
      title: 'Wähle deinen Kämpfer',
      subline:
        'Vom Programm unterstützte Medienkategorien. Die Zahlen zeigen, wie viele Listen du hast.',
      firstRunTitle: 'Noch nichts erfasst. Fangen wir an!',
      firstRunSubline:
        'Jede Medienkategorie hat eine Hauptdatenquelle plus List Vault. Listen lassen sich auch importieren oder von Hand eingeben. Mega ist für medienübergreifende Franchises.',
      byHand: 'von Hand',
      countTitle: 'Bereits erfasste Listen in dieser Kategorie',
      closeLabel: 'Schließen',
    },
    search: {
      queryLabel: (source: string): string => `Suche: ${source} oder List Vault`,
      searchButton: 'Suchen',
      resultsCount: (n: number): string =>
        `${n} ${selectPlural(n, 'de', { one: 'Ergebnis', other: 'Ergebnisse' })}`,
      itemsKicker: 'Einträge',
      countLoading: 'Zähle…',
      expandRow: (title: string): string => `Details anzeigen: ${title}`,
      previewButton: 'Vorschau',
      previewTab: (title: string): string => `Vorschau: ${title}`,
      addButton: 'Liste hinzufügen',
      nothingToAdd: 'Merkwürdigerweise gibt es in dieser Liste nichts hinzuzufügen',
      previewUnavailable:
        'Diese Quelle ist zu schüchtern, um ihre Einträge zu zeigen. Füge die Liste einfach hinzu und lösche sie später, falls es die falsche war.',
      curatedTitle: 'Kanonische Liste',
      curatedProvenance: 'Quelle: List Vault · Von Fleischsäcken exklusiv für Listulator erstellt und gepflegt',
      sourceProvenance: (source: string): string => `Quelle: ${source}`,
      /** Where a curated-only category (Mega) searches: the tile footer and the Search tab. */
      librarySource: 'Community-Bibliothek',
      importing: 'Liste wird aufgebaut…',
      searching: 'Suche läuft…',
      noKeyHeadline: (source: string): string => `Im List Vault nichts gefunden, und die Suche in ${source} braucht einen API-Schlüssel`,
      noKeyDesktop: (category: string): string => `Trage deinen API-Schlüssel in den Einstellungen ein, um die Hauptdatenquelle für „${category}“ zu durchsuchen. Bis dahin kannst du Einträge von Hand hinzufügen oder auf kanonische Listen aus dem List Vault zurückgreifen`,
      noKeyWeb: (category: string): string => `Für die Suche in der Hauptdatenquelle für „${category}“ braucht es einen API-Schlüssel in der .env-Datei des Servers. Bis dahin kannst du Einträge von Hand hinzufügen oder auf kanonische Listen aus dem List Vault zurückgreifen`,
      offlineHeadline: (category: string): string => `„${category}“ lässt sich gerade nicht durchsuchen`,
      offlineDesktop: (category: string): string => `Für die Suche in „${category}“ braucht es einen API-Schlüssel (trage deinen in den Einstellungen ein), und der List Vault war nicht erreichbar. Prüfe deine Internetverbindung, trage deinen API-Schlüssel ein, wenn du die Hauptdatenquelle für „${category}“ durchsuchen möchtest, oder füge Einträge von Hand hinzu`,
      offlineWeb: (category: string): string => `Für die Suche in „${category}“ braucht es einen API-Schlüssel in der .env-Datei des Servers, und der List Vault war nicht erreichbar. Prüfe deine Internetverbindung, trage deinen API-Schlüssel ein, wenn du die Hauptdatenquelle für „${category}“ durchsuchen möchtest, oder füge Einträge von Hand hinzu`,
      libraryOnlyOffline: (category: string): string =>
        `Der List Vault ist der einzige Ort, um „${category}“ zu durchsuchen, und er war nicht erreichbar. Prüfe deine Internetverbindung und versuche es erneut, oder füge Einträge von Hand hinzu`,
      libraryUnreachable:
        'Der List Vault war nicht erreichbar, deshalb fehlen kanonische Listen in diesen Ergebnissen',
      nothingFoundLibraryDown:
        'Der List Vault war nicht erreichbar, deshalb wurden kanonische Listen nicht durchsucht.',
      openSettings: 'Einstellungen öffnen',
      nothingFoundHeadline: 'Nichts gefunden',
      nothingFoundBody: 'Sicher, dass es das überhaupt gibt? Versuche es jedenfalls mit einer anderen Schreibweise oder lege eine Liste von Hand an.',
      nothingToImportHeadline: 'Nichts zu importieren',
      retry: 'Erneut versuchen',
      dismiss: 'Schließen',
    },
    addByHand: {
      titleLabel: 'Titel',
      titlePlaceholder: 'Meine Liste',
      descriptionLabel: 'Beschreibung',
      descriptionPlaceholder: 'Optional',
      itemsLabel: 'Einträge',
      itemsPlaceholder: 'Erster Eintrag\nZweiter Eintrag\n\nEine Gruppe:\nDritter Eintrag\nVierter Eintrag',
      itemsHint: 'Zeilen, die mit einem Doppelpunkt enden oder mit # beginnen, eröffnen eine Gruppe, die bis zur nächsten gilt. Leere Zeilen werden ignoriert',
      statusLabel: 'Status',
      create: 'Liste erstellen',
      creating: 'Wird erstellt…',
      count: (n: number, g: number): string => {
        const itemText = entries(n)
        if (g === 0) return itemText

        return `${itemText} in ${g} ${selectPlural(g, 'de', { one: 'Gruppe', other: 'Gruppen' })}`
      },
      noItems: 'Keine Einträge (kannst du später hinzufügen)',
      assumedDuration: (duration: string): string => `Jeder Eintrag bekommt standardmäßig eine Dauer von ${duration}`,
      createFailed: 'Die Liste konnte aus irgendeinem Grund nicht erstellt werden',
    },
    helper: {
      topPick: 'Erste Wahl',
      openList: 'Liste öffnen',
      notThat: 'Nicht das',
      backToStrongest: '…Zeit ist ein flacher Kreis…',
      nothingUnfinished: 'Du hast alles abgeschlossen — Zeit für eine neue Liste!',
      loading: 'Stöbere…',
      failed: 'Es konnte nichts vorgeschlagen werden',
      retry: 'Noch einmal',
      surprise: {
        title: 'Überraschung, Mistkerl!',
        explain: 'Eine zufällige kanonische Liste, die du noch nicht verfolgst. Millionen Fliegen können nicht irren, oder?',
        any: 'Beliebig',
        category: 'KATEGORIE',
        spin: 'Drehen und gewinnen!',
        spinAgain: 'Nochmal drehen',
        spinning: 'Dreht sich…',
        thisOne: 'Die hier',
        note: 'Wähl deine Kategorien und probier dein Glück!',
        nothingHere: 'Hier ist nichts mehr übrig: Du verfolgst alles',
        anyTitle: (n: number): string => `${candidates(n)} in allen Kategorien`,
        shelfTitle: (n: number): string => `${candidates(n)} in dieser Kategorie`,
        pool: (n: number, shelves: number): string =>
          `${candidates(n)} ${shelves === 0 ? 'in allen Kategorien' : shelves === 1 ? 'in dieser Kategorie' : `in den gewählten Kategorien (${shelves})`}`,
        meta: (category: string, count: number | undefined): string =>
          [category, count === undefined ? null : entries(count), 'kanonische Liste'].filter(Boolean).join(' · '),
        landed: (title: string): string => `Gelandet bei ${title}`,
        nothingLeft: (shelves: number): string =>
          `Nichts mehr übrig ${acrossShelves(shelves)}: Du verfolgst dort bereits jede kanonische Liste.`,
        unreachable: 'Der List Vault war nicht erreichbar.',
        curatedTip: 'Kanonische Liste, von Fleischsäcken erstellt und gepflegt',
      },
      justOneFix: {
        title: 'Nur ein Häppchen',
        explain: 'Ein schneller Dopamin-Kick vom kürzesten unfertigen Ding, das du verfolgst',
        why: (time: string): string => `Kürzester unfertiger Eintrag, den du hast — ${time}, und er ist erledigt.`,
      },
      finalizer: {
        title: 'Mach ihn fertig!',
        explain: 'Bring lose Enden aus den Listen zu Ende, die dem Ziel am nächsten sind',
        why: (percent: number, left: string): string => `Am nächsten am Ziel: ${percent} % erledigt, noch ${left}.`,
        whyComplete: 'Diese Liste ist abgeschlossen, also gibt es keine zweite Runde',
        whyOngoing: 'Diese Liste läuft noch, aber nichts Abschließbares ist näher dran.',
      },
      tired: {
        title: 'Und nun zu etwas völlig anderem',
        explain: 'Du hast eine Liste satt und willst etwas anderes aus einem anderen Medium?',
        tiredOf: 'Ich habe genug von',
        pickList: 'Liste wählen',
        pickTitle: 'Wähle die Liste, die dich ermüdet',
        pickerKicker: 'ODER?',
        pickerCount: (shown: number, total: number): string => `${shown} von ${total}`,
        pickerFilter: 'Den Schuldigen finden…',
        pickerNone: (query: string): string => `Keine Liste passt zu „${query}“.`,
        nothingElse: 'Sonst gibt es nichts anzubieten: alles Unfertige gehört zum selben Medium.',
        whyBase: 'Anderes Medium',
        whyNeglected: 'und du hast es länger nicht angerührt',
        whyProgress: (percent: number, left: string): string => `${percent} % erledigt, noch ${left}`,
        whyFallback: 'Anderes Medium — die beste Übereinstimmung unter dem, was übrig ist.',
      },
    },
    platformCard: {
      one: 'Plattform',
      many: (n: number): string => `Plattformen · ${n}`,
      chipLabel: (title: string): string => `Plattformen für ${title}`,
      edit: 'Bearbeiten',
      editLabel: (title: string): string => `Plattformen für ${title} bearbeiten`,
    },
    list: {
      loading: 'Liste wird geladen…',
      saveFailed: 'Die Änderung konnte nicht gespeichert werden',
      loadFailedHeadline: 'Diese Liste lässt sich nicht öffnen',
      retry: 'Erneut versuchen',
      empty: 'Keine Einträge... noch nicht',
      comingSoon: 'Bald verfügbar',
      noGroup: 'Keine Gruppe',
      /** The Group field's hint while it has focus: a name typed there makes a group (owner). */
      typeToCreate: 'Tippen, um eine neue anzulegen',
      tags: {
        platform: 'Plattform',
        notSet: 'Nicht gesetzt',
        fieldLabel: (label: string, value: string): string => `${label}: ${value}`,
        fieldTip: 'Plattformen wählen',
        panelLabel: 'Plattformen wählen',
        head: (named: number): string => (named > 1 ? `Plattformen · ${named}` : 'Plattform'),
        clear: 'Leeren',
        clearTip: 'Alle Plattformen entfernen',
        notSetNote: 'Nicht gesetzt. Wähle eine Plattform:',
        removeTip: (name: string): string => `${name} entfernen`,
        search: (n: number): string => `${n} Plattformen durchsuchen`,
        inList: 'Aus dieser Liste',
        common: 'Am häufigsten',
        matches: (n: number): string => `Treffer · ${n}`,
        moreFoot: (shown: number, total: number): string => `${shown} von ${total} — weiter tippen.`,
        noMatch: (query: string): string => `Keine Plattform passt zu „${query}“. Versuche einen Plattformcode oder einen anderen Namen`,
        sourceSays: (codes: string): string => (codes ? `Quelle: ${codes}` : 'Quelle schweigt'),
        nextItem: 'Standardplattformen',
        nextItemNote: 'Lege Standardplattformen für manuell hinzugefügte Einträge in dieser Liste fest',
        nextField: (value: string): string => `Standardplattformen für manuell hinzugefügte Einträge: ${value}`,
        nextTip: 'Standardplattformen für manuell hinzugefügte Einträge',
        resetToSource: 'Zurücksetzen',
        none: 'Keine',
        addPlatforms: (title: string): string => `Plattformen für ${title} setzen`,
        addPlatformsTip: 'Keine Plattform, klicken zum Auswählen',
        addChoice: (label: string, title: string): string => `${label} für ${title} setzen`,
        addChoiceTip: (label: string): string => `${label} nicht gesetzt — klicken, um zu setzen`,
      },
      itemActions: {
        details: (title: string): string => `Details zu ${title}`,
        dragOnList: 'Ziehen, um durch die Liste zu verschieben',
        dragWithin: (group: string): string => `Ziehen, um innerhalb von „${group}“ umzusortieren`,
        dragGroup: 'Ziehen, um die ganze Gruppe durch die Liste zu verschieben',
        deleteGroupLabel: 'leer',
        deleteGroupAria: 'Diese leere Gruppe löschen',
        deleteGroupTip: 'Diese leere Gruppe löschen — sie enthält keine Einträge',
        groupRemoved: (name: string): string => `Gruppe ${name} entfernt`,
        groupRestored: (name: string): string => `Gruppe ${name} wiederhergestellt`,
        renameGroupAria: (name: string): string => `Gruppe ${name} umbenennen`,
        groupNameLabel: 'Gruppenname',
        groupRenamed: (from: string, to: string): string => `Gruppe „${from}“ in „${to}“ umbenannt`,
        groupRenameFailed: (name: string): string => `Gruppe ${name} ließ sich nicht umbenennen`,
        groupCreated: (name: string): string => `Gruppe ${name} angelegt`,
        groupRemoveFailed: (name: string): string => `Gruppe ${name} konnte nicht entfernt werden`,
        deleteGroupWithItems: (name: string): string => `Gruppe ${name} löschen`,
        groupDeleteKicker: 'Gruppe löschen',
        groupDeleteQuestion: (name: string): string => `„${name}“ löschen?`,
        groupDeleteNote: (n: number, done: number): string =>
          `${entries(n)}${done > 0 ? `, davon ${done} erledigt,` : ''} in dieser Gruppe ${n === 1 ? 'wird' : 'werden'} ebenfalls gelöscht`,
        groupDeleteConfirm: 'Löschen',
        groupRemovedWithItems: (name: string, n: number): string => `Gruppe ${name} und ${entries(n)} entfernt`,
        edit: (title: string): string => `${title} bearbeiten`,
        remove: (title: string): string => `${title} entfernen`,
        infoKicker: 'Details',
        estimated: 'Diese Laufzeit ist eine grobe Schätzung',
        editTitle: 'Titel',
        editMinutes: 'Dauer (Minuten)',
        editGroup: 'Gruppe',
        discard: 'Nicht speichern',
        save: 'Speichern',
        saved: (title: string): string => `Änderungen an ${title} gespeichert`,
        undo: 'Rückgängig',
        removed: (title: string): string => `${title} entfernt`,
        restored: (title: string): string => `${title} wiederhergestellt`,
        added: (title: string, group: string | null): string =>
          group ? `${title} zu „${group}“ hinzugefügt` : `${title} hinzugefügt`,
        removeFailed: (title: string): string => `${title} konnte nicht entfernt werden`,
        editUndone: (title: string): string => `Änderung an ${title} rückgängig gemacht`,
        editFailed: 'Die Änderungen konnten nicht gespeichert werden',
        undoFailed: 'Das ließ sich nicht rückgängig machen',
      },
      addItem: {
        titleLabel: 'Titel',
        titlePlaceholder: 'Eintrag hinzufügen…',
        minutesLabel: 'Minuten',
        groupLabel: 'Gruppe',
        add: 'Hinzufügen',
        addGroup: 'Gruppe hinzufügen',
        adding: 'Wird hinzugefügt…',
        failed: 'Der Eintrag konnte nicht hinzugefügt werden',
      },
      createGroup: (name: string): string => `+ „${name}“ anlegen`,
      editList: 'Liste bearbeiten',
      orderMenu: {
        kicker: 'Liste zurücksetzen',
        resetQuestion: 'Diese Liste in ihren jungfräulichen Zustand zurücksetzen?',
        resetLead: {
          canonical:
            'Zurück zur kanonischen Liste aus dem List Vault',
          file: 'Zurück zur importierten Datei',
          api: 'Zurück zur Liste aus der Suche',
        },
        computing: 'Wir rechnen aus, was sich ändern würde…',
        previewFailed: (message: string): string =>
          `Es ließ sich nicht ausrechnen, was sich ändern würde (${message}). Das Zurücksetzen stellt die Liste trotzdem auf die Quelle zurück.`,
        removed: (n: number): string =>
          `${selectPlural(n, 'de', { one: `${n} von dir hinzugefügter Eintrag wird entfernt`, other: `${n} von dir hinzugefügte Einträge werden entfernt` })}`,
        restored: (n: number): string =>
          `${selectPlural(n, 'de', { one: `${n} von dir entfernter Eintrag kommt zurück`, other: `${n} von dir entfernte Einträge kommen zurück` })}`,
        cleared: (n: number): string =>
          `${selectPlural(n, 'de', { one: `${n} Erledigt-Markierung wird gelöscht`, other: `${n} Erledigt-Markierungen werden gelöscht` })}`,
        joinCost: (parts: readonly string[]): string =>
          parts.length <= 1
            ? `${parts[0]}.`
            : `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}.`,
        noCost: 'Was du hinzugefügt, entfernt oder als erledigt markiert hast, bleibt unberührt.',
        resetEverything: 'Zurücksetzen',
        sorted: 'Nach Datum sortiert — Gruppen als Blöcke verschoben.',
        orderRestored: 'Reihenfolge der Quelle wiederhergestellt.',
        resetDone: 'Auf die Quelle zurückgesetzt — Reihenfolge, Name, Beschreibung und Markierung.',
        undone: 'Zurücksetzen rückgängig gemacht',
        orderUndone: 'Reihenfolge wiederhergestellt',
        sortFailed: 'Die Liste konnte nicht sortiert werden',
        resetFailed: 'Die Liste konnte nicht zurückgesetzt werden',
        undoFailed: 'Das ließ sich nicht rückgängig machen',
      },
      moves: {
        movedTo: (title: string, position: number, total: number, group?: string): string =>
          `${title} auf Platz ${position} von ${total} verschoben${group ? ` in „${group}“` : ''}`,
        atEdge: (side: 'top' | 'bottom', group?: string): string =>
          `Schon ${side === 'top' ? 'am Anfang' : 'am Ende'} ${group ? `von „${group}“` : 'der Liste'}`,
        movedOnList: 'Eintrag verschoben',
        movedInside: (group: string): string => `Eintrag innerhalb von „${group}“ verschoben.`,
        onlyInsideGroup: 'Umsortieren geht nur innerhalb einer Gruppe',
        undone: 'Verschieben rückgängig gemacht',
        saveFailed: 'Das Verschieben konnte nicht gespeichert werden',
        undoFailed: 'Das Verschieben ließ sich nicht rückgängig machen',
      },
      moreMenu: {
        kicker: 'Listenaktionen',
        edit: 'Liste bearbeiten',
        export: 'Liste exportieren',
        reorder: 'Liste ordnen',
        reset: 'Liste zurücksetzen',
        delete: 'Liste löschen',
        exportKicker: 'Liste exportieren',
        exportNote:
          'Speichere diese Liste im YAML-Format. Der Fortschritt ist nicht enthalten. Nützlich für Vorschläge kanonischer Listen und zum Teilen von Listen.',
        download: 'Datei herunterladen',
        copy: 'In die Zwischenablage kopieren',
        reorderKicker: 'Liste ordnen',
        reorderQuestion: 'Liste neu ordnen?',
        reorderHint:
          'Gruppen werden als Blöcke nach ihrem frühesten Eintrag verschoben. Auch innerhalb jeder Gruppe wird neu geordnet',
        reorderNote:
          'Diese einmalige Aktion verhindert späteres manuelles Umsortieren nicht.',
        cancel: 'Abbrechen',
        sortNow: 'Nach Erscheinungsdatum sortieren',
        restoreSourceOrder: 'Reihenfolge der Quelle wiederherstellen',
        restoreHint: 'Die Reihenfolge der Quelle stellt die Einträge so wieder her, wie die Quelle sie aufführt.',
        deleteKicker: 'Liste löschen',
        deleteQuestion: (title: string): string => `„${title}“ löschen?`,
        deleteNote: (n: number, done: number): string =>
          n === 0 ? 'Die Liste ist leer.' : `${entries(n)} (${done} erledigt) verschwinden wie ein Kackhaufen im Wind`,
        keep: 'Liste behalten',
        confirmDelete: 'Liste löschen',
        itemCount: (n: number): string => entries(n),
        saved: (fileName: string, n: number): string => `${fileName} gespeichert — ${entries(n)}.`,
        copied: 'YAML-Liste in die Zwischenablage kopiert',
        copyFailed: 'Kopieren in die Zwischenablage fehlgeschlagen. Versuche stattdessen „Datei herunterladen“?',
        exportFailed: 'Wütende Zollkontrolle erkannt: Diese Liste konnte nicht exportiert werden',
        deleted: (title: string): string => `„${title}“ gelöscht.`,
        restored: (title: string): string => `${title} wiederhergestellt`,
        deleteFailed: 'Plötzliches iddqd erkannt: Diese Liste konnte nicht gelöscht werden',
        restoreFailed: 'Nekromantie-Fehlschlag erkannt: Liste konnte nicht wiederhergestellt werden',
      },
      editPopover: {
        kicker: 'Liste bearbeiten',
        title: 'Titel',
        description: 'Beschreibung (optional)',
        descriptionPlaceholder: 'Guter Ort für Infos dazu, was in der Liste enthalten ist und was nicht',
        status: 'Status (optional)',
        renamed: (title: string): string => `Umbenannt in „${title}“.`,
        descriptionUpdated: 'Beschreibung aktualisiert',
        statusMarked: (status: 'complete' | 'ongoing'): string =>
          `Listenstatus geändert auf ${status === 'complete' ? 'Abgeschlossen' : 'Laufend'}.`,
        statusCleared: 'Der Listenstatus wurde geschrödingert',
        listSaved: 'Liste aktualisiert',
        reverted: (title: string): string => `Zurückgesetzt auf ${title}`,
        saveFailed: 'Deine Änderungen an der Liste konnten nicht gespeichert werden',
        undoFailed: 'Das ließ sich nicht rückgängig machen',
      },
      rail: {
        title: 'Springen zu',
        hide: 'Gruppen-Sprungleiste einklappen',
        show: 'Gruppen-Sprungleiste vergrößern',
        resize: 'Größe der Gruppen-Sprungleiste ändern',
      },
      filter: {
        label: 'Einträge filtern',
        placeholder: 'Einträge filtern…',
        total: (n: number): string => entries(n),
        shown: (shown: number, total: number): string => `${shown} von ${total} angezeigt`,
        groupShown: (shown: number, total: number): string => `${shown} von ${total}`,
        nothing: (text: string): string =>
          text.trim() ? `Nichts passt zu „${text.trim()}“.` : 'Nichts passt zu diesem Filter.',
        all: 'Alle',
        clearTip: 'Elemente aller Typen anzeigen',
        hideOption: (name: string): string => `${name} ausblenden`,
        alsoShowOption: (name: string): string => `Nach ${name} filtern`,
        facetPicks: (named: readonly string[], more: number): string =>
          more > 0 ? `${named.join(', ')} +${more}` : named.join(', '),
        facetDropdownLabel: (facet: string, summary: string): string => `${facet}: ${summary}`,
        facetPickTip: 'Typen zum Filtern wählen',
        facetCount: (facet: string, n: number): string => `${facet} · ${n}`,
        facetLabels: {
          Type: 'Typ',
          Medium: 'Medium',
          Language: 'Sprache',
          Platform: 'Plattform',
          Recording: 'Aufnahme',
        },
        optionLabels: {
          Untagged: '(unbekannt)',
          MULTI: 'MULTI',
          Movie: 'Film',
          TV: 'Serie',
          Animation: 'Animation',
          Documentary: 'Dokumentation',
          Wrestling: 'Wrestling',
          MMA: 'MMA',
          Game: 'Spiel',
          Comic: 'Comic',
          Book: 'Buch',
          Music: 'Musik',
          YouTube: 'YouTube',
          Album: 'Album',
          EP: 'EP',
          Single: 'Single',
          Mini: 'Mini',
          Live: 'Live',
          Compilation: 'Compilation',
        },
        collapseAll: 'Einklappen',
        expandAll: 'Ausklappen',
        collapseAllTip: 'Alle Gruppen darunter einklappen',
        expandAllTip: 'Alle Gruppen darunter aufklappen',
      },
      checkForUpdates: 'Nach Updates suchen',
      order: 'Reihenfolge',
      more: 'Mehr',
      close: 'Schließen',
      updates: {
        checkFailed: 'Die Suche nach Updates ist fehlgeschlagen',
        checking: 'Suche nach Updates…',
        nothingNew: 'Keine Updates gefunden',
        addFailed: 'Sie konnten nicht hinzugefügt werden',
        foundBand: (n: number): string => `${newEntries(n)} gefunden.`,
        updateList: 'Liste aktualisieren',
        dismissFound: 'Schließen',
        appliedToast: (n: number): string => `${newEntries(n)} hinzugefügt.`,
        newBand: (n: number): string =>
          selectPlural(n, 'de', { one: `${n} neuer Eintrag wurde hinzugefügt`, other: `${n} neue Einträge wurden hinzugefügt` }),
        markAllSeen: 'Alle als gesehen markieren',
        markedSeen: 'Alle als gesehen markiert',
        markSeenFailed: 'Sie konnten nicht als gesehen markiert werden',
      },
    },
    preview: {
      title: 'Listenvorschau',
      closeLabel: 'Schließen',
      loading: 'Einträge werden aufgelistet…',
      summary: (count: number, duration: string, estimated: boolean): string =>
        `${entries(count)} · ${estimated ? '≈ ' : ''}${duration}`,
      addButton: 'Diese Liste hinzufügen',
      adding: 'Liste wird aufgebaut…',
      nothingToAdd: 'Nichts hinzuzufügen: Diese Liste ist leer wie das Gewissen eines Milliardärs',
      loadFailedHeadline: 'Für diese Liste gibt es keine Vorschau',
      retry: 'Erneut versuchen',
      footer: (provenance: string): string => `${provenance}`,
      expandGroup: (label: string): string => `${label} ausklappen`,
      collapseGroup: (label: string): string => `${label} einklappen`,
    },
    importFile: {
      chooseFile: 'Datei wählen…',
      boxLabel: 'Oder füge YAML hier ein',
      boxPlaceholder:
        'title: Alle Jackie-Chan-Filme\ncategory: movie\nitems:\n  - { title: Drunken Master, year: 1978 }',
      import: 'Importieren',
      importing: 'Wird importiert…',
      readOutFile: (name: string, size: string, l: string): string => `${name} · ${size} · ${l}`,
      readOutPasted: (l: string): string => `Eingefügt · ${l}`,
      lines: (n: number): string => lines(n),
      footer:
        'Nutze die Exportfunktion in einer Liste, um eine YAML-Listendatei zu erstellen',
      otherCategoryKicker: 'Falsches Loch',
      otherCategoryQuestion: (fileCategory: string): string => `In „${fileCategory}“ importieren?`,
      otherCategoryNote: (current: string, fileCategory: string): RichText => [
        'Wir sind in ',
        { strong: `„${current}“` },
        ', und die importierte Liste gehört zu ',
        { strong: `„${fileCategory}“` },
        '.',
      ],
      back: 'Zurück',
      importFailed: 'Diese Datei konnte nicht importiert werden, deshalb lässt sich die Liste nicht erstellen',
    },
    createList: {
      title: (category: string): string => `Neue Liste: ${category}`,
      searchTab: (): string => 'Suche',
      handTab: 'Hände einsetzen',
      importTab: 'Importieren',
      closeLabel: 'Schließen',
    },
    home: {
      title: 'Meine Listen',
      newList: 'Neue Liste',
      checkForUpdates: 'Nach Updates suchen',
      checkingUpdates: 'Suche nach Updates…',
      loadFailed: 'Deine Listen konnten nicht geladen werden',
      retry: 'Erneut versuchen',
      listCount: (n: number): string => lists(n),
      summary: (listCount: string, done: number, total: number, timeLeft: string | null): string =>
        timeLeft
          ? `${listCount} · ${done} von ${total} erledigt · noch ${timeLeft}`
          : `${listCount} · ${done} von ${total} erledigt`,
      needHelp: 'Hilfe gefällig?',
      helpButtons: {
        tiredBoss: 'Ich bin müde, Chef',
        finalizer: 'Finalizer',
        justOneFix: 'Nur ein Häppchen',
        surpriseMe: 'Überrasch mich',
      },
      orphanedTitle: 'Ohne Kategorie',
      orphanedNote: 'diese Kategorie gibt es nicht mehr',
      pendingBand: (n: number): string => ` hat ${newEntries(n)}.`,
      updateList: 'Liste aktualisieren',
      dismissUpdate: 'Schließen',
      noNewUpstream: 'Da oben gibt es nichts Neues.',
      updateApplied: (n: number, title: string): string =>
        `${newEntries(n)} zu „${title}“ hinzugefügt.`,
      updateFailed: 'Diese Liste konnte nicht aktualisiert werden',
      checkPartial: (titles: readonly string[]): string =>
        `${lists(titles.length)} ${titles.length === 1 ? 'konnte' : 'konnten'} nicht geprüft werden: ${titles.join(', ')}`,
      checkUpdatesFailed: 'Die Suche nach Updates ist fehlgeschlagen',
    },
  },
}
