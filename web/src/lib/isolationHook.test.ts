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

// `sql_batch` (53.1, 53.2): the app's own command that runs a list of statements in one transaction. The limits are the native side's
// (`Limits::DEFAULT` in `sql_batch.rs`; `sqlBatchLimits.guard.test.ts` keeps the two equal).
const BATCH_MAX_STATEMENTS = 2_000
const BATCH_MAX_BYTES = 64 * 1024 * 1024
const batch = (statements: unknown, rest: Record<string, unknown> = {}, db: unknown = DATABASE) => message('sql_batch', { db, statements, ...rest })
const stmt = (query: unknown = 'SELECT 1', values?: unknown) => (values === undefined ? { query } : { query, values })
/** A copy of the list with one place empty (a hole, which is not an `undefined` element: `in` and `forEach` skip it). */
const withHole = <T>(list: T[], at: number): T[] => {
  const copy = [...list]
  Reflect.deleteProperty(copy, at)

  return copy
}

describe('what the app sends passes untouched', () => {
  it.each([
    ['sql load', message('plugin:sql|load', { db: DATABASE })],
    ['sql select', sql('select', 'SELECT id, title FROM lists WHERE user_id = $1', ['u'])],
    ['sql execute', sql('execute', 'INSERT INTO __local_migrations (tag, applied_at) VALUES ($1, $2)', ['0001', 1])],
    ['pragma foreign_keys', sql('execute', 'PRAGMA foreign_keys = ON')],
    ['sql_batch (the app\u2019s own command: a whole rewrite in one transaction)', batch([stmt('DELETE FROM list_items WHERE list_id = $1', ['l1']), stmt('INSERT INTO list_items (id, list_id, title) VALUES ($1, $2, $3)', ['i', 'l1', 'T'])])],
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

  it.each([
    ['window is_fullscreen', message('plugin:window|is_fullscreen', { label: 'main' })],
    ['window set_fullscreen', message('plugin:window|set_fullscreen', { label: 'main', value: true })],
    ['window set_fullscreen back', message('plugin:window|set_fullscreen', { label: 'main', value: false })],
    ['window close', message('plugin:window|close', { label: 'main' })],
    ['event listen, the window being resized', message('plugin:event|listen', { event: 'tauri://resize', target: { kind: 'Window', label: 'main' }, handler: 12 })],
    ['event unlisten', message('plugin:event|unlisten', { event: 'tauri://resize', eventId: 5 })],
    ['event listen, a close or quit held back while a run goes on (H-015)', message('plugin:event|listen', { event: 'quit-while-running', target: { kind: 'Window', label: 'main' }, handler: 12 })],
    ['event unlisten, the same', message('plugin:event|unlisten', { event: 'quit-while-running', eventId: 5 })],
    ['the inspector toggle (the dev and debug builds only; the permission is not granted in a release)', message('plugin:webview|internal_toggle_devtools', {})],
  ])('the window and its events: %s', (_name, sent) => {
    expect(passes(sent)).toBe(true)
  })

  // The updater plugin's own JavaScript (2.13.3, `dist-js/index.js`): `check()` sends `{ ...options }`, `downloadAndInstall(onEvent)` sends
  // `{ onEvent: channel, rid, ...options }`. By the time the hook sees it, `ipc.js` has turned the channel into its text form.
  it.each([
    ['updater check, no options', message('plugin:updater|check', {})],
    ['updater check, every option unset (the client may spell them so)', message('plugin:updater|check', { headers: undefined, timeout: undefined, proxy: undefined, target: undefined })],
    ['updater download_and_install', message('plugin:updater|download_and_install', { onEvent: '__CHANNEL__:12', rid: 3 })],
    ['updater download_and_install, options unset', message('plugin:updater|download_and_install', { onEvent: '__CHANNEL__:12', rid: 3, headers: undefined, timeout: undefined, restartAfterInstall: undefined })],
    ['relaunch (the app\u2019s own command: macOS restarts after an update)', message('relaunch', {})],
    ['hold_close on (the app\u2019s own command: a whole-list run holds the window\u2019s close, H-015)', message('hold_close', { held: true })],
    ['hold_close off', message('hold_close', { held: false })],
    ['backups_info (the app\u2019s own command: the failed-load state asks whether a copy of the database exists, 52.3)', message('backups_info', {})],
  ])('the updater: %s', (_name, sent) => {
    expect(passes(sent)).toBe(true)
  })
})

describe('only what the app sends (SR-062: the approval is not bound to the command name)', () => {
  // Tauri encrypts the payload but sends the command name in the clear and does not tie the two together, so a payload this
  // hook approves under one name can be presented to the native side under another. The hook therefore approves no payload
  // it has not checked against the command it is for: a command it does not know is refused, whatever plugin it is of.
  it.each([
    'plugin:event|emit',
    'plugin:event|emit_to',
    'plugin:event|listen_all',
    'plugin:window|create',
    'plugin:window|set_title',
    'plugin:window|destroy',
    'plugin:window|start_dragging',
    'plugin:window|is_maximized',
    'plugin:webview|webview_close',
    'plugin:webview|create_webview',
    'plugin:resources|close',
    'plugin:app|app_hide',
    'plugin:path|resolve_directory',
    'plugin:fs|read_text_file',
    'plugin:shell|execute',
    'plugin:dialog|open',
    'plugin:log|log',
    'plugin:window-state|save_window_state',
    'plugin:nothing|here',
    'plugin:sql|close',
    'plugin:sql|get_migrations',
    'plugin:sql|sql_batch',
    'sql_batch ',
    'SQL_BATCH',
    'sql-batch',
    'plugin:store|close',
    'plugin:http|fetch_something_new',
    'plugin:opener|reveal_item_in_dir',
    'plugin:opener|open_path',
    'some-app-command',
    'greet',
    '',
    'plugin:|',
  ])('refuses the command %j, with an empty payload and with a payload that is valid for another command', (cmd) => {
    expect(isRefused(message(cmd, {}))).toBe(true)
    expect(isRefused(message(cmd, { label: 'main' }))).toBe(true)
    expect(isRefused(message(cmd, { db: DATABASE, query: 'SELECT 1', values: [] }))).toBe(true)
    expect(isRefused(message(cmd, { path: 'settings.json' }))).toBe(true)
  })

  it('refuses a command that is not text, and a message that is not an object', () => {
    for (const sent of [{ cmd: 1, callback: 1, error: 2, payload: {} }, { cmd: null, payload: {} }, { payload: {} }, null, undefined, 'plugin:event|listen'] as unknown[]) {
      expect(isRefused(sent as IpcMessage)).toBe(true)
    }
  })

  describe('the window calls', () => {
    it.each([
      ['another window', { label: 'other' }],
      ['no label', {}],
      ['a label that is not text', { label: 1 }],
      ['an extra key', { label: 'main', extra: 1 }],
      ['a database beside the label', { label: 'main', db: DATABASE }],
      ['a path beside the label', { label: 'main', path: '/tmp/x' }],
    ])('refuses is_fullscreen and close with %s', (_name, payload) => {
      expect(isRefused(message('plugin:window|is_fullscreen', payload))).toBe(true)
      expect(isRefused(message('plugin:window|close', payload))).toBe(true)
    })

    it.each([
      ['a value that is not a boolean', { label: 'main', value: 1 }],
      ['a text value', { label: 'main', value: 'true' }],
      ['no value', { label: 'main' }],
      ['another window', { label: 'other', value: true }],
      ['an extra key', { label: 'main', value: true, extra: 1 }],
    ])('refuses set_fullscreen with %s', (_name, payload) => {
      expect(isRefused(message('plugin:window|set_fullscreen', payload))).toBe(true)
    })
  })

  describe('the events', () => {
    const good = { event: 'tauri://resize', target: { kind: 'Window', label: 'main' }, handler: 12 }

    it.each([
      ['another event', { ...good, event: 'tauri://close-requested' }],
      ['an event of the app’s own making', { ...good, event: 'anything' }],
      ['no event', { target: good.target, handler: 12 }],
      ['another window as the target', { ...good, target: { kind: 'Window', label: 'other' } }],
      ['every window as the target', { ...good, target: { kind: 'Any' } }],
      ['a target of another kind', { ...good, target: { kind: 'AnyLabel', label: 'main' } }],
      ['a target with an extra key', { ...good, target: { kind: 'Window', label: 'main', extra: 1 } }],
      ['a target that is text', { ...good, target: 'main' }],
      ['no target', { event: good.event, handler: 12 }],
      ['a handler that is not a whole number', { ...good, handler: 1.5 }],
      ['a handler that is text', { ...good, handler: 'x' }],
      ['no handler', { event: good.event, target: good.target }],
      ['an extra key', { ...good, extra: 1 }],
      ['a database in the payload', { ...good, db: DATABASE }],
    ])('refuses listen with %s', (_name, payload) => {
      expect(isRefused(message('plugin:event|listen', payload))).toBe(true)
    })

    it.each([
      ['another event', { event: 'x', eventId: 5 }],
      ['no event id', { event: 'tauri://resize' }],
      ['an event id that is not a whole number', { event: 'tauri://resize', eventId: -1 }],
      ['an event id that is text', { event: 'tauri://resize', eventId: '5' }],
      ['an extra key', { event: 'tauri://resize', eventId: 5, extra: 1 }],
      ['no event', { eventId: 5 }],
    ])('refuses unlisten with %s', (_name, payload) => {
      expect(isRefused(message('plugin:event|unlisten', payload))).toBe(true)
    })
  })

  it('refuses the inspector toggle when it carries anything', () => {
    expect(isRefused(message('plugin:webview|internal_toggle_devtools', { label: 'main' }))).toBe(true)
    expect(isRefused(message('plugin:webview|internal_toggle_devtools', { db: DATABASE }))).toBe(true)
  })

  // The property itself: a payload that is valid for one command is refused under every command it was not written for,
  // except the commands that take the very same shape. Each exception is a pair the app's own resources stay inside of.
  describe('a payload approved for one command is refused under any other', () => {
    const examples: Record<string, { payload: unknown; shape: string }> = {
      'plugin:sql|load': { payload: { db: DATABASE }, shape: 'db' },
      'plugin:sql|select': { payload: { db: DATABASE, query: 'SELECT 1', values: [] }, shape: 'statement' },
      'plugin:sql|execute': { payload: { db: DATABASE, query: 'SELECT 1', values: [] }, shape: 'statement' },
      sql_batch: { payload: { db: DATABASE, statements: [{ query: 'SELECT 1', values: [] }] }, shape: 'batch' },
      'plugin:store|load': { payload: { path: 'settings.json', options: { autoSave: true } }, shape: 'store-load' },
      'plugin:store|get_store': { payload: { path: 'settings.json' }, shape: 'path' },
      'plugin:store|get': { payload: { rid: 7, key: 'k' }, shape: 'rid-key' },
      'plugin:store|has': { payload: { rid: 7, key: 'k' }, shape: 'rid-key' },
      'plugin:store|delete': { payload: { rid: 7, key: 'k' }, shape: 'rid-key' },
      'plugin:store|set': { payload: { rid: 7, key: 'k', value: 'x' }, shape: 'rid-key-value' },
      'plugin:store|reload': { payload: { rid: 7, ignoreDefaults: true }, shape: 'rid-reload' },
      'plugin:store|clear': { payload: { rid: 7 }, shape: 'rid' },
      'plugin:store|reset': { payload: { rid: 7 }, shape: 'rid' },
      'plugin:store|keys': { payload: { rid: 7 }, shape: 'rid' },
      'plugin:store|values': { payload: { rid: 7 }, shape: 'rid' },
      'plugin:store|entries': { payload: { rid: 7 }, shape: 'rid' },
      'plugin:store|length': { payload: { rid: 7 }, shape: 'rid' },
      'plugin:store|save': { payload: { rid: 7 }, shape: 'rid' },
      'plugin:http|fetch': { payload: { clientConfig: { method: 'GET', url: 'https://musicbrainz.org/ws/2/', headers: [], data: null } }, shape: 'fetch' },
      'plugin:http|fetch_send': { payload: { rid: 7 }, shape: 'rid' },
      'plugin:http|fetch_read_body': { payload: { rid: 7 }, shape: 'rid' },
      'plugin:http|fetch_cancel': { payload: { rid: 7 }, shape: 'rid' },
      'plugin:http|fetch_cancel_body': { payload: { rid: 7 }, shape: 'rid' },
      'plugin:opener|open_url': { payload: { url: 'https://github.com/gerharar/listulator' }, shape: 'url' },
      'plugin:window|is_fullscreen': { payload: { label: 'main' }, shape: 'label' },
      'plugin:window|close': { payload: { label: 'main' }, shape: 'label' },
      'plugin:window|set_fullscreen': { payload: { label: 'main', value: true }, shape: 'label-value' },
      'plugin:event|listen': { payload: { event: 'tauri://resize', target: { kind: 'Window', label: 'main' }, handler: 12 }, shape: 'listen' },
      'plugin:event|unlisten': { payload: { event: 'tauri://resize', eventId: 5 }, shape: 'unlisten' },
      'plugin:webview|internal_toggle_devtools': { payload: {}, shape: 'empty' },
      // `{}` is the whole payload of four commands (the inspector's toggle, the updater's check, our relaunch and our backups_info), so they are one shape here.
      'plugin:updater|check': { payload: {}, shape: 'empty' },
      'plugin:updater|download_and_install': { payload: { onEvent: '__CHANNEL__:12', rid: 3 }, shape: 'channel-rid' },
      relaunch: { payload: {}, shape: 'empty' },
      hold_close: { payload: { held: true }, shape: 'held' },
      backups_info: { payload: {}, shape: 'empty' },
    }
    // Shapes that another shape's payload also satisfies: the optional keys. `store|load` takes `path` alone as `get_store`
    // does; `reload` takes `rid` alone as the rid-only commands do (a reload payload that sets `ignoreDefaults` does not
    // pass for them); `store|set` takes `rid` and `key` without a value, which the native side rejects as a missing field
    // (the hook cannot require it: a value may be null or unset). All of them stay inside the app's own settings stores.
    const alsoSatisfies: Record<string, string[]> = {
      path: ['store-load'],
      rid: ['rid-reload'],
      'rid-key': ['rid-key-value'],
    }
    const names = Object.keys(examples)

    it('has an example for every command the hook knows', () => {
      expect(names.length).toBe(35)
    })

    it('passes each example under its own command', () => {
      for (const cmd of names) expect(passes(message(cmd, examples[cmd]!.payload)), cmd).toBe(true)
    })

    it('refuses each example under every command of another shape', () => {
      const wrongly: string[] = []
      for (const to of names) {
        for (const from of names) {
          const source = examples[from]!
          const target = examples[to]!
          const sameShape = source.shape === target.shape || (alsoSatisfies[source.shape] ?? []).includes(target.shape)
          if (!sameShape && passes(message(to, source.payload))) wrongly.push(`${from} payload passes as ${to}`)
        }
      }
      expect(wrongly).toEqual([])
    })
  })
})

describe('the updater (SR-063 to SR-067; task 20.10b: only the calls the client makes, in the shapes it sends them)', () => {
  const CHANNEL = '__CHANNEL__:12'

  it.each(['plugin:updater|download', 'plugin:updater|install', 'plugin:resources|close', 'plugin:updater|', 'plugin:updater|check_all', 'plugin:updater|download_and_install_all'])(
    'refuses the command %j, with the payload of a call it does allow',
    (cmd) => {
      expect(isRefused(message(cmd, {}))).toBe(true)
      expect(isRefused(message(cmd, { onEvent: CHANNEL, rid: 3 }))).toBe(true)
      expect(isRefused(message(cmd, { rid: 3 }))).toBe(true)
      expect(isRefused(message(cmd, { updateRid: 3, bytesRid: 4 }))).toBe(true)
    },
  )

  describe('check', () => {
    it.each([
      ['headers', [['x-a', 'b']]],
      ['timeout', 1000],
      ['proxy', 'http://127.0.0.1:8080'],
      ['target', 'windows-x86_64'],
      ['an option the plugin does not have', true],
    ])('refuses the option %s', (key, value) => {
      expect(isRefused(message('plugin:updater|check', { [key === 'an option the plugin does not have' ? 'extra' : key]: value }))).toBe(true)
    })

    it('refuses a payload that is not an empty object', () => {
      for (const payload of [null, undefined, 'check', 0, [], [{}], { rid: 3 }, { onEvent: CHANNEL }]) {
        expect(isRefused(message('plugin:updater|check', payload)), JSON.stringify(payload)).toBe(true)
      }
    })
  })

  describe('download_and_install', () => {
    it.each([
      ['headers', [['x-a', 'b']]],
      ['timeout', 1000],
      ['restartAfterInstall', false],
      ['restartAfterInstall', true],
      ['proxy', 'http://127.0.0.1:8080'],
      ['target', 'windows-x86_64'],
    ])('refuses the option %s', (key, value) => {
      expect(isRefused(message('plugin:updater|download_and_install', { onEvent: CHANNEL, rid: 3, [key]: value }))).toBe(true)
    })

    it.each([1.5, -1, '3', '3 ', NaN, Infinity, 2 ** 32, 2 ** 53, null, undefined, {}, [3], true])('refuses the resource number %j', (rid) => {
      expect(isRefused(message('plugin:updater|download_and_install', { onEvent: CHANNEL, rid }))).toBe(true)
    })

    it.each([5, null, undefined, true, {}, { id: 12 }, ['__CHANNEL__:12'], '', '__CHANNEL__:', '__CHANNEL__:abc', '__CHANNEL__:-1', '__CHANNEL__:1.5', '__CHANNEL__: 12', '__CHANNEL__:12\n', '__CHANNEL__:12 ', 'x__CHANNEL__:12', '__channel__:12', '__CHANNEL__:12345678901', 'javascript:alert(1)'])(
      'refuses %j in place of the channel',
      (onEvent) => {
        expect(isRefused(message('plugin:updater|download_and_install', { onEvent, rid: 3 }))).toBe(true)
      },
    )

    it('refuses a call that lacks either part, or is not an object', () => {
      expect(isRefused(message('plugin:updater|download_and_install', { rid: 3 }))).toBe(true)
      expect(isRefused(message('plugin:updater|download_and_install', { onEvent: CHANNEL }))).toBe(true)
      for (const payload of [{}, null, undefined, [], 'x', [CHANNEL, 3]]) {
        expect(isRefused(message('plugin:updater|download_and_install', payload)), JSON.stringify(payload)).toBe(true)
      }
    })

    it('refuses the shape of download or install (a second resource number) and the key store’s shapes', () => {
      expect(isRefused(message('plugin:updater|download_and_install', { updateRid: 3, bytesRid: 4 }))).toBe(true)
      expect(isRefused(message('plugin:updater|download_and_install', { onEvent: CHANNEL, rid: 3, bytesRid: 4 }))).toBe(true)
      expect(isRefused(message('plugin:updater|download_and_install', { rid: 3, key: 'k' }))).toBe(true)
    })
  })

  describe('hold_close (H-015)', () => {
    it.each([
      ['no payload', {}],
      ['text', { held: 'true' }],
      ['a number', { held: 1 }],
      ['null', { held: null }],
      ['unset', { held: undefined }],
      ['an extra key', { held: true, extra: 1 }],
      ['a label', { held: true, label: 'main' }],
      ['another key instead', { value: true }],
    ])('refuses the payload with %s', (_name, payload) => {
      expect(isRefused(message('hold_close', payload))).toBe(true)
    })

    it.each([null, undefined, [], 'now', 0, true])('refuses the payload %j', (payload) => {
      expect(isRefused(message('hold_close', payload))).toBe(true)
    })

    it.each(['Hold_close', 'HOLD_CLOSE', ' hold_close', 'hold_close ', 'hold_close\u0000', 'plugin:window|hold_close', 'hold-close', 'holdClose', 'close'])(
      'refuses the look-alike %j, even with a good payload',
      (cmd) => {
        expect(isRefused(message(cmd, { held: true }))).toBe(true)
      },
    )
  })

  describe('relaunch', () => {
    it.each([{ label: 'main' }, { rid: 3 }, { exitCode: 0 }, { onEvent: CHANNEL, rid: 3 }, null, undefined, [], 'now', 0])('refuses the payload %j', (payload) => {
      expect(isRefused(message('relaunch', payload))).toBe(true)
    })

    it.each(['Relaunch', 'RELAUNCH', ' relaunch', 'relaunch ', 'relaunch\u0000', 'plugin:app|relaunch', 'plugin:process|restart', 'plugin:process|exit', 'restart', 'exit'])(
      'refuses the look-alike or neighbour %j, even with an empty payload',
      (cmd) => {
        expect(isRefused(message(cmd, {}))).toBe(true)
      },
    )
  })

  describe('backups_info (52.3)', () => {
    it.each([{ folder: 'backups' }, { path: '/tmp' }, { rid: 3 }, { label: 'main' }, null, undefined, [], 'now', 0])('refuses the payload %j', (payload) => {
      expect(isRefused(message('backups_info', payload))).toBe(true)
    })

    it.each(['Backups_info', 'BACKUPS_INFO', ' backups_info', 'backups_info ', 'backups_info\u0000', 'plugin:fs|read_dir', 'plugin:fs|exists', 'backups-info', 'backupsInfo', 'backups'])(
      'refuses the look-alike or neighbour %j, even with an empty payload',
      (cmd) => {
        expect(isRefused(message(cmd, {}))).toBe(true)
      },
    )
  })

  it.each(['plugin:updater|CHECK', 'Plugin:updater|check', 'plugin:UPDATER|check', 'plugin:updater |check', 'plugin:updater| check', ' plugin:updater|check', 'plugin:updater|check ', 'plugin:updater|DOWNLOAD_AND_INSTALL'])(
    'refuses the look-alike %j',
    (cmd) => {
      expect(isRefused(message(cmd, {}))).toBe(true)
      expect(isRefused(message(cmd, { onEvent: '__CHANNEL__:12', rid: 3 }))).toBe(true)
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
    // Enforcement can be switched off on a pooled connection and stays off there (measured, 53.0): the app sends only the exact ON.
    ['pragma foreign_keys off', 'PRAGMA foreign_keys = OFF'],
    ['pragma foreign_keys off, lower case, no spaces', 'pragma foreign_keys=off'],
    ['pragma foreign_keys zero', 'PRAGMA foreign_keys = 0'],
    ['pragma foreign_keys one (only the word ON is what the app sends)', 'PRAGMA foreign_keys = 1'],
    ['pragma foreign_keys false', 'PRAGMA foreign_keys = false'],
    ['pragma foreign_keys as text', "PRAGMA foreign_keys = 'off'"],
    ['pragma foreign_keys with no value', 'PRAGMA foreign_keys'],
    ['pragma foreign_keys with a schema name', 'PRAGMA main.foreign_keys = OFF'],
    ['pragma foreign_keys quoted', 'PRAGMA "foreign_keys" = OFF'],
    ['pragma foreign_keys ON, then more', 'PRAGMA foreign_keys = ON ON'],
    ['pragma foreign_keys ON, then off', 'PRAGMA foreign_keys = ON OFF'],
    ['pragma defer_foreign_keys', 'PRAGMA defer_foreign_keys = ON'],
    ['pragma foreign_key_check', 'PRAGMA foreign_key_check'],
    ['a pragma after another word', 'EXPLAIN PRAGMA foreign_keys = OFF'],
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
    // SQLite reads a quoted name followed by `(` as a call (`"abs"(-1)`, `` `abs`(-1) `` and `[abs](-1)` all run; BL-077), so a
    // quoted forbidden word that is called is the function, however it is spelled. (A single-quoted string is a syntax error there.)
    ...['load_extension', 'fts3_tokenizer'].flatMap((word): [string, string][] => [
      [`${word} in double quotes, called`, `SELECT "${word}"('x')`],
      [`${word} in backticks, called`, `SELECT \`${word}\`('x')`],
      [`${word} in brackets, called`, `SELECT [${word}]('x')`],
      [`${word} quoted, upper case, called`, `SELECT "${word.toUpperCase()}"('x')`],
      [`${word} quoted, a comment before the bracket`, `SELECT "${word}" /* x */ ('x')`],
      [`${word} quoted, a line comment before the bracket`, `SELECT "${word}" -- x\n('x')`],
      [`${word} quoted, called inside a CTE`, `WITH t AS (SELECT "${word}"('x')) SELECT * FROM t`],
    ]),
    ['attach, quoted and called', `SELECT "attach"('x')`],
    ['vacuum, quoted and called', `SELECT [vacuum]('x')`],
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
      // A quoted forbidden word is a name unless it is called: a column, or a name followed by something else than `(`.
      'SELECT "load_extension", "fts3_tokenizer" FROM lists',
      'SELECT "attach" + 1 FROM lists WHERE 1 IN ("attach")',
      'SELECT abs("load_extension") FROM lists',
      "SELECT 'load_extension'",
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

describe('sql_batch (53.2: the app’s own command, the whole list in one transaction)', () => {
  const refused = (sent: IpcMessage): void => expect(isRefused(sent)).toBe(true)

  describe('what the app sends passes untouched', () => {
    it.each([
      ['one statement', batch([stmt('SELECT 1')])],
      ['a statement with no values key (the native side defaults it)', batch([{ query: 'SELECT 1' }])],
      ['values of every kind Drizzle sends: text, whole and fractional numbers, null', batch([stmt('INSERT INTO t (a, b, c, d) VALUES ($1, $2, $3, $4)', ['a', 1, 1.5, null])])],
      ['the foreign-keys option on', batch([stmt('DROP TABLE t')], { foreignKeysOff: true })],
      ['the foreign-keys option off', batch([stmt('SELECT 1')], { foreignKeysOff: false })],
      ['the option unset (the page may send every key, the unset ones as undefined)', batch([stmt('SELECT 1')], { foreignKeysOff: undefined })],
      ['two hundred statements, a 50,000-item rewrite', batch(Array.from({ length: 200 }, (_, n) => stmt(`INSERT INTO t VALUES ($1, $2)`, [`id-${n}`, n])))],
      ['the most statements one call may hold', batch(Array.from({ length: BATCH_MAX_STATEMENTS }, () => stmt()))],
      ['a statement that returns rows', batch([stmt('INSERT INTO t (a) VALUES ($1) RETURNING a, b', ['x'])])],
      ['the exact ON of the pragma the app sends', batch([stmt('PRAGMA foreign_keys = ON')])],
    ])('%s', (_name, sent) => {
      expect(passes(sent)).toBe(true)
    })

    it('lets every statement of the app’s own migrations through as one batch', () => {
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
      expect(passes(batch(statements.map((query) => stmt(query))))).toBe(true)
    })
  })

  describe('only that shape', () => {
    it.each([
      ['another database', batch([stmt()], {}, 'sqlite:/tmp/other.sqlite')],
      ['no database', message('sql_batch', { statements: [stmt()] })],
      ['an extra key beside the statements', batch([stmt()], { extra: 1 })],
      ['a second list under another name', batch([stmt()], { queries: [stmt()] })],
      ['no statements', message('sql_batch', { db: DATABASE })],
      ['no payload', message('sql_batch', null)],
      ['a payload that is an array', message('sql_batch', [DATABASE, [stmt()]])],
      ['a payload that is bytes', message('sql_batch', new Uint8Array([1, 2, 3]))],
      ['a __proto__ key', message('sql_batch', { ['__proto__']: 1, db: DATABASE, statements: [stmt()] })],
      ['the foreign-keys option as text', batch([stmt()], { foreignKeysOff: 'true' })],
      ['the foreign-keys option as a number', batch([stmt()], { foreignKeysOff: 1 })],
      ['the foreign-keys option as an object', batch([stmt()], { foreignKeysOff: {} })],
    ])('refuses %s', (_name, sent) => refused(sent))

    it.each([
      ['a string', 'SELECT 1'],
      ['an object that only has a length', { length: 1, 0: stmt() }],
      ['a typed array', new Uint8Array(3)],
      ['a Set', new Set([stmt()])],
      ['a number', 3],
      ['null', null],
      ['an empty list (there is nothing to do; the caller says so itself)', []],
      ['one statement more than a call may hold', Array.from({ length: BATCH_MAX_STATEMENTS + 1 }, () => stmt())],
      ['a list that says it is a billion long (it is never walked)', new Array(1_000_000_000)],
      ['a list with a hole in it', withHole([stmt(), stmt(), stmt()], 1)],
      ['a list of text', ['SELECT 1']],
      ['a list with a null in it', [stmt(), null]],
      ['a list with a list in it', [[stmt()]]],
    ])('refuses statements that are %s', (_name, statements) => refused(batch(statements)))

    it.each([
      ['an extra key', { query: 'SELECT 1', values: [], extra: 1 }],
      ['no query', { values: [] }],
      ['a query that is not text', { query: 5, values: [] }],
      ['a query that is a list', { query: ['SELECT 1'], values: [] }],
      ['values that are text', { query: 'SELECT 1', values: 'x' }],
      ['values that are an object', { query: 'SELECT 1', values: { 0: 1, length: 1 } }],
      ['values that are bytes', { query: 'SELECT 1', values: new Uint8Array(2) }],
    ])('refuses a statement with %s', (_name, statement) => refused(batch([stmt(), statement])))
  })

  describe('the values (the app sends only text, numbers and null; the native side would bind more, the hook lets none of it through)', () => {
    it.each([
      ['undefined', undefined],
      ['true', true],
      ['false', false],
      ['an object', { a: 1 }],
      ['a list', [1, 2]],
      ['a nested list', [[1]]],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['minus Infinity', Number.NEGATIVE_INFINITY],
      ['a BigInt', 10n],
      ['a function', () => 1],
      ['a symbol', Symbol('x')],
      ['a date', new Date(0)],
      ['bytes', new Uint8Array(2)],
    ])('refuses %s as a value', (_name, value) => {
      refused(batch([stmt('SELECT $1', [value])]))
      refused(batch([stmt(), stmt('SELECT $1, $2', ['ok', value])]))
    })

    it('refuses a list of values with a hole in it', () => {
      refused(batch([stmt('SELECT $1, $2, $3', withHole(['a', 'b', 'c'], 1))]))
    })

    it('never walks a list of values that says it is a billion long', () => {
      const started = Date.now()
      refused(batch([stmt('SELECT 1', new Array(1_000_000_000))]))
      expect(Date.now() - started).toBeLessThan(1000)
    })
  })

  describe('the SQL of every statement, wherever it stands in the list', () => {
    const hostile: [string, string][] = [
      ['attach', "ATTACH DATABASE '/tmp/x.sqlite' AS x"],
      ['detach', 'DETACH DATABASE x'],
      ['vacuum into', "VACUUM INTO '/tmp/copy.sqlite'"],
      ['load_extension', "SELECT load_extension('/tmp/evil.dylib')"],
      ['begin (the command opens the transaction itself)', 'BEGIN'],
      ['begin immediate', 'BEGIN IMMEDIATE'],
      ['commit', 'COMMIT'],
      ['end', 'END'],
      ['rollback', 'ROLLBACK'],
      ['savepoint', 'SAVEPOINT a'],
      ['release', 'RELEASE a'],
      ['a second statement in the text', 'SELECT 1; SELECT 2'],
      ['a second statement that attaches', "SELECT 1; ATTACH '/tmp/x.sqlite' AS x"],
      ['a pragma that switches enforcement off', 'PRAGMA foreign_keys = OFF'],
      ['a pragma that switches it off, lower case', 'pragma foreign_keys=0'],
      ['a pragma that writes the schema', 'PRAGMA writable_schema = ON'],
      ['a pragma that checks (the native side does that itself)', 'PRAGMA foreign_key_check'],
      ['an empty statement', ''],
      ['a NUL', 'SELECT 1\u0000'],
      ['an unterminated string that might hide the rest', "SELECT 'abc; ATTACH '/tmp/x' AS x"],
    ]
    const good = () => stmt('INSERT INTO t (a) VALUES ($1)', ['x'])

    it.each(hostile)('refuses %s first, in the middle and last of five', (_name, query) => {
      refused(batch([stmt(query), good(), good(), good(), good()]))
      refused(batch([good(), good(), stmt(query), good(), good()]))
      refused(batch([good(), good(), good(), good(), stmt(query)]))
    })

    it('still checks the last statement of the most a call may hold', () => {
      const last = Array.from({ length: BATCH_MAX_STATEMENTS }, () => good())
      last[BATCH_MAX_STATEMENTS - 1] = stmt("ATTACH '/tmp/x.sqlite' AS x")

      refused(batch(last))
    })

    it('refuses a hostile statement under the foreign-keys option too', () => {
      refused(batch([stmt('DROP TABLE t'), stmt("ATTACH '/tmp/x.sqlite' AS x")], { foreignKeysOff: true }))
      refused(batch([stmt('PRAGMA foreign_keys = OFF')], { foreignKeysOff: true }))
    })
  })

  describe('the size of one call (the text of every statement and every value: text by its length, a number as 20, null as 4)', () => {
    it('lets a call of exactly the most through', () => {
      const query = 'SELECT $1'

      expect(passes(batch([stmt(query, ['x'.repeat(BATCH_MAX_BYTES - query.length)])]))).toBe(true)
    })

    it('refuses a call one byte over', () => {
      const query = 'SELECT $1'

      refused(batch([stmt(query, ['x'.repeat(BATCH_MAX_BYTES - query.length + 1)])]))
    })

    it('adds the statements up, not one by one', () => {
      const third = Math.floor(BATCH_MAX_BYTES / 3) + 1
      const big = () => stmt('SELECT $1', ['x'.repeat(third)])

      expect(passes(batch([big(), big()]))).toBe(true)
      refused(batch([big(), big(), big()]))
    })

    it('counts a number as 20 and null as 4, so a long list of small values cannot slip past', () => {
      const numbers = Math.floor(BATCH_MAX_BYTES / 20)
      refused(batch([stmt('SELECT 1', new Array<number>(numbers + 1).fill(1))]))
      const nulls = Math.floor(BATCH_MAX_BYTES / 4)
      refused(batch([stmt('SELECT 1', new Array<null>(nulls + 1).fill(null))]))
    })
  })

  it('says which command and which statement it refused, never what the statement held', () => {
    warnings.length = 0
    refused(batch([stmt(), stmt("SELECT 'a-very-secret-title'; ATTACH '/tmp/very-secret-file' AS x")]))

    const logged = warnings.join('\n')
    expect(logged).toContain('sql_batch')
    expect(logged).toContain('statement 1')
    expect(logged).not.toContain('very-secret')
  })

  it('never throws, whatever it is given', () => {
    const cyclic: Record<string, unknown> = { db: DATABASE }
    cyclic['statements'] = [cyclic]

    for (const payload of [cyclic, { db: DATABASE, statements: [{ query: 'SELECT 1', values: [cyclic] }] }, { db: DATABASE, statements: new Proxy([], {}) }]) {
      expect(() => hook(message('sql_batch', payload))).not.toThrow()
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

  it('refuses a look-alike of the window and event commands too', () => {
    for (const cmd of ['plugin:window|IS_FULLSCREEN', ' plugin:window|close', 'plugin:event|LISTEN', 'plugin:event |listen', 'Plugin:window|close']) {
      expect(isRefused(message(cmd, { label: 'main' })), cmd).toBe(true)
    }
  })
})
