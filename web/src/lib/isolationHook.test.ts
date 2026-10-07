import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadIsolationHook, type IpcMessage } from './isolationHook.testing.js'

/**
 * The desktop app's isolation hook (security review, Phase 19, 19.12.3: SR-002, 003, 004, 008; spike S1, DECISIONS
 * "Security review spike S1"). The window can ask the native side to open any database file, read or write any JSON file
 * and send a request through any proxy; the hook runs in the sandboxed isolation frame, sees every request before it is
 * encrypted and refuses what the app never sends. A refusal rewrites the command to one that does not exist (a hook that
 * throws leaves the caller waiting for ever: probe P7c).
 *
 * The allowed cases are the shapes the app really sends (read from the plugins' own JavaScript and the spike's counters);
 * the refused ones are the probes of the review and what each of them could grow into.
 */

const REFUSED = 'plugin:refused-by-listulator-hook|'
const DATABASE = 'sqlite:listulator.sqlite'
const { hook, warnings } = loadIsolationHook()

const message = (cmd: string, payload: unknown): IpcMessage => ({ cmd, callback: 1, error: 2, payload, options: {} })
const isRefused = (sent: IpcMessage): boolean => hook(sent).cmd.startsWith(REFUSED)
const passes = (sent: IpcMessage): boolean => {
  const out = hook(sent)

  return out.cmd === sent.cmd && out.payload === sent.payload
}

const sql = (cmd: 'select' | 'execute', query: unknown, values: unknown = [], db: unknown = DATABASE) =>
  message(`plugin:sql|${cmd}`, { db, query, values })

describe('what the app sends passes untouched', () => {
  it.each([
    ['sql load', message('plugin:sql|load', { db: DATABASE })],
    ['sql select', sql('select', 'SELECT id, title FROM lists WHERE user_id = $1', ['u'])],
    ['sql execute', sql('execute', 'INSERT INTO __local_migrations (tag, applied_at) VALUES ($1, $2)', ['0001', 1])],
    ['pragma foreign_keys', sql('execute', 'PRAGMA foreign_keys = ON')],
    ['store load, settings', message('plugin:store|load', { path: 'settings.json', options: { autoSave: true } })],
    ['store load, preferences', message('plugin:store|load', { path: 'preferences.json', options: { autoSave: true } })],
    ['store load, no options', message('plugin:store|load', { path: 'settings.json' })],
    ['store get_store', message('plugin:store|get_store', { path: 'settings.json' })],
    ['store get', message('plugin:store|get', { rid: 7, key: 'tmdbKey' })],
    ['store set', message('plugin:store|set', { rid: 7, key: 'tmdbKey', value: 'x' })],
    ['store save', message('plugin:store|save', { rid: 7 })],
    ['store reload', message('plugin:store|reload', { rid: 7, ignoreDefaults: undefined })],
    [
      'http fetch (the plugin sends every key, unset ones as undefined)',
      message('plugin:http|fetch', {
        clientConfig: {
          method: 'GET',
          url: 'https://musicbrainz.org/ws/2/artist?query=x&fmt=json',
          headers: [['user-agent', 'Listulator/0.1']],
          data: null,
          maxRedirections: undefined,
          connectTimeout: undefined,
          proxy: undefined,
          danger: undefined,
        },
      }),
    ],
    ['http fetch_send', message('plugin:http|fetch_send', { rid: 3 })],
    ['http fetch_read_body', message('plugin:http|fetch_read_body', { rid: 4 })],
    ['http fetch_cancel', message('plugin:http|fetch_cancel', { rid: 3 })],
    ['http fetch_cancel_body', message('plugin:http|fetch_cancel_body', { rid: 4 })],
    ['opener open_url', message('plugin:opener|open_url', { url: 'https://github.com/gerharar/listulator', with: undefined })],
    ['opener open_url with a query', message('plugin:opener|open_url', { url: 'https://openlibrary.org/search?q=dune&mode=everything' })],
  ])('%s', (_name, sent) => {
    expect(passes(sent)).toBe(true)
  })

  it.each(['plugin:window|is_fullscreen', 'plugin:window|set_fullscreen', 'plugin:window|close', 'plugin:event|listen', 'plugin:resources|close'])(
    'other commands are left to the permissions, not the hook: %s',
    (cmd) => {
      expect(passes(message(cmd, { label: 'main' }))).toBe(true)
    },
  )
})

