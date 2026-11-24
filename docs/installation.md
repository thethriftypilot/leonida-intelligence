# Installation & hosting

[← Back to README](../README.md)

**On this page:**
- [Windows installer (easiest)](#windows-installer-easiest)
- [Windows 11 from source](#windows-11)
- [Open it on other devices](#open-it-on-other-devices)
- [Start automatically at logon](#start-automatically-at-logon)
- [Linux home server (Docker)](#linux-home-server-docker)
- [Linux bare metal (systemd)](#linux-bare-metal-systemd)
- [Moving to another host](#moving-to-another-host)
- [Configuration](#configuration)
- [Security model](#security-model)
- [Updating the app](#updating-the-app)

Leonida Intelligence runs on **one** computer, the *host*. Every other device just opens it in a
browser, so there is nothing to install on them.

---

## Windows installer (easiest)

1. Download **`LeonidaIntelligence-Setup-<version>.exe`** from the
   [latest release](https://github.com/thethriftypilot/leonida-intelligence/releases/latest).
2. Double-click it. The installer isn't code-signed yet, so Windows may show *"Windows protected
   your PC"*. Click **More info → Run anyway**. You can check the download against the
   `.sha256` file published next to it.
3. Leave the boxes ticked. They let your other devices connect and start the app when you sign in.
   Windows asks for permission **once**, to add the firewall rule.
4. The installer downloads the map, about 130 MB, with a progress window. Then it opens the map
   in your browser.

No admin rights are needed apart from that one optional firewall prompt. Nothing else needs
installing: the installer brings its own copy of Node.js and Git (MinGit) and keeps them to
itself.

**The tray icon.** Leonida runs quietly in the notification area next to the clock. Click the
icon to open the map. Right-click it for:

- **Open on my phone or tablet…** shows the address to type on other devices. It also spots the
  two usual blockers: the network is set to *Public*, or there's no firewall rule. Each has a
  button that fixes it.
- **Download / Update the map**, **Start with Windows**, and **Quit**.
- **More:** restart the server, edit settings (port, PIN…), open the data folder, view the log.

**Where things live**

| What | Where |
| --- | --- |
| Program | `%LOCALAPPDATA%\Programs\Leonida Intelligence` (replaced on upgrade) |
| Your progress, backups, map, settings (`data\.env`) | `%LOCALAPPDATA%\Leonida Intelligence\data` |
| Server log | `%LOCALAPPDATA%\Leonida Intelligence\logs\server.log` |

**Upgrading.** Run the newer installer. Your data folder isn't touched.

**Uninstalling.** Use *Settings → Apps → Installed apps → Leonida Intelligence → Uninstall*.
The uninstaller removes the firewall rule (one permission prompt) and the autostart entry. It
then asks whether to delete your data as well; the default is to keep it.

**Moving from a source install.** In the old copy, use *Tools → Backups → Export*. Then use
*Import* in the installed app.

**Silent install** (for scripting):
`LeonidaIntelligence-Setup-<version>.exe /VERYSILENT /TASKS="autostart"`. This skips the
firewall prompt and the map download. Afterwards, run `Leonida.exe --download-map` and use the
tray's *Open on my phone or tablet* window.

**Building the installer yourself.** You need Node.js 24+, plus Inno Setup 6 (`winget install
JRSoftware.InnoSetup`). Then run `powershell -ExecutionPolicy Bypass -File installer\build.ps1`.
The output goes to `build\out\`. Pushing a `v*` tag builds the installer and publishes it as a
GitHub Release (`.github/workflows/release.yml`).

---

## Windows 11

To run from source instead, you need Node.js 24 or newer, and git.

```powershell
winget install OpenJS.NodeJS
```

```powershell
winget install Git.Git
```

Close and reopen PowerShell after installing them. Then, in the project folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

`setup.ps1` does the following:

1. Checks the Node.js and git versions.
2. Runs `npm install` and builds the web app.
3. Creates `.env` from `.env.example`.
4. Downloads the map tiles and landmark data from GTADB (about 100 MB, as a sparse git
   checkout into `data/sources/gtadb`).
5. Offers to add a Windows Firewall rule for **Private** networks only. This opens an admin
   prompt.

Options:

| Option | What it does |
| --- | --- |
| `-HiRes` | Also downloads zoom level 6 (sharper street detail, larger download) |
| `-SkipMapDownload` | Skips the map step, for example if you copied `data/` from another machine |

**Start the app:** double-click `start.cmd`, or run:

```powershell
.\start.cmd
```

The window prints the addresses it's listening on. Open **http://localhost:5180** on the host.
`start.ps1` restarts the server automatically if it ever crashes.

## Open it on other devices

1. Find the host's IP address. Look for the `IPv4 Address` of your Wi-Fi or Ethernet adapter,
   for example `192.168.1.50`. The server also prints it at startup.

   ```powershell
   ipconfig
   ```

2. On the other device, browse to `http://<that-address>:5180`.
3. If it doesn't load:
   - Set your Windows network to **Private** (Settings → Network & internet → your network).
   - Make sure the firewall rule exists.

   See [troubleshooting](troubleshooting.md#the-app-doesnt-open-on-my-other-computer-tablet-or-phone).

**Tip:** reserve the host's IP address in your router (a "DHCP reservation") so the address
never changes. You can also use the computer's name, for example `http://GAMING-PC:5180`.

## Start automatically at logon

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

This registers a hidden scheduled task. To remove it:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1 -Remove
```

## Linux home server (Docker)

```sh
git clone https://github.com/thethriftypilot/leonida-intelligence.git
cd leonida-intelligence
cp .env.example .env        # optional: LI_ACCESS_PIN, LI_PORT, …
docker compose up -d
```

- The first start downloads the map into `./data`, which also holds the databases and backups.
- The container restarts automatically, has a health check, and runs as the non-root `node`
  user.
- To download the high-resolution map level as well, set `LI_FETCH_ARGS: "--hires"` in
  `docker-compose.yml`.
- To publish on a single network interface, change the port line to
  `"192.168.1.10:5180:5180"`.

> The Docker files are written but have not yet been run on a real Linux host. See
> [status](status.md).

## Linux bare metal (systemd)

```sh
sudo mkdir -p /opt/leonida-intelligence && sudo chown $USER /opt/leonida-intelligence
git clone https://github.com/thethriftypilot/leonida-intelligence.git /opt/leonida-intelligence
cd /opt/leonida-intelligence && ./scripts/setup.sh
sudo cp deploy/leonida-intelligence.service /etc/systemd/system/
sudo systemctl edit leonida-intelligence     # set User= if it isn't "leonida"
sudo systemctl daemon-reload && sudo systemctl enable --now leonida-intelligence
```

## Moving to another host

Your progress lives in `data/user.sqlite` on the host, not in any browser. There are two ways
to move it:

- **Backup file:** in the app, go to **Tools → My data → Download backup**. Then, on the new
  host, use **Restore from file…**.
- **Whole folder:** stop the app and copy the entire `data/` folder to the new host.

## Configuration

Copy `.env.example` to `.env` and edit it. Every setting is optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `LI_PORT` | `5180` | Port |
| `LI_HOST` | `0.0.0.0` | Interface to bind; `127.0.0.1` means this computer only |
| `LI_ACCESS_PIN` | — | Optional PIN, asked once per browser |
| `LI_UPDATE_INTERVAL_HOURS` | `12` | Default research interval; you can also change it in the app |
| `LI_DATA_DIR` | `data` | Databases, backups and the map |
| `LI_BACKUP_KEEP` | `30` | Number of daily progress backups to keep |
| `LI_OFFLINE` | `false` | Never contact the internet; uses cached and pinned data |
| `LI_ALLOW_PUBLIC_IPS` | `false` | Leave this off |

## Security model

- The server answers only private network addresses: 10/8, 172.16/12, 192.168/16, 100.64/10,
  link-local, loopback and IPv6 ULA. Anything else gets `403`.
- State-changing API calls require a custom `X-LI-Client` header, which blocks cross-site form
  posts.
- The optional PIN is stored as an HMAC-signed, HttpOnly, SameSite=Strict cookie.
- No API keys are needed, and nothing secret is sent to the browser.
- **Never port-forward this app to the internet.** For remote access, use a VPN to your home
  network.

## Updating the app

```powershell
git pull
```

```powershell
npm install
```

```powershell
npm run build
```

Then restart the app. Database schema changes are applied automatically after a backup is
taken.
