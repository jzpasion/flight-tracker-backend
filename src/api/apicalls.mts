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
            return (
              toRemove.alt_baro > 100 &&
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
            flightsWithColor.map((flight: any) => {
              return axios
                .get(`https://api.adsbdb.com/v0/callsign/${flight.flight}`, {
                  timeout: REQUEST_TIMEOUT_MS,
                })
                .then((res) => {
                  return {
                    ...res.data.response.flightroute,
                    color: flight.color,
                  };
                })
                .catch((err) => {
                  console.log("Callsign error:", err.message);
                  return null;
                });
            })
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