describe('a refusal', () => {
  it('rewrites the command to one that does not exist, keeps the callbacks and drops the payload', () => {
    const out = hook(message('plugin:sql|load', { db: 'sqlite:/tmp/sr19-abs.sqlite' }))

    expect(out.cmd).toBe(`${REFUSED}refused`)
    expect([out.callback, out.error]).toEqual([1, 2])
    expect(out.payload).toEqual({})
  })

  it('says which command it refused in the frame’s own log, never what it carried', () => {
    warnings.length = 0
    hook(message('plugin:sql|load', { db: 'sqlite:/tmp/very-secret-name.sqlite' }))

    expect(warnings.join('\n')).toContain('plugin:sql|load')
    expect(warnings.join('\n')).not.toContain('very-secret-name')
  })

  it.each([null, undefined, 7, 'x', [], { callback: 1, error: 2 }, { cmd: 5, callback: 1, error: 2 }, { cmd: {}, callback: 1, error: 2 }])(
    'never throws, whatever it is given: %j',
    (odd) => {
      // A throw would leave the caller waiting for ever (probe P7c).
      expect(() => hook(odd as unknown as IpcMessage)).not.toThrow()
    },
  )
})

describe('the database (SR-002; probes P1, P2, P3b)', () => {
  it.each([
    'sqlite:/tmp/sr19-abs.sqlite',
    'sqlite:../../tmp/sr19-dotdot.sqlite',
    'sqlite:/tmp/sr19-attached.sqlite',
    'sqlite:listulator.sqlite ',
    ' sqlite:listulator.sqlite',
    'sqlite:Listulator.sqlite',
    'sqlite:LISTULATOR.SQLITE',
    'sqlite:listulator.sqlite?mode=ro',
    'sqlite:listulator.sqlite#x',
    'sqlite:./listulator.sqlite',
    'sqlite:sub/listulator.sqlite',
    'sqlite:listulator.sqlite\u0000.x',
    'sqlite:listulator\u200b.sqlite',
    'sqlite::memory:',
    'sqlite:',
    '',
    'listulator.sqlite',
    'postgres://x/y',
  ])('refuses to load %j', (db) => {
    expect(isRefused(message('plugin:sql|load', { db }))).toBe(true)
  })

  it.each([undefined, null, 5, ['sqlite:listulator.sqlite'], { toString: 'x' }, true])('refuses a database that is not a string: %j', (db) => {
    expect(isRefused(message('plugin:sql|load', { db }))).toBe(true)
  })

  it('refuses extra keys, a missing database, and a payload that is not an object', () => {
    expect(isRefused(message('plugin:sql|load', { db: DATABASE, extra: 1 }))).toBe(true)
    expect(isRefused(message('plugin:sql|load', {}))).toBe(true)
    expect(isRefused(message('plugin:sql|load', null))).toBe(true)
    expect(isRefused(message('plugin:sql|load', [DATABASE]))).toBe(true)
    expect(isRefused(message('plugin:sql|load', new Uint8Array([1, 2, 3])))).toBe(true)
    expect(isRefused(message('plugin:sql|load', { ['__proto__']: 1, db: DATABASE }))).toBe(true)
  })

  it('refuses a call on any database but the app’s own, for select and execute alike', () => {
    for (const cmd of ['select', 'execute'] as const) {
      expect(isRefused(sql(cmd, 'SELECT 1', [], 'sqlite:/tmp/other.sqlite'))).toBe(true)
      expect(isRefused(message(`plugin:sql|${cmd}`, { db: undefined, query: 'SELECT 1', values: [] }))).toBe(true)
    }
  })

  it('refuses `close` (closing every pool; the app never closes the database) and anything unknown', () => {
    expect(isRefused(message('plugin:sql|close', {}))).toBe(true)
    expect(isRefused(message('plugin:sql|close', { db: DATABASE }))).toBe(true)
    expect(isRefused(message('plugin:sql|something_new', { db: DATABASE }))).toBe(true)
    expect(isRefused(message('plugin:sql|', {}))).toBe(true)
  })

  it('refuses a malformed statement call', () => {
    expect(isRefused(message('plugin:sql|select', { db: DATABASE, query: 'SELECT 1' }))).toBe(false) // values default
    expect(isRefused(message('plugin:sql|select', { db: DATABASE, query: 'SELECT 1', values: 'x' }))).toBe(true)
    expect(isRefused(message('plugin:sql|select', { db: DATABASE, query: 'SELECT 1', values: [], extra: 1 }))).toBe(true)
    expect(isRefused(message('plugin:sql|select', { db: DATABASE, query: 5, values: [] }))).toBe(true)
    expect(isRefused(message('plugin:sql|select', { db: DATABASE, values: [] }))).toBe(true)
  })
})

