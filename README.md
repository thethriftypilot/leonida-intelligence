<div align="center">

<img src="web/public/icon.svg" width="88" alt="Leonida Intelligence logo" />

# Leonida Intelligence

**A self-hosted GTA VI map and discovery companion for your home network.**

Open it on the PC, laptop, tablet or phone beside your PS5. Your progress follows you to every
device, and the map gains new places as the community discovers them.

[![CI](https://github.com/thethriftypilot/leonida-intelligence/actions/workflows/ci.yml/badge.svg)](https://github.com/thethriftypilot/leonida-intelligence/actions/workflows/ci.yml)
![Node 24](https://img.shields.io/badge/Node.js-24+-3c873a?style=flat-square)
![Windows · Linux · Docker](https://img.shields.io/badge/runs%20on-Windows%20%C2%B7%20Linux%20%C2%B7%20Docker-ff5fa2?style=flat-square)
![Tests](https://img.shields.io/badge/tests-27%20unit%20%2B%2010%20browser-2ee6d6?style=flat-square)
![License MIT](https://img.shields.io/badge/code-MIT-ff9f43?style=flat-square)
![Unofficial](https://img.shields.io/badge/unofficial-fan%20tool-9aa4b8?style=flat-square)

[Quick start](#-quick-start) · [Features](#-features) · [Screenshots](#-screenshots) ·
[Documentation](#-documentation) · [Contributing](#-contributing) · [Data & credits](#-data--credits)

<img src="docs/screenshots/overview.jpg" alt="The full Leonida map with category pins, filters and progress bar" width="100%" />

</div>

> [!NOTE]
> This is an independent fan project for personal use. It is not affiliated with, endorsed by,
> or sponsored by Rockstar Games or Take-Two Interactive.

---

## ✨ Features

<table>
<tr>
<td width="50%" valign="top">

### 🗺️ The real map of Leonida
- In-game map tiles with smooth zoom, plus **Day**, **Night** and **Community** styles
- About **4,000 sourced places**, each linked to where it came from
- Category pins and clusters, region shortcuts, measuring tool, your own pins
- Remembers where you left off

</td>
<td width="50%" valign="top">

### ✅ Your progress, on every device
- Mark places **visited, collected, completed, favourite, planned**
- Notes, checklists, saved routes, completion stats
- Stored on your host computer, not in the browser
- Daily automatic backups, plus export and restore

</td>
</tr>
<tr>
<td valign="top">

### 🔎 Ask it questions
- *"Show me hidden cash near Vice City"*
- *"What secrets haven't I discovered?"*
- Runs offline on your own data; no AI subscription needed
- Tools: **What should I get first?**, **Nearby**, **Route planner**, **What am I missing?**,
  **Surprise me**

</td>
<td valign="top">

### 🛡️ Spoiler-safe and self-updating
- Set your chapter; future story content is **never sent to the browser**
- Checks approved sources every 12 hours (adjustable), or when you click
  **Check for updates**
- Every pin shows its evidence and verification status
- Never places a pin at a guessed position

</td>
</tr>
</table>

---

## 🚀 Quick start

### Windows: download and double-click

[![Download for Windows](https://img.shields.io/badge/Download-Windows%20installer-ff5fa2?style=for-the-badge&logo=windows)](https://github.com/thethriftypilot/leonida-intelligence/releases/latest)

1. Download **`LeonidaIntelligence-Setup-….exe`** from the
   [latest release](https://github.com/thethriftypilot/leonida-intelligence/releases/latest),
   then run it.
2. It isn't code-signed yet. If Windows says *"Windows protected your PC"*, click **More info → Run
   anyway**.
3. The installer sets everything up: it downloads the map, adds the firewall rule, and can start
   with Windows. Then it opens the map.

Leonida then sits in the notification area next to the clock. Right-click the icon and choose
**Open on my phone or tablet** to get the address for your other devices. More detail is in the
[installation guide](docs/installation.md#windows-installer-easiest).

### Windows from source

You need [Node.js 24+](https://nodejs.org) and [git](https://git-scm.com).
If you don't have them:

```powershell
winget install OpenJS.NodeJS
```

```powershell
winget install Git.Git
```

Then download the project and set it up:

```powershell
git clone https://github.com/thethriftypilot/leonida-intelligence.git
```

```powershell
cd leonida-intelligence
```

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

(No git? Use the green **Code → Download ZIP** button, extract it, and run the last command
in that folder.)

```powershell
.\start.cmd
```

Open **http://localhost:5180**. On your other devices, use `http://<this-PC's-IP>:5180`;
run `ipconfig` and look for *IPv4 Address*.

**Linux / Docker**

```sh
git clone https://github.com/thethriftypilot/leonida-intelligence.git
cd leonida-intelligence && docker compose up -d
```

For autostart, firewall, Linux/systemd, configuration and security, see the
[**installation guide**](docs/installation.md).

---

## 📸 Screenshots

<table>
<tr>
<td width="50%"><img src="docs/screenshots/location-details.jpg" alt="Location details" /><br/><b>Location details.</b> Description, in-game photo, evidence, source links, progress toggles and notes.</td>
<td width="50%"><img src="docs/screenshots/smart-search.jpg" alt="Natural-language search" /><br/><b>Ask a question.</b> See how it was understood, then show only the results on the map.</td>
</tr>
<tr>
<td><img src="docs/screenshots/recommendations.jpg" alt="What should I get first" /><br/><b>What should I get first?</b> Suggestions are labelled as opinions, with the facts underneath.</td>
<td><img src="docs/screenshots/route-planner.jpg" alt="Route planner" /><br/><b>Discovery planner.</b> Optimised waypoint order with honest straight-line distances.</td>
</tr>
<tr>
<td><img src="docs/screenshots/spoiler-protection.jpg" alt="Spoiler protection" /><br/><b>Spoiler protection.</b> Withheld on the server, with a confirm-to-reveal timer.</td>
<td><img src="docs/screenshots/dashboard.jpg" alt="Dashboard" /><br/><b>Dashboard.</b> Totals, completion, items awaiting review and source health.</td>
</tr>
<tr>
<td><img src="docs/screenshots/research-updates.jpg" alt="Research updates" /><br/><b>Research updates.</b> Per-source status, licences, schedule and reports.</td>
<td><img src="docs/screenshots/night-style.jpg" alt="Night style with progress panel" /><br/><b>Night style.</b> Category progress, recent community finds and your recent completions.</td>
</tr>
</table>

<p align="center"><img src="docs/screenshots/mobile.jpg" alt="Phone layout" width="280" /><br/><b>Works on phones and tablets too.</b></p>

---

## 📚 Documentation

| Guide | What's inside |
| --- | --- |
| [**Installation & hosting**](docs/installation.md) | Windows setup, opening it on other devices, autostart, Docker, systemd, configuration, security |
| [**User guide**](docs/user-guide.md) | The screen layout, pin styles, progress tracking, search, smart tools, spoilers, trust levels, backups, shortcuts |
| [**Research & updates**](docs/research-updates.md) | Where the data comes from, what each update does, schedule, managing sources, review queue, imports, rollback |
| [**Troubleshooting**](docs/troubleshooting.md) | Can't connect from another device, empty map, failed updates, missing progress |
| [**Architecture & development**](docs/architecture.md) | How it's built, project layout, running tests, regenerating screenshots |
| [**Source research**](docs/research.md) | Which sites were evaluated, their licences and terms, and why each was used or not |
| [**Status & roadmap**](docs/status.md) | What's tested, what isn't yet, and known data gaps |

---

## 🤝 Contributing

- **Bugs and ideas:** open an [issue](https://github.com/thethriftypilot/leonida-intelligence/issues/new/choose).
- **A pin is wrong or missing:** use the **Data correction** template, and include a source
  link.
- **Code and data changes:** read [CONTRIBUTING.md](CONTRIBUTING.md) first. In short: never
  invent coordinates, always cite a source, only use data whose licence allows reuse, and
  respect spoilers.
- **Security issues:** report them privately, as described in [SECURITY.md](SECURITY.md).

---

## 🙏 Data & credits

| Data | Source | Licence |
| --- | --- | --- |
| Landmarks & map tiles | [GTADB](https://map.gtadb.org) — gtadb.org and all contributors (community cartography by YANIS and the GTA VI Mapping Community) | CC BY 4.0 |
| Gameplay guides & missions | [GTA 6 Loot Map](https://github.com/theihtishaam/GTA-6-Interactive-Map-and-Loot-Tracker) dataset, linking to original publisher articles such as PowerPyx and GamesRadar+ | MIT |
| Research leads | Public RSS/Atom feeds; only links and short excerpts are stored | Publishers' own |

- Map tiles are downloaded by each user's own setup and are **not** included in this
  repository.
- Full notices, including the changes made to the data, are in [ATTRIBUTION.md](ATTRIBUTION.md).
- The project's own code is [MIT-licensed](LICENSE).

*Grand Theft Auto*, *GTA VI*, *Leonida* and *Vice City* are trademarks of Rockstar Games /
Take-Two Interactive.
