// The desktop app's isolation hook (security review, Phase 19, 19.12.3: SR-002, 003, 004, 008; docs/DECISIONS.md "Security
// review spike S1"). Tauri runs this in a sandboxed iframe that sees every request the window sends to the native side,
// before it is encrypted, and the native side accepts nothing that did not pass through here. So even a script running in
// the window can only do what the app itself does: open the app's own database, read and write its two settings files,
// ask the HTTP plugin for a plain request, and open a link in the browser.
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
        } else {
          at += 1 // punctuation: an operator, a bracket, a comma, the mark of a parameter
        }
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
  }
  // The window's other commands (events, the window itself) are for the permissions to govern. These four plugins are
  // governed here: a command of theirs that is not above is refused, whatever its spelling (the native side matches
  // exactly, so a look-alike runs nothing, and this does not rely on that).
  var GUARDED_PLUGIN = /^\s*plugin:\s*(sql|store|http|opener)\s*\|/i

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
      if (GUARDED_PLUGIN.test(cmd)) return refuse(data, 'command not allowed')

      return data
    } catch {
      return refuse(data, 'error')
    }
  }
})()
