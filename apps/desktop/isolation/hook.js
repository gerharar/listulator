// The desktop app's isolation hook (security review, Phase 19, 19.12.3: SR-002, 003, 004, 008; docs/DECISIONS.md "Security
// review spike S1"). Tauri runs this in a sandboxed iframe that sees every request the window sends through `invoke`,
// before it is encrypted. A request that passes is exactly what the app itself sends: open the app's own database, read
// and write its two settings files, ask the HTTP plugin for a plain request, open a link in the browser, the window's own
// few calls, and the updater's check and install with the app's own relaunch (task 20.10b, SR-066). Everything else is
// refused, whatever plugin it is of (SR-062).
//
// What this does NOT do (SR-062, DECISIONS "Security review 19.14"): Tauri encrypts the payload but sends the command name
// in the clear and does not tie the two together, and the page forwards the frame's answer. So a script that handles that
// step itself can present an approved payload under another command name. This hook narrows that to payloads that are valid
// for the command they were approved under (it approves nothing it has not checked against its own command, and no command
// it does not know); the durable answer is the app's own native commands (BACKLOG).
//
// A refusal rewrites the command to one that does not exist: the caller gets a clean rejection. A hook that throws would
// leave the caller waiting for ever (probe P7c), so nothing here may throw: any error is a refusal.
//
// Plain script, no imports: Tauri inlines it into the isolation page. It is tested against hostile requests in
// web/src/lib/isolationHook.test.ts (the file is run there the way the frame runs it). Adding something the app really
// sends means changing this file and that test together, with the reason in docs/DECISIONS.md.

