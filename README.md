# Leonida Intelligence

A personal GTA VI map and discovery companion you run on one computer at home and
open from any browser on your network (PC, laptop, tablet or phone beside your PS5).

> **Unofficial fan tool.** Not affiliated with, endorsed by, or sponsored by Rockstar Games
> or Take-Two Interactive. For private, non-commercial use on your home network.

- **Interactive map of Leonida.** Full GTA VI game-map tiles with smooth zoom, clustering,
  category icons, a night style and an alternative community road map. It remembers your
  last view, and has region shortcuts, full screen, a measuring tool and your own pins.
- **Real, attributed locations.** About 4,000 sourced records: GTADB community landmarks
  (shops, Ammu-Nation, mod shops, safehouses, marinas, airports and so on) plus post-release
  gameplay guides and missions (bank jobs, payday loans, collectibles, meditations, races,
  activities). Each one links to its original source.
- **Progress tracking stored on the server.** Mark places visited, collected, completed,
  favourite or planned. You also get notes, custom pins, checklists, saved routes,
  statistics, backups and exports. Every device sees the same progress.
- **Self-updating research.** Every 12 hours (you can change this), and when you press
  *Check for updates*, the app checks its approved sources. It merges changes, records
  history, queues anything uncertain for your review and writes a report.
- **Spoiler protection** is enforced by the server. Hidden story content never reaches the
  browser, so search and suggestions can't leak it.
- **Smart tools:**
  - Find something useful, What should I get first, Nearby and the Discovery planner.
  - What am I missing, Recently found by the community and Surprise me.
  - Natural-language search, which runs offline with no AI subscription.

---

## Quick start (Windows 11)

Prerequisites: **Node.js 24+** and **git**. If you don't have them:

```powershell
winget install OpenJS.NodeJS
```

```powershell
winget install Git.Git
```

Close and reopen PowerShell. Then, in the project folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

The setup script:

1. Installs the dependencies.
2. Builds the web app.
3. Creates `.env`.
4. Downloads the map tiles and landmark data (about 100 MB).
5. Offers to add a Windows Firewall rule for your **Private** network only.

Start the app by double-clicking **`start.cmd`**, or run:

```powershell
.\start.cmd
```

Open **http://localhost:5180**. On the first start, the app imports its data in a few
seconds. To start the app automatically when you log on:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

### Opening it on another computer, tablet or phone

1. On the host PC, find its IP address. Look for the `IPv4 Address` of your Wi-Fi or
   Ethernet adapter, for example `192.168.1.153`:

   ```powershell
   ipconfig
   ```

   The server also prints every address it listens on when it starts.
2. On the other device, open `http://192.168.1.153:5180` (use your own address).
3. If the page doesn't load, Windows may be treating your network as *Public*. Go to
   Settings → Network & internet → your network → set **Private network**, then allow
   the firewall rule. See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

For a stable address, reserve the PC's IP in your router (a "DHCP reservation"), or use
its hostname, for example `http://MY-PC:5180`.

## Hosting on a Linux home server

**Docker (recommended):**

```sh
git clone <this project> leonida && cd leonida
cp .env.example .env          # optional: set LI_ACCESS_PIN, LI_PORT …
docker compose up -d          # first start downloads the map into ./data
```

The `./data` volume holds both databases, backups and the map. The container restarts
automatically, has a health check, and runs as a non-root user.

**Bare metal with systemd:** run `scripts/setup.sh`, then install
`deploy/leonida-intelligence.service` (instructions are inside the file).

**Moving from Windows to the server:**

1. In the app, go to *Tools → My data → Download backup*.
2. Set up the server.
3. Restore the backup there. You can also copy the whole `data/` folder while the app is
   stopped.

## Using it

| Area | What it does |
| --- | --- |
| Top bar | Search or ask a question, set your story **Progress** (chapter), spoiler shield, *Surprise me*, *Tools*, *Check for updates*, Dashboard, Full screen |
| Left panel | Map style, region shortcuts, categories (expand a category for its subcategories; **only** shows just that one), progress filters (hide completed, unvisited, favourites, planned), evidence filters, legend |
| Map | Click a pin for details. Solid ring = corroborated or verified; dashed ring = unconfirmed; faded = approximate area; dimmed with ✓ = done. Bottom-left shows game coordinates under the cursor. Right edge: **Measure**, **Add pin**, **I'm here** |
| Right panel | Details: description, how-to steps, chapter, rewards, evidence, source links, in-game photo where licensed, progress buttons, notes, your verdict, change history |
| Bottom bar | Completion ring, per-category progress, recently discovered by the community, recently completed by you |

