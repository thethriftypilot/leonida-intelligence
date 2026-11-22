#!/bin/sh
# Downloads the map on first start (into the persistent volume), then runs the server.
set -e
if [ ! -d /app/data/sources/gtadb/maps/tiles/6/day ] && [ "${LI_OFFLINE:-false}" != "true" ]; then
  echo "First start: downloading GTADB map tiles and data (CC BY 4.0)…"
  node --disable-warning=ExperimentalWarning scripts/fetch-data.ts ${LI_FETCH_ARGS:-} || echo "Map download failed; the app will start without tiles. Restart the container to retry."
fi
exec node --disable-warning=ExperimentalWarning server/main.ts