describe('the SQL text (SR-002; probe P3b: ATTACH reaches any database file)', () => {
  const hostile: [string, string][] = [
    ['attach', "ATTACH DATABASE '/tmp/sr19-target.sqlite' AS x"],
    ['attach, lower case', "attach database '/tmp/x.sqlite' as x"],
    ['attach, mixed case', "AtTaCh '/tmp/x.sqlite' AS x"],
    ['attach after a comment', "/* hello */ ATTACH '/tmp/x.sqlite' AS x"],
    ['attach after a line comment', "-- hello\nATTACH '/tmp/x.sqlite' AS x"],
    ['attach in a second statement', "SELECT 1; ATTACH '/tmp/x.sqlite' AS x"],
    ['attach after a string that ends in a semicolon', "SELECT ';' ; ATTACH '/tmp/x.sqlite' AS x"],
    ['attach with newlines', "SELECT 1\n;\nATTACH\n'/tmp/x.sqlite'\nAS x"],
    ['attach after a doubled quote', "SELECT 'it''s'; ATTACH '/tmp/x.sqlite' AS x"],
    ['attach after a backslash that SQLite does not treat as an escape', "SELECT 'a\\'; ATTACH '/tmp/x.sqlite' AS x; SELECT '"],
    ['attach inside a CTE statement', "WITH t AS (SELECT 1) SELECT * FROM t; ATTACH '/tmp/x.sqlite' AS x"],
    ['explain attach', "EXPLAIN ATTACH '/tmp/x.sqlite' AS x"],
    ['detach', 'DETACH DATABASE x'],
    ['vacuum into (writes a copy of the database anywhere)', "VACUUM INTO '/tmp/copy.sqlite'"],
    ['vacuum', 'VACUUM'],
    ['load_extension', "SELECT load_extension('/tmp/evil.dylib')"],
    ['load_extension, upper case', "SELECT LOAD_EXTENSION('/tmp/evil.dylib')"],
    ['load_extension in a subquery', "SELECT * FROM (SELECT load_extension('/tmp/evil.dylib'))"],
    ['fts3_tokenizer', "SELECT fts3_tokenizer('simple')"],
    ['pragma writable_schema', 'PRAGMA writable_schema = ON'],
    ['pragma journal_mode', 'PRAGMA journal_mode = OFF'],
    ['pragma data_version', 'PRAGMA data_version'],
    ['pragma foreign_keys with a second pragma', 'PRAGMA foreign_keys = ON; PRAGMA writable_schema = ON'],
    ['a second statement of any kind', 'SELECT 1; SELECT 2'],
    ['a second statement after a comment', 'SELECT 1; /* x */ DROP TABLE lists'],
    ['an unterminated string that might hide the rest', "SELECT 'abc; ATTACH '/tmp/x' AS x"],
    ['an unterminated quoted identifier', 'SELECT "abc; ATTACH x'],
    ['an unterminated bracket identifier', 'SELECT [abc; ATTACH x'],
    ['a NUL that ends the statement for SQLite', "SELECT 1;\u0000 ATTACH '/tmp/x.sqlite' AS x"],
    ['a control character', "SELECT 1\u0001; ATTACH '/tmp/x.sqlite' AS x"],
    ['a vertical tab as whitespace', "SELECT 1;\u000bATTACH '/tmp/x.sqlite' AS x"],
    ['nothing at all', ''],
    ['only whitespace', '   \n  '],
    ['only a comment', '-- nothing'],
    ['a statement kind the app never sends', 'REINDEX'],
    ['a transaction control the app never sends', 'BEGIN'],
    ['a bare semicolon', ';'],
    ['a NUL alone, at the end', 'SELECT 1\u0000'],
    ['a NUL alone, in the middle', 'SELECT\u00001'],
    ['a NUL inside a string', "SELECT 'a\u0000b'"],
    ['a control character alone', 'SELECT\u0001 1'],
    ['a delete character alone', 'SELECT 1\u007f'],
    ['an escape character alone', 'SELECT 1\u001b[0m'],
    // Each forbidden word on its own, after a word that is allowed first, with nothing else wrong with the shape.
    ...['attach', 'detach', 'vacuum', 'load_extension', 'fts3_tokenizer'].flatMap((word): [string, string][] => [
      [`${word} after select`, `SELECT 1 ${word}`],
      [`${word} upper case after select`, `SELECT 1 ${word.toUpperCase()}`],
      [`${word} inside a CTE statement`, `WITH t AS (SELECT 1) ${word} x`],
      [`${word} inside an insert`, `INSERT INTO t SELECT 1 ${word}`],
      [`${word} after a comment inside a statement`, `SELECT 1 /* x */ ${word} -- y\n`],
    ]),
  ]

  it.each(hostile)('refuses %s', (_name, query) => {
    expect(isRefused(sql('execute', query))).toBe(true)
    expect(isRefused(sql('select', query))).toBe(true)
  })

  // The reader above is not SQLite's lexer, so any place where SQLite groups characters differently from it is a place text
  // can be read as "inside a string" by one and as code by the other (review of the fix batch, 2026-10-07). SQLite reads a
  // parameter mark followed by a name and a bracket (`$a(`, `@a(`, `:a(`, `#a(`) as one token that swallows quotes, `;` and
  // `--` up to the next space or `)`. The app sends only `$N` (and `?`, `?N`), so the reader accepts nothing else: any other
  // parameter form, and any character that SQL itself does not use, is refused instead of skipped as punctuation.
  describe('parameter marks and characters SQLite groups in its own way', () => {
    const refusedShapes: [string, string][] = [
      ['a named `$` parameter with a bracket', 'SELECT $a(x)'],
      ['a numbered `$` parameter with a bracket', 'SELECT $1(x)'],
      ['an `@` parameter with a bracket', 'SELECT @a(x)'],
      ['a `:` parameter with a bracket', 'SELECT :a(x)'],
      ['a `#` parameter with a bracket', 'SELECT #a(x)'],
      ['a lone quote after such a parameter', "SELECT $1(')"],
      ['a lone double quote after such a parameter', 'SELECT $1(")'],
      ['a lone quote after an `@` parameter', "SELECT @a(')"],
      ['a lone quote after a `:` parameter', "SELECT :a(')"],
      ['a `$` parameter with a name', 'SELECT $a FROM lists'],
      ['a `$` parameter that is a number then a name', 'SELECT $1a FROM lists'],
      ['a `$` parameter that is a number then `::`', 'SELECT $1::a FROM lists'],
      ['a `$` with nothing after it', 'SELECT $ FROM lists'],
      ['an `@` parameter', 'SELECT @a FROM lists'],
      ['a `:` parameter', 'SELECT :a FROM lists'],
      ['a `#` mark', 'SELECT #a FROM lists'],
      ['a backslash outside a string', 'SELECT \\ FROM lists'],
      ['a caret', 'SELECT 1 ^ 2'],
      ['a curly bracket', 'SELECT {1}'],
      ['a closing square bracket on its own', 'SELECT 1]'],
    ]

    it.each(refusedShapes)('refuses %s', (_name, query) => {
      expect(isRefused(sql('execute', query))).toBe(true)
      expect(isRefused(sql('select', query))).toBe(true)
    })

    it('refuses these marks even where a hostile word would follow in the text', () => {
      for (const mark of ['$a(', '$1(', '@a(', ':a(', '#a(']) {
        expect(isRefused(sql('execute', `SELECT ${mark}x) FROM lists`)), mark).toBe(true)
      }
    })

    it('still lets the parameter forms the app sends through, next to every kind of neighbour', () => {
      for (const query of [
        'select * from "lists" where "id" = $1',
        'select * from "lists" where "id" = $12 and "name" = $2',
        'select * from "lists" where ("id" = $1)',
        'select * from "lists" where "id" in ($1, $2, $3)',
        'select lower($1) from "lists"',
        'select * from "lists" where "id" = $1;',
        'insert into "t" ("a", "b") values ($1, $2) returning "a"',
        'select * from "lists" where "id" = ?',
        'select * from "lists" where "id" = ?1 and "name" = ?2',
        'select "a" || "b", "a" <> "b", "a" != "b", "a" >= 1, -1, 2 * 3 / 4 % 5, 1 << 2, ~1, 1 & 2, 1 | 2 from "t"',
      ]) {
        expect(passes(sql('execute', query)), query).toBe(true)
      }
    })

    it('does not refuse these characters inside a string, a quoted name or a comment', () => {
      for (const query of [
        "SELECT '$a(', '@x', ':y', '#z', '\\', '{', '^' FROM lists",
        'SELECT "$a(", "@x", "a:b" FROM lists',
        'SELECT 1 /* $a( @x :y #z */',
        'SELECT 1 -- $a( @x :y #z',
      ]) {
        expect(passes(sql('execute', query)), query).toBe(true)
      }
    })
  })

  it('does not refuse a keyword that is only a word inside a string, a quoted name or a comment', () => {
    for (const query of [
      "SELECT 'ATTACH', 'vacuum' FROM lists",
      'SELECT "attach" FROM lists',
      'SELECT [vacuum] FROM lists',
      'SELECT `detach` FROM lists',
      'SELECT 1 /* ATTACH x */',
      'SELECT 1 -- VACUUM INTO x',
      "UPDATE list_items SET title = 'PRAGMA writable_schema' WHERE id = $1",
    ]) {
      expect(passes(sql('execute', query)), query).toBe(true)
    }
  })

  it('does not refuse a statement that ends in a semicolon', () => {
    expect(passes(sql('execute', 'SELECT 1;'))).toBe(true)
    expect(passes(sql('execute', 'SELECT 1 ;  \n'))).toBe(true)
    expect(passes(sql('execute', 'SELECT 1; -- done'))).toBe(true)
  })

  it('lets every statement of the app’s own migrations through', () => {
    const dir = join(import.meta.dirname, '../../../server/drizzle')
    const statements = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .flatMap((name) =>
        readFileSync(join(dir, name), 'utf8')
          .split('--> statement-breakpoint')
          .map((statement) => statement.trim())
          .filter(Boolean),
      )

    expect(statements.length).toBeGreaterThan(30)
    expect(statements.filter((query) => !passes(sql('execute', query)))).toEqual([])
  })

  it('refuses nothing that Drizzle writes for the queries the repository makes', () => {
    for (const query of [
      'select "id", "name", "created_at" from "lists" where "lists"."user_id" = $1 order by "lists"."created_at" desc',
      'insert into "list_items" ("id", "list_id", "title") values ($1, $2, $3) returning "id", "title"',
      'update "lists" set "name" = $1 where ("lists"."id" = $2 and "lists"."user_id" = $3)',
      'delete from "list_items" where "list_items"."list_id" = $1',
      'select count(*) from "list_items" where "list_items"."list_id" = $1',
      'with "t" as (select 1) select * from "t"',
      'CREATE TABLE IF NOT EXISTS __local_migrations (tag text PRIMARY KEY NOT NULL, applied_at integer NOT NULL)',
      'SELECT tag FROM __local_migrations',
      'PRAGMA foreign_keys = ON',
      'pragma foreign_keys=on',
    ]) {
      expect(passes(sql('execute', query)), query).toBe(true)
    }
  })
})

