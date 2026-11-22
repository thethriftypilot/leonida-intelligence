# Attribution and third-party notices

Leonida Intelligence is an independent, unofficial fan tool for personal use. *Grand Theft Auto*,
*Grand Theft Auto VI*, *Leonida*, *Vice City* and related names, logos and imagery belong to
Rockstar Games / Take-Two Interactive. This project is not affiliated with or endorsed by them.

## Data

### GTADB — landmarks and map tiles
- Source: https://map.gtadb.org · repository https://github.com/rolux/gtadb.org
- **GTA VI Landmarks Data (CC BY 4.0) — https://map.gtadb.org**
- **GTA VI Map Tiles (CC BY 4.0) — https://map.gtadb.org** — includes community cartography by
  YANIS and the GTA VI Mapping Community (`yanis,18` layer)
- Copyright © 2025–2026 GTADB.ORG and contributors. Licence: https://creativecommons.org/licenses/by/4.0/
- Changes made here: landmark records are re-categorised, names normalised (trailing "?" moved into
  verification status), descriptions generated from the structured fields, and verification /
  confidence assigned from the record's evidence. Tiles are served unmodified; the "night style"
  recolours them in the browser with a CSS filter.
- In-game photos shown in location details are loaded from the GTADB GitHub repository (CC BY 4.0).
- Note on the `day` tileset: GTADB declares its map tiles CC BY 4.0. The day map appears to be
  derived from the in-game map; its original artwork provenance has not been independently
  confirmed, so Leonida Intelligence downloads it onto your own machine for private use and does
  **not** redistribute it (tiles are not part of this project's files).

### GTA 6 Loot Map dataset
- Source: https://github.com/theihtishaam/GTA-6-Interactive-Map-and-Loot-Tracker (MIT licence,
  © 2026 The Ihtisham and GTA 6 Loot Map contributors — full text in `seed/lootmap/LICENSE`)
- Used: `guides.json`, `collectible-guides.json`, `guide-positions.json`, `missions.json`,
  `mission-positions.json` (pinned copy in `seed/lootmap/`, updated from GitHub at runtime).
- Records summarise and link to original publisher articles (e.g. PowerPyx, GamesRadar+). Those
  publishers retain all rights to their articles and screenshots, which are linked, not copied.

### Feeds
- Research leads store only a title, link, date and a ≤280-character excerpt from public RSS/Atom
  feeds, always linking back to the publisher.

## Software (runtime)
- Fastify, @fastify/static, @fastify/compress — MIT
- fast-xml-parser — MIT
- React, React DOM — MIT
- Leaflet — BSD-2-Clause; Leaflet.markercluster — MIT
- lucide-react icons — ISC
- Node.js built-in `node:sqlite` (SQLite — public domain)

## Evaluated but not used
- **navanem/gta6-leonida-atlas** — AGPL-3.0. Not incorporated (no code copied) to avoid AGPL
  obligations; its data is itself derived from GTADB, which is used directly.
