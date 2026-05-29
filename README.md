# Flight Tracker Backend

A real-time flight tracking backend built with **Express** and **Socket.IO**. Clients
subscribe to a geographic area (latitude, longitude, radius) and the server streams the
live aircraft in that area — along with their airline route details — over a WebSocket
connection, refreshing every few seconds.

It is the backend half of a flight-tracking app; a separate frontend connects via
Socket.IO and renders the aircraft (and the search radius) on a map.

## How it works

```
            getFlightsOnLocation (lat, lon, rad)
  Frontend ───────────────────────────────────────────►  Backend
            ◄───────────────────────────────────────────
              flightDetails      (raw aircraft + colors)
              flightsOnLocation  (resolved airline routes)
```

Every 7 seconds, for each subscribed client, the server:

1. Fetches all aircraft inside the requested radius from a community ADS-B provider.
2. Filters out ground/low traffic (`alt_baro > 100`) and entries without a valid callsign.
3. Assigns each flight a stable color (same callsign → same color).
4. Emits the raw aircraft immediately as `flightDetails`.
5. Looks up each flight's route (origin/destination/airline) and emits the resolved
   list as `flightsOnLocation`.

## External APIs

This service depends on free, community-run ADS-B APIs (no API key required):

| Purpose | Provider | Endpoint |
| --- | --- | --- |
| Flight list (primary) | [airplanes.live](https://airplanes.live) | `GET /v2/point/{lat}/{lon}/{radius}` |
| Flight list (fallback) | [adsb.lol](https://adsb.lol) | `GET /v2/point/{lat}/{lon}/{radius}` |
| Route details | [adsbdb](https://www.adsbdb.com) | `GET /v0/callsign/{callsign}` |

Both flight-list providers run the same `readsb` software and return an identical
`{ "ac": [ ... ] }` shape, so the fallback is a transparent swap. If the primary is
slow or down, requests fail fast (5s timeout) and the next provider is tried.

> **Note on route lookups:** `adsbdb` only knows scheduled **airline** flights. Private
> and general-aviation aircraft (tail numbers like `N12345`) legitimately return `404`
> and are skipped from `flightsOnLocation` — this is expected, not an error.

> **Usage / rate limits:** airplanes.live requests non-commercial use and limits to
> roughly 1 request/second. The default 7-second poll stays well within that.

## Socket.IO API

The server exposes a Socket.IO connection on **port 8000** (CORS open to all origins).

### Events the client emits

| Event | Arguments | Description |
| --- | --- | --- |
| `getFlightsOnLocation` | `lat, lon, rad` | Start streaming flights in the given radius (km). Polls every 7s until disconnect. |
| `getRadiusMap` | `lat, lon, rad` | Request the circle outline for the search radius. Responds once with `markRadius`. |

### Events the server emits

| Event | Payload | Description |
| --- | --- | --- |
| `flightDetails` | `Aircraft[]` | Raw aircraft in range, each tagged with a `color`. Sent first, on every poll. |
| `flightsOnLocation` | `Route[]` | Aircraft with resolved airline route info (origin, destination, airline) + `color`. |
| `markRadius` | `{ lat, lon }[]` | 361 points forming the perimeter circle of the search radius, for drawing on a map. |

Intervals are tracked per socket and cleared automatically on `disconnect`.

## Project structure

```
src/
├── app.mts                     # Express + HTTP server bootstrap, wires up Socket.IO (port 8000)
├── socket/
│   └── socketService.mts       # initSocket / getIO — Socket.IO server singleton
├── api/
│   ├── apicalls.mts            # Flight handler: polling, provider fallback, route lookups, socket events
│   └── globalFunction.mts      # Helpers: destinationPoint (radius circle), color assignment
└── interface/
    └── globalInterface.mts     # Shared types (latLng)
```

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- npm

### Installation

```bash
git clone <your-repo-url>
cd backendFlightApp
npm install
```

### Build & run

The project is written in TypeScript (`.mts`) and compiled to ES modules (`.mjs`) in
`dist/`. **You must build before running** — `npm start` runs the compiled output, not
the source.

```bash
# Compile TypeScript -> dist/
npm run build

# Start the compiled server (http://localhost:8000)
npm start
```

### Development

```bash
# Recompile on every change (run alongside the server)
npm run start:dev

# Or: auto-rebuild AND auto-restart together (tsc --watch + nodemon)
npm run dev
```

> ⚠️ Because the app runs the compiled `dist/` output, a source change has no effect
> until it is recompiled. If you edit a `.mts` file and don't see your change, rebuild
> with `npm run build` (or use the watch scripts above) and restart the server.

## Available scripts

| Script | Command | Description |
| --- | --- | --- |
| `npm run build` | `tsc` | Compile `src/**/*.mts` to `dist/`. |
| `npm start` | `node dist/app.mjs` | Run the compiled server. |
| `npm run start:dev` | `tsc --watch` | Recompile on file changes. |
| `npm run dev` | `nodemon dist/app.mjs & tsc -w` | Watch + auto-restart. |

## Configuration

The server is configured via environment variables. Copy the provided template and edit
as needed — all values are optional and fall back to the defaults below:

```bash
cp .env.example .env
```

`npm start` and `npm run dev` load `.env` automatically (via Node's
`--env-file-if-exists`). All variables are optional.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8000` | HTTP / Socket.IO server port. |
| `CORS_ORIGIN` | `*` | Allowed Socket.IO CORS origin (set a specific URL in production). |
| `POLL_INTERVAL_MS` | `7000` | How often (ms) to refresh the flight list per client. |
| `REQUEST_TIMEOUT_MS` | `5000` | Per-request timeout (ms) for outbound ADS-B calls. |
| `FLIGHT_LIST_PROVIDERS` | airplanes.live, adsb.lol | Comma-separated provider base URLs, tried in order. |

## Tech stack

- **Node.js** + **TypeScript** (ES modules, `NodeNext`, target ES2022)
- **Express** — HTTP server
- **Socket.IO** — real-time client communication
- **axios** — HTTP client for the ADS-B APIs

## License

ISC