describe('the settings stores (SR-003; probe P4)', () => {
  it.each([
    '/tmp/sr19-p4.json',
    '../sr19-p4.json',
    '../../.ssh/authorized_keys',
    'settings.json/../../x.json',
    './settings.json',
    'sub/settings.json',
    'settings.json ',
    ' settings.json',
    'Settings.json',
    'PREFERENCES.JSON',
    'settings.json\u0000.x',
    'settings.jsоn',
    'listulator.sqlite',
    '.window-state.json',
    'fullscreen.json',
    'C:\\Users\\x\\settings.json',
    '\\\\server\\share\\settings.json',
    '',
    '~/settings.json',
  ])('refuses to load %j', (path) => {
    expect(isRefused(message('plugin:store|load', { path }))).toBe(true)
    expect(isRefused(message('plugin:store|get_store', { path }))).toBe(true)
  })

  it.each([undefined, null, 5, ['settings.json'], { a: 1 }])('refuses a path that is not a string: %j', (path) => {
    expect(isRefused(message('plugin:store|load', { path }))).toBe(true)
  })

  it('refuses options the app never sends: only `autoSave` passes', () => {
    const path = 'settings.json'
    for (const options of [
      { autoSave: true, createNew: true },
      { serializeFnName: 'x' },
      { deserializeFnName: 'x' },
      { defaults: { a: 1 } },
      { overrideDefaults: true },
      { autoSave: 'yes' },
      { autoSave: -1 },
      { autoSave: Number.NaN },
      'x',
      5,
      [],
    ]) {
      expect(isRefused(message('plugin:store|load', { path, options })), JSON.stringify(options)).toBe(true)
    }
    expect(passes(message('plugin:store|load', { path, options: { autoSave: 250 } }))).toBe(true)
    expect(passes(message('plugin:store|load', { path, options: { autoSave: false } }))).toBe(true)
    expect(passes(message('plugin:store|load', { path, options: null }))).toBe(true)
  })

  it('refuses a resource number that is not a whole number, extra keys, and commands it does not know', () => {
    for (const rid of ['7', 1.5, -1, Number.NaN, null, undefined, {}, [7]]) {
      expect(isRefused(message('plugin:store|get', { rid, key: 'k' })), String(rid)).toBe(true)
    }
    expect(isRefused(message('plugin:store|get', { rid: 7, key: 'k', extra: 1 }))).toBe(true)
    expect(isRefused(message('plugin:store|get', { rid: 7 }))).toBe(true)
    expect(isRefused(message('plugin:store|get', { rid: 7, key: 5 }))).toBe(true)
    expect(isRefused(message('plugin:store|something_new', { rid: 7 }))).toBe(true)
  })
})

