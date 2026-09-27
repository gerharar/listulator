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

/** The part after "Nichts mehr übrig" for a shelf count. */
const acrossShelves = (shelves: number): string =>
  shelves === 0 ? 'in allen Regalen' : shelves === 1 ? 'in diesem Regal' : `in den gewählten Regalen (${shelves})`

export const de: Locale = {
  app: {
    loading: 'Lädt…',
    unknownError: 'Etwas ist schiefgelaufen',
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
    searchFailed: 'Suche fehlgeschlagen',
    defaultPlaceholder: 'Suchen…',
    placeholders: {
      movie: 'Ein Schauspieler, Regisseur oder eine Filmreihe…',
      music: 'Eine Band oder ein Künstler…',
      book: 'Ein Autor…',
    },
    languageLabel: 'Sprache',
    allLanguages: 'Alle',
    includeUnknown: 'Auch Bücher ohne Sprachangabe einbeziehen',
    discographyTypesLabel: 'Auch einbeziehen',
    includeEp: 'EPs',
    includeSingle: 'Singles',
    includeLive: 'Live-Alben',
    includeCompilation: 'Compilations',
  },

  categories: {
    movie: { label: 'Filme' },
    tv: { label: 'Serien' },
    animation: { label: 'Animation' },
    documentary: { label: 'Dokumentationen' },
    wrestling: { label: 'Pro-Wrestling' },
    mma: { label: 'MMA' },
    game: { label: 'Spiele' },
    comic: { label: 'Comics' },
    book: { label: 'Bücher' },
    music: { label: 'Musik' },
    youtube: { label: 'YouTube' },
    mega: {
      label: 'Mega',
      description:
        'Franchises, die mehrere Medien zugleich umspannen — Filme, Serien und Animation zusammen, in Erscheinungsreihenfolge. Marvel und Star Trek gehören hierher; eine einzelne Serie oder Filmreihe nicht.',
    },
  },

  errors: {
    'search.queryRequired': (): string => 'Gib etwas zum Suchen ein.',
    'search.unavailable': (p: { category: string }): string =>
      `Die Suche ist für „${p.category}“ nicht verfügbar. Füge die Einträge von Hand hinzu.`,
    'search.unavailableOffline': (p: { category: string }): string =>
      `Die Suche ist für „${p.category}“ nicht verfügbar, und die Community-Bibliothek war nicht erreichbar. Füge die Einträge von Hand hinzu.`,
    'list.unknownCategory': (p: { key: string }): string =>
      `Unbekannte Kategorie ‚${p.key}‘, die Liste kann nicht importiert werden.`,
    'list.sourceEmpty': (p: { title: string }): string =>
      `Für „${p.title}“ gibt es nichts zu importieren.`,
    'list.fileInvalid': (): string =>
      'Diese Datei hat nicht das Listenformat, die Liste kann nicht importiert werden.',
    'list.fileSyntax': (p: { line?: number }): string =>
      p.line
        ? `Syntaxfehler in Zeile ${p.line}, die Liste kann nicht importiert werden.`
        : 'Syntaxfehler, die Liste kann nicht importiert werden.',
    'list.fileNoItems': (): string => 'Keine Einträge gefunden, die Liste kann nicht importiert werden.',
    'list.fileMissingTitle': (): string => 'Kein Titel gefunden, die Liste kann nicht importiert werden.',
    'list.fileItemMissingTitle': (p: { index: number }): string =>
      `Eintrag ${p.index} hat keinen Titel, die Liste kann nicht importiert werden.`,
    'list.fileItemNotesTooLong': (p: { index: number; max: number }): string =>
      `Die Notizen von Eintrag ${p.index} sind länger als ${p.max} Zeichen, die Liste kann nicht importiert werden.`,
    'list.alreadyExists': (): string =>
      'Diese Liste gibt es schon wieder — es wurde nichts wiederhergestellt.',
    'group.nameEmpty': (): string => 'Eine Gruppe braucht einen Namen.',
    'group.nameTaken': (): string => 'Diese Liste hat bereits eine Gruppe mit diesem Namen.',
    'group.notEmpty': (): string =>
      'Nur eine leere Gruppe kann gelöscht werden — verschiebe oder entferne zuerst ihre Einträge.',
    'group.orderMismatch': (): string =>
      'Die Gruppen haben sich geändert, seit du die Liste geladen hast — lade sie neu und versuche es noch einmal.',
    'reset.unavailable': (): string =>
      'Diese Liste hat keine Quelle, auf die sie zurückgesetzt werden könnte — sie wurde von Hand erstellt oder kam an, bevor die Quelle gespeichert wurde.',
    'refresh.handMadeList': (): string =>
      'Diese Liste wurde von Hand erstellt, es gibt also nichts zum Abgleichen.',
    'refresh.searchUnavailable': (p: { category: string }): string =>
      `Die Suche ist für „${p.category}“ nicht verfügbar.`,
  },

  request: {
    unreachable: 'Der Server ist nicht erreichbar. Läuft er?',
    failed: (status: number): string => `Anfrage fehlgeschlagen (${status})`,
    unknown: 'Etwas ist schiefgelaufen.',
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
      headline: 'Etwas ist schiefgelaufen',
      explanation: 'In Listulator ist ein unerwarteter Fehler aufgetreten. Deine Listen sind gespeichert; Neuladen hilft meistens.',
      reload: 'Neu laden',
    },
    meter: {
      label: (done: number, total: number): string => `${done} von ${total} erledigt`,
      noteCapped: (cap: number, perCell: number): string => `${cap} Zellen ≈ je ${perCell} Einträge`,
      noteUncapped: 'Eine Zelle = ein Eintrag',
    },
    progress: {
      count: (done: number, total: number, percent: number): string =>
        total ? `${done}/${total} (${percent} %)` : `${done}/${total}`,
      left: (duration: string): string => `noch ${duration}`,
      allDone: '✓ Alles erledigt',
      doneForNow: '✓ Vorerst erledigt',
    },
    status: {
      complete: 'Abgeschlossen',
      ongoing: 'Laufend',
    },
    marks: {
      curated: 'Kuratierte Liste — von Hand in der Community-Bibliothek gepflegt',
      byHand: 'Von Hand erstellt — ohne Quelle',
      manual: 'Von Hand hinzugefügt — nicht aus der Quelle wiederherstellbar',
      newCount: (n: number): string => `${n} NEU`,
      newItem: 'NEU',
      allDone: '✓ Alles erledigt',
    },
    common: {
      close: 'Schließen',
      keep: 'Behalten',
      toggleDone: 'Als erledigt markieren',
      backToLayer: 'Zurück zu dieser Ebene',
      clickToEdit: 'Zum Bearbeiten klicken',
      showKey: 'Schlüssel anzeigen',
      hideKey: 'Schlüssel verbergen',
    },
    statusPicker: {
      notKnown: 'Unbekannt',
      notKnownNote: 'Lass es leer, wenn du es nicht weißt.',
      ongoingNote: 'In der Quelle können neue Einträge dazukommen.',
      completeNote: 'Abgeschlossen — es kommen keine Einträge mehr dazu.',
    },
    appHeader: {
      settings: 'Einstellungen',
    },
    settings: {
      title: 'Einstellungen',
      closeLabel: 'Schließen',
      theme: 'Design',
      themeQuantum: 'Quantum',
      skin: 'Farbschema',
      motion: 'Animation',
      reduceMotion: 'Weniger Bewegung — Ebenen wechseln ohne Übergang',
      language: 'Sprache',
      languages: {
        en: 'English',
        ru: 'Русский',
        de: 'Deutsch',
      },
      keys: {
        title: 'API-Schlüssel',
        placeholder: 'Schlüssel einfügen',
        clientIdPlaceholder: 'Client-ID',
        clientSecretPlaceholder: 'Client-Secret',
        infoLabel: 'Wofür dieser Schlüssel ist',
        how: 'Wie?',
        howTitle: 'Wo du diesen Schlüssel bekommst',
        howHeading: 'Wo du ihn bekommst',
        test: 'Testen',
        status: {
          untested: 'Ungetestet',
          testing: 'Test läuft',
          working: 'Funktioniert',
          rejected: 'Abgelehnt',
          unreachable: 'Offline',
          failed: 'Fehlgeschlagen',
        },
        usedNote: (used: string): string => `Füllt Listen in: ${used}.`,
        missNote:
          'Ohne ihn lassen sich diese Kategorien weiterhin von Hand aufbauen — nur die Katalogsuche fällt weg.',
        sources: {
          tmdb: {
            name: 'TMDB',
            used: 'Filme, Serien, Animation, Dokumentationen',
            host: 'themoviedb.org',
            steps: [
              'Lege ein kostenloses Konto an und öffne Settings → API.',
              'Beantrage einen Schlüssel — für den privaten Gebrauch wird er sofort genehmigt.',
              'Kopiere den API Read Access Token und füge ihn hier ein.',
            ],
          },
          igdb: {
            name: 'IGDB',
            used: 'Spiele',
            host: 'dev.twitch.tv',
            steps: [
              'IGDB läuft über die Twitch-Anmeldung — melde dich in der Twitch-Entwicklerkonsole an.',
              'Registriere eine Anwendung, um eine Client-ID und ein Secret zu bekommen.',
              'Füge beides hier ein und drücke „Testen“.',
            ],
          },
          comicVine: {
            name: 'Comic Vine',
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
            used: 'Playlists und Kanäle',
            host: 'console.cloud.google.com',
            steps: [
              'Lege in der Google-Cloud-Konsole ein Projekt an.',
              'Aktiviere für dieses Projekt die YouTube Data API v3.',
              'Credentials → Create credentials → API key, dann füge den Schlüssel hier ein.',
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
        'dark-orange': 'Dunkel Orange',
        'dark-green': 'Dunkel Grün',
        'dark-blue': 'Dunkel Blau',
        'dark-violet': 'Dunkel Violett',
        'light-bone': 'Helles Knochenweiß',
      },
    },
    layerStack: {
      untitledListTab: 'Liste',
    },
    categoryPicker: {
      title: 'Kategorie wählen',
      subline:
        'Die Kategorien sind fest eingebaut. Die Zahlen zeigen, wie viele Listen du in jeder Kategorie hast.',
      firstRunTitle: 'Noch nichts verfolgt — such dir ein Regal aus und füll es',
      firstRunSubline:
        'Jede Kategorie baut Listen aus ihrer eigenen Quelle. Mega ist für Franchises über mehrere Medien hinweg — ein Regal für Filme, Spiele und Comics zusammen.',
      byHand: 'von Hand',
      countTitle: 'Listen in diesem Regal',
      closeLabel: 'Schließen',
    },
    search: {
      queryLabel: (source: string): string => `Suche: ${source}`,
      searchButton: 'Suchen',
      resultsCount: (n: number): string =>
        `${n} ${selectPlural(n, 'de', { one: 'Ergebnis', other: 'Ergebnisse' })}`,
      itemsKicker: 'Einträge',
      countLoading: 'Einträge werden gezählt…',
      expandRow: (title: string): string => `Details anzeigen: ${title}`,
      previewButton: 'Vorschau',
      previewTab: (title: string): string => `Vorschau: ${title}`,
      addButton: 'Liste hinzufügen',
      nothingToAdd: 'Nichts hinzuzufügen — diese Quelle hat keine Einträge zum Importieren',
      previewUnavailable:
        'Diese Quelle kann ihre Einträge vor dem Import nicht auflisten. Füge die Liste hinzu — eine falsche zu löschen kostet einen Klick.',
      curatedTitle: 'Kuratierte Liste',
      curatedProvenance: 'Kuratiert · von Hand in der Community-Bibliothek gepflegt',
      sourceProvenance: (source: string): string => `Aus ${source}`,
      /** Where a curated-only category (Mega) searches: the tile footer and the Search tab. */
      librarySource: 'Community-Bibliothek',
      importing: 'Liste wird aufgebaut…',
      searching: 'Suche läuft…',
      noKeyHeadline: (source: string): string => `Die Suche braucht einen ${source}-Schlüssel`,
      noKeyDesktop: (category: string): string =>
        `Trage deinen Schlüssel in den Einstellungen ein, um „${category}“ zu durchsuchen. Bis dahin kannst du Einträge von Hand hinzufügen.`,
      noKeyWeb: (category: string): string =>
        `Für die Suche in „${category}“ braucht es einen API-Schlüssel in der .env-Datei des Servers. Bis dahin kannst du Einträge von Hand hinzufügen.`,
      offlineHeadline: (category: string): string => `„${category}“ lässt sich gerade nicht durchsuchen`,
      offlineDesktop: (category: string): string =>
        `Für die Suche in „${category}“ braucht es einen API-Schlüssel (trage deinen in den Einstellungen ein), und die Community-Bibliothek kuratierter Listen war nicht erreichbar. Prüfe deine Verbindung oder füge Einträge von Hand hinzu.`,
      offlineWeb: (category: string): string =>
        `Für die Suche in „${category}“ braucht es einen API-Schlüssel in der .env-Datei des Servers, und die Community-Bibliothek kuratierter Listen war nicht erreichbar. Prüfe die Verbindung oder füge Einträge von Hand hinzu.`,
      libraryUnreachable:
        'Die Community-Bibliothek war nicht erreichbar, deshalb fehlen kuratierte Listen in diesen Ergebnissen.',
      nothingFoundLibraryDown:
        ' Die Community-Bibliothek war nicht erreichbar, deshalb wurden kuratierte Listen nicht durchsucht.',
      openSettings: 'Einstellungen öffnen',
      nothingFoundHeadline: 'Nichts gefunden',
      nothingFoundBody: 'Versuche eine andere Schreibweise oder füge von Hand hinzu.',
      nothingToImportHeadline: 'Nichts zu importieren',
      retry: 'Erneut versuchen',
      dismiss: 'Schließen',
    },
    addByHand: {
      titleLabel: 'Listentitel',
      titlePlaceholder: 'Alle Jackie-Chan-Filme',
      descriptionLabel: 'Beschreibung',
      descriptionPlaceholder: 'Optional',
      itemsLabel: 'Einträge — einer pro Zeile',
      itemsPlaceholder: 'Frühe Filme:\nDrunken Master\nPolice Story\n\nSpäte Filme:\nRush Hour',
      itemsHint: 'Eine Zeile, die mit einem Doppelpunkt endet oder mit # beginnt, eröffnet eine Gruppe.',
      statusLabel: 'Status',
      create: 'Liste erstellen',
      creating: 'Wird erstellt…',
      count: (n: number, g: number): string => {
        const itemText = entries(n)
        if (g === 0) return itemText

        return `${itemText} in ${g} ${selectPlural(g, 'de', { one: 'Gruppe', other: 'Gruppen' })}`
      },
      noItems: 'Noch keine Einträge — du kannst sie später hinzufügen.',
      assumedDuration: (duration: string): string =>
        `Wir nehmen für jeden etwa ${duration} an; das kannst du später korrigieren.`,
      createFailed: 'Die Liste konnte nicht erstellt werden',
    },
    helper: {
      topPick: 'Erste Wahl',
      alternates: 'Alternativen',
      openList: 'Liste öffnen',
      notThat: 'Nicht das',
      backToStrongest: 'Zurück zur stärksten Wahl',
      nothingUnfinished: 'Nichts Unfertiges mehr — füge eine Liste hinzu.',
      loading: 'Wir suchen etwas…',
      failed: 'Es konnte kein Vorschlag geholt werden',
      retry: 'Noch einmal',
      surprise: {
        title: 'Überraschung, Mistkerl!',
        explain: 'Eine zufällige kuratierte Liste, die du noch nicht verfolgst. Millionen Fliegen können nicht irren, oder?',
        any: 'Beliebig',
        category: 'KATEGORIE',
        spin: 'Drehen',
        spinAgain: 'Nochmal drehen',
        spinning: 'Dreht sich…',
        thisOne: 'Die hier',
        idleMeta: 'Dreh und gewinn!',
        note: 'Wähl deine Kategorien und probier dein Glück!',
        nothingHere: 'Hier ist nichts mehr übrig — du verfolgst alles',
        anyTitle: (n: number): string => `${candidates(n)} in allen Regalen`,
        shelfTitle: (n: number): string => `${candidates(n)} in diesem Regal`,
        pool: (n: number, shelves: number): string =>
          `${candidates(n)} ${shelves === 0 ? 'in allen Regalen' : shelves === 1 ? 'in diesem Regal' : `in den gewählten Regalen (${shelves})`}`,
        meta: (category: string, count: number | undefined): string =>
          [category, count === undefined ? null : entries(count), 'kuratierte Liste']
            .filter(Boolean)
            .join(' · '),
        landed: (title: string): string => `Gelandet bei ${title}`,
        nothingLeft: (shelves: number): string =>
          `Nichts mehr übrig ${acrossShelves(shelves)} — du verfolgst dort bereits jede kanonische Liste.`,
        unreachable: 'Die Community-Bibliothek war nicht erreichbar.',
        curatedTip: 'Kuratierte Liste — von Hand in der Community-Bibliothek gepflegt',
      },
      justOneFix: {
        title: 'Nur ein Häppchen',
        explain: 'Ein schneller Dopamin-Kick vom kürzesten unfertigen Ding, das du verfolgst',
        why: (time: string): string => `Kürzester unfertiger Eintrag, den du hast — ${time}, und er ist erledigt.`,
      },
      finalizer: {
        title: 'Mach ihn fertig!',
        explain: 'Bring lose Enden aus den Listen zu Ende, die dem Ziel am nächsten sind',
        why: (percent: number, left: string): string =>
          `Am nächsten am Ziel: ${percent} % erledigt, nur noch ${left}.`,
        whyComplete: 'Die Liste ist abgeschlossen, also bleibt Fertiges auch fertig.',
        whyOngoing: 'Als laufend markiert — nichts Abschließbares ist näher dran.',
      },
      tired: {
        title: 'Und nun zu etwas völlig anderem',
        explain: 'Du hast eine Liste satt und willst etwas anderes aus einem anderen Medium?',
        tiredOf: 'Ich habe genug von',
        pickList: 'Liste wählen',
        pickTitle: 'Wähle die Liste, die dich ermüdet',
        pickerKicker: 'ODER?',
        pickerCount: (shown: number, total: number): string => `${shown} von ${total}`,
        pickerFilter: 'Listen filtern…',
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
      multi: 'Plattformübergreifend',
      multiNote:
        'Dasselbe Spiel auf jeder Plattform, für die es erschienen ist. Diese Liste nennt sie nicht.',
      chipLabel: (title: string): string => `Plattformen für ${title}`,
    },
    list: {
      loading: 'Liste wird geladen…',
      saveFailed: 'Die Änderung konnte nicht gespeichert werden',
      loadFailedHeadline: 'Diese Liste lässt sich nicht öffnen',
      retry: 'Erneut versuchen',
      empty: 'Noch keine Einträge.',
      comingSoon: 'Bald verfügbar',
      noGroup: 'Keine Gruppe',
      itemActions: {
        details: (title: string): string => `Details zu ${title}`,
        dragOnList: 'Ziehen, um diesen Eintrag in der Liste zu verschieben',
        dragWithin: (group: string): string => `Ziehen, um innerhalb von „${group}“ umzusortieren`,
        dragGroup: 'Ziehen, um diese Gruppe in der Liste zu verschieben',
        deleteGroupLabel: 'leer',
        deleteGroupAria: 'Diese leere Gruppe löschen',
        deleteGroupTip: 'Diese leere Gruppe löschen — sie enthält keine Einträge',
        groupRemoved: (name: string): string => `Gruppe ${name} entfernt`,
        groupRestored: (name: string): string => `Gruppe ${name} wiederhergestellt`,
        groupRemoveFailed: (name: string): string => `Gruppe ${name} konnte nicht entfernt werden`,
        deleteGroupWithItems: (name: string): string => `Gruppe ${name} löschen`,
        groupDeleteKicker: 'Gruppe löschen',
        groupDeleteQuestion: (name: string): string => `Gruppe „${name}“ löschen?`,
        groupDeleteNote: (n: number, done: number): string =>
          `${entries(n)}${done > 0 ? `, davon ${done} als erledigt markiert,` : ''} ${n === 1 ? 'wird' : 'werden'} mit gelöscht. Rückgängig machen ist 8 Sekunden lang möglich.`,
        groupDeleteConfirm: 'Gruppe löschen',
        groupRemovedWithItems: (name: string, n: number): string => `Gruppe ${name} und ${entries(n)} entfernt`,
        edit: (title: string): string => `${title} bearbeiten`,
        remove: (title: string): string => `${title} entfernen`,
        infoKicker: 'Details',
        estimated: 'Die Laufzeit ist geschätzt — bearbeite den Eintrag, um die echte einzutragen.',
        editTitle: 'Titel',
        editMinutes: 'Minuten',
        editGroup: 'Gruppe',
        discard: 'Verwerfen',
        save: 'Speichern',
        saved: (title: string): string => `Änderungen an ${title} gespeichert`,
        undo: 'Rückgängig',
        removed: (title: string): string => `${title} entfernt`,
        restored: (title: string): string => `${title} wiederhergestellt`,
        added: (title: string, group: string | null): string =>
          group ? `${title} zu „${group}“ hinzugefügt` : `${title} hinzugefügt`,
        removeFailed: (title: string): string => `${title} konnte nicht entfernt werden`,
        editFailed: 'Die Änderungen konnten nicht gespeichert werden',
        undoFailed: 'Das ließ sich nicht rückgängig machen',
      },
      addItem: {
        titleLabel: 'Titel',
        titlePlaceholder: 'Eintrag hinzufügen…',
        minutesLabel: 'Minuten',
        groupLabel: 'Gruppe',
        add: 'Hinzufügen',
        adding: 'Wird hinzugefügt…',
        failed: 'Der Eintrag konnte nicht hinzugefügt werden',
      },
      createGroup: (name: string): string => `+ „${name}“ anlegen`,
      editList: 'Liste bearbeiten',
      orderMenu: {
        kicker: 'Liste zurücksetzen',
        resetQuestion: 'Diese Liste auf die Quelle zurücksetzen?',
        resetLead: {
          canonical:
            'Zurück zur aktuellen Datei in der Community-Bibliothek. Du bekommst, was die Datei jetzt enthält.',
          file: 'Zurück zu der Datei, die du importiert hast.',
          api: 'Zurück zu dem Zustand, in dem die Liste angekommen ist.',
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
        noCost: 'Nichts, was du hinzugefügt, entfernt oder als erledigt markiert hast, ist betroffen.',
        undoNote: 'Rückgängig machen ist 8 Sekunden lang möglich.',
        resetOrder: 'Reihenfolge zurücksetzen',
        resetEverything: 'Alles zurücksetzen',
        sorted: 'Nach Datum sortiert — Gruppen als Blöcke verschoben.',
        orderReset: 'Reihenfolge zurückgesetzt.',
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
        movedOnList: 'In der Liste verschoben.',
        movedInside: (group: string): string => `Innerhalb von „${group}“ verschoben.`,
        movedRows: (n: number): string =>
          `${n} ${selectPlural(n, 'de', { one: 'Zeile', other: 'Zeilen' })} verschoben.`,
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
          'Speichere diese Liste im YAML-Format. Dein Fortschritt ist nie enthalten. Praktisch für Einreichungen kanonischer Listen.',
        download: 'Datei herunterladen',
        copy: 'In die Zwischenablage kopieren',
        reorderKicker: 'Liste ordnen',
        reorderQuestion: 'Diese Liste chronologisch sortieren?',
        reorderHint:
          'Gruppen wandern als Blöcke, nach ihrem frühesten Eintrag; auch innerhalb jeder Gruppe wird sortiert. Nichts wird aufgelöst.',
        reorderNote:
          'Eine einmalige Aktion — die Liste bleibt nicht sortiert. Rückgängig machen ist 8 Sekunden lang möglich.',
        cancel: 'Abbrechen',
        sortNow: 'Jetzt sortieren',
        deleteKicker: 'Liste löschen',
        deleteQuestion: (title: string): string => `„${title}“ löschen?`,
        deleteNote: (n: number, done: number): string =>
          n === 0
            ? 'Die Liste ist leer. Rückgängig machen ist 8 Sekunden lang möglich.'
            : `${entries(n)}, davon ${done} als erledigt markiert, gehen mit. Rückgängig machen ist 8 Sekunden lang möglich.`,
        keep: 'Behalten',
        confirmDelete: 'Liste löschen',
        itemCount: (n: number): string => entries(n),
        saved: (fileName: string, n: number): string => `${fileName} gespeichert — ${entries(n)}.`,
        copied: 'YAML in die Zwischenablage kopiert.',
        copyFailed: 'Kopieren fehlgeschlagen — versuche stattdessen „Datei herunterladen“.',
        exportFailed: 'Die Liste konnte nicht exportiert werden',
        deleted: (title: string): string => `„${title}“ gelöscht.`,
        restored: (title: string): string => `${title} wiederhergestellt`,
        deleteFailed: 'Die Liste konnte nicht gelöscht werden',
        restoreFailed: 'Die Liste konnte nicht wiederhergestellt werden',
      },
      editPopover: {
        kicker: 'Liste bearbeiten',
        title: 'Titel',
        description: 'Beschreibung (optional)',
        descriptionPlaceholder: 'Worum es in der Liste geht — ein, zwei Zeilen',
        status: 'Status (optional)',
        renamed: (title: string): string => `Umbenannt in „${title}“.`,
        descriptionUpdated: 'Beschreibung aktualisiert.',
        statusMarked: (status: 'complete' | 'ongoing'): string =>
          `Als ${status === 'complete' ? 'abgeschlossen' : 'laufend'} markiert.`,
        statusCleared: 'Status entfernt.',
        reverted: (title: string): string => `Zurückgesetzt auf ${title}`,
        saveFailed: 'Deine Änderungen an der Liste konnten nicht gespeichert werden',
        undoFailed: 'Das ließ sich nicht rückgängig machen',
      },
      rail: {
        title: 'Springen zu',
        hide: 'Sprungleiste einklappen',
        show: 'Sprungleiste anzeigen',
        resize: 'Breite der Sprungleiste ändern',
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
        clearTip: 'Filter aufheben — alles zeigen',
        hideOption: (name: string): string => `${name} ausblenden`,
        alsoShowOption: (name: string): string =>
          `${name} ebenfalls zeigen — beliebig viele können gleichzeitig aktiv sein`,
        facetPicks: (named: readonly string[], more: number): string =>
          more > 0 ? `${named.join(', ')} +${more}` : named.join(', '),
        facetDropdownLabel: (facet: string, summary: string): string => `${facet}: ${summary}`,
        facetPickTip: 'Auswählen, was angezeigt wird',
        facetCount: (facet: string, n: number): string => `${facet} · ${n}`,
        facetLabels: {
          Type: 'Typ',
          Medium: 'Medium',
          Language: 'Sprache',
          Platform: 'Plattform',
        },
        optionLabels: {
          Untagged: 'Ohne Tag',
          MULTI: 'MULTI',
          Unknown: 'Unbekannt',
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
          Live: 'Live',
          Compilation: 'Compilation',
        },
        collapseAll: 'Alle einklappen',
        expandAll: 'Alle ausklappen',
        collapseAllTip: 'Jede Gruppe einklappen',
        expandAllTip: 'Jede Gruppe ausklappen',
      },
      checkForUpdates: 'Nach Updates suchen',
      order: 'Reihenfolge',
      more: 'Mehr',
      close: 'Schließen',
      updates: {
        checkFailed: 'Die Suche nach Updates ist fehlgeschlagen',
        nothingNew: 'Keine neuen Einträge in der Quelle.',
        addFailed: 'Sie konnten nicht hinzugefügt werden',
        foundBand: (n: number): string => `${newEntries(n)} gefunden.`,
        updateList: 'Liste aktualisieren',
        dismissFound: 'Schließen',
        appliedToast: (n: number): string => `${newEntries(n)} hinzugefügt.`,
        newBand: (n: number): string =>
          `${selectPlural(n, 'de', { one: `${n} neuer Eintrag wurde hinzugefügt`, other: `${n} neue Einträge wurden hinzugefügt` })}. Hast du etwas von Hand sortiert? Prüfe, ob es betroffen ist`,
        markAllSeen: 'Alle als gesehen markieren',
        markedSeen: 'Alle als gesehen markiert',
        markSeenFailed: 'Sie konnten nicht als gesehen markiert werden',
      },
    },
    preview: {
      title: 'Vorschau',
      closeLabel: 'Schließen',
      loading: 'Einträge werden aufgelistet…',
      summary: (count: number, duration: string, estimated: boolean): string =>
        `${entries(count)} · ${estimated ? '≈ ' : ''}${duration}`,
      addButton: 'Liste hinzufügen',
      adding: 'Liste wird aufgebaut…',
      nothingToAdd: 'Nichts hinzuzufügen — diese Quelle hat keine Einträge zum Importieren',
      loadFailedHeadline: 'Für diese Liste gibt es keine Vorschau',
      retry: 'Erneut versuchen',
      footer: (provenance: string): string =>
        `${provenance}. „Liste hinzufügen“ erstellt genau diese Liste.`,
      expandGroup: (label: string): string => `${label} ausklappen`,
      collapseGroup: (label: string): string => `${label} einklappen`,
    },
    importFile: {
      chooseFile: 'Datei wählen…',
      boxLabel: 'YAML',
      boxPlaceholder:
        'title: Alle Jackie-Chan-Filme\ncategory: movie\nitems:\n  - { title: Drunken Master, year: 1978 }',
      import: 'Importieren',
      importing: 'Wird importiert…',
      readOutFile: (name: string, size: string, l: string): string => `${name} · ${size} · ${l}`,
      readOutPasted: (l: string): string => `Eingefügt · ${l}`,
      lines: (n: number): string => lines(n),
      footer:
        'Listulator-Listen reisen als YAML-Dateien. Der Export schreibt eine, der Import liest sie als neue Liste wieder ein.',
      otherCategoryKicker: 'Andere Kategorie',
      otherCategoryQuestion: (fileCategory: string): string => `In „${fileCategory}“ importieren?`,
      otherCategoryNote: (current: string, fileCategory: string): RichText => [
        'Aktuelle Kategorie ist ',
        { strong: `„${current}“` },
        ', die importierte Liste gehört zu ',
        { strong: `„${fileCategory}“` },
        '.',
      ],
      back: 'Zurück',
      importFailed: 'Die Datei konnte nicht importiert werden, die Liste kann nicht importiert werden.',
    },
    createList: {
      title: (category: string): string => `Neue Liste: ${category}`,
      searchTab: (source: string): string => `Suche: ${source}`,
      handTab: 'Von Hand',
      importTab: 'Datei importieren',
      closeLabel: 'Schließen',
    },
    home: {
      title: 'Meine Listen',
      newList: 'Neue Liste',
      checkForUpdates: 'Nach Updates suchen',
      checkingUpdates: 'Wird geprüft…',
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
      noNewUpstream: 'Keine neuen Einträge in der Quelle.',
      updateApplied: (n: number, title: string): string =>
        `${newEntries(n)} zu „${title}“ hinzugefügt.`,
      updateFailed: 'Diese Liste konnte nicht aktualisiert werden',
      checkPartial: (titles: readonly string[]): string =>
        `${lists(titles.length)} ${titles.length === 1 ? 'konnte' : 'konnten'} nicht geprüft werden: ${titles.join(', ')}`,
      checkUpdatesFailed: 'Die Suche nach Updates ist fehlgeschlagen',
    },
  },
}
