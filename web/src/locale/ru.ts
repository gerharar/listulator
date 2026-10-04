import { selectPlural } from './plural.js'
import type { RichText } from './types.js'
import type { Locale } from './en.js'

/**
 * Russian -- a full translation (task 10.32b), typed as a whole `Locale` so a
 * key added to `en.ts` without a Russian counterpart fails to compile, and the
 * strict parity test says the same about a key that slipped through a cast.
 *
 * **Register:** «ты», imperative plural for actions ("Добавь"), neutral and
 * short; the prototype's playful lines (the four helper sheets) keep their
 * attitude rather than being flattened. Movie/series names and platform codes
 * are data and stay as they are. A machine-assisted draft until the owner has
 * reviewed it -- see docs/DECISIONS.md (10.32b).
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

/** "N новых элементов" -- the adjective agrees too. */
const newItems = (n: number): string =>
  `${n} ${selectPlural(n, 'ru', { one: 'новый элемент', few: 'новых элемента', many: 'новых элементов', other: 'нового элемента' })}`

/** The part after "Ничего не осталось" for a shelf count. */
const acrossShelves = (shelves: number): string =>
  shelves === 0 ? 'ни в одной категории' : shelves === 1 ? 'в этой категории' : `в выбранных категориях (${shelves})`

export const ru: Locale = {
  app: {
    loading: 'Загрузка…',
    unknownError: 'Упс... Что-то пошло не так',
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
    searchFailed: 'Поиск не шмог',
    defaultPlaceholder: 'Поиск…',
    placeholders: {
      movie: 'Искать актёра, режиссёра, или серию фильмов',
      music: 'Искать группу или исполнителя',
      book: 'Искать автора',
    },
    languageLabel: 'Язык',
    allLanguages: 'Все',
    includeUnknown: 'ХЗ',
    discographyTypesLabel: 'Включить',
    includeEp: 'EP',
    includeSingle: 'Синглы',
    includeLive: 'Концерты',
    includeCompilation: 'Сборники',
  },

  categories: {
    movie: {
      label: 'Фильмы',
      handTitlePlaceholder: 'Фильмы с Вином Дизелем',
      handItemsPlaceholder:
        'Франшиза Форсаж:\nФорсаж\nФорсаж 5\n\n# Франшиза Хроники Риддика\nЧёрная дыра\nХроники Риддика\nРиддик',
    },
    tv: {
      label: 'Сериалы',
      handTitlePlaceholder: 'Теория большого взрыва',
      handItemsPlaceholder:
        'Сезон 1:\nS1E1: Pilot\nS1E2: The Big Bran Hypothesis\nS1E3: The Fuzzy Boots Corollary\n\n# Сезон 2\nS2E1: The Bad Fish Paradigm\nS2E2: The Codpiece Topology',
      handItemsHint:
        'Один эпизод на строку. Строка, оканчивающаяся двоеточием или начинающаяся с #, открывает сезон, который действует до следующего',
    },
    animation: {
      label: 'Анимация',
      handTitlePlaceholder: 'Аркейн (анимационный сериал)',
      handItemsPlaceholder:
        'Сезон 1:\nWelcome to the Playground\nSome Mysteries Are Better Left Unsolved\n\n# Сезон 2\nHeavy Is the Crown\nWatch It All Burn',
    },
    documentary: {
      label: 'Документальное кино',
      handTitlePlaceholder: 'Документальные фильмы Дэвида Аттенборо',
      handItemsPlaceholder:
        'Голубая планета:\nМир океана\nГлубины\n\n# Планета Земля\nОт полюса до полюса\nГоры\nПресная вода',
    },
    wrestling: {
      label: 'Рестлинг',
      handTitlePlaceholder: 'PPV-матчи Андертейкера',
      handItemsPlaceholder:
        'Серия на WrestleMania:\nWrestleMania VII (Джимми Снука)\nWrestleMania VIII (Джейк Робертс)\n\n# Survivor Series\nSurvivor Series 1990 (командный матч на выбывание)\nSurvivor Series 1991 (одиночный матч)',
    },
    mma: {
      label: 'ММА',
      handTitlePlaceholder: 'Титульные бои UFC',
      handItemsPlaceholder:
        'Титул в тяжёлом весе:\nUFC 12 (Коулман -- Северн)\nUFC 14 (Смит -- Коулман)\n\n# Титул в лёгком весе\nUFC 30 (Палвер -- Уно)\nUFC 33 (Палвер -- Холлман)',
    },
    game: {
      label: 'Игры',
      handTitlePlaceholder: 'Игры серии Pokémon',
      handItemsPlaceholder:
        'Первое поколение:\nPokémon Red\nPokémon Blue\n\n# Второе поколение\nPokémon Gold\nPokémon Silver',
    },
    comic: {
      label: 'Комиксы',
      handTitlePlaceholder: 'Человек-паук: Сага о клонах',
      handItemsPlaceholder:
        'Фаза 1 (пролог):\nSpider-Man: The Lost Years #1\nSpider-Man: The Lost Years #2\n\n# Фаза 2 (Алый Паук)\nThe Amazing Spider-Man #400\nSpider-Man (1990) #57',
      handItemsHint:
        'Один выпуск или том на строку. Строка, оканчивающаяся двоеточием или начинающаяся с #, открывает секцию, которая действует до следующей',
    },
    book: {
      label: 'Книги',
      handTitlePlaceholder: 'Романы Плоского Мира',
      handItemsPlaceholder:
        'Ринсвинд:\nЦвет волшебства\nБезумная звезда\n\n# Смерть\nМор, ученик Смерти\nМрачный Жнец',
      handItemsHint:
        'Одна книга на строку. Строка, оканчивающаяся двоеточием или начинающаяся с #, открывает секцию, которая действует до следующей',
    },
    music: {
      label: 'Музыка',
      handTitlePlaceholder: 'Дискография Cannibal Corpse',
      handItemsPlaceholder:
        'Студийные альбомы:\nEaten Back to Life\nButchered At Birth\nTomb Of The Mutilated\n\n# EP и синглы\nHammer Smashed Face\nWorm Infested',
      handItemsHint:
        'Один релиз на строку. Строка, оканчивающаяся двоеточием или начинающаяся с #, открывает секцию, которая действует до следующей',
    },
    youtube: {
      label: 'YouTube',
      handTitlePlaceholder: 'Dungeon Soup',
      handItemsPlaceholder:
        'Chaotic Good Barbarian, сезон 1:\nImmortality Killed The Lich\nHearse of Strahd\n\n# Chaotic Good Barbarian, сезон 2\nI HAVE NO LUCK AND I MUST SCREAM\nONI-GIRI',
    },
    mega: {
      label: 'Мега',
      description:
        'Для списков франшиз, охватывающих несколько категорий (фильмы, сериалы, книги, игры, и т.д.)',
      handTitlePlaceholder: 'Ведьмак -- всё',
      handItemsPlaceholder:
        'Книги:\nПоследнее желание\nМеч Предназначения\n\n# Игры\nВедьмак\nВедьмак 2: Убийцы королей',
    },
  },

  errors: {
    'search.queryRequired': (): string => 'Эй, а что искать-то?',
    'search.unavailable': (p: { category: string }): string => `Поиск недоступен для категории ${p.category}. Можно импортировать список или создать его вручную`,
    'search.unavailableOffline': (p: { category: string }): string => `Поиск недоступен для категории ${p.category}, а List Vault не отвечает. Попробуй позже или сделай список вручную`,
    'list.unknownCategory': (p: { key: string }): string => `Руки-крюки: список нельзя импортировать, неизвестная категория ‘${p.key}’. Сверь написание категории с CONTRIBUTING.md, обычно проблема где-то там`,
    'list.sourceEmpty': (p: { title: string }): string => `Обнаружена преждевременная листуляция: для ${p.title} нечего импортировать`,
    'list.sourceTooLarge': (p: { title?: string; count: number; max: number }): string =>
      `${p.title ? `${p.title}` : 'Этот источник'} слишком толстый для одного списка: ${p.count.toLocaleString('ru')}, а в список входит не больше ${p.max.toLocaleString('ru')}`,
    'list.fileInvalid': (p: { detail?: string }): string =>
      `Не та дырка, бро: ты пытаешься запихать квадратный файл в круглую дырку, поэтому его нельзя импортировать. Убедись, что это корректный YAML-файл со всеми обязательными полями${p.detail ? `. Что нашёл разбор: ${p.detail}` : ''}`,
    'list.fileSyntax': (p: { line?: number }): string => p.line ? `Руки-из-жопы-растуки: список нельзя импортировать, синтаксическая ошибка в строке ${p.line}` : 'Руки-из-жопы-растуки: список нельзя импортировать, синтаксическая ошибка',
    'list.fileNoItems': (): string => 'Обнаружена преждевременная листуляция: список нельзя импортировать, нет элементов',
    'list.fileMissingTitle': (): string => 'Обнаружена преждевременная листуляция: список нельзя импортировать, нет названия',
    'list.fileItemMissingTitle': (p: { index: number }): string => `Обнаружен рецидив Альцгеймера: список нельзя импортировать, у элемента ${p.index} нет названия`,
    'list.fileItemNotesTooLong': (p: { index: number; max: number }): string => `Обнаружена реинкарнация Льва Толстого: список нельзя импортировать, заметки к элементу ${p.index} длиннее ${p.max} символов`,
    'list.alreadyExists': (): string => 'Обнаружена самая быстрая рука на Диком Западе: такой список уже существует, поэтому ничего не восстановлено',
    'group.nameEmpty': (): string => 'Человеку нужно название группы',
    'group.nameTaken': (): string => 'Обнаружен рецидив Альцгеймера: в этом списке уже есть группа с таким названием',
    'group.notEmpty': (): string => 'Удалить группу можно, только приняв её пустоту',
    'group.orderMismatch': (): string =>
      'Группы изменились с тех пор, как ты открыл список, -- перезагрузи его и повтори',
    'name.tooLong': (p: { max: number }): string => `Слишшшком длинннное название: не больше ${p.max} символов`,
    'reset.unavailable': (): string => 'У этого списка нет источника, к которому его можно сбросить, а ты не должен видеть это сообщение',
    'refresh.handMadeList': (): string => 'Этот список -- ручная работа, сверять его не с чем',
    'refresh.searchUnavailable': (p: { category: string }): string =>
      `Поиск недоступен для категории ${p.category}`,
  },

  request: {
    unreachable: 'Нет связи с сервером. Есть там кто-нибудь?',
    failed: (status: number): string => `Запрос не удался (${status})`,
    unknown: 'Упс... Что-то пошло не так',
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
      headline: 'Упс... ',
      explanation: 'Listulator наступил на неизвестные науке грабли и сдох, обоссавшись и обосравшись. Не переживай, твои списки не пострадали. Перезагрузи, чтобы вернуть приложение к жизни (надеюсь)',
      reload: 'Перезагрузить',
    },
    meter: {
      label: (done: number, total: number): string => `${done} из ${total} готово`,
      noteCapped: (cap: number, perCell: number): string => `${cap} ячеек по ≈ ${perCell} элементов в каждой`,
      noteUncapped: 'Одна ячейка -- один элемент',
      explainHint: 'Как работают ячейки полосы прогресса',
      detailCapped: (cap: number, perCell: number): string => `Полоса ограничена ${cap} ячейками, поэтому каждая ячейка символизирует примерно ${perCell} элементов`,
      detailUncapped: 'Каждая ячейка -- один элемент списка. Закрашенная ячейка = завершено',
    },
    progress: {
      count: (done: number, total: number, percent: number): string =>
        total ? `${done}/${total} (${percent}%)` : `${done}/${total}`,
      left: (duration: string): string => `осталось ${duration}`,
      leftApprox: (duration: string): string => `≈ осталось ${duration}`,
      runtimesPendingTip: (count: number): string => `Ищем длительность: осталось ${count}`,
      allDone: '✓ Завершён',
      doneForNow: '✓ Завершён (пока что)',
    },
    status: {
      complete: 'Закончен',
      ongoing: 'Ещё идёт',
    },
    marks: {
      curated: 'Канонический список из List Vault (ведётся мясными мешками)',
      byHand: 'Список создан вручную мясными мешками',
      manual: 'Элемент добавлен вручную',
      newCount: (n: number): string => `${n} NEW`,
      newItem: 'НОВОЕ',
      allDone: '✓ Завершён',
    },
    common: {
      close: 'Закрыть',
      keep: 'Оставить',
      toggleDone: 'Отметить как завершённое',
      backToLayer: 'Назад к этому окну',
      clickToEdit: 'Нажми, чтобы изменить',
      showKey: 'Показать ключ',
      hideKey: 'Скрыть ключ',
    },
    statusPicker: {
      notKnown: 'Шрёдингера',
      notKnownNote: 'Когда понятия не имееешь, выйдет ли тут что-нибудь новое',
      ongoingNote: 'Этот список ещё не закончен (выходит что-то новое)',
      completeNote: 'Этот список закончен (ничего нового не выйдет)',
    },
    appHeader: {
      settings: 'Настройки',
      about: 'О программе',
    },
    about: {
      title: 'О программе',
      closeLabel: 'Закрыть',
      version: 'Версия',
      checkForUpdates: 'Проверить обновления',
      updatesLater: 'Проверка обновлений появится в следующей версии',
      upToDate: 'Установлена последняя версия Listulator',
      checking: 'Проверяем…',
      available: 'Доступно обновление',
      failed: 'Не удалось проверить обновления',
      download: 'Скачать обновление',
      retry: 'Повторить',
      legal: 'Лицензия и уведомления',
      dataSources: 'Источники данных',
      showAttribution: 'Показать атрибуцию',
      hideAttribution: 'Скрыть атрибуцию',
      powers: {
        igdb: 'Игры',
        musicbrainz: 'Альбомы и дискографии',
        openLibrary: 'Книги',
        comicVine: 'Комиксы',
        youtube: 'Плейлисты и каналы',
        wikipedia: 'Турниры по реслингу и MMA',
        tmdb: 'Фильмы, сериалы, анимация и документальное кино',
      },
    },
    settings: {
      title: 'Настройки',
      closeLabel: 'Закрыть',
      theme: 'Тема',
      themeQuantum: 'Quantum',
      skin: 'Шкура',
      motion: 'Анимация',
      reduceMotion: 'Минимизировать анимацию',
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
        how: 'Как?',
        howTitle: 'Как получить этот ключ',
        howHeading: 'Добыча Ключа',
        test: 'Проверить',
        status: {
          untested: 'Не проверен',
          testing: 'Проверка',
          working: 'Работает',
          rejected: 'Отклонён',
          unreachable: 'Нет связи',
          failed: 'Сбой',
        },
        usedNote: (used: string): string => `Используется при поиске: ${used}`,
        missNote:
          'Списки можно делать и без этих ключей, но только вручную или из List Vault, который ведут мясные мешки',
        sources: {
          tmdb: {
            name: 'TMDB',
            fullName: 'TMDB (The Movie Database)',
            used: 'фильмы, сериалы, анимация, документальное',
            host: 'themoviedb.org',
            steps: [
              'Создайте бесплатный аккаунт и откройте Settings → API',
              'Запросите Developer API key (для личного использования дадут сразу):',
              'App name: любое. App URL: http://example.com. Summary: Personal key for Serialized media checklister',
              'Скопируйте API-ключ и вставьте его сюда',
            ],
          },
          igdb: {
            name: 'IGDB',
            fullName: 'IGDB (Internet Game Database)',
            used: 'видеоигры',
            host: 'dev.twitch.tv',
            steps: [
              'IGDB работает через авторизацию Twitch. Создайте аккаунт Twitch и включите двухфакторную аутентификацию',
              'Откройте Twitch Developer Portal → Applications и зарегистрируйте новое приложение:',
              'Name: любое. OAuth Redirect URLs: http://localhost. Category: Application Integration. Client type: Confidential',
              'Нажмите Manage рядом с приложением и создайте New Secret',
              'Скопируйте Client ID и Client Secret и вставьте их сюда',
            ],
          },
          comicVine: {
            name: 'Comic Vine',
            fullName: 'Comic Vine',
            used: 'комиксы',
            host: 'comicvine.gamespot.com/api',
            steps: [
              'Создайте аккаунт GameSpot и войдите',
              'Откройте страницу API -- ключ указан вверху',
              'Скопируйте его и вставьте сюда',
            ],
          },
          youtube: {
            name: 'YouTube',
            fullName: 'YouTube',
            used: 'плейлисты и каналы YouTube',
            host: 'console.cloud.google.com',
            steps: [
              'Войдите в аккаунт Google и создайте проект в консоли Google Cloud (Select a project → New project):',
              'Project name: любое. Parent resource: любой',
              'Откройте API & Services → Enabled APIs & services → нажмите Enable APIs and services',
              'Найдите и включите YouTube Data API v3, затем нажмите Credentials → Create credentials → API key:',
              'Name: любое. API restrictions: YouTube Data API v3. Application restrictions: none',
              'Скопируйте свой API-ключ и вставьте его сюда',
            ],
          },
        },
      },
    },
    skin: {
      button: 'Шкура',
      kicker: 'Шкура',
      changed: (label: string): string => `Шкуру заменили: ${label}`,
      labels: {
        'dark-orange': 'Destiny',
        'dark-green': 'Jupiter',
        'dark-blue': 'Deluge',
        'dark-violet': 'Romans',
        'light-bone': 'Jouhou',
      },
    },
    layerStack: {
      untitledListTab: 'Список',
    },
    categoryPicker: {
      title: 'Выбери Своего Бойца',
      subline:
        'Категории медиа, поддерживаемые приложением. Числа показывают, сколько у тебя списков',
      firstRunTitle: 'Ничего не отслеживается. Пора начинать!',
      firstRunSubline:
        'У каждой категории есть основной источник данных плюс List Vault. Списки также можно импортировать или вводить вручную. Мега -- для франшиз на стыке разных категорий',
      byHand: 'вручную',
      countTitle: 'Добавленных списков в этой категории',
      closeLabel: 'Закрыть',
    },
    search: {
      queryLabel: (source: string): string => `Поиск: ${source} или List Vault`,
      libraryQueryLabel: (source: string): string => `Поиск: ${source}`,
      searchButton: 'Искать',
      resultsCount: (n: number): string => results(n),
      more: {
        // «из N» takes the genitive: «из 21 результата», «из 22 результатов»; the plus does not change the noun.
        count: (shown: number, total: number, lowerBound: boolean): string =>
          `${shown} из ${total}${lowerBound ? '+' : ''} ${selectPlural(total, 'ru', { one: 'результата', few: 'результатов', many: 'результатов', other: 'результатов' })}`,
        caption: (shown: number): string => `Конец первых ${shown}`,
        note: 'Найдены ещё совпадения. Уточни запрос, чтобы улучшить результаты',
        showMore: 'Показать Ещё',
        loading: 'Загружаем…',
        refine: 'Уточнить Запрос',
      },
      itemsKicker: 'элементов',
      countLoading: 'Считаем…',
      expandRow: (title: string): string => `Показать подробности: ${title}`,
      previewButton: 'Поглядеть',
      previewTab: (title: string): string => `Предпросмотр: ${title}`,
      addButton: 'Добавить Список',
      nothingToAdd: 'Как ни странно, в этом списке нечего добавлять',
      megaHint: {
        title: (p: { count: number; category: string }): string =>
          p.count === 1 ? `Твоя принцесса в замке ${p.category}` : `Твои принцессы в замке ${p.category}`,
        unit: (n: number): string => selectPlural(n, 'ru', { one: 'список', few: 'списка', many: 'списков', other: 'списка' }),
        items: (n: number): string => items(n),
        subline: 'В категории Mega есть канонические списки с тем, что ты ищешь, и даже больше',
        open: 'Открыть',
        openList: (title: string): string => `Открыть: ${title}`,
        seeAll: (p: { n: number; category: string }): string => `Показать все ${p.n} в ${p.category}`,
      },
      previewUnavailable:
        'Этот источник слишком застенчив, чтобы показывать свои элементы. Просто добавьте его и потом удалите, если он не торт',
      curatedTitle: 'Канонический Список',
      curatedProvenance: 'Источник: List Vault · Создан и поддерживается мясными мешками специально для Listulator',
      sourceProvenance: (source: string): string => `Источник: ${source}`,
      /** Where a curated-only category (Mega) searches: the tile footer and the Search tab. */
      librarySource: 'List Vault',
      importing: 'Строим список…',
      searching: 'Ищем…',
      noKeyHeadline: (source: string): string => `В List Vault ничего не найдено, а для поиска в ${source} нужен API-ключ`,
      noKeyDesktop: (category: string): string => `Добавь API-ключ в настройках, чтобы искать в основном источнике данных категории ${category}. А пока элементы можно добавлять вручную или пользоваться каноническими списками из List Vault`,
      noKeyWeb: (category: string): string => `Для поиска в основном источнике данных категории ${category} нужен API-ключ в файле .env сервера. А пока элементы можно добавлять вручную или пользоваться каноническими списками из List Vault`,
      offlineHeadline: (category: string): string => `Вообще не ищется в категории ${category}`,
      offlineDesktop: (category: string): string => `Для поиска в категории ${category} нужен API-ключ (добавьте свой в настройках), а List Vault недоступен. Проверь подключение к интернету, добавь API-ключ, если хочешь искать в основном источнике данных категории ${category}, или сделай список вручную`,
      offlineWeb: (category: string): string => `Для поиска в категории ${category} нужен API-ключ в файле .env сервера, а List Vault недоступен. Проверь подключение к интернету, добавь API-ключ, если хочешь искать в основном источнике данных категории ${category}, или сделай список вручную`,
      libraryOnlyOffline: (category: string): string =>
        `List Vault -- единственное место для поиска в категории ${category}, и он недоступен. Проверь подключение к интернету и попробуй ещё раз, или сделай список вручную`,
      libraryUnreachable:
        'Не удалось достучаться до List Vault, поэтому канонических списков в этих результатах нет',
      nothingFoundLibraryDown:
        'List Vault недоступен, поэтому канонические списки неискабельны',
      openSettings: 'Открыть настройки',
      nothingFoundHeadline: 'Ничего не найдено',
      nothingFoundBody: 'Уверен, что это вообще существует? На всякий случай попробуй написать иначе или сделай список вручную',
      nothingToImportHeadline: 'Нечего импортировать',
      retry: 'Повторить',
      dismiss: 'Закрыть',
    },
    addByHand: {
      titleLabel: 'Название',
      titlePlaceholder: 'Мой список',
      descriptionLabel: 'Описание',
      descriptionPlaceholder: 'Необязательно',
      itemsLabel: 'Элементы',
      itemsPlaceholder: 'Первый элемент\nВторой элемент\n\nГруппа:\nТретий элемент\nЧетвёртый элемент',
      itemsHint: 'Строки, оканчивающиеся двоеточием или начинающиеся с #, открывают группу, которая действует до следующей',
      statusLabel: 'Статус',
      create: 'Создать Список',
      creating: 'Создаём…',
      count: (n: number, g: number): string => {
        const itemText = items(n)
        if (g === 0) return itemText

        return `${itemText} в ${selectPlural(g, 'ru', { one: `${g} группе`, few: `${g} группах`, many: `${g} группах`, other: `${g} группах` })}`
      },
      noItems: 'Элементов нет (можно насовать позже)',
      assumedDuration: (duration: string): string => `Каждому элементу будет задана длительность по умолчанию: ${duration}`,
      createFailed: 'Не удалось создать список, и хрен пойми почему',
    },
    helper: {
      topPick: 'Топ за свои деньги',
      openList: 'Открыть Cписок',
      notThat: 'Не Это',
      backToStrongest: '…Время -- плоский круг…',
      nothingUnfinished: 'Ты всех порешал -- пора добавить новый список!',
      loading: 'Роемся…',
      failed: 'Не удалось ничего предложить',
      retry: 'Ещё раз',
      surprise: {
        title: 'Подержи Моё Пиво',
        explain: 'Случайный канонический список, который ты ещё не отслеживаешь. Миллионы мух не могут ошибаться, ы?',
        any: 'Любая',
        category: 'КАТЕГОРИЯ',
        spin: 'Крутануть',
        spinAgain: 'Ещё Разок',
        spinning: 'Кручу, верчу…',
        thisOne: 'Этот',
        note: 'Выбери категории и улыбнись своей удаче!',
        nothingHere: 'Здесь ничего не осталось: ты большой брат, уже следящий за всем',
        anyTitle: (n: number): string => `${candidates(n)} во всех категориях`,
        shelfTitle: (n: number): string => `${candidates(n)} в этой категории`,
        pool: (n: number, shelves: number): string =>
          `${candidates(n)} ${shelves === 0 ? 'во всех категориях' : shelves === 1 ? 'в этой категории' : `в выбранных категориях (${shelves})`}`,
        meta: (category: string, count: number | undefined): string =>
          [category, count === undefined ? null : items(count), 'канонический список'].filter(Boolean).join(' · '),
        landed: (title: string): string => `Выпало: ${title}`,
        nothingLeft: (shelves: number): string =>
          `Ничего не осталось ${acrossShelves(shelves)}: ты уже отслеживаешь все канонические списки оттуда`,
        unreachable: 'Не удалось связаться с List Vault',
        curatedTip: 'Канонический список, созданный и поддерживаемый мясными мешками',
      },
      justOneFix: {
        title: 'Быстрая Доза',
        explain: 'Быстрая доза дофамина от самого короткого из незавершённого',
        why: (time: string): string => `Самый короткий незавершённый элемент -- ${time}, и ты можешь обтирать станок.`,
      },
      finalizer: {
        title: 'Добей Его!',
        explain: 'Добей оставшихся в списках, которые ближе всего к финишу',
        why: (percent: number, left: string): string => `Ближе всего к финишу: готово ${percent}%, осталось ${left}.`,
        whyComplete: 'Этот список закончен, так что второго раунда не будет',
        whyOngoing: 'Этот список не закончен, но ничего более завершабельного нет',
      },
      tired: {
        title: 'А Теперь Нечто Совсем Другое',
        explain: 'Устал туннелить один и тот же список и хочешь переключиться на что-нибудь другое?',
        tiredOf: 'Я устал от',
        pickList: 'Выбери список',
        pickTitle: 'Выбери список, который надоел',
        pickerKicker: 'ИЛИ?',
        pickerCount: (shown: number, total: number): string => `${shown} из ${total}`,
        pickerFilter: 'Найти виновника…',
        pickerNone: (query: string): string => `Нет списков, подходящих под ${query}.`,
        nothingElse: 'Больше предложить нечего: всё незавершённое из той же категории',
        whyBase: 'Другая категория',
        whyNeglected: 'и ты давно его не открывал',
        whyProgress: (percent: number, left: string): string => `готово ${percent}%, осталось ${left}`,
        whyFallback: 'Другая категория -- лучшее из оставшегося',
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
      saveFailed: 'Не удалось сохранить изменения',
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
        notSetNote: 'Не указана. Выбери платформу:',
        removeTip: (name: string): string => `Убрать ${name}`,
        search: (n: number): string => `Поиск по ${n} платформам`,
        inList: 'Из этого списка',
        common: 'Самые частые',
        matches: (n: number): string => `Найдено · ${n}`,
        moreFoot: (shown: number, total: number): string => `Показано ${shown} из ${total} -- уточни запрос.`,
        noMatch: (query: string): string => `Нет такой платформы ${query}. Попробуй код платформы или другое название`,
        sourceSays: (codes: string): string => (codes ? `Источник: ${codes}` : 'Источник молчит'),
        nextItem: 'Платформы по умолчанию',
        nextItemNote: 'Задай платформы по умолчанию для элементов, добавляемых вручную в этот список',
        nextField: (value: string): string => `Платформы по умолчанию для элементов, добавляемых вручную: ${value}`,
        nextTip: 'Платформы по умолчанию для элементов, добавляемых вручную',
        resetToSource: 'Сбросить',
        none: 'Нет',
        addPlatforms: (title: string): string => `Указать платформы: ${title}`,
        addPlatformsTip: 'Платформы нет -- нажмите, чтобы выбрать',
        addChoice: (label: string, title: string): string => `Указать ${label.toLowerCase()}: ${title}`,
        addChoiceTip: (label: string): string => `${label} не указан -- нажми, чтобы указать`,
      },
      itemActions: {
        details: (title: string): string => `Подробности: ${title}`,
        dragOnList: 'Тащи, чтобы переместить по списку',
        dragWithin: (group: string): string => `Тащи, чтобы изменить порядок внутри группы ${group}`,
        dragGroup: 'Тащи, чтобы переместить всю группу по списку',
        deleteGroupLabel: 'пусто',
        deleteGroupAria: 'Удалить пустую группу',
        deleteGroupTip: 'Удалить пустую группу -- в ней нет элементов',
        groupRemoved: (name: string): string => `Группа удалена: ${name}`,
        groupRestored: (name: string): string => `Группа восстановлена: ${name}`,
        renameGroupAria: (name: string): string => `Переименовать группу ${name}`,
        groupNameLabel: 'Название группы',
        groupRenamed: (from: string, to: string): string => `Группа ${from} переименована в ${to}`,
        groupRenameFailed: (name: string): string => `Не удалось переименовать группу ${name}`,
        groupCreated: (name: string): string => `Группа создана: ${name}`,
        groupRemoveFailed: (name: string): string => `Не удалось удалить группу: ${name}`,
        deleteGroupWithItems: (name: string): string => `Удалить группу ${name}`,
        groupDeleteKicker: 'Удалить группу',
        groupDeleteQuestion: (name: string): string => `Удалить ${name}?`,
        groupDeleteNote: (n: number, done: number): string =>
          `Вместе с группой будут удалены: ${items(n)}${done > 0 ? `, из них завершено -- ${done}` : ''}`,
        groupDeleteConfirm: 'Удалить',
        groupRemovedWithItems: (name: string, n: number): string => `Группа ${name} удалена вместе с элементами: ${n}`,
        edit: (title: string): string => `Изменить: ${title}`,
        remove: (title: string): string => `Удалить: ${title}`,
        infoKicker: 'Подробности',
        estimated: 'Длительность на глаз',
        runtimePending: '-',
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
          group ? `Добавлено: ${title} -- в группу ${group}` : `Добавлено: ${title}`,
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
        addGroup: 'Добавить группу',
        adding: 'Добавляю…',
        failed: 'Не удалось добавить элемент',
      },
      createGroup: (name: string): string => `+ Создать ${name}`,
      editList: 'Изменить Список',
      orderMenu: {
        kicker: 'Сброс списка',
        resetQuestion: 'Вернуть список в девственное состояние?',
        resetLead: {
          canonical: 'Назад к каноническому списку из List Vault',
          file: 'Назад к импортированному файлу',
          api: 'Назад к списку из поиска',
        },
        computing: 'Вычисляем, что изменится…',
        previewFailed: (message: string): string =>
          `Не удалось вычислить, что изменится (${message}). Сброс всё равно вернёт список к источнику`,
        removed: (n: number): string =>
          `${selectPlural(n, 'ru', { one: `будет удалён ${n} добавленный тобой элемент`, few: `будут удалены ${n} добавленных тобой элемента`, many: `будут удалены ${n} добавленных тобой элементов`, other: `будут удалены ${n} добавленных тобой элемента` })}`,
        restored: (n: number): string =>
          `${selectPlural(n, 'ru', { one: `вернётся ${n} удалённый тобой элемент`, few: `вернутся ${n} удалённых тобой элемента`, many: `вернутся ${n} удалённых тобой элементов`, other: `вернутся ${n} удалённых тобой элемента` })}`,
        cleared: (n: number): string =>
          `${selectPlural(n, 'ru', { one: `будет снята ${n} отметка «завершено»`, few: `будут сняты ${n} отметки «завершено»`, many: `будут сняты ${n} отметок «завершено»`, other: `будут сняты ${n} отметки «завершено»` })}`,
        joinCost: (parts: readonly string[]): string => {
          const sentence =
            parts.length <= 1
              ? `${parts[0]}.`
              : `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}.`
          return sentence.charAt(0).toUpperCase() + sentence.slice(1)
        },
        noCost: 'В этом списке нет добавленного, удалённого, или отмеченного как завершённое',
        resetEverything: 'Сбросить',
        sorted: 'Отсортировано по дате -- группы перемещены целиком',
        orderRestored: 'Порядок источника восстановлен',
        resetDone: 'Сброшено к источнику -- порядок, название, описание и отметки о завершении',
        undone: 'Сброс отменён',
        orderUndone: 'Порядок восстановлен',
        sortFailed: 'Не удалось отсортировать список',
        resetFailed: 'Не удалось сбросить список',
        undoFailed: 'Не удалось отменить',
      },
      moves: {
        movedTo: (title: string, position: number, total: number, group?: string): string =>
          `${title}: позиция ${position} из ${total}${group ? ` в группе ${group}` : ''}`,
        atEdge: (side: 'top' | 'bottom', group?: string): string =>
          `Уже ${side === 'top' ? 'в начале' : 'в конце'} ${group ? `группы ${group}` : 'списка'}`,
        movedOnList: 'Элемент перемещён',
        movedInside: (group: string): string => `Элемент перемещён внутри группы ${group}`,
        onlyInsideGroup: 'Менять порядок можно только внутри одной группы',
        undone: 'Перемещение отменено',
        saveFailed: 'Не удалось сохранить перемещение',
        undoFailed: 'Не удалось отменить перемещение',
      },
      moreMenu: {
        kicker: 'Действия со списком',
        edit: 'Изменить Список',
        export: 'Экспортировать Список',
        reorder: 'Упорядочить Список',
        reset: 'Сбросить Список',
        delete: 'Удалить Список',
        exportKicker: 'Экспорт Списка',
        exportNote:
          'Сохранить текущий список в формате YAML. Прогресс не сохраняется. Подходит для создания канонических списков и для спискообмена',
        download: 'Скачать Файл',
        copy: 'Копировать В Буфер',
        reorderKicker: 'Упорядочить список',
        reorderQuestion: 'Навести Порядок В Списке?',
        reorderHint:
          '- Группы отсортируются по самому раннему элементу. Содержимое групп тоже отсортируется внутри группы',
        reorderNote: '- Это одноразовая акция устрашения, которая не блокирует менять порядок вручную',
        cancel: 'Отмена',
        sortNow: 'Отсортировать По Дате',
        restoreSourceOrder: 'Вернуть Исходный Порядок',
        restoreHint: '- Исходный порядок отсортирует элементы в том порядке, в каком их отдаёт источник',
        deleteKicker: 'Удаление Списка',
        deleteQuestion: (title: string): string => `Удалить ${title}?`,
        deleteNote: (n: number, done: number): string =>
          n === 0 ? 'Список пуст' : `${items(n)} (закончено -- ${done}) улетучатся, как какашка на ветру`,
        keep: 'Оставить Список',
        confirmDelete: 'Удалить Список',
        itemCount: (n: number): string => items(n),
        saved: (fileName: string, n: number): string => `Сохранён ${fileName} -- ${items(n)}.`,
        copied: 'YAML-список скопирован в буфер обмена',
        copyFailed: 'Не удалось скопировать в буфер обмена. Попробуй cкачать файл?',
        exportFailed: 'Обнаружен злой таможенный контроль: не удалось экспортировать этот список',
        deleted: (title: string): string => `Удалено: ${title}`,
        restored: (title: string): string => `Восстановлено: ${title}`,
        deleteFailed: 'Обнаружен внезапный iddqd: не удалось удалить этот список',
        restoreFailed: 'Обнаружен сбой некромантии: не удалось восстановить список',
      },
      editPopover: {
        kicker: 'Изменить Список',
        title: 'Название',
        description: 'Описание (необязательно)',
        descriptionPlaceholder: 'Хорошее место для сведений о том, что входит в список, а что нет',
        status: 'Статус (необязательно)',
        renamed: (title: string): string => `Переименовано: ${title}`,
        descriptionUpdated: 'Описание обновлено',
        statusMarked: (status: 'complete' | 'ongoing'): string =>
          `Статус списка изменён на ${status === 'complete' ? 'Завершён' : 'Продолжается'}.`,
        statusCleared: 'Статус списка стал шрёдингеровским',
        listSaved: 'Список обновлён',
        reverted: (title: string): string => `Возвращено: ${title}`,
        saveFailed: 'Не удалось сохранить изменения списка',
        undoFailed: 'Не удалось отменить',
      },
      rail: {
        title: 'Перейти к',
        hide: 'Свернуть навигацию по группам',
        show: 'Распахнуть навигацию по группам',
        resize: 'Изменить размер навигации по группам',
      },
      filter: {
        label: 'Фильтр элементов',
        placeholder: 'Фильтр элементов…',
        total: (n: number): string => items(n),
        shown: (shown: number, total: number): string => `показано ${shown} из ${total}`,
        groupShown: (shown: number, total: number): string => `${shown} из ${total}`,
        nothing: (text: string): string =>
          text.trim() ? `Ничего подходящего под ${text.trim()}.` : 'Ничего подходящего под этот фильтр',
        all: 'Все',
        clearTip: 'Показать элементы всех типов',
        hideOption: (name: string): string => `Скрыть: ${name}`,
        alsoShowOption: (name: string): string => `Фильтр: ${name}`,
        facetPicks: (named: readonly string[], more: number): string =>
          more > 0 ? `${named.join(', ')} +${more}` : named.join(', '),
        facetDropdownLabel: (facet: string, summary: string): string => `${facet}: ${summary}`,
        facetPickTip: 'Выбери типы для фильтра',
        facetCount: (facet: string, n: number): string => `${facet} · ${n}`,
        facetLabels: {
          Type: 'Тип',
          Medium: 'Категория',
          Language: 'Язык',
          Platform: 'Платформа',
          Recording: 'Запись',
        },
        optionLabels: {
          Untagged: '(хз)',
          MULTI: 'МУЛЬТИ',
          Movie: 'Фильм',
          TV: 'Сериал',
          Animation: 'Анимация',
          Documentary: 'Документалка',
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
          Live: 'Концерт',
          Compilation: 'Сборник',
        },
        collapseAll: 'Свернуть',
        expandAll: 'Развернуть',
        collapseAllTip: 'Свернуть все группы ниже',
        expandAllTip: 'Развернуть все группы ниже',
      },
      linkBack: { before: 'Этот список приехал из ', after: '. Ты мог его потрогать, поэтому теперь он твой' },
      sourceCopyNotice: (p: { days: number; source: string }): string => `Копия из источника обновляется каждые ${p.days} дн., этого требует ${p.source}`,
      checkForUpdates: 'Проверить Обновления',
      order: 'Порядок',
      more: 'Ещё',
      close: 'Закрыть',
      updates: {
        checkFailed: 'Не удалось проверить обновления',
        checking: 'Проверяем обновления…',
        nothingNew: 'Обновлений не найдено',
        addFailed: 'Не шмог поставить обновления',
        foundBand: (n: number): string => `Найдено: ${newItems(n)}.`,
        updateList: 'Обновить список',
        dismissFound: 'Закрыть',
        appliedToast: (n: number): string => `Добавлено: ${newItems(n)}.`,
        newBand: (n: number): string =>
          selectPlural(n, 'ru', { one: `Добавлен ${n} новый элемент`, few: `Добавлены ${n} новых элемента`, many: `Добавлено ${n} новых элементов`, other: `Добавлено ${n} новых элемента` }),
        markAllSeen: 'Убрать Отменку Новое',
        markedSeen: 'Отметка Новое убрана',
        markSeenFailed: 'Не удалось убрать отметку Новое с элементов',
      },
    },
    preview: {
      title: 'Поглядеть список',
      closeLabel: 'Закрыть',
      loading: 'Подсчитываем элементы…',
      noRuntime: '-',
      summary: (count: number, duration: string, estimated: boolean): string =>
        `${items(count)} · ${estimated ? '≈ ' : ''}${duration}`,
      addButton: 'Добавить Список',
      adding: 'Строим список…',
      nothingToAdd: 'Добавлять нечего: этот список пуст, как совесть миллиардера',
      loadFailedHeadline: 'Не удаётся поглядеть список',
      retry: 'Повторить',
      footer: (provenance: string): string => `${provenance}`,
      expandGroup: (label: string): string => `Развернуть: ${label}`,
      collapseGroup: (label: string): string => `Свернуть: ${label}`,
    },
    importFile: {
      chooseFile: 'Выбрать файл…',
      boxLabel: 'Или вставь YAML сюда',
      boxPlaceholder:
        'title: Все фильмы Джеки Чана\ncategory: movie\nitems:\n  - { title: Пьяный мастер, year: 1978 }',
      import: 'Импортировать',
      importing: 'Пошёл Импорт…',
      readOutFile: (name: string, size: string, l: string): string => `${name} · ${size} · ${l}`,
      readOutPasted: (l: string): string => `Вставлено · ${l}`,
      lines: (n: number): string => lines(n),
      footer:
        'Используй экспорт списка, чтобы создать файл со списком в формате YAML',
      otherCategoryKicker: 'Не Та Дырка',
      otherCategoryQuestion: (fileCategory: string): string => `Импортировать в ${fileCategory}?`,
      otherCategoryNote: (current: string, fileCategory: string): RichText => [
        'Мы в разделе ',
        { strong: `${current}` },
        ', а импортируемый список -- из раздела ',
        { strong: `${fileCategory}` },
        '.',
      ],
      back: 'Назад',
      importFailed: 'Не удалось импортировать этот файл, поэтому список нельзя создать',
    },
    createList: {
      title: (category: string): string => `Новый список: ${category}`,
      searchTab: (): string => 'Искать',
      handTab: 'Вбить Руками',
      importTab: 'Импортировать',
      closeLabel: 'Закрыть',
    },
    home: {
      title: 'Мои Списки',
      newList: 'Новый Список',
      checkForUpdates: 'Проверить обновления',
      checkingUpdates: 'Проверяем обновления…',
      loadFailed: 'Не удалось загрузить твои списки',
      retry: 'Повторить',
      listCount: (n: number): string => lists(n),
      summary: (listCount: string, done: number, total: number, timeLeft: string | null): string =>
        timeLeft
          ? `${listCount} · готово ${done} из ${total} · осталось ${timeLeft}`
          : `${listCount} · готово ${done} из ${total}`,
      needHelp: 'Нужна помощь?',
      helpButtons: {
        tiredBoss: 'Я Устал, Босс',
        finalizer: 'Финализатор',
        justOneFix: 'Скорострел',
        surpriseMe: 'Удиви Меня',
      },
      orphanedTitle: 'Без категории',
      orphanedNote: 'такой категории больше нет',
      pendingBand: (n: number): string => ` -- новых элементов: ${n}.`,
      updateList: 'Обновить Список',
      dismissUpdate: 'Закрыть',
      noNewUpstream: 'Там наверху ничего нового',
      updateApplied: (n: number, title: string): string =>
        `Добавлено: ${newItems(n)} -- в ${title}.`,
      updateFailed: 'Не удалось обновить этот список',
      checkPartial: (titles: readonly string[]): string =>
        `Не удалось проверить: ${lists(titles.length)}: ${titles.join(', ')}`,
      checkUpdatesFailed: 'Не удалось проверить обновления',
    },
  },
}
