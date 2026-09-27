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
  shelves === 0 ? 'ни на одной полке' : shelves === 1 ? 'на этой полке' : `на выбранных полках (${shelves})`

export const ru: Locale = {
  app: {
    loading: 'Загрузка…',
    unknownError: 'Что-то пошло не так',
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
    searchFailed: 'Поиск не удался',
    defaultPlaceholder: 'Поиск…',
    placeholders: {
      movie: 'Актёр, режиссёр или серия фильмов…',
      music: 'Группа или исполнитель…',
      book: 'Автор…',
    },
    languageLabel: 'Язык',
    allLanguages: 'Все',
    includeUnknown: 'Включить и книги без указанного языка',
    discographyTypesLabel: 'Также включить',
    includeEp: 'EP',
    includeSingle: 'Синглы',
    includeLive: 'Концертные альбомы',
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
    'search.queryRequired': (): string => 'Введите, что искать.',
    'search.unavailable': (p: { category: string }): string =>
      `Поиск недоступен для категории «${p.category}». Добавьте элементы вручную.`,
    'search.unavailableOffline': (p: { category: string }): string =>
      `Поиск недоступен для категории «${p.category}», а библиотека сообщества не отвечает. Добавьте элементы вручную.`,
    'list.unknownCategory': (p: { key: string }): string =>
      `Неизвестная категория ‘${p.key}’, список нельзя импортировать.`,
    'list.sourceEmpty': (p: { title: string }): string =>
      `Для «${p.title}» нечего импортировать.`,
    'list.fileInvalid': (): string =>
      'Файл не в формате списка, список нельзя импортировать.',
    'list.fileSyntax': (p: { line?: number }): string =>
      p.line
        ? `Синтаксическая ошибка в строке ${p.line}, список нельзя импортировать.`
        : 'Синтаксическая ошибка, список нельзя импортировать.',
    'list.fileNoItems': (): string => 'Элементов не найдено, список нельзя импортировать.',
    'list.fileMissingTitle': (): string => 'Название не найдено, список нельзя импортировать.',
    'list.fileItemMissingTitle': (p: { index: number }): string =>
      `У элемента ${p.index} нет названия, список нельзя импортировать.`,
    'list.fileItemNotesTooLong': (p: { index: number; max: number }): string =>
      `Заметки к элементу ${p.index} длиннее ${p.max} символов, список нельзя импортировать.`,
    'list.alreadyExists': (): string =>
      'Такой список уже снова существует — ничего не восстановлено.',
    'group.nameEmpty': (): string => 'У группы должно быть название.',
    'group.nameTaken': (): string => 'В этом списке уже есть группа с таким названием.',
    'group.notEmpty': (): string =>
      'Удалить можно только пустую группу — сначала перенесите или удалите её элементы.',
    'group.orderMismatch': (): string =>
      'Группы изменились с тех пор, как вы открыли список, — перезагрузите его и повторите.',
    'reset.unavailable': (): string =>
      'У этого списка нет источника для сброса — он создан вручную или появился раньше, чем источник стал сохраняться.',
    'refresh.handMadeList': (): string =>
      'Этот список создан вручную, сверять его не с чем.',
    'refresh.searchUnavailable': (p: { category: string }): string =>
      `Поиск недоступен для категории «${p.category}».`,
  },

  request: {
    unreachable: 'Нет связи с сервером. Он запущен?',
    failed: (status: number): string => `Запрос не удался (${status})`,
    unknown: 'Что-то пошло не так.',
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
      headline: 'Что-то пошло не так',
      explanation: 'В Listulator произошла непредвиденная ошибка. Ваши списки сохранены; обычно помогает перезагрузка.',
      reload: 'Перезагрузить',
    },
    meter: {
      label: (done: number, total: number): string => `${done} из ${total} готово`,
      noteCapped: (cap: number, perCell: number): string => `${cap} ячеек ≈ по ${perCell} элем. в каждой`,
      noteUncapped: 'Одна ячейка — один элемент',
    },
    progress: {
      count: (done: number, total: number, percent: number): string =>
        total ? `${done}/${total} (${percent}%)` : `${done}/${total}`,
      left: (duration: string): string => `осталось ${duration}`,
      allDone: '✓ Всё готово',
      doneForNow: '✓ Пока всё',
    },
    status: {
      complete: 'Завершён',
      ongoing: 'Продолжается',
    },
    marks: {
      curated: 'Подборка — ведётся вручную в библиотеке сообщества',
      byHand: 'Создан вручную — без источника',
      manual: 'Добавлен вручную — не восстанавливается из источника',
      newCount: (n: number): string => `${n} НОВ.`,
      newItem: 'НОВОЕ',
      allDone: '✓ Всё готово',
    },
    common: {
      close: 'Закрыть',
      keep: 'Оставить',
      toggleDone: 'Отметить как готовое',
      backToLayer: 'Назад к этому слою',
      clickToEdit: 'Нажмите, чтобы изменить',
      showKey: 'Показать ключ',
      hideKey: 'Скрыть ключ',
    },
    statusPicker: {
      notKnown: 'Неизвестно',
      notKnownNote: 'Оставьте пустым, если не знаете.',
      ongoingNote: 'В источнике могут появиться новые элементы.',
      completeNote: 'Завершён — новых элементов не будет.',
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
      reduceMotion: 'Меньше анимации — слои сменяются без перехода',
      language: 'Язык',
      languages: {
        en: 'English',
        ru: 'Русский',
        de: 'Deutsch',
      },
      keys: {
        title: 'API-ключи',
        placeholder: 'Вставьте ключ',
        clientIdPlaceholder: 'Client ID',
        clientSecretPlaceholder: 'Client secret',
        infoLabel: 'Для чего этот ключ',
        how: 'Как?',
        howTitle: 'Где взять этот ключ',
        howHeading: 'Где взять',
        test: 'Проверить',
        status: {
          untested: 'Не проверен',
          testing: 'Проверка',
          working: 'Работает',
          rejected: 'Отклонён',
          unreachable: 'Нет связи',
          failed: 'Сбой',
        },
        usedNote: (used: string): string => `Наполняет списки: ${used}.`,
        missNote:
          'Без него эти категории всё равно можно собрать вручную — не работает только поиск по каталогу.',
        sources: {
          tmdb: {
            name: 'TMDB',
            used: 'фильмы, сериалы, анимация, документальное',
            host: 'themoviedb.org',
            steps: [
              'Создайте бесплатный аккаунт и откройте Settings → API.',
              'Запросите ключ — для личного использования одобряют сразу.',
              'Скопируйте API Read Access Token и вставьте его сюда.',
            ],
          },
          igdb: {
            name: 'IGDB',
            used: 'игры',
            host: 'dev.twitch.tv',
            steps: [
              'IGDB работает через авторизацию Twitch — войдите в консоль разработчика Twitch.',
              'Зарегистрируйте приложение, чтобы получить Client ID и секрет.',
              'Вставьте оба сюда и нажмите «Проверить».',
            ],
          },
          comicVine: {
            name: 'Comic Vine',
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
            used: 'плейлисты и каналы',
            host: 'console.cloud.google.com',
            steps: [
              'Создайте проект в консоли Google Cloud.',
              'Включите для него YouTube Data API v3.',
              'Credentials → Create credentials → API key, затем вставьте ключ сюда.',
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
        'dark-orange': 'Тёмное оранжевое',
        'dark-green': 'Тёмное зелёное',
        'dark-blue': 'Тёмное синее',
        'dark-violet': 'Тёмное фиолетовое',
        'light-bone': 'Светлая кость',
      },
    },
    layerStack: {
      untitledListTab: 'Список',
    },
    categoryPicker: {
      title: 'Выберите категорию',
      subline:
        'Категории встроены. Числа показывают, сколько у вас списков в каждой категории.',
      firstRunTitle: 'Пока ничего не отслеживается — выберите полку и наполните её',
      firstRunSubline:
        'Каждая категория строит списки из своего источника. Мега — для франшиз на стыке медиа: одна полка для фильмов, игр и комиксов вместе.',
      byHand: 'вручную',
      countTitle: 'Списков на этой полке',
      closeLabel: 'Закрыть',
    },
    search: {
      queryLabel: (source: string): string => `Поиск: ${source}`,
      searchButton: 'Искать',
      resultsCount: (n: number): string => results(n),
      itemsKicker: 'элементов',
      countLoading: 'Считаем элементы…',
      expandRow: (title: string): string => `Показать подробности: ${title}`,
      previewButton: 'Предпросмотр',
      previewTab: (title: string): string => `Предпросмотр: ${title}`,
      addButton: 'Добавить список',
      nothingToAdd: 'Добавлять нечего — в этом источнике нет элементов для импорта',
      previewUnavailable:
        'Этот источник не показывает элементы до импорта. Добавьте список — удалить неудачный стоит одного клика.',
      curatedTitle: 'Подборка',
      curatedProvenance: 'Подборка · ведётся вручную в библиотеке сообщества',
      sourceProvenance: (source: string): string => `Из источника: ${source}`,
      /** Where a curated-only category (Mega) searches: the tile footer and the Search tab. */
      librarySource: 'Библиотека сообщества',
      importing: 'Собираем список…',
      searching: 'Ищем…',
      noKeyHeadline: (source: string): string => `Для поиска нужен ключ ${source}`,
      noKeyDesktop: (category: string): string =>
        `Добавьте ключ в настройках, чтобы искать в категории «${category}». А пока элементы можно добавлять вручную.`,
      noKeyWeb: (category: string): string =>
        `Для поиска в категории «${category}» нужен API-ключ в файле .env сервера. А пока элементы можно добавлять вручную.`,
      offlineHeadline: (category: string): string => `Сейчас нельзя искать в категории «${category}»`,
      offlineDesktop: (category: string): string =>
        `Для поиска в категории «${category}» нужен API-ключ (добавьте свой в настройках), а библиотека подборок сообщества недоступна. Проверьте соединение или добавьте элементы вручную.`,
      offlineWeb: (category: string): string =>
        `Для поиска в категории «${category}» нужен API-ключ в файле .env сервера, а библиотека подборок сообщества недоступна. Проверьте соединение или добавьте элементы вручную.`,
      libraryUnreachable:
        'Не удалось связаться с библиотекой сообщества, поэтому подборок в этих результатах нет.',
      nothingFoundLibraryDown:
        ' Библиотека сообщества недоступна, поэтому подборки не искались.',
      openSettings: 'Открыть настройки',
      nothingFoundHeadline: 'Ничего не найдено',
      nothingFoundBody: 'Попробуйте другое написание или добавьте вручную.',
      nothingToImportHeadline: 'Нечего импортировать',
      retry: 'Повторить',
      dismiss: 'Закрыть',
    },
    addByHand: {
      titleLabel: 'Название списка',
      titlePlaceholder: 'Все фильмы Джеки Чана',
      descriptionLabel: 'Описание',
      descriptionPlaceholder: 'Необязательно',
      itemsLabel: 'Элементы — по одному в строке',
      itemsPlaceholder: 'Ранние фильмы:\nПьяный мастер\nИстория полицейского\n\nПоздние фильмы:\nЧасы пик',
      itemsHint: 'Строка, оканчивающаяся двоеточием или начинающаяся с #, открывает группу.',
      statusLabel: 'Статус',
      create: 'Создать список',
      creating: 'Создаём…',
      count: (n: number, g: number): string => {
        const itemText = items(n)
        if (g === 0) return itemText

        return `${itemText} в ${selectPlural(g, 'ru', { one: `${g} группе`, few: `${g} группах`, many: `${g} группах`, other: `${g} группах` })}`
      },
      noItems: 'Элементов пока нет — их можно добавить позже.',
      assumedDuration: (duration: string): string =>
        `Считаем, что на каждый уйдёт около ${duration}; позже это можно поправить.`,
      createFailed: 'Не удалось создать список',
    },
    helper: {
      topPick: 'Лучший вариант',
      alternates: 'Запасные',
      openList: 'Открыть список',
      notThat: 'Не это',
      backToStrongest: 'Снова лучший вариант',
      nothingUnfinished: 'Незаконченного не осталось — добавьте список.',
      loading: 'Ищем, что предложить…',
      failed: 'Не удалось получить предложение',
      retry: 'Ещё раз',
      surprise: {
        title: 'Сюрприз, засранец!',
        explain: 'Случайная подборка, которую вы ещё не отслеживаете. Миллионы мух не могут ошибаться, а?',
        any: 'Любая',
        category: 'КАТЕГОРИЯ',
        spin: 'Крутить',
        spinAgain: 'Ещё раз',
        spinning: 'Крутим…',
        thisOne: 'Эту',
        idleMeta: 'Крутите — и выиграйте!',
        note: 'Выберите категории и испытайте удачу!',
        nothingHere: 'Здесь ничего не осталось — вы отслеживаете всё',
        anyTitle: (n: number): string => `${candidates(n)} на всех полках`,
        shelfTitle: (n: number): string => `${candidates(n)} на этой полке`,
        pool: (n: number, shelves: number): string =>
          `${candidates(n)} ${shelves === 0 ? 'на всех полках' : shelves === 1 ? 'на этой полке' : `на выбранных полках (${shelves})`}`,
        meta: (category: string, count: number | undefined): string =>
          [category, count === undefined ? null : items(count), 'подборка'].filter(Boolean).join(' · '),
        landed: (title: string): string => `Выпало: ${title}`,
        nothingLeft: (shelves: number): string =>
          `Ничего не осталось ${acrossShelves(shelves)} — вы уже отслеживаете все подборки оттуда.`,
        unreachable: 'Не удалось связаться с библиотекой сообщества.',
        curatedTip: 'Подборка — ведётся вручную в библиотеке сообщества',
      },
      justOneFix: {
        title: 'Быстрая доза',
        explain: 'Быстрая доза дофамина от самого короткого незаконченного из того, что вы отслеживаете',
        why: (time: string): string => `Самый короткий незаконченный элемент — ${time}, и он готов.`,
      },
      finalizer: {
        title: 'Добей его!',
        explain: 'Доведите до конца хвосты в списках, которые ближе всего к финишу',
        why: (percent: number, left: string): string => `Ближе всего к финишу: готово ${percent}%, осталось всего ${left}.`,
        whyComplete: 'Список завершён, так что законченное так и останется законченным.',
        whyOngoing: 'Помечен как продолжающийся — ничего более завершимого нет.',
      },
      tired: {
        title: 'А теперь нечто совершенно другое',
        explain: 'Устали от одного списка и хотите чего-то другого — из другого медиа?',
        tiredOf: 'Мне надоело проходить',
        pickList: 'Выберите список',
        pickTitle: 'Выберите список, который надоел',
        pickerKicker: 'ИЛИ?',
        pickerCount: (shown: number, total: number): string => `${shown} из ${total}`,
        pickerFilter: 'Фильтр списков…',
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
      empty: 'Элементов пока нет.',
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
        notSetNote: 'Не указана. Выберите одну или несколько.',
        removeTip: (name: string): string => `Убрать ${name}`,
        search: (n: number): string => `Поиск по ${n} платформам`,
        inList: 'В этом списке',
        common: 'Самые частые',
        matches: (n: number): string => `Найдено · ${n}`,
        moreFoot: (shown: number, total: number): string => `Показано ${shown} из ${total} — уточните запрос.`,
        noMatch: (query: string): string =>
          `Нет платформы «${query}». Список фиксирован — попробуйте код или другое название.`,
        sourceSays: (codes: string): string => (codes ? `В источнике: ${codes}.` : 'В источнике платформ нет.'),
        nextItem: 'Следующий добавленный элемент',
        nextItemNote: 'Каждый новый элемент этого списка начнётся с этого. Один элемент меняется в его окне правки.',
        nextField: (value: string): string => `Платформа для следующего элемента: ${value}`,
        nextTip: 'Платформа для следующего элемента — запоминается для этого списка',
        resetToSource: 'Вернуть как в источнике',
        none: 'Нет',
        addPlatforms: (title: string): string => `Указать платформы: ${title}`,
        addPlatformsTip: 'Платформа не указана — нажмите, чтобы указать',
        addChoice: (label: string, title: string): string => `Указать ${label.toLowerCase()}: ${title}`,
        addChoiceTip: (label: string): string => `${label} не указан — нажмите, чтобы указать`,
      },
      itemActions: {
        details: (title: string): string => `Подробности: ${title}`,
        dragOnList: 'Перетащите, чтобы переместить элемент в списке',
        dragWithin: (group: string): string => `Перетащите, чтобы изменить порядок внутри группы «${group}»`,
        dragGroup: 'Перетащите, чтобы переместить группу в списке',
        deleteGroupLabel: 'пусто',
        deleteGroupAria: 'Удалить пустую группу',
        deleteGroupTip: 'Удалить пустую группу — в ней нет элементов',
        groupRemoved: (name: string): string => `Группа удалена: ${name}`,
        groupRestored: (name: string): string => `Группа восстановлена: ${name}`,
        groupRemoveFailed: (name: string): string => `Не удалось удалить группу: ${name}`,
        deleteGroupWithItems: (name: string): string => `Удалить группу ${name}`,
        groupDeleteKicker: 'Удалить группу',
        groupDeleteQuestion: (name: string): string => `Удалить группу «${name}»?`,
        groupDeleteNote: (n: number, done: number): string =>
          `Вместе с ней будут удалены: ${items(n)}${done > 0 ? `, из них готово — ${done}` : ''}. Отменить можно в течение 8 секунд.`,
        groupDeleteConfirm: 'Удалить группу',
        groupRemovedWithItems: (name: string, n: number): string => `Группа ${name} удалена вместе с элементами: ${n}`,
        edit: (title: string): string => `Изменить: ${title}`,
        remove: (title: string): string => `Удалить: ${title}`,
        infoKicker: 'Подробности',
        estimated: 'Длительность — оценка; измените элемент, чтобы указать настоящую.',
        editTitle: 'Название',
        editMinutes: 'Минуты',
        editGroup: 'Группа',
        discard: 'Отменить',
        save: 'Сохранить',
        saved: (title: string): string => `Изменения сохранены: ${title}`,
        undo: 'Отменить действие',
        removed: (title: string): string => `Удалено: ${title}`,
        restored: (title: string): string => `Восстановлено: ${title}`,
        added: (title: string, group: string | null): string =>
          group ? `Добавлено: ${title} — в группу «${group}»` : `Добавлено: ${title}`,
        removeFailed: (title: string): string => `Не удалось удалить: ${title}`,
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
        resetQuestion: 'Сбросить список к источнику?',
        resetLead: {
          canonical: 'К актуальному файлу в библиотеке сообщества. Вы получите то, что в файле сейчас.',
          file: 'К файлу, который вы импортировали.',
          api: 'К тому виду, в котором список появился.',
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
        noCost: 'Добавленное, удалённое и отмеченное готовым вами не затрагивается.',
        undoNote: 'Отменить можно в течение 8 секунд.',
        resetOrder: 'Сбросить порядок',
        resetEverything: 'Сбросить всё',
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
        movedOnList: 'Перемещено в списке.',
        movedInside: (group: string): string => `Перемещено внутри группы «${group}».`,
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
          'Сохраните этот список в формате YAML. Ваш прогресс в него не входит. Удобно для предложений в общую библиотеку.',
        download: 'Скачать файл',
        copy: 'Копировать в буфер',
        reorderKicker: 'Упорядочить список',
        reorderQuestion: 'Отсортировать этот список по хронологии?',
        reorderHint:
          'Группы перемещаются целиком — по самому раннему элементу, и внутри каждой группы элементы тоже сортируются. Ничего не расформировывается.',
        reorderNote: 'Разовое действие — список не останется отсортированным. Отменить можно в течение 8 секунд.',
        cancel: 'Отмена',
        sortNow: 'Отсортировать',
        deleteKicker: 'Удаление списка',
        deleteQuestion: (title: string): string => `Удалить «${title}»?`,
        deleteNote: (n: number, done: number): string =>
          n === 0
            ? 'Список пуст. Отменить можно в течение 8 секунд.'
            : `Вместе с ним уйдут: ${items(n)}, из них готово — ${done}. Отменить можно в течение 8 секунд.`,
        keep: 'Оставить',
        confirmDelete: 'Удалить список',
        itemCount: (n: number): string => items(n),
        saved: (fileName: string, n: number): string => `Сохранён ${fileName} — ${items(n)}.`,
        copied: 'YAML скопирован в буфер обмена.',
        copyFailed: 'Не удалось скопировать — попробуйте «Скачать файл».',
        exportFailed: 'Не удалось экспортировать список',
        deleted: (title: string): string => `Удалено: «${title}».`,
        restored: (title: string): string => `Восстановлено: ${title}`,
        deleteFailed: 'Не удалось удалить список',
        restoreFailed: 'Не удалось восстановить список',
      },
      editPopover: {
        kicker: 'Изменить список',
        title: 'Название',
        description: 'Описание (необязательно)',
        descriptionPlaceholder: 'О чём этот список — строка-другая',
        status: 'Статус (необязательно)',
        renamed: (title: string): string => `Переименовано: «${title}».`,
        descriptionUpdated: 'Описание обновлено.',
        statusMarked: (status: 'complete' | 'ongoing'): string =>
          `Отмечен как ${status === 'complete' ? 'завершённый' : 'продолжающийся'}.`,
        statusCleared: 'Статус снят.',
        reverted: (title: string): string => `Возвращено: ${title}`,
        saveFailed: 'Не удалось сохранить изменения списка',
        undoFailed: 'Не удалось отменить',
      },
      rail: {
        title: 'Перейти к',
        hide: 'Свернуть панель перехода',
        show: 'Показать панель перехода',
        resize: 'Изменить ширину панели перехода',
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
        clearTip: 'Сбросить фильтр — показать всё',
        hideOption: (name: string): string => `Скрыть: ${name}`,
        alsoShowOption: (name: string): string => `Показать также: ${name} — можно включить сколько угодно`,
        facetPicks: (named: readonly string[], more: number): string =>
          more > 0 ? `${named.join(', ')} +${more}` : named.join(', '),
        facetDropdownLabel: (facet: string, summary: string): string => `${facet}: ${summary}`,
        facetPickTip: 'Выбрать, что показывать',
        facetCount: (facet: string, n: number): string => `${facet} · ${n}`,
        facetLabels: {
          Type: 'Тип',
          Medium: 'Медиа',
          Language: 'Язык',
          Platform: 'Платформа',
          Recording: 'Запись',
        },
        optionLabels: {
          Untagged: 'Без метки',
          MULTI: 'МУЛЬТИ',
          Unknown: 'Неизвестно',
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
        collapseAll: 'Свернуть все',
        expandAll: 'Развернуть все',
        collapseAllTip: 'Свернуть все группы',
        expandAllTip: 'Развернуть все группы',
      },
      checkForUpdates: 'Проверить обновления',
      order: 'Порядок',
      more: 'Ещё',
      close: 'Закрыть',
      updates: {
        checkFailed: 'Не удалось проверить обновления',
        nothingNew: 'В источнике нет новых элементов.',
        addFailed: 'Не удалось добавить',
        foundBand: (n: number): string => `Найдено: ${newItems(n)}.`,
        updateList: 'Обновить список',
        dismissFound: 'Закрыть',
        appliedToast: (n: number): string => `Добавлено: ${newItems(n)}.`,
        newBand: (n: number): string =>
          `${selectPlural(n, 'ru', { one: `Добавлен ${n} новый элемент`, few: `Добавлены ${n} новых элемента`, many: `Добавлено ${n} новых элементов`, other: `Добавлено ${n} новых элемента` })}. Что-то сортировали вручную? Проверьте, не затронуто ли это`,
        markAllSeen: 'Отметить всё просмотренным',
        markedSeen: 'Всё отмечено просмотренным',
        markSeenFailed: 'Не удалось отметить просмотренным',
      },
    },
    preview: {
      title: 'Предпросмотр',
      closeLabel: 'Закрыть',
      loading: 'Перечисляем элементы…',
      summary: (count: number, duration: string, estimated: boolean): string =>
        `${items(count)} · ${estimated ? '≈ ' : ''}${duration}`,
      addButton: 'Добавить список',
      adding: 'Собираем список…',
      nothingToAdd: 'Добавлять нечего — в этом источнике нет элементов для импорта',
      loadFailedHeadline: 'Не удаётся показать предпросмотр',
      retry: 'Повторить',
      footer: (provenance: string): string => `${provenance}. «Добавить список» создаёт ровно этот список.`,
      expandGroup: (label: string): string => `Развернуть: ${label}`,
      collapseGroup: (label: string): string => `Свернуть: ${label}`,
    },
    importFile: {
      chooseFile: 'Выбрать файл…',
      boxLabel: 'YAML',
      boxPlaceholder:
        'title: Все фильмы Джеки Чана\ncategory: movie\nitems:\n  - { title: Пьяный мастер, year: 1978 }',
      import: 'Импортировать',
      importing: 'Импортируем…',
      readOutFile: (name: string, size: string, l: string): string => `${name} · ${size} · ${l}`,
      readOutPasted: (l: string): string => `Вставлено · ${l}`,
      lines: (n: number): string => lines(n),
      footer:
        'Списки Listulator хранятся в YAML-файлах. Экспорт записывает файл, импорт читает его обратно как новый список.',
      otherCategoryKicker: 'Другой раздел',
      otherCategoryQuestion: (fileCategory: string): string => `Импортировать в «${fileCategory}»?`,
      otherCategoryNote: (current: string, fileCategory: string): RichText => [
        'Текущий раздел — ',
        { strong: `«${current}»` },
        ', а импортируемый список из раздела ',
        { strong: `«${fileCategory}»` },
        '.',
      ],
      back: 'Назад',
      importFailed: 'Не удалось импортировать файл, список нельзя импортировать.',
    },
    createList: {
      title: (category: string): string => `Новый список: ${category}`,
      searchTab: (source: string): string => `Поиск: ${source}`,
      handTab: 'Вручную',
      importTab: 'Импорт файла',
      closeLabel: 'Закрыть',
    },
    home: {
      title: 'Мои списки',
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
      noNewUpstream: 'В источнике нет новых элементов.',
      updateApplied: (n: number, title: string): string =>
        `Добавлено: ${newItems(n)} — в «${title}».`,
      updateFailed: 'Не удалось обновить этот список',
      checkPartial: (titles: readonly string[]): string =>
        `Не удалось проверить: ${lists(titles.length)}: ${titles.join(', ')}`,
      checkUpdatesFailed: 'Не удалось проверить обновления',
    },
  },
}
