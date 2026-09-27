# Contributing a list

Listulator's curated lists live in this repo, under `lists/`, and are
reviewed and merged the same way any other change is: open a pull request.
Once merged, a list is pullable into any instance with one click (the sync
feature reads `lists/index.json`, not GitHub's directory API).

Background and full design intent: [`docs/intent/custom-lists.md`](docs/intent/custom-lists.md).

## File format

A list is a single YAML file: a title, a category, and a flat array of items.

```yaml
title: Marvel Cinematic Universe (Release Order)
category: mega
items:
  - { title: Iron Man, year: 2008, minutes: 126 }
  - { title: The Incredible Hulk, year: 2008, minutes: 112 }
```

Block style works identically to the inline flow-mapping style shown above —
use whichever you find more natural:

```yaml
title: Marvel Cinematic Universe (Release Order)
category: mega
items:
  - title: Iron Man
    year: 2008
    minutes: 126
```

Top-level fields:

| Field         | Required? | Notes |
|---------------|-----------|-------|
| `title`       | Yes       | Rejected with a specific error if missing — never silently dropped. |
| `description` | No        | A longer free-text blurb alongside `title` — a sentence or two of context, not a synopsis. |
| `category`    | Yes       | See "`category` must be one of the fixed keys" below. |
| `status`      | No        | The production status of the thing the list is about — is it still being released, or finished? — not your own progress through it. Exactly `complete` or `ongoing`; omit it if you don't know. |
| `items`       | Yes       | A flat array, always in chronological order (see `group` below). |

```yaml
title: Some Show
description: A procedural that ran for a decade before wrapping up.
category: tv
status: complete
items:
  - { title: Pilot }
```

Per-item fields:

| Field     | Required? | Notes |
|-----------|-----------|-------|
| `title`   | Yes       | Rejected with a specific error if missing — never silently dropped. |
| `year`    | No        | Release/publication year. |
| `minutes` | No        | Time to consume. Omit it if there's no meaningful single answer (see the book example below) — it falls back to the category's default duration with `is_estimated: true`, the same rule every built-in data source already follows. |
| `group`   | No        | A free-text label for items that need internal structure, e.g. `group: Season 1`. The same field works for a TV season, a comic story arc, or anything else that needs grouping — there's no category-specific shape. Every list always renders in chronological order; `group` only labels contiguous runs within that order and has no other effect. |
| `tags`    | No        | A list of short free-text strings, rendered as badges, e.g. `tags: [Album, Live]`. One generic field for every category — there's no fixed vocabulary or category-specific field name. Use whatever short labels make sense for what you're contributing: a music release type, a book's language, a franchise entry's medium, a promotion's event format, or anything else worth flagging at a glance. Purely a display attribute — it never affects ordering or `group`. |
| `notes`   | No        | Curator prose explaining *why this item is here*, shown read-only in the app — never a synopsis, and never your own commentary. Add one only when a reader would otherwise be confused, e.g. `notes: "Same game as the PS3 entry above, but this platform shipped extra missions."` Capped at 2048 characters; longer values are rejected, not truncated. |

Example using `group`:

```yaml
title: Some Show
category: tv
items:
  - { title: Pilot, group: Season 1 }
  - { title: Episode Two, group: Season 1 }
  - { title: Season Premiere, group: Season 2 }
```

Example using `tags`:

```yaml
title: Some Band — Discography
category: music
items:
  - { title: Debut Album, year: 2001, tags: [Album] }
  - { title: Live in Concert, year: 2004, tags: [Album, Live] }
  - { title: B-Sides EP, year: 2005, tags: [EP] }
```

### Games: `tags` are platform codes

In a `game` list, `tags` are the game's platforms, written as the codes in
[`config/platforms.csv`](config/platforms.csv) (the `abbreviation` column; any
case), or `multi` for "the same game on every platform it shipped on":

```yaml
  - { title: Halo 3, year: 2007, tags: [X360] }
  - { title: The Witcher 3, year: 2015, tags: [WIN, PS4, XONE] }
```

The check below refuses a code that is not in that file, including older
codes the app still reads (`PC` is now `WIN`). To add or rename a platform,
edit `config/platforms.csv` (codes in capitals, never digits only: a bare
`2600` is a number to YAML, so Atari 2600 is `A2600`), then run
`npm run platforms:generate -w server` and commit both files.
`npm run platforms:check -w server` (needs IGDB keys in `.env`) lists any
platform IGDB has that the file lacks; games on those import untagged.

## `category` must be one of the fixed keys

`category` is validated against the app's existing, closed category
registry — never a value you invent. Use the **key**, not the display name:

| Key           | Display name    |
|---------------|------------------|
| `movie`       | Movies           |
| `tv`          | TV Shows         |
| `animation`   | Animation        |
| `documentary` | Documentaries    |
| `wrestling`   | Wrestling        |
| `mma`         | MMA              |
| `game`        | Games            |
| `comic`       | Comics           |
| `book`        | Books            |
| `music`       | Music            |
| `youtube`     | YouTube          |
| `mega`        | Mega             |

Want a genuinely new category? That's a code change (a new adapter, a new
default duration, a new registry entry), not something a list file can
introduce — open an issue to discuss it rather than a list PR.

## Folder layout is for humans, not the app

`lists/<category>/<slug>.yaml` (e.g. `lists/wrestling/`, `lists/tv/`) is the
convention — it's just for browsing the repo. The file's own `category`
field is what the app actually reads, so a misfiled or later-moved file
can't silently change what it becomes.

## Safety

Files are parsed with a safe YAML loader only: no custom tags, no
executable content, by construction. A PR that requires anything else
won't be merged.

## What makes a PR mergeable

- Valid YAML, parseable by a safe loader.
- `category` is exactly one of the keys in the table above.
- Every item has a `title`.
- Ideally, a real list someone would actually want to track — not a test
  fixture (two are already in `lists/` for that purpose, see below).

## Catching a broken file before you commit it

A pre-commit hook validates every staged `lists/*.yaml` file through the
real parser and blocks the commit if one doesn't validate. It's local-only
(`.git/hooks/` isn't tracked by git), so install it once per clone:

```
ln -sf ../../scripts/pre-commit .git/hooks/pre-commit
```

`scripts/pre-commit` is the tracked source of truth — the symlink just
points your local hook at it. No new dependency: it shells out to `tsx`,
already used by the scripts above.

## `lists/index.json`

A flat manifest of every list in `lists/`, `{path, title, category}` per
entry, plus `description` and `status` when the list file itself sets
them (both optional — an entry without them is still valid) — the file the
sync feature actually fetches, rather than crawling GitHub's directory API
and hitting its unauthenticated rate limit. **Generated, not hand-edited**:
run

```
npx tsx server/src/tools/generateListsIndex.ts
```

from the repo root after adding or changing a list file, and commit the
resulting `lists/index.json` in the same PR. It re-parses every file under
`lists/` and fails loudly, naming the file, if anything doesn't validate —
so a passing run is also a check that your new file is well-formed.

## Example files

`lists/mega/marvel-cinematic-universe.yaml` and
`lists/book/lord-of-the-rings.yaml` are real starter lists, not
placeholders — they double as fixtures for the parser's own tests. Use
them as a model, or replace/extend them with more accurate or more
complete data via PR.
