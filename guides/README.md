# Guides

Step-by-step guides the app links to. English only.

| Guide | Linked from |
|---|---|
| [Get a TMDB key](tmdb-key.md) | Settings → API keys → TMDB → How? |
| [Get an IGDB key](igdb-key.md) | Settings → API keys → IGDB → How? |
| [Get a Comic Vine key](comic-vine-key.md) | Settings → API keys → Comic Vine → How? |
| [Get a YouTube key](youtube-key.md) | Settings → API keys → YouTube → How? |

## Writing a guide

- **Do not rename or move a guide.** Every installed copy of the app links to
  its file name (`web/src/lib/guides.ts`), and a rename breaks the button in
  all of them. Add a new file instead, and change the link in a new release.
- Screenshots go in `images/`, named `<guide>-<step>-<what>.png`
  (`tmdb-2-request-key.png`). Crop to the part that matters, hide any key or
  e-mail address, and keep each file under about 200 KB: every image stays in
  git history for good.
- Each step is one thing to do. The app's own short version of the steps (kept
  in the locale files, not shown at the moment) should stay true to the guide.
- A guide ends with the line the app tells people to do last: paste the key into
  Settings → API keys, then press Test.
- Sites change. Put a "Last checked" date at the top and update it when you
  walk through the steps again.