describe('the HTTP plugin (SR-004, SR-005; probe P5: the proxy option goes past the CSP)', () => {
  const config = (extra: Record<string, unknown>, url: unknown = 'https://musicbrainz.org/ws/2/x') =>
    message('plugin:http|fetch', { clientConfig: { method: 'GET', url, headers: [], data: null, ...extra } })

  it.each([
    ['a proxy', { proxy: { all: 'http://127.0.0.1:9999' } }],
    ['a proxy with credentials', { proxy: { all: { url: 'http://127.0.0.1:9999', basicAuth: { username: 'a', password: 'b' } } } }],
    ['an empty proxy object', { proxy: {} }],
    ['certificate checks turned off', { danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true } }],
    ['an empty danger object', { danger: {} }],
    ['a connect timeout', { connectTimeout: 1 }],
    ['a redirect limit', { maxRedirections: 100 }],
    ['no redirects', { maxRedirections: 0 }],
    ['a key the plugin does not know', { somethingNew: true }],
  ])('refuses %s', (_name, extra) => {
    expect(isRefused(config(extra))).toBe(true)
  })

  it('treats a key set to undefined or null as not set (the plugin’s own client sends them so)', () => {
    expect(passes(config({ proxy: undefined, danger: undefined, connectTimeout: undefined, maxRedirections: undefined }))).toBe(true)
    expect(passes(config({ proxy: null, danger: null, connectTimeout: null, maxRedirections: null }))).toBe(true)
  })

  it.each(['http://musicbrainz.org/x', 'file:///etc/passwd', 'ftp://x/y', 'data:text/plain,x', 'javascript:1', 'not a url', '', 5, null, undefined, ['https://x.org/']])(
    'refuses an address that is not an https one: %j',
    (url) => {
      expect(isRefused(message('plugin:http|fetch', { clientConfig: { method: 'GET', url, headers: [], data: null } }))).toBe(true)
    },
  )

  it('refuses a method that is not a word, headers that are not pairs of strings, and a body that is not bytes', () => {
    expect(isRefused(message('plugin:http|fetch', { clientConfig: { method: 5, url: 'https://x.org/', headers: [], data: null } }))).toBe(true)
    expect(isRefused(config({ headers: 'x' }))).toBe(true)
    expect(isRefused(config({ headers: [['a']] }))).toBe(true)
    expect(isRefused(config({ headers: [['a', 1]] }))).toBe(true)
    expect(isRefused(config({ data: 'text' }))).toBe(true)
    expect(isRefused(config({ data: [1, 2, 'x'] }))).toBe(true)
    expect(passes(config({ data: [1, 2, 255] }))).toBe(true)
  })

  it('refuses a client config that is missing, extra keys beside it, and commands it does not know', () => {
    expect(isRefused(message('plugin:http|fetch', {}))).toBe(true)
    expect(isRefused(message('plugin:http|fetch', { clientConfig: null }))).toBe(true)
    expect(isRefused(message('plugin:http|fetch', { clientConfig: { method: 'GET', url: 'https://x.org/', headers: [], data: null }, proxy: { all: 'x' } }))).toBe(true)
    expect(isRefused(message('plugin:http|fetch_send', { rid: 3, proxy: 'x' }))).toBe(true)
    expect(isRefused(message('plugin:http|fetch_send', { rid: 'x' }))).toBe(true)
    expect(isRefused(message('plugin:http|something_new', { rid: 3 }))).toBe(true)
  })
})

