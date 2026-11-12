# The identity tool

Shows that a change meant to leave a theme looking exactly as it did has done so. It takes a screenshot and a dump of every element (box, computed
colour, background, border, outline, shadow, opacity, filter, font, letter-spacing, `::before` / `::after` included) of every screen, in every skin of
every theme, in Chromium and WebKit, and later compares a fresh capture with an earlier one. Not part of `npm test`.

## Run it

Close `tauri dev` first: the tool boots its own app on a throw-away database and needs ports 5173 and 3001. Browsers do not launch in the Claude Code
sandbox, so run it outside it.

```bash
cd web
# 1. Take a baseline at a commit you trust. The label is yours: the short commit id is a good one.
IDENTITY_MODE=capture IDENTITY_BASELINE=b475e5d npm run identity
# 2. After a change: the same screens again, every difference listed. No difference means every test passes.
IDENTITY_MODE=compare IDENTITY_BASELINE=b475e5d npm run identity
```

Two baselines matter for eX-Zed (Phase 49): `x003`, the Quantum screens as they are with the theme built (compare Quantum against it with
`IDENTITY_THEME=quantum`), and `exzed-x003`, eX-Zed's own 26 screens x 6 skins x 2 engines, which the later eX-Zed phases (X-006, X-007) compare
against so each shows only its intended differences (`IDENTITY_MODE=compare IDENTITY_BASELINE=exzed-x003 IDENTITY_THEME=exzed npm run identity`).
A compare straight after a capture is zero, for both.

`exzed-x003` was captured at 49.14 and **re-captured on 2026-11-12, after Phase 50 (X-006) and the owner's look** (Checkpoint F): it now holds eX-Zed with its art, the Spectrum border, the Settings row, the picker's scene and tile plates, the category banners and the header's paper cells, the vault door and the Xen and Ikigai bridge tiles. A compare straight after it passes in full (314). X-007 compares against it, so each of its tasks shows only its intended differences; it is re-captured again only after the owner has looked at X-007. One slot (`exzed-1b / list`, Chromium) was captured a second time because the first capture, written during the 3-worker run, differed from every later render by 24 anti-aliased icon pixels. Glemt's wall was replaced afterwards (2026-11-12, design's rebuilt `grey-stones-wall.png`, now the same drawing as Focal's), and Glemt's (`exzed-1b`) 52 slots were re-captured the same day after the owner had looked at it (a capture of that skin alone, one worker); the full compare then passed (314). Quantum's `x003` is never re-captured for this.

Narrow it with `IDENTITY_THEME=quantum`, `IDENTITY_STATE=list`, `--project=chromium`, `-g "dark-orange"`. Run `compare` straight after a `capture` once:
that is the check that the baseline is repeatable.

Captures live in `web/e2e-tools/baselines/<label>/<theme>/<skin>/<engine>/<state>.{png,json}` and are git-ignored (screenshots depend on the machine).
A failing comparison keeps the screenshot it saw in `baselines/_current/` to put beside the baseline.

## Reading a failure

Each line is one difference, by the last three steps of the element's path: `box` (its rectangle), `style` (a computed value, before -> after), `text`,
`added`, `removed`. The screenshot line says how many pixels differ and within which box. A change that moves nothing visible shows in the dump only;
one that only changes pixels (a gradient, an image) shows in the screenshot only.

## Adding a theme, a skin or a screen

- A theme or a skin: an entry in `identity/themes.ts`: its skin keys, the preferences that select it (`seed`) and the preference its skin is stored under
  (`skinKey`: Quantum's `skin`, eX-Zed's `exzedSkin`). No state and no capture code changes. `identityThemes.guard.test.ts` (in `npm test`) keeps eX-Zed's
  list equal to the app's six skins.
- A screen: an entry in `identity/states.ts`. One list for every theme, so a new screen is added once. A state only reads; one that has to write
  (a toast, a drag) makes a list of its own with `ownList` and removes it.
- Routine for a new theme: capture every existing theme at the commit before, add the theme, compare every existing theme (zero difference), then
  capture the new theme's own baseline.

## What it cannot see

- **Motion.** It runs with reduced motion on. With motion on, the same page rasterises some icon edges differently on every load (four loads, four
  different screenshots), so identical CSS would not give identical pixels. Keyframes are therefore not compared; their end states are.
- **Noise under load.** About one load in ten, a few icon edges still differ by a few levels. A failing comparison is repeated in a fresh page up to twice;
  a state that passes only on a repeat is reported as flaky. A real difference fails every time.
- **Network content.** Home's lists are the seed lists with fixed dates; the community library and the Preview's search and expansion are answered
  with fixed data; the clock is fixed. Anything not in `states.ts` is not looked at.
