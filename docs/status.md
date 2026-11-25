# Status and remaining work

[← Back to README](../README.md)

Last verified: 25 November 2026.

## Operational and tested

Automated coverage: **36 unit/integration tests** and **14 Playwright browser tests**. All pass.

- [x] Real GTA VI basemap (GTADB `day` tiles, zoom 0–5) with an exact CRS calibration.
  Alternative layers: night style and the YANIS v18 community map. *(e2e: tiles load, zoom)*
- [x] About 4,000 real, attributed records (3,752 GTADB, 260 guides and missions). Every
  record has a source link. *(unit: seed parse, attribution check)*
- [x] Search: name suggestions plus natural-language search over the local data.
  *(unit + e2e)*
- [x] Category, subcategory, progress and evidence filters. *(e2e)*
- [x] Detail panel with description, steps, chapter, rewards, evidence, links, photo,
  history, notes and verdict. *(e2e)*
- [x] Server-side progress (visited, collected, completed, favourite, planned), notes,
  markers, checklists and routes. It persists across restarts and is shared across browsers.
  *(unit restart test + e2e second browser)*
- [x] Spoiler protection: chapter setting, story and late-game hiding, gameplay redaction,
  temporary reveal with confirmation. It is enforced server-side, so search can't leak.
  *(unit + e2e)*
- [x] Research engine: three live adapters (GTADB git, Loot Map GitHub, RSS) plus file
  import. Failure isolation, dedupe, invalid-coordinate queue, removal safety, history,
  reports. A live manual run against the internet succeeded on 22 Nov 2026.
  *(unit: add/update/remove, failure isolation, invalid coordinates, concurrency)*
- [x] Scheduler: 12 h default, configurable, and survives restarts. Manual *Check for
  updates*. *(e2e: manual run reports in UI)*
- [x] Review queue for leads, duplicates, bad coordinates and unplaced items. Approve with
  map placement.
- [x] Backups: daily automatic, before restore, before migration, manual, JSON
  export/restore, research snapshot rollback. *(unit + e2e)*
- [x] Migrations with a pre-migration backup, and refusal of newer schemas. *(unit)*
- [x] LAN-only IP guard, CSRF header, optional PIN. *(unit)* The server was reached
  through its LAN IP address from the host.
- [x] Dashboard, bottom progress bar, smart tools (useful, get first, nearby, planner,
  missing, community, surprise). *(e2e smoke)*
- [x] Responsive layout including phone width. *(e2e mobile)*
- [x] **Glitches & fixes** (24 Nov 2026): 11 sourced entries covering working glitches, bugs with
  player fixes, the 01.002.002 patch notes and fakes to avoid. Each has a status, a checked
  date and step-by-step instructions. The list refreshes from the GitHub repository on every
  update run, falling back to the bundled copy. The red barn glitch is pinned on the GTADB
  *Apollo Aggregates* landmark. *(unit: parsing, rejection, offline fallback, search; e2e:
  Glitches tab and detail)*
- [x] **Play Mode** (25 Nov 2026): a guided hunt to the nearest unfinished, unlocked, positioned
  place, with distance, compass direction, steps, *Got it* / *Skip*, a timer and a session
  summary. The session survives reloads. *(unit: queue order, chapter/done/disputed/area
  exclusion, bearings; e2e: start, got it, skip, end)*
- [x] **Live sync** across devices with Server-Sent Events (`/api/events`). Events carry only a
  channel and an id. It falls back to a 2-minute refresh if the connection drops. *(unit:
  channel mapping, hub streaming; e2e: a change made elsewhere appears without reload)*
- [x] **Achievements** (20, computed from your stats, with unlock pop-ups) and a **shareable
  progress card** drawn on a canvas in the browser. *(unit: unlocking and progress; e2e:
  dashboard and card render)*
- [x] **Windows installer** (Inno Setup, per-user, with Node.js and MinGit bundled), tested on
  Windows 11 on 23 Nov 2026:
  - silent install, with the tray app starting the server;
  - map download through the progress window (about 1 minute, 132 MB on disk);
  - the map, tiles and LAN address served;
  - a clean shutdown with `--quit`;
  - an upgrade over a running copy, with data kept;
  - a silent uninstall that removes the program and its autostart and registry entries.

## Not verified in this environment

- [ ] **Windows installer, interactive parts:**
  - clicking through the wizard pages;
  - the firewall step: the permission prompt was declined during testing, so
    `installer/tools/network.ps1` was only syntax-checked;
  - the uninstaller's "delete your data?" question;
  - the tray's *Open on my phone or tablet* window and its *Make Private* button.

  The installer is also not code-signed, so expect a SmartScreen warning.

- [ ] **Docker image**: Docker isn't installed on the build machine, so the Dockerfile and
  compose file are written but have **not been built or run**. Test on the Linux server with
  `docker compose up -d`.
- [ ] **Access from a second physical device.** It was checked via the host's LAN IP on the
  host itself. The firewall already had Node.js allow rules. Try it from another PC or phone.
- [ ] **setup.ps1 end-to-end on a clean machine.** Its steps were run individually here
  (npm install, build, fetch-data).
- [ ] **PWA install / offline cache.** Browsers only enable service workers on `https://` or
  `localhost`, so on `http://<LAN-IP>` the app works as a normal web page. You'd need HTTPS
  (for example a reverse proxy with a local certificate) to install it as an app on other
  devices.

## Limited by available data or licensing (not software gaps)

- **Glitches are curated by hand.** No glitch site offers a licensed data feed, so glitch
  statuses only change when someone edits `seed/glitches/glitches.json` and pushes it. Statuses
  were last checked on 24 Nov 2026, using press and fan-tracker reports, not hands-on testing.
  Rockstar's own patch-notes page timed out when fetched, so the 01.002.002 notes come from two
  outlets quoting it.

- **Weapons, hidden cash, rare vehicle spawns, easter eggs.** The categories exist and fill
  in automatically. Today the only legitimately reusable data covers the following; the
  "Secrets" category has a single entry:
  - gun stores, mod shops and Pay 'n' Spray (GTADB)
  - bank jobs, loans, vaults, the underwater treasure guide, collectibles and activities
    (Loot Map dataset)

  Richer marker sets exist on gtamap.io, mapgenie.io and vice-city.app. Their terms either
  forbid scraping or need a paid API key whose redistribution terms are unclear (see
  [research.md](research.md)). You can import your own exports.
- **94 missions without a published start position** stay in the unplaced queue. They are
  never guessed.
- **Road routing** isn't available: no licensed Leonida road network exists. The planner uses
  straight-line distances, which are clearly labelled.
- **Live PS5 integration** isn't possible: there is no authorised API for position, inventory
  or mission progress.
- **Zoom level 6 tiles** (finer detail) are optional:

  ```powershell
  node --disable-warning=ExperimentalWarning scripts/fetch-data.ts --hires
  ```

  This is a larger download.

## Possible next steps

- [ ] Optional adapter for vice-city.app if you buy a developer key. Pins would go to review,
  pending clarification of their licence.
- [ ] Optional AI summarisation of research leads. It would need an API key and only suggest
  categories, never coordinates. The current extraction is keyword-based with no AI.
- [ ] Reverse geocoding of your own pins via api.gtadb.org (experimental API).
- [ ] HTTPS helper for LAN PWA installation.