describe('the opener (SR-008: the scope is a string glob)', () => {
  it.each([
    'https://github.com/gerharar/listulator/../../evil/repo',
    'https://github.com/gerharar/listulator/%2e%2e/%2e%2e/evil/repo',
    'https://github.com/gerharar/listulator/%2E%2E/x',
    'https://github.com/gerharar/listulator/./x',
    'https://github.com/gerharar/listulator/..',
    'https://github.com/gerharar/listulator/x/..',
    'https://github.com/gerharar/listulator/..%2fx',
    'https://github.com/gerharar/listulator/\\..\\x',
    'https://user:pw@github.com/gerharar/listulator',
    'https://github.com@evil.example/gerharar/listulator',
    'http://github.com/gerharar/listulator',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,x',
    'mailto:x@example.com',
    'ssh://git@github.com/x',
    '/etc/passwd',
    'github.com/gerharar/listulator',
    '',
    ' https://github.com/gerharar/listulator',
    'https://github.com/gerharar/listulator\u0000',
    'https://github.com/gerharar/listulator\n',
  ])('refuses to open %j', (url) => {
    expect(isRefused(message('plugin:opener|open_url', { url }))).toBe(true)
  })

  it('does not refuse a dot or a double dot that is inside a name, or in the query', () => {
    expect(passes(message('plugin:opener|open_url', { url: 'https://www.wikipedia.org/wiki/Dune_(1984_film)' }))).toBe(true)
    expect(passes(message('plugin:opener|open_url', { url: 'https://www.wikipedia.org/wiki/St._Elsewhere' }))).toBe(true)
    expect(passes(message('plugin:opener|open_url', { url: 'https://openlibrary.org/search?q=a..b' }))).toBe(true)
  })

  it('refuses the program to open it with, other opener commands, and non-string addresses', () => {
    expect(isRefused(message('plugin:opener|open_url', { url: 'https://github.com/gerharar/listulator', with: 'sh' }))).toBe(true)
    expect(isRefused(message('plugin:opener|open_path', { path: '/etc/passwd' }))).toBe(true)
    expect(isRefused(message('plugin:opener|reveal_item_in_dir', { paths: ['/etc/passwd'] }))).toBe(true)
    expect(isRefused(message('plugin:opener|open_url', { url: 5 }))).toBe(true)
    expect(isRefused(message('plugin:opener|open_url', {}))).toBe(true)
  })
})

