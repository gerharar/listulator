import { selectPlural } from './plural.js'
import type { RichText } from './types.js'
import type { Locale } from './en.js'

/**
 * Russian — a full translation (task 10.32b), typed as a whole `Locale` so a
 * key added to `en.ts` without a Russian counterpart fails to compile, and the
 * strict parity test says the same about a key that slipped through a cast.
 *
 * **Register:** «вы», imperative plural for actions ("Добавьте"), neutral and
 * short; the prototype's playful lines (the four helper sheets) keep their
 * attitude rather than being flattened. Movie/series names and platform codes
 * are data and stay as they are. A machine-assisted draft until the owner has
 * reviewed it — see docs/DECISIONS.md (10.32b).
 *
 * Every count goes through `selectPlural` with all four forms (one / few /
 * many / other), never an `n === 1` shortcut.
 */
const items = (n: number): string =>
  `${n} ${selectPlural(n, 'ru', { one: 'элемент', few: 'элемента', many: 'элементов', other: 'элемента' })}`
const lists = (n: number): string =>
  `${n} ${selectPlural(n, 'ru', { one: 'список', few: 'списка', many: 'списков', other: 'списка' })}`
const candidates = (n: number): string =>
  `${n} ${selectPlural(n, 'ru', { one: 'кандидат', few: 'кандидата', many: 'кандидатов', other: 'кандидата' })}`
const lines = (n: number): string =>
  `${n} ${selectPlural(n, 'ru', { one: 'строка', few: 'строки', many: 'строк', other: 'строки' })}`
const results = (n: number): string =>
  `${n} ${selectPlural(n, 'ru', { one: 'результат', few: 'результата', many: 'результатов', other: 'результата' })}`

/** "N новых элементов" — the adjective agrees too. */
const newItems = (n: number): string =>
  `${n} ${selectPlural(n, 'ru', { one: 'новый элемент', few: 'новых элемента', many: 'новых элементов', other: 'нового элемента' })}`

/** The part after "Ничего не осталось" for a shelf count. */
const acrossShelves = (shelves: number): string =>
  shelves === 0 ? 'ни в одной категории' : shelves === 1 ? 'в этой категории' : `в выбранных категориях (${shelves})`