;(function () {
  'use strict'

  var REFUSED_COMMAND = 'plugin:refused-by-listulator-hook|refused'
  var DATABASE = 'sqlite:listulator.sqlite'
  var STORE_FILES = ['settings.json', 'preferences.json']
  var HAS_OWN = Object.prototype.hasOwnProperty

  // ---- small checks (each returns a reason for refusing, or null) ----

  function isObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]'
  }

  function unset(value) {
    return value === undefined || value === null
  }

  /** The plugins' own JavaScript sends every option, the unset ones as undefined: those count as not sent. */
  function keysProblem(payload, allowed, required) {
    if (!isObject(payload)) return 'payload is not an object'
    var keys = Object.keys(payload)
    for (var i = 0; i < keys.length; i++) {
      if (allowed.indexOf(keys[i]) < 0 && !unset(payload[keys[i]])) return 'unexpected key'
    }
    for (var j = 0; j < required.length; j++) {
      if (unset(payload[required[j]])) return 'missing key'
    }
    return null
  }

  function isWholeNumber(value) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0 && value <= 4294967295
  }

  function ridProblem(payload) {
    return isWholeNumber(payload.rid) ? null : 'resource number'
  }

  // ---- the database ----

  function databaseProblem(db) {
    return db === DATABASE ? null : 'database'
  }

  var ALLOWED_FIRST_WORDS = ['select', 'insert', 'update', 'delete', 'create', 'drop', 'alter', 'with', 'pragma']
  // Words that reach outside the app's own database (ATTACH a file, VACUUM INTO a path, an extension, a tokenizer
  // function that takes a pointer) or change how SQLite treats it (PRAGMA, but for foreign_keys).
  var FORBIDDEN_WORDS = ['attach', 'detach', 'vacuum', 'load_extension', 'fts3_tokenizer']
  var WORD = /[A-Za-z_\u0080-\uffff][A-Za-z0-9_$\u0080-\uffff]*/y
  var NUMBER = /[0-9][0-9.]*/y
  var PARAMETER = /\$[0-9]+(?![A-Za-z0-9_$\u0080-\uffff(:])/y
  var PUNCTUATION = '(),.*=<>!+-/%|&~?'
  var UNSAFE_TEXT = /[^\t\n\f\r\u0020-\u007e\u0080-\uffff]/

  /**
   * One statement, of a kind the app sends, with no forbidden word outside a string, a quoted name or a comment. The text is
   * read the way SQLite reads it, and anything this reader is unsure of is refused: an unterminated quote could hide the
   * rest of the text from this check but not from SQLite, and a control character (a NUL ends the text for SQLite) the same.
   */
  function sqlProblem(query) {
    if (typeof query !== 'string') return 'query is not text'
    if (UNSAFE_TEXT.test(query)) return 'control character in query'

    var tokens = []
    var length = query.length
    var at = 0
    while (at < length) {
      var c = query.charAt(at)
      var next = query.charAt(at + 1)
      var end

      if (c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r') {
        at += 1
      } else if (c === '-' && next === '-') {
        end = query.indexOf('\n', at)
        at = end < 0 ? length : end + 1
      } else if (c === '/' && next === '*') {
        end = query.indexOf('*/', at + 2)
        at = end < 0 ? length : end + 2
      } else if (c === "'" || c === '"' || c === '`') {
        // A quote inside is doubled; a backslash is nothing special to SQLite.
        var from = at + 1
        for (;;) {
          end = query.indexOf(c, from)
          if (end < 0) return 'unterminated quote'
          if (query.charAt(end + 1) === c) from = end + 2
          else break
        }
        tokens.push(c === "'" ? '<string>' : '<name>')
        at = end + 1
      } else if (c === '[') {
        end = query.indexOf(']', at + 1)
        if (end < 0) return 'unterminated name'
        tokens.push('<name>')
        at = end + 1
      } else if (c === ';') {
        tokens.push(';')
        at += 1
      } else {
        WORD.lastIndex = at
        var word = WORD.exec(query)
        if (word) {
          tokens.push(word[0].toLowerCase())
          at += word[0].length
          continue
        }
        NUMBER.lastIndex = at
        var number = NUMBER.exec(query)
        if (number) {
          tokens.push('<number>')
          at += number[0].length
          continue
        }
        // A parameter the app sends: `$1`, `$12` (Drizzle's form). SQLite reads `$` + a name + `(` as ONE token that runs on
        // past quotes, `;` and `--` to the next space or `)`, and `$1::x` the same way, so a `$N` that is followed by a name
        // character, `(` or `:` is not the form the app sends and is refused, not guessed at.
        PARAMETER.lastIndex = at
        var parameter = PARAMETER.exec(query)
        if (parameter) {
          at += parameter[0].length
          continue
        }
        // Every other character is either an operator or a bracket SQL itself uses (`?` and `?N` are parameter marks that
        // end at the digits), or something this reader does not know: `@`, `:`, `#` start parameters whose spelling SQLite
        // reads differently from this reader, and `\`, `^`, `{`, `}`, a stray `]`, a lone `$` are not SQL. A character this
        // reader would only skip is a character it could be wrong about, so it is refused.
        if (PUNCTUATION.indexOf(c) < 0) return 'character the reader does not know'
        at += 1
      }
    }

    if (tokens[tokens.length - 1] === ';') tokens.pop()
    if (tokens.length === 0) return 'empty statement'
    if (tokens.indexOf(';') >= 0) return 'more than one statement'
    if (ALLOWED_FIRST_WORDS.indexOf(tokens[0]) < 0) return 'kind of statement'
    for (var i = 0; i < tokens.length; i++) {
      if (FORBIDDEN_WORDS.indexOf(tokens[i]) >= 0) return 'forbidden word'
      if (tokens[i] === 'pragma' && (i > 0 || tokens[1] !== 'foreign_keys')) return 'forbidden word'
    }
    return null
  }

  function statementProblem(payload) {
    return (
      keysProblem(payload, ['db', 'query', 'values'], ['db', 'query']) ||
      databaseProblem(payload.db) ||
      sqlProblem(payload.query) ||
      (unset(payload.values) || Array.isArray(payload.values) ? null : 'values')
    )
  }

  // ---- the two settings stores ----

  function storePathProblem(path) {
    return typeof path === 'string' && STORE_FILES.indexOf(path) >= 0 ? null : 'store path'
  }

  function storeLoadProblem(payload) {
    var problem = keysProblem(payload, ['path', 'options'], ['path']) || storePathProblem(payload.path)
    if (problem) return problem
    var options = payload.options
    if (unset(options)) return null
    if (!isObject(options)) return 'store options'
    var keys = Object.keys(options)
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] !== 'autoSave' && !unset(options[keys[i]])) return 'store option'
    }
    var autoSave = options.autoSave
    if (unset(autoSave) || typeof autoSave === 'boolean') return null
    return typeof autoSave === 'number' && isFinite(autoSave) && autoSave >= 0 ? null : 'store option'
  }

  function storeKeyProblem(payload) {
    return (
      keysProblem(payload, ['rid', 'key'], ['rid', 'key']) ||
      ridProblem(payload) ||
      (typeof payload.key === 'string' ? null : 'store key')
    )
  }

  function storeSetProblem(payload) {
    return (
      keysProblem(payload, ['rid', 'key', 'value'], ['rid', 'key']) ||
      ridProblem(payload) ||
      (typeof payload.key === 'string' ? null : 'store key')
    )
  }

  function ridOnly(payload) {
    return keysProblem(payload, ['rid'], ['rid']) || ridProblem(payload)
  }

  function storeReloadProblem(payload) {
    return (
      keysProblem(payload, ['rid', 'ignoreDefaults'], ['rid']) ||
      ridProblem(payload) ||
      (unset(payload.ignoreDefaults) || typeof payload.ignoreDefaults === 'boolean' ? null : 'store option')
    )
  }

  // ---- HTTP: a plain request; no proxy, no certificate switches, no timeouts, no redirect settings ----

  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  var HTTPS_ADDRESS = /^https:\/\/[^\s\u0000-\u001f\u007f\\]+$/

  function httpsProblem(address) {
    if (typeof address !== 'string' || !HTTPS_ADDRESS.test(address)) return 'address'
    try {
      var parsed = new URL(address)

      return parsed.protocol === 'https:' && parsed.hostname !== '' && parsed.username === '' && parsed.password === '' ? null : 'address'
    } catch {
      return 'address'
    }
  }

  function fetchProblem(payload) {
    var problem = keysProblem(payload, ['clientConfig'], ['clientConfig'])
    if (problem) return problem
    var config = payload.clientConfig
    var known = ['method', 'url', 'headers', 'data']
    var options = ['maxRedirections', 'connectTimeout', 'proxy', 'danger']
    if (!isObject(config)) return 'client config'
    problem = keysProblem(config, known.concat(options), ['method', 'url'])
    if (problem) return 'client config: ' + problem
    // Never sent by the app: a proxy sends the request anywhere past the CSP (SR-004), `danger` turns certificate checks off,
    // the others change how the plugin's client behaves (SR-005). Unset (undefined or null) is how the plugin's own
    // JavaScript sends them when the caller did not ask.
    for (var i = 0; i < options.length; i++) {
      if (!unset(config[options[i]])) return 'client option'
    }
    var keys = Object.keys(config)
    for (var k = 0; k < keys.length; k++) {
      if (known.indexOf(keys[k]) < 0 && options.indexOf(keys[k]) < 0) return 'client config key'
    }
    if (typeof config.method !== 'string' || !/^[A-Za-z]+$/.test(config.method)) return 'method'
    if (httpsProblem(config.url)) return 'address'
    var headers = config.headers
    if (!unset(headers)) {
      if (!Array.isArray(headers)) return 'headers'
      for (var h = 0; h < headers.length; h++) {
        if (!Array.isArray(headers[h]) || headers[h].length !== 2 || typeof headers[h][0] !== 'string' || typeof headers[h][1] !== 'string') return 'headers'
      }
    }
    var data = config.data
    if (!unset(data)) {
      if (!Array.isArray(data)) return 'body'
      for (var d = 0; d < data.length; d++) {
        if (typeof data[d] !== 'number' || data[d] < 0 || data[d] > 255 || Math.floor(data[d]) !== data[d]) return 'body'
      }
    }
    return null
  }

  // ---- the system browser: the scope is a string glob, so ".." and its spellings get through it ----

  function openUrlProblem(payload) {
    var problem = keysProblem(payload, ['url', 'with'], ['url'])
    if (problem) return problem
    if (!unset(payload['with'])) return 'program to open with'
    var address = payload.url
    if (httpsProblem(address)) return 'address'
    var rest = address.slice('https://'.length)
    var cut = rest.search(/[?#]/)
    var path = cut < 0 ? rest : rest.slice(0, cut)
    if (/%2f|%5c/i.test(path)) return 'encoded separator'
    var segments = path.split('/')
    for (var i = 0; i < segments.length; i++) {
      var segment = segments[i]
      // Decoded up to twice: a segment of dots only is a step up or a no-op whatever the spelling.
      for (var round = 0; round < 3; round++) {
        if (/^\.+$/.test(segment) && segment.length <= 2) return 'dot segment'
        try {
          var decoded = decodeURIComponent(segment)
        } catch {
          return 'bad escape'
        }
        if (decoded === segment) break
        segment = decoded
      }
    }
    return null
  }

  // ---- the window and its events: the few calls the app makes itself ----

  var WINDOW_LABEL = 'main'
  var WINDOW_EVENT = 'tauri://resize' // the one event the app listens to (the window's size, for the full-screen switch)

  function windowLabelProblem(payload) {
    return keysProblem(payload, ['label'], ['label']) || (payload.label === WINDOW_LABEL ? null : 'window')
  }

  function setFullscreenProblem(payload) {
    return (
      keysProblem(payload, ['label', 'value'], ['label', 'value']) ||
      (payload.label === WINDOW_LABEL ? null : 'window') ||
      (typeof payload.value === 'boolean' ? null : 'full-screen value')
    )
  }

  function listenProblem(payload) {
    var problem = keysProblem(payload, ['event', 'target', 'handler'], ['event', 'target', 'handler'])
    if (problem) return problem
    if (payload.event !== WINDOW_EVENT) return 'event'
    var target = payload.target
    if (!isObject(target)) return 'event target'
    var keys = Object.keys(target)
    if (keys.length !== 2 || keys.indexOf('kind') < 0 || keys.indexOf('label') < 0) return 'event target'
    if (target.kind !== 'Window' || target.label !== WINDOW_LABEL) return 'event target'
    return isWholeNumber(payload.handler) ? null : 'event handler'
  }

  function unlistenProblem(payload) {
    return (
      keysProblem(payload, ['event', 'eventId'], ['event', 'eventId']) ||
      (payload.event === WINDOW_EVENT ? null : 'event') ||
      (isWholeNumber(payload.eventId) ? null : 'event id')
    )
  }

  /** The inspector's shortcut in a dev or debug build (the native side grants it nowhere else); it carries nothing. */
  function noPayload(payload) {
    return isObject(payload) && Object.keys(payload).length === 0 ? null : 'payload for a command that takes none'
  }

  // ---- the updater: the two calls the client makes, and the app's own relaunch (task 20.10b, SR-066) ----

  // How `ipc.js` hands a channel to this frame: the page's `Channel` is turned into its text form (`SERIALIZE_TO_IPC_FN`) before
  // the message is posted, and the id is the page's callback number.
  var CHANNEL = /^__CHANNEL__:[0-9]{1,10}$/

  /**
   * `check()` sends `{ ...options }` and the client passes none: an empty object, or the plugin's four options all unset. A
   * header, a timeout, a proxy or a target would steer the request the plugin makes (SR-066, SR-067).
   */
  function updaterCheckProblem(payload) {
    return keysProblem(payload, [], [])
  }

  /**
   * `downloadAndInstall(onEvent)` sends `{ onEvent: channel, rid, ...options }`: the progress channel and the update that `check`
   * returned. Not `headers`, `timeout` or `restartAfterInstall` (the install is the plugin's, and the restart is `relaunch`). Not
   * `download` or `install`, which take a downloaded-bytes resource the page could point anywhere.
   */
  function updaterInstallProblem(payload) {
    var problem = keysProblem(payload, ['onEvent', 'rid'], ['onEvent', 'rid'])
    if (problem) return problem
    if (typeof payload.onEvent !== 'string' || !CHANNEL.test(payload.onEvent)) return 'progress channel'

    return ridProblem(payload)
  }

  // ---- the commands of the four plugins that reach outside the window ----

  var COMMANDS = {
    'plugin:sql|load': function (payload) {
      return keysProblem(payload, ['db'], ['db']) || databaseProblem(payload.db)
    },
    'plugin:sql|select': statementProblem,
    'plugin:sql|execute': statementProblem,
    'plugin:store|load': storeLoadProblem,
    'plugin:store|get_store': function (payload) {
      return keysProblem(payload, ['path'], ['path']) || storePathProblem(payload.path)
    },
    'plugin:store|get': storeKeyProblem,
    'plugin:store|has': storeKeyProblem,
    'plugin:store|delete': storeKeyProblem,
    'plugin:store|set': storeSetProblem,
    'plugin:store|clear': ridOnly,
    'plugin:store|reset': ridOnly,
    'plugin:store|keys': ridOnly,
    'plugin:store|values': ridOnly,
    'plugin:store|entries': ridOnly,
    'plugin:store|length': ridOnly,
    'plugin:store|save': ridOnly,
    'plugin:store|reload': storeReloadProblem,
    'plugin:http|fetch': fetchProblem,
    'plugin:http|fetch_send': ridOnly,
    'plugin:http|fetch_read_body': ridOnly,
    'plugin:http|fetch_cancel': ridOnly,
    'plugin:http|fetch_cancel_body': ridOnly,
    'plugin:opener|open_url': openUrlProblem,
    'plugin:window|is_fullscreen': windowLabelProblem,
    'plugin:window|close': windowLabelProblem,
    'plugin:window|set_fullscreen': setFullscreenProblem,
    'plugin:event|listen': listenProblem,
    'plugin:event|unlisten': unlistenProblem,
    'plugin:webview|internal_toggle_devtools': noPayload,
    'plugin:updater|check': updaterCheckProblem,
    'plugin:updater|download_and_install': updaterInstallProblem,
    // The app's own command (`relaunch` in lib.rs): restarts the app after an update; it takes nothing.
    relaunch: noPayload,
  }
  // Anything not in the table is refused, whatever plugin it is of and however it is spelled: the native side matches a
  // command name exactly, and this hook approves a payload only for the command it has checked it against.

  function describe(data) {
    var cmd = data && typeof data.cmd === 'string' ? data.cmd : '(not text)'

    return cmd.replace(/[^ -~]/g, '?').slice(0, 80)
  }

  function refuse(data, reason) {
    // Names the command and the reason, never what the request carried: keys travel in addresses, SQL carries library data.
    console.warn('[listulator] refused ' + describe(data) + ': ' + reason)

    return {
      cmd: REFUSED_COMMAND,
      callback: data && data.callback,
      error: data && data.error,
      payload: {},
    }
  }

  window.__TAURI_ISOLATION_HOOK__ = function (data) {
    try {
      if (!isObject(data) || typeof data.cmd !== 'string') return refuse(data, 'not a command')
      var cmd = data.cmd
      if (HAS_OWN.call(COMMANDS, cmd)) {
        var problem = COMMANDS[cmd](data.payload)

        return problem ? refuse(data, problem) : data
      }

      return refuse(data, 'command not allowed')
    } catch {
      return refuse(data, 'error')
    }
  }
})()
