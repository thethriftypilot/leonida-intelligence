# Status and remaining work

Last verified: 22 November 2026.

## Operational and tested

Automated coverage: **27 unit/integration tests** and **10 Playwright browser tests**. All pass.

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

## Not verified in this environment

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

- **Weapons, hidden cash, rare vehicle spawns, easter eggs.** The categories exist and fill
  in automatically. Today the only legitimately reusable data covers the following; the
  "Secrets" category has a single entry:
  - gun stores, mod shops and Pay 'n' Spray (GTADB)
  - bank jobs, loans, vaults, the underwater treasure guide, collectibles and activities
    (Loot Map dataset)

  Richer marker sets exist on gtamap.io, mapgenie.io and vice-city.app. Their terms either
  forbid scraping or need a paid API key whose redistribution terms are unclear (see
  RESEARCH.md). You can import your own exports.
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
