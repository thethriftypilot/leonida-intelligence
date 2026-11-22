# Troubleshooting

[← Back to README](../README.md)

### The app doesn't open on my other computer, tablet or phone

1. Check that the server is running on the host. Its window lists addresses such as
   `http://192.168.1.153:5180`. Use that address, not `localhost`, on other devices.
2. Make sure both devices are on the same Wi-Fi or LAN. Guest networks often block
   device-to-device traffic.
3. Windows network profile: go to Settings → Network & internet → Wi-Fi or Ethernet →
   your network → **Private network**.
4. Firewall: re-run `setup.ps1`, or add the rule yourself in an *Administrator* PowerShell:

   ```powershell
   New-NetFirewallRule -DisplayName 'Leonida Intelligence (LAN)' -Direction Inbound -Protocol TCP -LocalPort 5180 -Action Allow -Profile Private
   ```

   If Windows showed a "Node.js" firewall prompt, allow it for **Private** networks.
5. If `.env` sets `LI_HOST=127.0.0.1`, change it to `0.0.0.0`.
6. A `403 "only accepts connections from your local network"` error means the request came
   from a public IP address, for example through a VPN or a reverse proxy. Connect directly
   on the LAN.

### "Port already in use" at startup

Another program is using port 5180. Set `LI_PORT=5181` in `.env` and restart.

### The map is blue or empty, but pins show

The map tiles weren't downloaded. Run:

```powershell
node --disable-warning=ExperimentalWarning scripts/fetch-data.ts
```

This needs git and internet access. Then reload the page. Docker downloads the tiles on its
first start, so check `docker compose logs`.

### "Web app not built"

```powershell
npm run build
```

### An update failed

Open *Tools → Updates*. Each source shows its last status and error, and each report lists
the failures. One failing source never blocks the others, and existing data is kept.

| Error | What it means |
| --- | --- |
| `HTTP 429` / rate limited | The site is throttling requests. The app retries on the next cycle. If a feed keeps doing this, disable it |
| `timeout` / `network error` | You're offline or the site is down. The app uses its cached data |
| `upstream format may have changed` | The source's file structure changed. Nothing is deleted. Report it, or update the adapter |
| `removal skipped as a safety measure` | Upstream suddenly lost more than half its records. Nothing was removed |
| `git update failed` | The app falls back to the GitHub HTTP download automatically. Check that git is installed |

To undo an update that brought in bad data: go to *Tools → My data → Server backups & research
snapshots → roll back*. Your progress is not affected.

### My progress looks wrong or missing

- Progress is stored on the **host** in `data/user.sqlite`, not in the browser. Check that every
  device opens the same host address.
- To restore, go to *Tools → My data → Server backups* and choose *restore*. You can also use
  *Restore from file…* with a downloaded JSON backup. A safety backup is taken before every
  restore.
- Backups are in `data/backups/`. To copy the database by hand, stop the app first.

### "Database schema is newer than this application supports"

You ran an older version of the app against data from a newer one. Update the app, or restore
a backup from `data/backups/`.

### Spoilers showed up

Check the **Progress** chapter selector and the shield popover. A temporary reveal lasts 10
minutes, and only in the tab where it was turned on. Close the tab, or press *Hide spoilers now*.

### Running the tests

```powershell
npm test
```

The first time, install the browser that the end-to-end tests use:

```powershell
npx playwright install chromium
```

```powershell
npm run test:e2e
```
