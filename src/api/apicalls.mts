import express from "express";
import {
  destinationPoint,
  generateRandomColor,
  getFlightColor,
} from "./globalFunction.mjs";
import { latLng } from "../interface/globalInterface.mjs";
import asyncHandler from "express-async-handler";
import { Server, Socket } from "socket.io";
import axios from "axios";
import http from "http";
import https from "https";

// Force IPv4 + keep-alive for all outbound API calls. adsbdb publishes an IPv6
// address, but Docker's default bridge network has no IPv6 route — Node then
// burns its connect budget on the unreachable IPv6 (Happy Eyeballs abandons the
// working IPv4 connection) and the request fails with ETIMEDOUT. Pinning family 4
// avoids that; keepAlive reuses connections across the frequent polls.
axios.defaults.httpAgent = new http.Agent({ keepAlive: true, family: 4 });
axios.defaults.httpsAgent = new https.Agent({ keepAlive: true, family: 4 });

const router = express.Router();

// store intervals per socket
const flightIntervals: Record<string, NodeJS.Timeout> = {};

// guards a socket from starting a new poll while the previous one is still
// running, so a slow/hanging provider can't stack up overlapping requests
const flightFetchBusy: Record<string, boolean> = {};

// per-request timeout so a hanging provider fails fast instead of blocking
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 5000;

// how often (ms) to refresh the flight list for each subscribed client
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 7000;

// flight-list providers, tried in order. Both run readsb and share the same
// /v2/point schema ({ ac: [...] }), so response handling is identical.
// Override with a comma-separated FLIGHT_LIST_PROVIDERS env var.
const FLIGHT_LIST_PROVIDERS = process.env.FLIGHT_LIST_PROVIDERS
  ? process.env.FLIGHT_LIST_PROVIDERS.split(",").map((url) => url.trim())
  : ["https://api.airplanes.live/v2/point", "https://api.adsb.lol/v2/point"];

// fetch the flight list, falling back to the next provider on failure.
// returns the `ac` array on success, or null if every provider failed.
async function fetchFlightList(lat: any, lon: any, rad: any) {
  for (const base of FLIGHT_LIST_PROVIDERS) {
    try {
      const res = await axios.get(`${base}/${lat}/${lon}/${rad}`, {
        timeout: REQUEST_TIMEOUT_MS,
      });
      return res.data.ac ?? [];
    } catch (err: any) {
      console.log(`Flight list provider failed (${base}):`, err.message);
    }
  }
  return null;
}

// Cache resolved routes per callsign. A flight's route is static for the day, so
// caching: (1) stops us re-querying adsbdb for the same callsign every poll
// (avoids rate-limiting), and (2) keeps a flight in the list across polls even if
// a later lookup is slow or fails — the route flapping in/out was the cause of
// flights "appearing then disappearing".
const ROUTE_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const routeCache = new Map<string, { route: any | null; ts: number }>();

// Resolve a callsign to its route ({ origin, destination, airline, ... } + color),
// or null when the callsign has no known route. Served from cache when possible;
// transient failures are NOT cached (so they retry) and fall back to any prior value.
async function resolveRoute(rawCallsign: any, color: string) {
  const callsign = String(rawCallsign).trim();
  const cached = routeCache.get(callsign);
  if (cached && Date.now() - cached.ts < ROUTE_TTL_MS) {
    return cached.route ? { ...cached.route, color } : null;
  }
  try {
    const res = await axios.get(
      `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`,
      { timeout: REQUEST_TIMEOUT_MS }
    );
    const route = res.data?.response?.flightroute ?? null;
    routeCache.set(callsign, { route, ts: Date.now() });
    return route ? { ...route, color } : null;
  } catch (err: any) {
    const status = err?.response?.status;
    // 4xx (other than rate-limit) means the callsign is genuinely unknown — cache
    // the negative so we stop re-querying it. Transient errors (timeout / 429 /
    // 5xx / network) are not cached; keep showing the last known route if we have one.
    if (status && status >= 400 && status < 500 && status !== 429) {
      routeCache.set(callsign, { route: null, ts: Date.now() });
      return null;
    }
    console.log(`Callsign lookup failed (${callsign}) [${status ?? err.code ?? "?"}]`);
    return cached ? (cached.route ? { ...cached.route, color } : null) : null;
  }
}

export default function initFlightHandler(io: Server) {
  io.on("connection", (socket: Socket) => {
    console.log(`connected ${socket.id}`);

    socket.on("getFlightsOnLocation", async (lat: any, lon: any, rad: any) => {
      // clear any existing interval for this socket
      if (flightIntervals[socket.id]) {
        clearInterval(flightIntervals[socket.id]);
      }

      const interval = setInterval(async () => {
        // skip this tick if the previous one is still in flight
        if (flightFetchBusy[socket.id]) return;
        flightFetchBusy[socket.id] = true;

        try {
          // getting the list of flight inside the radius (with provider fallback)
          const flights = await fetchFlightList(lat, lon, rad);

          // every provider failed — keep the last known data, don't clear the map
          if (flights === null) {
            return;
          }

          // checking if there are no flights
          if (flights.length === 0) {
            socket.emit("flightsOnLocation", []);
            socket.emit("flightDetails", []);
            return;
          }

          const removeFlights = flights.filter((toRemove: any) => {
            // alt_baro is the string "ground" for surface traffic and is absent
            // on some airborne aircraft that only report geometric altitude — fall
            // back to alt_geom so those planes aren't wrongly dropped.
            const altitude =
              typeof toRemove.alt_baro === "number"
                ? toRemove.alt_baro
                : typeof toRemove.alt_geom === "number"
                ? toRemove.alt_geom
                : null;
            return (
              altitude !== null &&
              altitude > 100 &&
              toRemove.flight &&
              !toRemove.flight.includes("@")
            );
          });

          const flightsWithColor = removeFlights.map((flight: any) => ({
            ...flight,
            color: getFlightColor(flight.flight),
          }));

          socket.emit("flightDetails", flightsWithColor);

          // get the flight details
          const flightDetailsList = await Promise.all(
            flightsWithColor.map((flight: any) =>
              resolveRoute(flight.flight, flight.color)
            )
          );

          // filter all flights

          const flightList = flightDetailsList.filter(
            (flight: any) => flight !== null
          );

          socket.emit("flightsOnLocation", flightList);
        } catch (err: any) {
          console.log("API error:", err.message);
        } finally {
          flightFetchBusy[socket.id] = false;
        }
      }, POLL_INTERVAL_MS);

      // Store the interval for cleanup
      flightIntervals[socket.id] = interval;
    });

    socket.on("getRadiusMap", async (lat: any, lon: any, rad: any) => {
      let tempRadiusLat: latLng[] = [];

      for (let i = 0; i <= 360; i++) {
        let dest = destinationPoint(lat, lon, rad, i);
        tempRadiusLat.push(dest);
      }

      socket.emit("markRadius", tempRadiusLat);
    });

    socket.on("disconnect", () => {
      console.log(`disconnected ${socket.id}`);
      if (flightIntervals[socket.id]) {
        clearInterval(flightIntervals[socket.id]);
        delete flightIntervals[socket.id];
      }
      delete flightFetchBusy[socket.id];
    });
  });
}