Keyboard shortcuts: `/` focuses search, `Esc` closes panels or cancels a map action,
`F` toggles full screen. The arrow keys and `+`/`−` pan and zoom when the map has focus.

**Questions you can ask.** Search understands categories, "near <place>", "haven't
found", "right now/early", "missable/before next chapter", favourites and planned. For
example:

- "Where can I get a free gun early in the game?"
- "Show me hidden cash near Vice City"
- "Find rare cars I can access right now"
- "What secrets haven't I discovered?"
- "What should I do before moving to the next chapter?"

Each answer shows how the question was interpreted, and comes only from the local
database.

## Spoiler protection

- Default: **Prologue**, story spoilers hidden, late-game secrets hidden, items with an
  unknown chapter shown but labelled.
- *Story* content (missions, story jobs) beyond your chapter is **not sent to the
  browser at all**. The badge on the shield shows how many items are being withheld.
- *Gameplay* locations, such as a bank job that unlocks in Chapter 3, stay on the map.
  Their descriptions are hidden until you reach that chapter. This way you can see that a
  bank exists without being told why you'll rob it.
- *Reveal spoilers for 10 minutes* asks for confirmation, applies only to that browser
  tab, and expires on its own.
- Change your chapter from the **Progress** selector. It is saved on the server, so all
  your devices follow it.

## How research updates work

Each source is an isolated adapter. If one fails, the others still run, and the report
shows the failure.

| Source | Method | What it adds | Licence |
| --- | --- | --- | --- |
| **GTADB** (map.gtadb.org) | `git fetch` of a sparse checkout, as the maintainers request ("please do not fetch live data… simply git pull"). Falls back to the GitHub API and raw file, then to the pinned seed | Landmarks with in-game names, photos and POI tags; map tiles | CC BY 4.0 (data), MIT (code) |
| **GTA 6 Loot Map dataset** (GitHub) | GitHub commits API, then raw files at that commit. Falls back to the cached copy, then to the pinned seed | Bank jobs, payday loans, vaults, collectibles, meditations, race trials, activities, rewards, 176 missions with chapters. Positions are registered from publisher screenshots | MIT; each record links to its publisher article |
| **Guide & community feeds** (RSS/Atom) | Conditional GET (ETag / Last-Modified), at most one request per host every 1.5 s | **Research leads only**: titles and links in the review queue. They never get auto-placed, because feeds carry no coordinates | Links and ≤280-character excerpts only |
| **Your imports** | Upload GeoJSON, JSON or CSV in *Tools → My data* | Your own data. Duplicates and rows without coordinates go to review | Yours |

The default feed is PowerPyx (`robots.txt` allows it). Reddit r/GTA6 is configured but
disabled, because Reddit rate-limits anonymous feed readers. You can enable it or add
feeds in *Tools → Updates → Edit settings*.

On every run, the engine:

1. Snapshots the research database, so you can roll back.
2. Validates coordinates against Leonida's bounds. Invalid coordinates go to the review
   queue and are never stored as positions.
3. Upserts by stable source ID with a content hash, so unchanged records aren't touched.
   Changes are written to history.
4. Marks records that disappeared upstream as *removed/outdated*. It refuses to do this if
   more than half of a source vanished, which usually means upstream changed format.
5. Queues leads, possible duplicates and bad coordinates for review.
6. Writes a report that lists what was added, changed, removed, queued, rejected and
   failed.

**Changing the schedule:** go to *Tools → Updates → Check every N hours*, or set
`LI_UPDATE_INTERVAL_HOURS` in `.env`. The schedule is based on the time since the last
run, so it survives restarts and sleep.

**Managing sources:** enable or disable each source, or edit its JSON settings (for
example feed URLs and title filters) in *Tools → Updates*.

**Recovering from a bad update:** go to *Tools → My data → Server backups & research
snapshots → roll back*. This only affects the shared research data. Your progress lives
in a separate database that updates never write to.

## Verification states

| State | Meaning here |
| --- | --- |
| **Verified** | **You** confirmed it in-game (*Your verdict → I confirmed this in-game*). Never assigned automatically. |
| **Community corroborated** | Backed by direct evidence: a GTADB entry with an in-game photo and a confirmed name, or a position registered from a publisher's in-game map screenshot (keypoint-matched). Several sites repeating one claim does not count. |
| **Unconfirmed** | Sourced but weakly evidenced: unknown or uncertain name, no photo, area-level position, or a user import. |
| **Disputed** | Flagged upstream as possibly non-existent, or you marked it "Not there". |
| **Outdated** | Removed upstream. It is kept so your progress isn't lost. |

