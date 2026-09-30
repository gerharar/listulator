# Listulator

A self-hostable **completionist tracker** for serialized and pseudo-serialized
media — built around *finishing* curated lists, not logging arbitrary one-off
media.

All the Jackie Chan movies. Every WWF PPV. The full Fantastic Four run. A
band's discography. A game franchise. Each is its own list; you check things
off, watch the completion percentage climb, and when you don't know what to
pick up next, the app tells you.

## Why

Existing watchlist apps track *individual* items. This one tracks *lists* —
progress toward 100% is the unit that matters, and the suggestion engine
exists to keep you moving forward on them instead of losing steam.

## The three buttons

When you don't know what to consume next:

| Button | What it does |
|---|---|
| **I'm tired, boss** | You name the list you're sick of; it suggests a different one — favouring long-neglected lists that are close to done, so you actually finish things. |
| **Suggest** | Picks something fresh: long-neglected lists you haven't started or have barely touched, avoiding the ones stuck in the middle. |
| **Quickie** | Whatever you can finish fastest. |

The ranking logic for each button lives in a plain JSON file under
`config/strategies/` — tune the weights, restart nothing, no rebuild.

## Categories

Twelve, built in. You can't add your own from the app: a category is a search
adapter plus a fallback duration, not just a name.

| Category | Search finds | Where the data comes from |
|---|---|---|
| Movies | An actor, a director, a film series, a studio | TMDB |
| TV Shows | A show → its episodes, specials included | TMDB |
| Animation | An animated series, or an animation studio's films | TMDB |
| Documentaries | A documentary series, or a film-maker's documentaries | TMDB |
| Wrestling | WWE, AEW, TNA, ROH | Wikipedia event tables |
| MMA | UFC, Bellator, PFL | Wikipedia event tables |
| Games | A franchise or collection | IGDB |
| Comics | A volume → its issues, in reading order | Comic Vine |
| Books | An author → their bibliography | Open Library |
| Music | An artist → their discography | MusicBrainz |
| YouTube | A playlist, or every upload from a channel | YouTube Data API |
| Mega | A cross-media franchise — films *and* series together, in release order | TMDB |

**Mega** is the odd one, and deliberate. Marvel is films, live-action series
and animation at once, so no medium category can hold it — and the question
isn't "where does this data live" but "where do I look". Television in a Mega
list is counted by *season*, because an MCU list at episode granularity runs to
several hundred entries against 56 films and stops being a checklist anyone
finishes. As seasons it is 111 entries — 56 films, 55 seasons.

Every list can also be typed in by hand, in any category.

### Ordering

Order works the same in every category: it's just each item's position, not
its `year` or any tag. Drag-reorder by hand, or run the one-off **Sort
chronologically** action to re-sort by year (each group moves as a block).
Category never changes this.

### Lists stay yours

Imports are deliberately imperfect — a filmography includes things you'd never
watch. Delete them and they stay deleted: a rescan won't offer them back. If
you delete something by mistake, tick **Re-add deleted entries** before
rescanning and it returns.

## Status

Feature-complete for phase 1 and walked end to end: all twelve categories, all
three suggestion buttons, list refresh, and a PWA build. Single-user only (see
`SINGLE_USER_MODE` below).

Not done yet: the phone layout hasn't been checked on real hardware, and
multi-tenancy is scaffolded in the schema but not switched on.

See [`SPEC.md`](SPEC.md) for the design, [`tasks/plan.md`](tasks/plan.md) for
the build plan, and [`docs/DECISIONS.md`](docs/DECISIONS.md) for why things are
the way they are — including the things that were tried and rejected.

## Stack

Node.js + TypeScript (Fastify) · React + Vite · SQLite (Drizzle ORM) ·
npm workspaces. No Docker required, no separate database server — the whole
thing is a Node process and a SQLite file.

## Development

```bash
npm install
npm run dev        # server (:3001) + web (:5173)
npm run test
npm run lint
npm run typecheck
npm run build
```

The dev server binds IPv4 only; use `vite --host` to reach it from another
device on your network.

### Changing the wording

Every word the interface says lives in
[`web/src/locale/en.ts`](web/src/locale/en.ts) — including the text of server
errors, which travel as codes and are worded on the client. Edit that one file
to reword anything; a second language is a second file.

## Configuration

Everything has a working default, so the app runs with no configuration at
all. To change something, copy `.env.example` to `.env` in the repo root:

```bash
cp .env.example .env
```

`.env` is gitignored, and an exported shell variable always wins over the file.

`SINGLE_USER_MODE` defaults to `true`: one implicit local user, no login, no
account to create. Every table is already `user_id`-scoped and handlers only
ever get the current user from a shared resolver, so switching this off later
is a config change rather than a rewrite — but the multi-user path isn't
implemented, and setting it to `false` today makes every request answer 501.

### API keys

Keys are only needed for **search**. Without one, that category simply has no
search and you add items by hand — nothing breaks, and no key is needed to use
the app at all.

| Variable | Category | Where |
|---|---|---|
| `TMDB_API_KEY` | Movies, TV, Animation, Documentaries, Mega | themoviedb.org → Settings → API (free, non-commercial) |
| `IGDB_CLIENT_ID` + `IGDB_CLIENT_SECRET` | Games | dev.twitch.tv/console/apps → register an app |
| `COMIC_VINE_API_KEY` | Comics | comicvine.gamespot.com/api (free, needs an account) |
| `YOUTUBE_API_KEY` | YouTube | See below |

Music (MusicBrainz), books (Open Library), wrestling and MMA (Wikipedia) need
no key and are always on.

#### Getting a YouTube key

More involved than the others, so in full:

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and sign
   in with any Google account.
2. Create a project — the dropdown in the top bar, then **New Project**. Name it
   anything.
3. Enable the API:
   [console.cloud.google.com/apis/library/youtube.googleapis.com](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
   → **Enable**. (Or *APIs & Services → Library*, search "YouTube Data API v3".)
4. Create the key: *APIs & Services → Credentials* →
   **+ Create Credentials → API key**. It looks like `AIza…`, 39 characters.
5. Optional but worth it: **Restrict key** → *API restrictions* → limit it to
   YouTube Data API v3, so a leaked key cannot be spent on other Google
   services.

**No billing account is required.** The free quota is 10,000 units a day.
Searching by channel name costs 100 units per search — about 100 a day — while
pasting a link or an `@handle` costs roughly 1, so the quota rarely matters in
practice.

### Installing it on a phone

The built app is a PWA — it installs to a home screen and runs without browser
chrome. **This requires HTTPS.** Browsers only register a service worker on a
secure origin, and `localhost` is the only exception, so opening
`http://192.168.x.x:5173` on a phone will show the app but will not offer to
install it. Put it behind a reverse proxy with a certificate, or use something
like Tailscale, and installation works.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for personal and other
noncommercial use: run it, self-host it, modify it, fork it and share it.
Commercial use is not permitted under this licence.

This is a source-available licence, not an OSI-approved open-source one.
The data sources have their own terms: TMDB and Comic Vine are free only for
noncommercial use.