describe('the command name', () => {
  // The native side matches a command exactly, so a look-alike runs nothing. The hook still refuses every spelling of a
  // guarded plugin's command that is not exact: it does not decide by a name it only half recognises.
  it.each([
    'plugin:sql|load ',
    ' plugin:sql|load',
    'Plugin:sql|load',
    'plugin:SQL|load',
    'plugin:sql|LOAD',
    'plugin:sql|load\u0000',
    'plugin:sql |load',
    'plugin:sql| load',
    'plugin:store|LOAD',
    'plugin:store |load',
    'plugin:http|FETCH',
    'PLUGIN:HTTP|fetch',
    'plugin:opener|OPEN_URL',
    ' plugin:opener|open_url',
  ])('refuses the look-alike %j, even with a harmless payload', (cmd) => {
    expect(isRefused(message(cmd, { db: DATABASE }))).toBe(true)
    expect(isRefused(message(cmd, {}))).toBe(true)
  })

  it('leaves a command of an unguarded plugin to the permissions, however it is spelled', () => {
    expect(passes(message('plugin:window|IS_FULLSCREEN', {}))).toBe(true)
    expect(passes(message('plugin:event|listen', { event: 'x' }))).toBe(true)
    expect(passes(message('some-app-command', { x: 1 }))).toBe(true)
  })
})
