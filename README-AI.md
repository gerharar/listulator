# Listulator — technical README

This is the technical companion to [README.md](README.md), which is written by a human for humans and covers the pitch, the FAQ and the install warnings in plain language. This file holds the facts an engineer, a self-hoster or an AI agent needs: what the project is made of, how to run it, test it and build it, and where everything lives. Everything here was checked against the repository when it was written; if the two disagree with the code, the code wins.

## What it is

Listulator is a **progress tracker for media franchises and pseudo-serialized media**. A *list* (a film series, a game franchise, a band's discography, a YouTube channel, a wrestling promotion's events, a cross-media universe) holds *items*; you tick items off, watch each list's completion climb, and use four helper buttons to decide what to pick up next. Lists come from search in a connector (TMDB, IGDB, MusicBrainz, …), from the curated **List Vault** in `lists/`, from a YAML file, or from your own typing.

The product ships as a **desktop app** (Windows x64, macOS Apple silicon) that keeps the library and the API keys on the user's computer. The same code also runs as a **self-hostable server plus web app**; that route works but is not a supported way to use Listulator (see [SECURITY.md](SECURITY.md)).

| | |
|---|---|
| Version | `1.0.0` (first public release; the version is written once in the root `package.json` and set everywhere with `npm run version:set -w @listulator/server -- <version>`) |
| Desktop targets | Windows x64 (NSIS installer, per-user install); macOS 11+ on Apple silicon (`.dmg`, ad-hoc sealed). No Intel Mac, no Linux build |
| Code signing | None at the OS level (Windows unsigned, macOS ad-hoc). Updates are signed with a separate key, see [Updates](#updates-desktop-app) |
| Languages in the UI | English, German, Russian (`web/src/locale/`) |
| Users | Single user only. `SINGLE_USER_MODE=true` is the only supported value; multi-tenancy is scaffolded in the schema (`user_id` on every table) and not switched on |
| Telemetry | None |
| Licence | [PolyForm Noncommercial 1.0.0](LICENSE) (source-available, noncommercial use); the lists in `lists/` are [CC BY 4.0](lists/LICENSE); data fetched from the services stays under their own terms, see [NOTICE.md](NOTICE.md) |

## Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict) everywhere; Rust for the desktop shell |
| Server | Node.js, [Fastify](https://fastify.dev/) 5, [Drizzle ORM](https://orm.drizzle.team/) over SQLite (`better-sqlite3`), `js-yaml` |
| Web app | React 19, Vite 8, `lucide-react`, `@floating-ui/react`, `vite-plugin-pwa` (the web build is a PWA; the desktop app registers no service worker) |
| Desktop shell | [Tauri](https://tauri.app/) 2 (`tauri` 2.12) with the plugins `sql`, `store`, `http`, `opener`, `window-state`, `updater` and `log`; the UI is the same React app in the system webview (WKWebView on macOS, WebView2 on Windows) |
| Desktop storage | Real SQLite through `tauri-plugin-sql`, bridged to Drizzle's `sqlite-proxy` driver, so the server's repository code runs unmodified in the webview |
| Tests | [Vitest](https://vitest.dev/) 4 (server, web, tools), Testing Library + jsdom (components), Playwright (`web/e2e`), `cargo test` (Rust) |
| Lint, format | ESLint 10 + typescript-eslint, Prettier. Named exports only (enforced by ESLint) |
| Toolchains | Node `26.12.1` ([`.node-version`](.node-version)), Rust `1.98.1` ([`rust-toolchain.toml`](rust-toolchain.toml)). Both are exact on purpose: a build of the same commit must not change because a toolchain moved. `package.json` allows Node >= 20 to run the code |
| Workspaces | npm workspaces: `server`, `web`, `apps/desktop` |
| CI | GitHub Actions in [`.github/workflows/`](.github/workflows): the release pipeline and two hand-started Windows builds |

No Docker and no separate database server are involved: the server is one Node process and one SQLite file.

## Repository layout

```
.
├── server/                    @listulator/server — Fastify API, Drizzle schema and migrations, connectors, tools
│   ├── src/catalog/           lists and items: repository, routes, groups, limits, restore (undo), reset, source copies
│   ├── src/ingestion/         search, preview, custom-list parsing, list library; adapters/ holds one adapter per connector
│   ├── src/suggestions/       the ranking engine and the strategy loader
│   ├── src/db/                schema.ts (the portable source of truth), client, migrate
│   ├── src/tools/             repository tools: list generators/validators, notices, version setter, updater/release tooling
│   └── drizzle/               generated SQL migrations (NNNN_name.sql); the desktop app applies the same files itself
├── web/                       @listulator/web — React app (used by both the web build and the desktop shell)
│   ├── src/screens/, components/, routes/   UI
│   ├── src/lib/api.ts         HTTP client for the self-hosted server
│   ├── src/lib/api.local.ts   the same API in-process, for the desktop app (SQLite via the Tauri SQL plugin)
│   ├── src/lib/db/            the desktop database opener and its own migration runner
│   ├── src/locale/            en.ts (the source of every word the UI says), de.ts, ru.ts
│   ├── src/styles/            design tokens and CSS
│   └── e2e/                   Playwright tests
├── apps/desktop/              @listulator/desktop — Tauri shell
│   ├── src-tauri/             Rust crate, tauri.conf.json (+ overlay configs), capabilities/, icons/
│   └── isolation/hook.js      the IPC isolation hook: every call from the webview to native code goes through it
├── lists/                     the List Vault: curated YAML lists by category, index.json, LICENSE (CC BY 4.0)
├── config/strategies/         suggestion strategies as JSON (weights and factors are configuration)
├── config/platforms.csv       game platform names used by the Games facet
├── guides/                    how to get each API key (with screenshots)
├── scripts/pre-commit         validates staged list files through the app's real parser
├── .github/workflows/         release.yml, desktop-windows.yml, updater-test-windows.yml
├── .env.example               every server setting and API key, commented
├── CHANGELOG.md, CONTRIBUTING.md, SECURITY.md, NOTICE.md, THIRD-PARTY-NOTICES.txt, LICENSE
└── README.md, README-AI.md
```

## How the pieces fit

**Two front doors, one core.** The web app talks to an API. In the self-hosted setup that API is the Fastify server (`/api/...`, `/health`). In the desktop app there is no server process: `web/src/lib/api.local.ts` provides the same functions by calling the catalog repository, the ingestion code and the suggestion engine directly in the webview, with SQLite behind `@tauri-apps/plugin-sql`. The Drizzle schema is shared (`web` imports `server/src/db/schema.ts`), so there is one definition of a table. Whenever an ingestion flow changes, it changes in both places (`server/src/ingestion/routes.ts` and `web/src/lib/api.local.ts`).

**Migrations.** `server/drizzle/*.sql` are generated by `drizzle-kit`. The server applies them with Drizzle's migrator; the webview cannot (no `node:fs`), so `web/src/lib/db/localDb.ts` applies the same files statement by statement with its own `__local_migrations` table, restartable after a crash. Migrations are additive in practice; the desktop app makes no backup before migrating.

**Categories are an open registry.** A category (`media_type`) is not an enum: it is an entry in `server/src/ingestion/mediaTypes.ts` (a search adapter, a fallback duration, optional facets). Adding one must not need a migration and must not touch the catalog or the suggestion code. Item length (`time_to_consume_minutes`) is never null: a real value, or the category's default with `is_estimated = true`.

**Suggestions.** Ranking is data: `config/strategies/*.json` name a scope and weighted factors (neglect time, completion percent, time left, …); new *shaping functions* are engine code (`server/src/suggestions/engine.ts`). The server reads strategy files at request time (override the folder with `STRATEGIES_DIR`); the desktop app bundles them into the build.

**Desktop security model.** The native side is the thing to protect from whatever runs in the webview:
- Tauri's *isolation pattern* is on. [`apps/desktop/isolation/hook.js`](apps/desktop/isolation/hook.js) sees every IPC call before it is encrypted and **refuses everything it does not know** (default deny): exact shapes for the database (one database name; only the statement kinds the app and its migrations use; `ATTACH`, `VACUUM`, extension loading and the like refused by a SQL reader that fails closed), the two settings stores, the HTTP plugin, the opener, the window and event calls, and the updater.
- [`capabilities/default.json`](apps/desktop/src-tauri/capabilities/default.json) grants only the calls the app makes (no `core:default`, no file-system plugin, no shell).
- A strict CSP applies to the app (`connect-src` lists the few hosts the webview itself talks to); other hosts are reached only through the HTTP plugin, whose scope is a host allowlist. A navigation guard in the Rust shell keeps the window on the app's own origin.
The reasoning and the review that found each rule are in the project's design notes, which are kept outside this repository; the tests that pin the rules are in `web/src/lib/isolationHook.test.ts`, `web/src/lib/tauriCapabilities.guard.test.ts` and `server/src/ciWorkflows.guard.test.ts`.

## Categories

Twelve, built in. A category is a search adapter plus a fallback duration; you cannot add your own from the UI.

| Category (`media_type`) | Search finds | Data source | Key needed |
|---|---|---|---|
| Movies (`movie`) | An actor, a director, a film series, a studio | TMDB | `TMDB_API_KEY` |
| TV Shows (`tv`) | A show and its episodes, specials included | TMDB | `TMDB_API_KEY` |
| Animation (`animation`) | An animated series, or a studio's films | TMDB | `TMDB_API_KEY` |
| Documentaries (`documentary`) | A documentary series, or a film-maker's documentaries | TMDB | `TMDB_API_KEY` |
| Pro Wrestling (`wrestling`) | WWE, AEW, TNA, ROH | Wikipedia event tables | none |
| MMA (`mma`) | UFC, Bellator, PFL | Wikipedia event tables | none |
| Games (`game`) | A franchise or collection | IGDB | `IGDB_CLIENT_ID` + `IGDB_CLIENT_SECRET` |
| Comics (`comic`) | A volume and its issues, in reading order | Comic Vine | `COMIC_VINE_API_KEY` |
| Books (`book`) | An author and their bibliography | Open Library | none |
| Music (`music`) | An artist and their discography | MusicBrainz | none |
| YouTube (`youtube`) | A playlist, or every upload from a channel | YouTube Data API | `YOUTUBE_API_KEY` |
| Mega (`mega`) | A cross-media franchise (films, series, animation in release order) | the List Vault only | none |

**Mega is curated lists only.** It offers community-library lists, never a connector search, and a user cannot build a Mega list from a connector. Television inside a Mega list is counted by season, so a franchise like the MCU stays a checklist people finish.

Every list can also be typed in by hand in any category, or imported from a YAML file (format: [CONTRIBUTING.md](CONTRIBUTING.md)).

**Order** is each item's position, nothing else. Drag to reorder, or run the one-off *Sort by release date* action (by year; each group moves as a block). **Deleted items stay deleted**: a refresh does not offer them back unless the user asks for deleted entries to be re-added.

## The four helper buttons

| Button | Mechanism |
|---|---|
| I'm Tired, Boss | strategy `tired-boss`: favours long-neglected lists close to done, excluding the list (and the medium) you are sick of |
| Finalizer | strategy `finalizer`: the list closest to being finished (a wrapped-up list before an ongoing one) |
| Just One Fix | strategy `just-one-fix`: the shortest unconsumed item across all lists |
| Surprise Me | choose a category; offers a List Vault entry of that category to preview and add |

`config/strategies/` also holds `suggest.json` and `quickie.json`, served by the same engine.

## Install (desktop app)

Download the installer from the [Releases page](https://github.com/gerharar/listulator/releases):

| System | File | Requirements |
|---|---|---|
| Windows | `Listulator_<version>_x64-setup.exe` | 64-bit Windows. The installer fetches Microsoft's WebView2 runtime if missing |
| macOS | `Listulator_<version>_aarch64.dmg` | Apple silicon, macOS 11 or newer. Intel Macs are not supported |

The installers are **not code-signed**, so Windows SmartScreen ("More info", then "Run anyway") and macOS Gatekeeper (System Settings, Privacy & Security, "Open Anyway") warn on first run. Nothing is wrong with the file; the checks below show it is the one this repository's pipeline built.

### Checking a download

Each release lists `SHA256SUMS` next to the installers.

1. **Checksum** (no account needed):
   - macOS, in the download folder: `grep dmg SHA256SUMS | shasum -a 256 -c` should print `OK`.
   - Windows PowerShell: `Get-FileHash .\Listulator_<version>_x64-setup.exe -Algorithm SHA256` (or cmd: `certutil -hashfile Listulator_<version>_x64-setup.exe SHA256`); the value must equal that file's line in `SHA256SUMS`.
2. **Build attestation**: a signed statement kept by GitHub that this exact file was built from this repository by its release workflow. Needs the [GitHub CLI](https://cli.github.com/) signed in:
   ```
   gh attestation verify Listulator_<version>_aarch64.dmg --repo gerharar/listulator
   ```
   It should end with "Verification succeeded". Use the `.exe` name for Windows. Stricter: add `--signer-workflow gerharar/listulator/.github/workflows/release.yml --source-ref refs/tags/v<version>`.

## Updates (desktop app)

- The app checks for an update **only** when the About screen opens or the user presses Check; there is no background polling, and nothing installs without a press.
- It reads `https://github.com/gerharar/listulator/releases/latest/download/latest.json`, so only a *published stable* release is ever offered (drafts and pre-releases are ignored by GitHub's `latest`).
- An update is installed only if it carries a minisign signature made with the maintainer's updater key, whose public half is built into the app (`plugins.updater.pubkey` in [`tauri.conf.json`](apps/desktop/src-tauri/tauri.conf.json)); the signed version must match the announced one (`requireSignedVersion`), and the same or an older version is never offered. The private key is held offline by the maintainer and is never available to CI.
- On Windows the installer is the update file (run with `/UPDATE`, the data folder is kept); on macOS the app archive replaces the app, then the app restarts.
- A check contacts github.com (the plugin's user agent is `tauri-plugin-updater/<version>`); that is the only network use that is not a library, connector or link action.
- The updater is called through three admitted shapes only (`plugin:updater|check`, `plugin:updater|download_and_install`, the app's own `relaunch`); see `web/src/lib/tauriUpdater.ts` and the hook.

## Development

Prerequisites: Node `26.12.1` (use the version in `.node-version`; a version manager such as `nvm`, `fnm` or `volta` reads it) and npm 11.

```bash
npm install            # use `npm ci --ignore-scripts` for a clean, script-free install
npm run dev            # server on :3001 and web on :5173, together
npm run test           # every workspace's tests (Vitest; cargo test for the desktop crate)
npm run lint           # eslint .
npm run typecheck      # tsc --noEmit in every workspace
npm run build          # server (tsc) and web (vite build) outputs
npm run format         # prettier --write .
```

Single workspaces: `npm run test -w @listulator/server`, `npm run dev -w @listulator/web`, `npm run test:e2e -w @listulator/web` (Playwright, see `web/playwright.config.ts`; install the browsers once with `npx playwright install`).

The dev server binds IPv4 only; run Vite with `--host` to reach it from another device on the network.

Database (server): `npm run db:generate` (after changing `server/src/db/schema.ts`) writes a new migration into `server/drizzle/`; `npm run db:migrate` applies the migrations to `DATABASE_PATH`.

Repository tools (all `tsx` scripts in `server/src/tools/`):

| Command | Purpose |
|---|---|
| `npm run lists:generate -w @listulator/server` | Draft a list file from a connector (a draft is hand-reviewed before it is committed) |
| `npm run lists:index -w @listulator/server` | Regenerate `lists/index.json` |
| `npm run platforms:generate` / `platforms:check` (`-w @listulator/server`) | Game platform names from `config/platforms.csv` |
| `npm run version:set -w @listulator/server -- <version>` | Set the version in every file that carries it (the `package.json` files, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`; the list is in `server/src/tools/versionSources.ts`) and check the result |
| `npm run notices` | Regenerate `THIRD-PARTY-NOTICES.txt` from the lockfiles |

A list contribution is validated by `scripts/pre-commit` (one-time install in [CONTRIBUTING.md](CONTRIBUTING.md)).

### Changing the wording

Every word the interface says lives in [`web/src/locale/en.ts`](web/src/locale/en.ts), including the text of server errors (they travel as codes and are worded on the client). `de.ts` and `ru.ts` follow the same shape; a new language is a new file.

### Conventions

- TypeScript strict; named exports only; no default exports.
- The current user always comes from the shared resolver, never from a default-user constant.
- Tests come first for new behaviour; guard tests pin rules that must not drift (workflows, capabilities, the isolation hook, public documents' links, version sources).
- `media_type` is an open registry (see above); suggestion strategies are configuration, not code.

## Building the desktop app

Prerequisites: the Node and Rust versions above (`rustup` reads `rust-toolchain.toml` by itself) plus the platform prerequisites of [Tauri 2](https://v2.tauri.app/start/prerequisites/): Xcode Command Line Tools on macOS; the Microsoft C++ Build Tools and WebView2 on Windows.

```bash
npm ci --ignore-scripts
npm run dev -w @listulator/desktop                       # a dev window against the Vite dev server (identifier com.listulator.desktop.dev)
npm run tauri:build -w @listulator/desktop -- -- --locked   # release bundles for the host system
```

- Output is under `apps/desktop/src-tauri/target/release/bundle/` (`macos/Listulator.app`, `dmg/*.dmg` on macOS; `nsis/*.exe` on Windows). The `-- --locked` makes cargo refuse a `Cargo.lock` that disagrees with `Cargo.toml`.
- Only the NSIS installer on Windows: `npm run tauri:build -w @listulator/desktop -- --bundles nsis -- --locked`.
- A debug build (inspector available) of the same code: add `--debug`. For a *separate app* that never touches a real library, also add `--config src-tauri/tauri.probe.conf.json` (name `ListulatorProbe`, identifier `com.listulator.desktop.probe`).
- Overlay configs in `apps/desktop/src-tauri/`: `tauri.dev.conf.json` (dev identity and the devtools shortcut, used by `tauri dev` only), `tauri.updater-artifacts.conf.json` (switches on update-file creation; used by the release workflow only), `tauri.updater-test.conf.json` (a test app that talks to a local update server; never in a release), `tauri.probe.conf.json` (see above). Guard tests keep the test and probe files out of every release path.
- Windows installers are normally built by CI, not locally: Actions, "Desktop (Windows)", Run workflow (`release` or `debug`); the installer is a three-day artifact.

## Release pipeline (maintainers)

1. `npm run version:set -w @listulator/server -- 1.2.3`, commit, push to `main`.
2. Push an annotated tag `v1.2.3` (only the maintainer may create `v*` tags; the tag must equal `v` + the version in `package.json`, and its commit must be on `main`).
3. [`release.yml`](.github/workflows/release.yml) builds on pinned runners (Windows x64 NSIS, macOS arm64 `.app` + `.dmg` + update archive), audits the bundles (contents, minimum macOS, identifier, version, architecture, seal), attests every file with GitHub build provenance, and creates a **draft** Release holding the installers, `Listulator.app.tar.gz` and `SHA256SUMS`. CI holds no updater key: each build job makes its own throw-away key only to let the bundler run, and the signatures it makes are never uploaded.
4. On the maintainer's own machine, `npm run release:sign -- v1.2.3 --key-file <key>` (from a clean checkout of the tag) re-checks the draft (checksums, attestations bound to the workflow, tag and commit), signs the Windows installer and the macOS archive with the offline updater key, verifies the signatures against the key built into the app, builds and re-validates `latest.json`, and uploads the two `.sig` files and `latest.json` to the draft.
5. The maintainer reviews the draft (seven files: installer, its `.sig`, `.dmg`, archive, its `.sig`, `latest.json`, `SHA256SUMS`) and publishes it.

## Configuration (server)

Everything has a working default. To change something, copy `.env.example` to `.env` in the repository root; `.env` is gitignored and an exported shell variable always wins.

```bash
cp .env.example .env
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `3001`, `127.0.0.1` | Where the server listens |
| `ALLOWED_HOSTS` | (none) | Extra host names the server answers to when `HOST` is not loopback; not a login |
| `DATABASE_PATH` | `data/listulator.sqlite` | The SQLite file |
| `LIST_VIRTUALIZATION` | `auto` | `off` (also `false`, `0`, `no`) draws every row of every list instead of a window of the long ones; the browser's `localStorage` key and the desktop's `preferences.json` key `listVirtualization` do the same, and `off` from any of them wins. See `guides/long-lists.md` |
| `SINGLE_USER_MODE` | `true` | The only supported value; `false` makes every request answer 501 |
| `STRATEGIES_DIR` | `config/strategies` | Where the suggestion strategies are read from |
| `LISTS_DROP_DIR` | `server/list_customs/` | Drop folder for custom-list files (`POST /api/lists/scan-folder`) |
| `TMDB_API_KEY`, `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `COMIC_VINE_API_KEY`, `YOUTUBE_API_KEY` | (none) | API keys, below |

### API keys

Keys are only needed for **search** in the matching categories. Without one that category has no search and items are added by hand or from the List Vault; nothing breaks.

| Variable | Category | How to get it |
|---|---|---|
| `TMDB_API_KEY` | Movies, TV, Animation, Documentaries | [guides/tmdb-key.md](guides/tmdb-key.md) (free, noncommercial) |
| `IGDB_CLIENT_ID` + `IGDB_CLIENT_SECRET` | Games | [guides/igdb-key.md](guides/igdb-key.md) (a Twitch developer application) |
| `COMIC_VINE_API_KEY` | Comics | [guides/comic-vine-key.md](guides/comic-vine-key.md) (free, needs an account) |
| `YOUTUBE_API_KEY` | YouTube | [guides/youtube-key.md](guides/youtube-key.md). No billing account is needed; the free quota is 10,000 units a day, a search by channel name costs 100, pasting a link or `@handle` about 1 |

Music (MusicBrainz), books (Open Library), wrestling and MMA (Wikipedia) need no key. The List Vault needs only an internet connection.

In the **desktop app** the keys are typed into Settings, not read from the environment.

## Data and keys on the desktop

Everything is in one data folder named after the app identifier, `com.listulator.desktop`: the library (`listulator.sqlite`), preferences, and the API keys (`settings.json`).

- Keys are stored as **plain text**; only the operating-system account (and disk encryption: FileVault, BitLocker) protects them. They are sent only to the service they belong to and are kept out of error messages. TMDB, YouTube and Comic Vine take the key in the request address, as their documentation asks, so that service's own logs can see it (a TMDB *read access token* goes in a header instead); IGDB's secret goes in the body of its request.
- Remove one key: clear its field in Settings.
- Remove everything on Windows: uninstall and tick **Delete the application data** (removes `%APPDATA%\com.listulator.desktop` and `%LOCALAPPDATA%\com.listulator.desktop`).
- Remove everything on macOS: there is no uninstaller; quit the app, trash it, and delete

  | Folder | Contents |
  |---|---|
  | `~/Library/Application Support/com.listulator.desktop` | library, preferences, **keys** |
  | `~/Library/Caches/com.listulator.desktop` | webview cache |
  | `~/Library/WebKit/com.listulator.desktop` | webview storage |
  | `~/Library/Logs/com.listulator.desktop` | logs |

  or in Terminal (this also deletes the library and keys): `rm -rf ~/Library/{"Application Support",Caches,WebKit,Logs}/com.listulator.desktop`
- A Mac cache from a very old build may still hold a copy of a TMDB or YouTube key (those answers were once cached by the webview); delete `~/Library/Caches/com.listulator.desktop` once if you used such a build.

The self-hosted server reads its keys from environment variables, not from this folder.

## The List Vault

`lists/<category>/*.yaml` are hand-reviewed, canonical lists (the Mega category exists only through them). `lists/index.json` is the manifest the app reads; the app fetches the manifest and list files from this repository's `main` branch, validates and bounds them, and never executes anything from them. Contributions: [CONTRIBUTING.md](CONTRIBUTING.md) (format, the CC BY 4.0 licence of a contribution, and what data must not be pasted in). Every `lists/` file is reviewed by the maintainer before it is merged.

## Installing the web build on a phone

The web build is a PWA and installs to a home screen, but **only over HTTPS**: browsers register a service worker on a secure origin only (`localhost` is the single exception), so `http://192.168.x.x:5173` shows the app but will not offer to install it. Put it behind a reverse proxy with a certificate, or use something like Tailscale. The phone layout has not been checked on real hardware, and this is not a supported way to use Listulator.

## Security

Report a vulnerability as described in [SECURITY.md](SECURITY.md) (private vulnerability reporting). Ordinary bugs and feature requests go to [Issues](https://github.com/gerharar/listulator/issues).

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE): free for personal and other noncommercial use (run, self-host, modify, fork, share); commercial use is not permitted. This is a source-available licence, not an OSI-approved open-source one. Third-party notices are in [NOTICE.md](NOTICE.md) and [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
