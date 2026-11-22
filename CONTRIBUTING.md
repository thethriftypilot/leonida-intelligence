# Contributing

Thanks for wanting to help. Leonida Intelligence is a small fan project, so issues and pull
requests are reviewed when time allows.

## Ground rules for data

Data accuracy matters more than the number of pins. Changes that add or alter locations must
follow these rules:

1. **Never invent coordinates.** If a place's exact position isn't published, keep it
   unplaced (`x`/`y` = `null`). Don't estimate a position from real-world Florida/Miami
   geography.
2. **Every record needs a source.** Give a link to where the information came from, such as a
   guide, an in-game screenshot or a dataset.
3. **Only use sources that allow reuse.** Open licences (CC BY, MIT, …), published APIs and
   feeds are fine. Scraping sites whose terms or `robots.txt` forbid it is not; that includes
   mapgenie.io. See [docs/research.md](docs/research.md).
4. **Respect spoilers.** Story content must carry a chapter (`chapterMin`) and a `spoiler`
   level so it stays hidden from players who haven't reached it.
5. **"Verified" is reserved for each user's own in-game confirmation.** Sources can at most
   make something *community corroborated*.

## Reporting a wrong or missing location

Open a **Data correction** issue. Include the place, what's wrong and a source link. A
screenshot of the in-game map is ideal.

## Development setup

```sh
git clone https://github.com/thethriftypilot/leonida-intelligence.git
cd leonida-intelligence
npm install
node --disable-warning=ExperimentalWarning scripts/fetch-data.ts   # map tiles (needs git)
npm run dev:server     # API on :5180
npm run dev:web        # web app on :5173
```

Before opening a pull request, run:

```sh
npm run typecheck
npm test
npx playwright install chromium && npm run test:e2e   # browser tests (need the map tiles)
```

- New source adapters go in `server/ingest/`. Copy the pattern in `gtadb.ts` or `lootmap.ts`:
  a stable `sourceKey`, a licence and attribution, a fallback when the network fails, and unit
  tests using fixtures.
- Keep changes focused, and describe in the pull request what you tested.

## Code of conduct

Be kind and constructive. Harassment, spoilers posted without warning, and links to pirated or
leaked material aren't welcome.
