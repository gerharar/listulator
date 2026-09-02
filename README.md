# Duldulator

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

## Status

Early development. See [`SPEC.md`](SPEC.md) for the design,
[`tasks/plan.md`](tasks/plan.md) for the build plan, and
[`docs/DECISIONS.md`](docs/DECISIONS.md) for why things are the way they are.

## Stack

Node.js + TypeScript (Fastify) · React + Vite · SQLite (Drizzle ORM) ·
npm workspaces. No Docker required, no separate database server — the whole
thing is a Node process and a SQLite file.

## Development

```bash
npm install
npm run dev        # server + web
npm run test
npm run lint
npm run typecheck
```

## License

[AGPL-3.0](LICENSE) — free to self-host and modify. If you run a modified
version as a public service, you must publish your changes.
