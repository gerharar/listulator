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

Per-item fields:

| Field     | Required? | Notes |
|-----------|-----------|-------|
| `title`   | Yes       | Rejected with a specific error if missing — never silently dropped. |
| `year`    | No        | Release/publication year. |
| `minutes` | No        | Time to consume. Omit it if there's no meaningful single answer (see the book example below) — it falls back to the category's default duration with `is_estimated: true`, the same rule every built-in data source already follows. |
| `group`   | No        | A free-text label for items that need internal structure, e.g. `group: Season 1`. The same field works for a TV season, a comic story arc, or anything else that needs grouping — there's no category-specific shape. |

Example using `group`:

```yaml
title: Some Show
category: tv
items:
  - { title: Pilot, group: Season 1 }
  - { title: Episode Two, group: Season 1 }
  - { title: Season Premiere, group: Season 2 }
```

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

## `lists/index.json`

A flat manifest of every list in `lists/`, `{path, title, category}` per
entry — the file the sync feature actually fetches, rather than crawling
GitHub's directory API and hitting its unauthenticated rate limit. **This
is currently maintained by hand and updated by whoever merges a list PR**;
there's no generator script yet. If you're contributing a list, add your
own entry to `lists/index.json` in the same PR.

## Example files

`lists/mega/marvel-cinematic-universe.yaml` and
`lists/book/lord-of-the-rings.yaml` are real starter lists, not
placeholders — they double as fixtures for the parser's own tests. Use
them as a model, or replace/extend them with more accurate or more
complete data via PR.