Discoveries without a published position (for example 94 missions) are **never placed at
guessed coordinates**. They live in *Tools → Review → Unplaced items*. If you find one
in-game, *I found it — place on map* stores your own placement, labelled as such.

## Backups

- **Automatic:** a daily copy of the progress database goes to `data/backups/`. 30 are
  kept by default (`LI_BACKUP_KEEP`). The app also takes a backup before every restore and
  before any schema migration.
- **Manual:**
  - *Tools → My data → Download backup (JSON)*, or *Create server backup*.
  - Or from the command line:

    ```powershell
    npm run backup
    ```

- **Restore:** *Tools → My data → Restore from file…* (replace or merge), or *restore*
  next to a server backup.
- **Research snapshots:** `data/snapshots/` keeps the last 8 pre-update copies of the
  research database.

## Configuration (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `LI_PORT` | `5180` | Port |
| `LI_HOST` | `0.0.0.0` | Interface to bind (`127.0.0.1` = this PC only) |
| `LI_ACCESS_PIN` | — | Optional PIN, asked once per browser |
| `LI_UPDATE_INTERVAL_HOURS` | `12` | Default research interval |
| `LI_DATA_DIR` | `data` | Databases, backups, map |
| `LI_BACKUP_KEEP` | `30` | Daily backups kept |
| `LI_OFFLINE` | `false` | Never contact the internet |
| `LI_ALLOW_PUBLIC_IPS` | `false` | Leave off. Requests from non-private IP addresses get `403` |

**Security model.** The server answers only private-network addresses (10/8, 172.16/12,
192.168/16, 100.64/10, link-local, loopback, IPv6 ULA). State-changing API calls need a
custom header, which blocks cross-site form posts. There's an optional PIN with an
HMAC-signed HttpOnly cookie. No API keys are needed, and none are sent to the browser.
**Do not port-forward this app to the internet.**

## Architecture

```text
server/        Fastify API (Node 24, TypeScript run natively)
  db.ts          two SQLite DBs via built-in node:sqlite + versioned migrations
  worldRepo.ts   research data: locations, history, review queue, runs, sources
  userRepo.ts    personal data: progress, markers, checklists, routes, settings, overrides
  ingest/        research engine + source adapters (gtadb, lootmap, rss, manual import, dedupe)
  scheduler.ts   interval updates + daily backups
  worldView.ts   spoiler filtering/redaction, user overrides, regions, layers
shared/        domain types, categories, coordinate frame, spoiler rules, NL search, routing
web/           React + Vite + Leaflet (custom CRS matching the GTADB tile pyramid)
seed/          pinned upstream copies so the app works offline on first start
tests/unit     node:test unit + integration tests (API via fastify.inject)
tests/e2e      Playwright browser tests
```

**Deviations from the suggested stack, and why:**

- **Node's built-in `node:sqlite` instead of better-sqlite3.** It needs no native
  compilation, so Windows install is a plain `npm install`.
- **TypeScript runs natively in Node 24** (type stripping), so the server has no build
  step.
- **Leaflet over MapLibre.** GTA VI uses a flat, fictional coordinate frame. Leaflet's
  `CRS.Simple` with a custom transformation reproduces the GTADB tile pyramid exactly:
  zoom 0 = 32 m/px, zoom 5 = 1 m/px. Pin placement was verified against GTADB venue
  coordinates, and the dataset's guide pins match to within 2 m.
- **No AGPL code was adopted.** The navanem *Leonida Atlas* is AGPL-3.0 and was evaluated
  but not used. Its data is GTADB's anyway, which we consume directly.

## Development

```powershell
npm test                 # unit + integration (node:test)
```

```powershell
npm run test:e2e         # browser tests (first time: npx playwright install chromium)
```

```powershell
npm run typecheck
```

```powershell
npm run dev:server       # API with auto-reload on :5180
```

```powershell
npm run dev:web          # Vite dev server on :5173 proxying the API
```

## What's operational and what isn't

See [REMAINING_WORK.md](REMAINING_WORK.md) for the exact checklist, and
[RESEARCH.md](RESEARCH.md) for the source and licensing evaluation. Attribution is in
[ATTRIBUTION.md](ATTRIBUTION.md).