export const ru: Locale = {
  app: {
    loading: 'Загрузка…',
    unknownError: 'Что-то пошло не так. Обосралити!',
  },

  newList: {
    title: 'Новый список',
  },

  bookLanguages: {
    eng: 'Английский',
    spa: 'Испанский',
    fre: 'Французский',
    ger: 'Немецкий',
    ita: 'Итальянский',
    por: 'Португальский',
    dut: 'Нидерландский',
    rus: 'Русский',
    pol: 'Польский',
    swe: 'Шведский',
    nor: 'Норвежский',
    dan: 'Датский',
    fin: 'Финский',
    jpn: 'Японский',
    chi: 'Китайский',
    kor: 'Корейский',
  },

  sourceSearch: {
    searchFailed: 'Поиск не справился со своей задачей',
    defaultPlaceholder: 'Поиск…',
    placeholders: {
      movie: 'Найдите актёра, режиссёра или серию фильмов',
      music: 'Найдите группу или исполнителя',
      book: 'Найдите автора',
    },
    languageLabel: 'Язык',
    allLanguages: 'Все',
    includeUnknown: 'Неизвестный',
    discographyTypesLabel: 'Включить',
    includeEp: 'EP',
    includeSingle: 'Синглы',
    includeLive: 'Концертные',
    includeCompilation: 'Сборники',
  },

  categories: {
    movie: { label: 'Фильмы' },
    tv: { label: 'Сериалы' },
    animation: { label: 'Анимация' },
    documentary: { label: 'Документальное' },
    wrestling: { label: 'Рестлинг' },
    mma: { label: 'ММА' },
    game: { label: 'Игры' },
    comic: { label: 'Комиксы' },
    book: { label: 'Книги' },
    music: { label: 'Музыка' },
    youtube: { label: 'YouTube' },
    mega: {
      label: 'Мега',
      description:
        'Франшизы, охватывающие сразу несколько медиа — фильмы, сериалы и анимация вместе, в порядке выхода. Сюда относятся Marvel и Star Trek; отдельный сериал или серия фильмов — нет.',
    },
  },

  errors: {
    'search.queryRequired': (): string => 'Эй, сначала введите, что искать',
    'search.unavailable': (p: { category: string }): string => `Поиск недоступен для категории «${p.category}». Можно импортировать список или создать его вручную.`,
    'search.unavailableOffline': (p: { category: string }): string => `Поиск недоступен для категории «${p.category}», а List Vault не отвечает. Повторите позже или создайте список вручную.`,
    'list.unknownCategory': (p: { key: string }): string => `Руки-крюки: список нельзя импортировать, неизвестная категория ‘${p.key}’. Сверьте написание категории с CONTRIBUTING.md — обычно проблема в этом`,
    'list.sourceEmpty': (p: { title: string }): string => `Обнаружена преждевременная листуляция: для «${p.title}» нечего импортировать`,
    'list.fileInvalid': (): string => 'Не та дырка, дружище: ваш файл — квадратный колышек, который пытается влезть в круглое отверстие, поэтому его нельзя импортировать. Убедитесь, что это корректный YAML со всеми обязательными полями',
    'list.fileSyntax': (p: { line?: number }): string => p.line ? `Руки-крюки: список нельзя импортировать, синтаксическая ошибка в строке ${p.line}` : 'Руки-крюки: список нельзя импортировать, синтаксическая ошибка',
    'list.fileNoItems': (): string => 'Обнаружена преждевременная листуляция: список нельзя импортировать, элементы не найдены',
    'list.fileMissingTitle': (): string => 'Обнаружена преждевременная листуляция: список нельзя импортировать, название не найдено',
    'list.fileItemMissingTitle': (p: { index: number }): string => `Обнаружен рецидив Альцгеймера: список нельзя импортировать, у элемента ${p.index} нет названия`,
    'list.fileItemNotesTooLong': (p: { index: number; max: number }): string => `Обнаружено перевоплощение Марселя Пруста: список нельзя импортировать, заметки к элементу ${p.index} длиннее ${p.max} символов`,
    'list.alreadyExists': (): string => 'Обнаружена самая быстрая рука на Диком Западе: такой список уже существует, поэтому ничего не восстановлено',
    'group.nameEmpty': (): string => 'Человеку нужно название для группы.',
    'group.nameTaken': (): string => 'Обнаружен рецидив Альцгеймера: в этом списке уже есть группа с таким названием.',
    'group.notEmpty': (): string => 'Удалить группу можно, только приняв её пустоту',
    'group.orderMismatch': (): string =>
      'Группы изменились с тех пор, как вы открыли список, — перезагрузите его и повторите.',
    'reset.unavailable': (): string => 'У этого списка нет источника, к которому его можно сбросить, и вы не должны видеть это сообщение',
    'refresh.handMadeList': (): string => 'Этот список — ручная работа, сверять его не с чем.',
    'refresh.searchUnavailable': (p: { category: string }): string =>
      `Поиск недоступен для категории «${p.category}».`,
  },

  request: {
    unreachable: 'Нет связи с сервером. Есть там кто-нибудь?',
    failed: (status: number): string => `Запрос не удался (${status})`,
    unknown: 'Что-то пошло не так. Обосралити!',
  },

  duration: {
    // Abbreviated, as English is ("1h 30m"): a spelled-out «1 час 30 минут» clipped Home's time column.
    minutes: (m: number): string => `${m} мин`,
    hours: (h: number): string => `${h} ч`,
    hoursMinutes: (h: number, m: number): string => `${h} ч ${m} мин`,
  },

  timeAgo: {
    never: 'ещё не открывали',
    today: 'сегодня',
    yesterday: 'вчера',
    days: (n: number): string =>
      `${n} ${selectPlural(n, 'ru', { one: 'день', few: 'дня', many: 'дней', other: 'дня' })} назад`,
    aMonth: 'месяц назад',
    months: (n: number): string =>
      `${n} ${selectPlural(n, 'ru', { one: 'месяц', few: 'месяца', many: 'месяцев', other: 'месяца' })} назад`,
    aYear: 'год назад',
    years: (n: number): string =>
      `${n} ${selectPlural(n, 'ru', { one: 'год', few: 'года', many: 'лет', other: 'года' })} назад`,
  },

  quantum: {
    crash: {
      headline: 'Что-то пошло не так. Обосралити!',
      explanation: 'Listulator наткнулся на непредвиденную ошибку и наложил в штаны от глубокого экзистенциального ужаса. Не волнуйтесь, ваши списки не пострадали. Нажмите «Перезагрузить», чтобы (надеюсь) вернуть приложение к жизни.',
      reload: 'Перезагрузить',
    },
    meter: {
      label: (done: number, total: number): string => `${done} из ${total} готово`,
      noteCapped: (cap: number, perCell: number): string => `${cap} ячеек ≈ по ${perCell} элем. в каждой`,
      noteUncapped: 'Одна ячейка — один элемент',
      explainHint: 'Как работают ячейки полосы прогресса',
      detailCapped: (cap: number, perCell: number): string => `Полоса ограничена ${cap} ячейками, поэтому каждая ячейка обозначает примерно ${perCell} элементов.`,
      detailUncapped: 'Каждая ячейка — один элемент списка. Закрашенная ячейка = выполнено.',
    },
    progress: {
      count: (done: number, total: number, percent: number): string =>
        total ? `${done}/${total} (${percent}%)` : `${done}/${total}`,
      left: (duration: string): string => `осталось ${duration}`,
      allDone: '✓ Всё готово',
      doneForNow: '✓ Готово (пока)',
    },
    status: {
      complete: 'Завершён',
      ongoing: 'Продолжается',
    },
    marks: {
      curated: 'Канонический список из List Vault (ведётся мясными мешками)',
      byHand: 'Список создан вручную (мясными мешками)',
      manual: 'Элемент добавлен вручную',
      newCount: (n: number): string => `${n} НОВ.`,
      newItem: 'НОВОЕ',
      allDone: '✓ Всё готово',
    },
    common: {
      close: 'Закрыть',
      keep: 'Оставить',
      toggleDone: 'Отметить как готовое',
      backToLayer: 'Назад к этому окну',
      clickToEdit: 'Нажмите, чтобы изменить',
      showKey: 'Показать ключ',
      hideKey: 'Скрыть ключ',
    },
    statusPicker: {
      notKnown: 'Шрёдингер',
      notKnownNote: 'Вы понятия не имеете, появится ли у этого медиа что-нибудь новое',
      ongoingNote: 'Этот список ещё не закончен (выходит что-то новое)',
      completeNote: 'Этот список завершён (ничего нового не выйдет)',
    },
    appHeader: {
      settings: 'Настройки',
    },
    settings: {
      title: 'Настройки',
      closeLabel: 'Закрыть',
      theme: 'Тема',
      themeQuantum: 'Quantum',
      skin: 'Оформление',
      motion: 'Анимация',
      reduceMotion: 'Меньше анимации',
      language: 'Язык интерфейса',
      languages: {
        en: 'English',
        ru: 'Русский',
        de: 'Deutsch',
      },
      keys: {
        title: 'API-ключи',
        placeholder: 'Ваш API-ключ',
        clientIdPlaceholder: 'Ваш Client ID',
        clientSecretPlaceholder: 'Ваш Client Secret',
        infoLabel: 'Для чего используется этот ключ',
        how: 'Чего?',
        howTitle: 'Как получить этот ключ',
        howHeading: 'Получение ключа',
        test: 'Проверить',
        status: {
          untested: 'Не проверен',
          testing: 'Проверка',
          working: 'Работает',
          rejected: 'Отклонён',
          unreachable: 'Нет связи',
          failed: 'Сбой',
        },
        usedNote: (used: string): string => `Используется при поиске: ${used}.`,
        missNote:
          'Списки можно собирать и без этих ключей, но только вручную или из List Vault, который ведут мясные мешки.',
        sources: {
          tmdb: {
            name: 'TMDB',
            fullName: 'TMDB (The Movie Database)',
            used: 'фильмы, сериалы, анимация, документальное',
            host: 'themoviedb.org',
            steps: [
              'Создайте бесплатный аккаунт и откройте Settings → API.',
              'Запросите ключ Developer (для личного использования одобряют сразу):',
              'App name: любое. App URL: http://example.com. Summary: Personal key for Serialized media checklister',
              'Скопируйте API Key и вставьте его сюда.',
            ],
          },
          igdb: {
            name: 'IGDB',
            fullName: 'IGDB (Internet Game Database)',
            used: 'видеоигры',
            host: 'dev.twitch.tv',
            steps: [
              'IGDB работает через авторизацию Twitch. Создайте аккаунт Twitch и включите двухфакторную аутентификацию.',
              'Откройте Twitch Developer Portal → Applications и зарегистрируйте новое приложение:',
              'Name: любое. OAuth Redirect URLs: http://localhost. Category: Application Integration. Client type: Confidential',
              'Нажмите Manage рядом с приложением и создайте New Secret',
              'Скопируйте Client ID и Client Secret и вставьте оба сюда.',
            ],
          },
          comicVine: {
            name: 'Comic Vine',
            fullName: 'Comic Vine',
            used: 'комиксы',
            host: 'comicvine.gamespot.com/api',
            steps: [
              'Создайте аккаунт GameSpot и войдите.',
              'Откройте страницу API — ключ указан вверху.',
              'Скопируйте его и вставьте сюда.',
            ],
          },
          youtube: {
            name: 'YouTube',
            fullName: 'YouTube',
            used: 'плейлисты и каналы YouTube',
            host: 'console.cloud.google.com',
            steps: [
              'Войдите в аккаунт Google и создайте проект в консоли Google Cloud (Select a project → New project):',
              'Project name: любое. Parent resource: любой.',
              'Откройте API & Services → Enabled APIs & services → нажмите Enable APIs and services',
              'Найдите и включите YouTube Data API v3, затем нажмите Credentials → Create credentials → API key:',
              'Name: любое. API restrictions: YouTube Data API v3. Application restrictions: none.',
              'Скопируйте свой API-ключ и вставьте его сюда.',
            ],
          },
        },
      },
    },
    skin: {
      button: 'Оформление',
      kicker: 'Оформление',
      changed: (label: string): string => `Оформление изменено: ${label}.`,
      labels: {
        'dark-orange': 'Судьба',
        'dark-green': 'Юпитер',
        'dark-blue': 'Потоп',
        'dark-violet': 'Римляне',
        'light-bone': 'Jouhou',
      },
    },
    layerStack: {
      untitledListTab: 'Список',
    },
    categoryPicker: {
      title: 'Выберите бойца',
      subline:
        'Категории медиа, поддерживаемые приложением. Числа показывают, сколько у вас списков.',
      firstRunTitle: 'Ничего не отслеживается. Давайте начнём!',
      firstRunSubline:
        'У каждой категории есть основной источник данных плюс List Vault. Списки также можно импортировать или вводить вручную. Мега — для франшиз на стыке разных медиа.',
      byHand: 'вручную',
      countTitle: 'Списков, уже отслеживаемых в этой категории',
      closeLabel: 'Закрыть',
    },
    search: {
      queryLabel: (source: string): string => `Поиск: ${source} или List Vault`,
      searchButton: 'Искать',
      resultsCount: (n: number): string => results(n),
      itemsKicker: 'элементов',
      countLoading: 'Считаем…',
      expandRow: (title: string): string => `Показать подробности: ${title}`,
      previewButton: 'Предпросмотр',
      previewTab: (title: string): string => `Предпросмотр: ${title}`,
      addButton: 'Добавить список',
      nothingToAdd: 'Как ни странно, в этом списке нечего добавлять',
      previewUnavailable:
        'Этот источник слишком застенчив, чтобы показать свои элементы. Просто добавьте список и удалите его позже, если он не тот.',
      curatedTitle: 'Канонический список',
      curatedProvenance: 'Из List Vault · Создан и поддерживается мясными мешками специально для Listulator',
      sourceProvenance: (source: string): string => `Из источника: ${source}`,
      /** Where a curated-only category (Mega) searches: the tile footer and the Search tab. */
      librarySource: 'Библиотека сообщества',
      importing: 'Собираем список…',
      searching: 'Ищем…',
      noKeyHeadline: (source: string): string => `В List Vault ничего не найдено, а для поиска в ${source} нужен API-ключ`,
      noKeyDesktop: (category: string): string => `Добавьте API-ключ в настройках, чтобы искать в основном источнике данных категории «${category}». А пока элементы можно добавлять вручную или пользоваться каноническими списками из List Vault`,
      noKeyWeb: (category: string): string => `Для поиска в основном источнике данных категории «${category}» нужен API-ключ в файле .env сервера. А пока элементы можно добавлять вручную или пользоваться каноническими списками из List Vault`,
      offlineHeadline: (category: string): string => `Сейчас нельзя искать в категории «${category}»`,
      offlineDesktop: (category: string): string => `Для поиска в категории «${category}» нужен API-ключ (добавьте свой в настройках), а List Vault недоступен. Проверьте подключение к интернету, добавьте API-ключ, если хотите искать в основном источнике данных категории «${category}», или добавьте элементы вручную`,
      offlineWeb: (category: string): string => `Для поиска в категории «${category}» нужен API-ключ в файле .env сервера, а List Vault недоступен. Проверьте подключение к интернету, добавьте API-ключ, если хотите искать в основном источнике данных категории «${category}», или добавьте элементы вручную`,
      libraryOnlyOffline: (category: string): string =>
        `List Vault — единственное место для поиска в категории «${category}», и он недоступен. Проверьте подключение к интернету и повторите попытку или добавьте элементы вручную`,
      libraryUnreachable:
        'Не удалось связаться с List Vault, поэтому канонических списков в этих результатах нет',
      nothingFoundLibraryDown:
        'List Vault недоступен, поэтому канонические списки не искались.',
      openSettings: 'Открыть настройки',
      nothingFoundHeadline: 'Ничего не найдено',
      nothingFoundBody: 'Уверены, что это вообще существует? В любом случае попробуйте написать иначе или создайте список вручную.',
      nothingToImportHeadline: 'Нечего импортировать',
      retry: 'Повторить',
      dismiss: 'Закрыть',
    },
    addByHand: {
      titleLabel: 'Название',
      titlePlaceholder: 'Все фильмы Джеки Чана',
      descriptionLabel: 'Описание',
      descriptionPlaceholder: 'Необязательно',
      itemsLabel: 'Элементы',
      itemsPlaceholder: 'Ранние фильмы:\nПьяный мастер\nИстория полицейского\n\n# Поздние фильмы\nЧасы пик\nСмокинг',
      itemsHint: 'Строки, оканчивающиеся двоеточием или начинающиеся с #, открывают группу, которая действует до следующей. Пустые строки игнорируются',
      statusLabel: 'Статус',
      create: 'Создать список',
      creating: 'Создаём…',
      count: (n: number, g: number): string => {
        const itemText = items(n)
        if (g === 0) return itemText

        return `${itemText} в ${selectPlural(g, 'ru', { one: `${g} группе`, few: `${g} группах`, many: `${g} группах`, other: `${g} группах` })}`
      },
      noItems: 'Элементов нет (можно добавить позже)',
      assumedDuration: (duration: string): string => `Каждому элементу будет задана длительность по умолчанию: ${duration}`,
      createFailed: 'Не удалось создать список неизвестно почему',
    },
    helper: {
      topPick: 'Лучший вариант',
      openList: 'Открыть список',
      notThat: 'Не это',
      backToStrongest: '…Время — плоский круг…',
      nothingUnfinished: 'Вы закончили всё — пора добавить новый список!',
      loading: 'Роемся…',
      failed: 'Не удалось ничего предложить',
      retry: 'Ещё раз',
      surprise: {
        title: 'Сюрприз, засранец!',
        explain: 'Случайный канонический список, который вы ещё не отслеживаете. Миллионы мух не могут ошибаться, а?',
        any: 'Любая',
        category: 'КАТЕГОРИЯ',
        spin: 'Крутить и побеждать!',
        spinAgain: 'Ещё раз',
        spinning: 'Крутим…',
        thisOne: 'Эту',
        note: 'Выберите категории и испытайте удачу!',
        nothingHere: 'Здесь ничего не осталось: вы отслеживаете всё',
        anyTitle: (n: number): string => `${candidates(n)} во всех категориях`,
        shelfTitle: (n: number): string => `${candidates(n)} в этой категории`,
        pool: (n: number, shelves: number): string =>
          `${candidates(n)} ${shelves === 0 ? 'во всех категориях' : shelves === 1 ? 'в этой категории' : `в выбранных категориях (${shelves})`}`,
        meta: (category: string, count: number | undefined): string =>
          [category, count === undefined ? null : items(count), 'канонический список'].filter(Boolean).join(' · '),
        landed: (title: string): string => `Выпало: ${title}`,
        nothingLeft: (shelves: number): string =>
          `Ничего не осталось ${acrossShelves(shelves)}: вы уже отслеживаете все канонические списки оттуда.`,
        unreachable: 'Не удалось связаться с List Vault.',
        curatedTip: 'Канонический список, созданный и поддерживаемый мясными мешками',
      },
      justOneFix: {
        title: 'Быстрая доза',
        explain: 'Быстрая доза дофамина от самого короткого незаконченного из того, что вы отслеживаете',
        why: (time: string): string => `Самый короткий незаконченный элемент — ${time}, и он готов.`,
      },
      finalizer: {
        title: 'Добей его!',
        explain: 'Доведите до конца хвосты в списках, которые ближе всего к финишу',
        why: (percent: number, left: string): string => `Ближе всего к финишу: готово ${percent}%, осталось ${left}.`,
        whyComplete: 'Этот список завершён, так что второго раунда не будет',
        whyOngoing: 'Этот список всё ещё продолжается, но ничего более завершимого нет.',
      },
      tired: {
        title: 'А теперь нечто совершенно другое',
        explain: 'Устали от одного списка и хотите чего-то другого — из другого медиа?',
        tiredOf: 'Мне надоело проходить',
        pickList: 'Выберите список',
        pickTitle: 'Выберите список, который надоел',
        pickerKicker: 'ИЛИ?',
        pickerCount: (shown: number, total: number): string => `${shown} из ${total}`,
        pickerFilter: 'Найти виновника…',
        pickerNone: (query: string): string => `Нет списков, подходящих под «${query}».`,
        nothingElse: 'Больше предложить нечего: всё незаконченное — из того же медиа.',
        whyBase: 'Другое медиа',
        whyNeglected: 'и вы давно его не открывали',
        whyProgress: (percent: number, left: string): string => `готово ${percent}%, осталось ${left}`,
        whyFallback: 'Другое медиа — лучшее из оставшегося.',
      },
    },
    platformCard: {
      one: 'Платформа',
      many: (n: number): string => `Платформы · ${n}`,
      chipLabel: (title: string): string => `Платформы: ${title}`,
      edit: 'Изменить',
      editLabel: (title: string): string => `Изменить платформы: ${title}`,
    },
    list: {
      loading: 'Загружаем список…',
      saveFailed: 'Не удалось сохранить изменение',
      loadFailedHeadline: 'Не удаётся открыть этот список',
      retry: 'Повторить',
      empty: 'Элементов нет... пока',
      comingSoon: 'Скоро',
      noGroup: 'Без группы',
      /** The Group field's hint while it has focus: a name typed there makes a group (owner). */
      typeToCreate: 'Введите, чтобы создать новую',
      tags: {
        platform: 'Платформа',
        notSet: 'Не указана',
        fieldLabel: (label: string, value: string): string => `${label}: ${value}`,
        fieldTip: 'Выбрать платформы',
        panelLabel: 'Выбрать платформы',
        head: (named: number): string => (named > 1 ? `Платформы · ${named}` : 'Платформа'),
        clear: 'Очистить',
        clearTip: 'Убрать все платформы',
        notSetNote: 'Не указана. Выберите платформу:',
        removeTip: (name: string): string => `Убрать ${name}`,
        search: (n: number): string => `Поиск по ${n} платформам`,
        inList: 'Из этого списка',
        common: 'Самые частые',
        matches: (n: number): string => `Найдено · ${n}`,
        moreFoot: (shown: number, total: number): string => `Показано ${shown} из ${total} — уточните запрос.`,
        noMatch: (query: string): string => `Нет платформы «${query}». Попробуйте код платформы или другое название`,
        sourceSays: (codes: string): string => (codes ? `Источник: ${codes}` : 'Источник молчит'),
        nextItem: 'Платформы по умолчанию',
        nextItemNote: 'Задайте платформы по умолчанию для элементов, добавляемых вручную в этот список',
        nextField: (value: string): string => `Платформы по умолчанию для элементов, добавляемых вручную: ${value}`,
        nextTip: 'Платформы по умолчанию для элементов, добавляемых вручную',
        resetToSource: 'Сбросить',
        none: 'Нет',
        addPlatforms: (title: string): string => `Указать платформы: ${title}`,
        addPlatformsTip: 'Платформы нет, нажмите, чтобы выбрать',
        addChoice: (label: string, title: string): string => `Указать ${label.toLowerCase()}: ${title}`,
        addChoiceTip: (label: string): string => `${label} не указан — нажмите, чтобы указать`,
      },
      itemActions: {
        details: (title: string): string => `Подробности: ${title}`,
        dragOnList: 'Перетащите, чтобы переместить по списку',
        dragWithin: (group: string): string => `Перетащите, чтобы изменить порядок внутри группы «${group}»`,
        dragGroup: 'Перетащите, чтобы переместить всю группу по списку',
        deleteGroupLabel: 'пусто',
        deleteGroupAria: 'Удалить пустую группу',
        deleteGroupTip: 'Удалить пустую группу — в ней нет элементов',
        groupRemoved: (name: string): string => `Группа удалена: ${name}`,
        groupRestored: (name: string): string => `Группа восстановлена: ${name}`,
        groupRemoveFailed: (name: string): string => `Не удалось удалить группу: ${name}`,
        deleteGroupWithItems: (name: string): string => `Удалить группу ${name}`,
        groupDeleteKicker: 'Удалить группу',
        groupDeleteQuestion: (name: string): string => `Удалить «${name}»?`,
        groupDeleteNote: (n: number, done: number): string =>
          `Вместе с группой будут удалены: ${items(n)}${done > 0 ? `, из них выполнено — ${done}` : ''}`,
        groupDeleteConfirm: 'Удалить',
        groupRemovedWithItems: (name: string, n: number): string => `Группа ${name} удалена вместе с элементами: ${n}`,
        edit: (title: string): string => `Изменить: ${title}`,
        remove: (title: string): string => `Удалить: ${title}`,
        infoKicker: 'Подробности',
        estimated: 'Эта длительность — примерная оценка',
        editTitle: 'Название',
        editMinutes: 'Длительность (минуты)',
        editGroup: 'Группа',
        discard: 'Не сохранять',
        save: 'Сохранить',
        saved: (title: string): string => `Изменения сохранены: ${title}`,
        undo: 'Отменить действие',
        removed: (title: string): string => `Удалено: ${title}`,
        restored: (title: string): string => `Восстановлено: ${title}`,
        added: (title: string, group: string | null): string =>
          group ? `Добавлено: ${title} — в группу «${group}»` : `Добавлено: ${title}`,
        removeFailed: (title: string): string => `Не удалось удалить: ${title}`,
        editUndone: (title: string): string => `Изменение отменено: ${title}`,
        editFailed: 'Не удалось сохранить изменения',
        undoFailed: 'Не удалось отменить',
      },
      addItem: {
        titleLabel: 'Название',
        titlePlaceholder: 'Добавить элемент…',
        minutesLabel: 'Минуты',
        groupLabel: 'Группа',
        add: 'Добавить',
        adding: 'Добавляем…',
        failed: 'Не удалось добавить элемент',
      },
      createGroup: (name: string): string => `+ Создать «${name}»`,
      editList: 'Изменить список',
      orderMenu: {
        kicker: 'Сброс списка',
        resetQuestion: 'Вернуть этот список в девственное состояние?',
        resetLead: {
          canonical: 'Назад к каноническому списку из List Vault',
          file: 'Назад к импортированному файлу',
          api: 'Назад к списку, полученному из поиска',
        },
        computing: 'Считаем, что изменится…',
        previewFailed: (message: string): string =>
          `Не удалось посчитать, что изменится (${message}). Сброс всё равно вернёт список к источнику.`,
        removed: (n: number): string =>
          `${selectPlural(n, 'ru', { one: `будет удалён ${n} добавленный вами элемент`, few: `будут удалены ${n} добавленных вами элемента`, many: `будут удалены ${n} добавленных вами элементов`, other: `будут удалены ${n} добавленных вами элемента` })}`,
        restored: (n: number): string =>
          `${selectPlural(n, 'ru', { one: `вернётся ${n} удалённый вами элемент`, few: `вернутся ${n} удалённых вами элемента`, many: `вернутся ${n} удалённых вами элементов`, other: `вернутся ${n} удалённых вами элемента` })}`,
        cleared: (n: number): string =>
          `${selectPlural(n, 'ru', { one: `будет снята ${n} отметка «готово»`, few: `будут сняты ${n} отметки «готово»`, many: `будут сняты ${n} отметок «готово»`, other: `будут сняты ${n} отметки «готово»` })}`,
        joinCost: (parts: readonly string[]): string => {
          const sentence =
            parts.length <= 1
              ? `${parts[0]}.`
              : `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}.`
          return sentence.charAt(0).toUpperCase() + sentence.slice(1)
        },
        noCost: 'Добавленное, удалённое и отмеченное как выполненное не затрагивается.',
        undoNote: 'Отменить можно в течение 8 секунд.',
        resetOrder: 'Сбросить порядок',
        resetEverything: 'Сбросить',
        sorted: 'Отсортировано по дате — группы перемещены целиком.',
        orderReset: 'Порядок сброшен.',
        resetDone: 'Сброшено к источнику — порядок, название, описание и флаг.',
        undone: 'Сброс отменён',
        orderUndone: 'Порядок восстановлен',
        sortFailed: 'Не удалось отсортировать список',
        resetFailed: 'Не удалось сбросить список',
        undoFailed: 'Не удалось отменить',
      },
      moves: {
        movedTo: (title: string, position: number, total: number, group?: string): string =>
          `${title}: позиция ${position} из ${total}${group ? ` в группе «${group}»` : ''}`,
        atEdge: (side: 'top' | 'bottom', group?: string): string =>
          `Уже ${side === 'top' ? 'в начале' : 'в конце'} ${group ? `группы «${group}»` : 'списка'}`,
        movedOnList: 'Элемент перемещён',
        movedInside: (group: string): string => `Элемент перемещён внутри группы «${group}».`,
        movedRows: (n: number): string =>
          `${selectPlural(n, 'ru', { one: `Перемещена ${n} строка`, few: `Перемещены ${n} строки`, many: `Перемещено ${n} строк`, other: `Перемещено ${n} строки` })}.`,
        onlyInsideGroup: 'Менять порядок можно только внутри одной группы',
        undone: 'Перемещение отменено',
        saveFailed: 'Не удалось сохранить перемещение',
        undoFailed: 'Не удалось отменить перемещение',
      },
      moreMenu: {
        kicker: 'Действия со списком',
        edit: 'Изменить список',
        export: 'Экспортировать список',
        reorder: 'Упорядочить список',
        reset: 'Сбросить список',
        delete: 'Удалить список',
        exportKicker: 'Экспорт списка',
        exportNote:
          'Сохраните этот список в формате YAML. Прогресс не включается. Подходит для предложений канонических списков и для обмена списками.',
        download: 'Скачать файл',
        copy: 'Копировать в буфер',
        reorderKicker: 'Упорядочить список',
        reorderQuestion: 'Отсортировать этот список по хронологии?',
        reorderHint:
          'Группы перемещаются блоками по самому раннему элементу. Внутри каждой группы порядок тоже меняется',
        reorderNote: 'Это одноразовое действие не мешает вручную менять порядок позже.',
        cancel: 'Отмена',
        sortNow: 'Упорядочить',
        deleteKicker: 'Удаление списка',
        deleteQuestion: (title: string): string => `Удалить «${title}»?`,
        deleteNote: (n: number, done: number): string =>
          n === 0 ? 'Список пуст.' : `${items(n)} (готово — ${done}) исчезнут, как какашка на ветру`,
        keep: 'Оставить список',
        confirmDelete: 'Удалить список',
        itemCount: (n: number): string => items(n),
        saved: (fileName: string, n: number): string => `Сохранён ${fileName} — ${items(n)}.`,
        copied: 'YAML-список скопирован в буфер обмена',
        copyFailed: 'Не удалось скопировать в буфер обмена. Попробуйте лучше «Скачать файл»?',
        exportFailed: 'Обнаружен злой таможенный контроль: не удалось экспортировать этот список',
        deleted: (title: string): string => `Удалено: «${title}».`,
        restored: (title: string): string => `Восстановлено: ${title}`,
        deleteFailed: 'Обнаружен внезапный iddqd: не удалось удалить этот список',
        restoreFailed: 'Обнаружен сбой некромантии: не удалось восстановить список',
      },
      editPopover: {
        kicker: 'Изменить список',
        title: 'Название',
        description: 'Описание (необязательно)',
        descriptionPlaceholder: 'Хорошее место для сведений о том, что входит в список, а что нет',
        status: 'Статус (необязательно)',
        renamed: (title: string): string => `Переименовано: «${title}».`,
        descriptionUpdated: 'Описание обновлено',
        statusMarked: (status: 'complete' | 'ongoing'): string =>
          `Статус списка изменён на «${status === 'complete' ? 'Завершён' : 'Продолжается'}».`,
        statusCleared: 'Статус списка стал шрёдингеровским',
        reverted: (title: string): string => `Возвращено: ${title}`,
        saveFailed: 'Не удалось сохранить изменения списка',
        undoFailed: 'Не удалось отменить',
      },
      rail: {
        title: 'Перейти к',
        hide: 'Свернуть навигацию по группам',
        show: 'Развернуть навигацию по группам',
        resize: 'Изменить размер навигации по группам',
      },
      filter: {
        label: 'Фильтр элементов',
        placeholder: 'Фильтр элементов…',
        total: (n: number): string => items(n),
        shown: (shown: number, total: number): string => `показано ${shown} из ${total}`,
        groupShown: (shown: number, total: number): string => `${shown} из ${total}`,
        nothing: (text: string): string =>
          text.trim() ? `Ничего не подходит под «${text.trim()}».` : 'Ничего не подходит под этот фильтр.',
        all: 'Все',
        clearTip: 'Показать элементы всех типов',
        hideOption: (name: string): string => `Скрыть: ${name}`,
        alsoShowOption: (name: string): string => `Фильтр: ${name}`,
        facetPicks: (named: readonly string[], more: number): string =>
          more > 0 ? `${named.join(', ')} +${more}` : named.join(', '),
        facetDropdownLabel: (facet: string, summary: string): string => `${facet}: ${summary}`,
        facetPickTip: 'Выберите типы для фильтра',
        facetCount: (facet: string, n: number): string => `${facet} · ${n}`,
        facetLabels: {
          Type: 'Тип',
          Medium: 'Медиа',
          Language: 'Язык',
          Platform: 'Платформа',
          Recording: 'Запись',
        },
        optionLabels: {
          Untagged: '(неизвестно)',
          MULTI: 'МУЛЬТИ',
          Movie: 'Фильм',
          TV: 'Сериал',
          Animation: 'Анимация',
          Documentary: 'Документальное',
          Wrestling: 'Рестлинг',
          MMA: 'ММА',
          Game: 'Игра',
          Comic: 'Комикс',
          Book: 'Книга',
          Music: 'Музыка',
          YouTube: 'YouTube',
          Album: 'Альбом',
          EP: 'EP',
          Single: 'Сингл',
          Mini: 'Мини',
          Live: 'Концертный',
          Compilation: 'Сборник',
        },
        collapseAll: 'Свернуть',
        expandAll: 'Развернуть',
        collapseAllTip: 'Свернуть все группы ниже',
        expandAllTip: 'Открыть все группы ниже',
      },
      checkForUpdates: 'Проверить обновления',
      order: 'Порядок',
      more: 'Ещё',
      close: 'Закрыть',
      updates: {
        checkFailed: 'Не удалось проверить обновления',
        nothingNew: 'Обновлений не найдено',
        addFailed: 'Не удалось добавить',
        foundBand: (n: number): string => `Найдено: ${newItems(n)}.`,
        updateList: 'Обновить список',
        dismissFound: 'Закрыть',
        appliedToast: (n: number): string => `Добавлено: ${newItems(n)}.`,
        newBand: (n: number): string =>
          selectPlural(n, 'ru', { one: `Добавлен ${n} новый элемент`, few: `Добавлены ${n} новых элемента`, many: `Добавлено ${n} новых элементов`, other: `Добавлено ${n} новых элемента` }),
        markAllSeen: 'Отметить всё просмотренным',
        markedSeen: 'Всё отмечено просмотренным',
        markSeenFailed: 'Не удалось отметить просмотренным',
      },
    },
    preview: {
      title: 'Предпросмотр списка',
      closeLabel: 'Закрыть',
      loading: 'Перечисляем элементы…',
      summary: (count: number, duration: string, estimated: boolean): string =>
        `${items(count)} · ${estimated ? '≈ ' : ''}${duration}`,
      addButton: 'Добавить этот список',
      adding: 'Собираем список…',
      nothingToAdd: 'Добавлять нечего: этот список пуст, как совесть миллиардера',
      loadFailedHeadline: 'Не удаётся показать предпросмотр',
      retry: 'Повторить',
      footer: (provenance: string): string => `${provenance}`,
      expandGroup: (label: string): string => `Развернуть: ${label}`,
      collapseGroup: (label: string): string => `Свернуть: ${label}`,
    },
    importFile: {
      chooseFile: 'Выбрать файл…',
      boxLabel: 'Или вставьте YAML сюда',
      boxPlaceholder:
        'title: Все фильмы Джеки Чана\ncategory: movie\nitems:\n  - { title: Пьяный мастер, year: 1978 }',
      import: 'Импортировать',
      importing: 'Импортируем…',
      readOutFile: (name: string, size: string, l: string): string => `${name} · ${size} · ${l}`,
      readOutPasted: (l: string): string => `Вставлено · ${l}`,
      lines: (n: number): string => lines(n),
      footer:
        'Используйте функцию экспорта в списке, чтобы создать файл списка YAML',
      otherCategoryKicker: 'Не та дырка',
      otherCategoryQuestion: (fileCategory: string): string => `Импортировать в «${fileCategory}»?`,
      otherCategoryNote: (current: string, fileCategory: string): RichText => [
        'Мы в разделе ',
        { strong: `«${current}»` },
        ', а импортируемый список — из раздела ',
        { strong: `«${fileCategory}»` },
        '.',
      ],
      back: 'Назад',
      importFailed: 'Не удалось импортировать этот файл, поэтому список нельзя создать',
    },
    createList: {
      title: (category: string): string => `Новый список: ${category}`,
      searchTab: (): string => 'Поиск',
      handTab: 'Пустить в ход руки',
      importTab: 'Импорт',
      closeLabel: 'Закрыть',
    },
    home: {
      title: 'Мои Прелессти',
      newList: 'Новый список',
      checkForUpdates: 'Проверить обновления',
      checkingUpdates: 'Проверяем…',
      loadFailed: 'Не удалось загрузить ваши списки',
      retry: 'Повторить',
      listCount: (n: number): string => lists(n),
      summary: (listCount: string, done: number, total: number, timeLeft: string | null): string =>
        timeLeft
          ? `${listCount} · готово ${done} из ${total} · осталось ${timeLeft}`
          : `${listCount} · готово ${done} из ${total}`,
      needHelp: 'Нужна помощь?',
      helpButtons: {
        tiredBoss: 'Устал, шеф',
        finalizer: 'Финализатор',
        justOneFix: 'Быстрая доза',
        surpriseMe: 'Удиви меня',
      },
      orphanedTitle: 'Без категории',
      orphanedNote: 'такой категории больше нет',
      pendingBand: (n: number): string => ` — новых элементов: ${n}.`,
      updateList: 'Обновить список',
      dismissUpdate: 'Закрыть',
      noNewUpstream: 'Там наверху ничего нового.',
      updateApplied: (n: number, title: string): string =>
        `Добавлено: ${newItems(n)} — в «${title}».`,
      updateFailed: 'Не удалось обновить этот список',
      checkPartial: (titles: readonly string[]): string =>
        `Не удалось проверить: ${lists(titles.length)}: ${titles.join(', ')}`,
      checkUpdatesFailed: 'Не удалось проверить обновления',
    },
  },
}
