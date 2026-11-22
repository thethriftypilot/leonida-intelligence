# Source research (22 November 2026, three days after GTA VI's release)

[← Back to README](../README.md)

This is what was checked before choosing the map foundation and data sources, and why each
source was used or rejected.

| Source | What exists | Reuse terms found | Decision |
| --- | --- | --- | --- |
| **gtadb.org / map.gtadb.org** (github.com/rolux/gtadb.org) | About 3,750 GTA VI landmarks with in-game names, positions, photos and POI tags. Several tile sets, including a post-release `day` game map at zoom 0–6 and the YANIS v18 community map | Code MIT; data, photos and tiles **CC BY 4.0**. The README invites reuse, but asks people **not to fetch live data from gtadb.org** and to `git pull` instead. FAQ: "Yes, you're welcome." | **Primary foundation.** Tiles and landmarks come from a sparse git checkout; updates use `git fetch` |
| **api.gtadb.org** | Experimental geocode, elevation and static-map APIs | Status "experimental". Shows API-key parameters, with "none currently" for auth, ToS and rate limits | Not used. The maintainers prefer git, and the API is experimental. Could later be used for reverse geocoding |
| **GTA 6 Loot Map** (github.com/theihtishaam/GTA-6-Interactive-Map-and-Loot-Tracker) | 75 guides and 10 collectible guides (bank jobs, loans, vaults, cards, magazines, meditations, trials, activities), 176 missions with chapters, and 132 screenshot-registered positions in a normalised crop of the GTADB frame | **MIT**. Each record links to its publisher source | **Used** for gameplay content. The coordinate transform `x = −10240 + nx·13824`, `y = 10496 − ny·19456` was checked: it reproduces GTADB venue coordinates exactly |
| **navanem/gta6-leonida-atlas** | Leaflet/React atlas built on GTADB landmarks (3,437 places) and a recoloured basemap | **AGPL-3.0** (code); data CC BY via GTADB | Not adopted, to avoid AGPL obligations. Its data is GTADB's, which is used directly |
| **vice-city.app** | Public JSON API (`x-api-key`) with an OpenAPI spec | Free key: 5 requests/day, no map pins or change feed. Pins need a paid developer key and carry a "mapgenie" community licence. "Don't resell or republish the exports" | Not integrated. Useful data needs a paid key and the redistribution terms are unclear. Could be added as an opt-in adapter if you buy a key |
| **gtamap.io** | About 3,000 markers in categories: collectibles, missions (banks, safes, ATMs), activities, vehicles, weapons, enterable buildings | `robots.txt` disallows `/api/`. Annotations are "© GTAMap.io". No public API or feed | **Not scraped.** You can import your *own* exported marks with *Tools → My data → Import* |
| **mapgenie.io** | Commercial GTA VI map | `robots.txt` and Ziff Davis terms **prohibit** automated retrieval, dataset creation and RAG use | **Not used** |
| **gtabase.com** | Interactive map with collectibles, weapons and so on; needs a login to sync | No API, feed or download. Terms page not located | Not used |
| **rockstargames.com/VI/downloads** | Official "Leonida Map & Cover Art Poster" print download | No reuse licence stated. `robots.txt` blocks AI crawlers | Not redistributed. The official poster is artwork and not a georeferenced map; GTADB's tiles are already calibrated |
| **PowerPyx** (RSS feed) | Post-release walkthroughs and location guides | `robots.txt` allows all. RSS is published for syndication | **Used as a lead feed only** (titles and links go to review) |
| **Reddit r/GTA6** | Community finds | Anonymous `.rss` access was rate-limited (HTTP 429) during testing. The Reddit Data API requires registration | Feed configured but **disabled by default** |
| **Fandom GTA wiki** | Wiki pages | Cloudflare bot challenge | Not used. Access controls are not bypassed |

## Map calibration

GTADB's `tiles.py` defines the pyramid: 256 px tiles, centred on (0, 0), covering ±16384 game
units, with 2^(z+2) tiles per side (zoom 5 = 1 px per unit). The web client uses Leaflet
`CRS.Simple` with `Transformation(1/32, 512, −1/32, 512)` and `lat = y, lng = x`. That makes
`{z}/{z},{y},{x}.jpg` line up exactly, and GTADB coordinates are used without any fitting.
Automated tests check guide and venue alignment against GTADB coordinates.

## Platform integration

PlayStation 5 offers no authorised, documented interface for live player position, inventory
or mission progress, so progress is tracked manually.
