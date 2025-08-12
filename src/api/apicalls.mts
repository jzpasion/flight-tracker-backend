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

export default function initFlightHandler(io: Server) {
  io.on("connection", (socket: Socket) => {
    console.log(`connected ${socket.id}`);

    socket.on("getFlightsOnLocation", async (lat: any, lon: any, rad: any) => {
      // clear any existing interval for this socket
      if (flightIntervals[socket.id]) {
        clearInterval(flightIntervals[socket.id]);
      }

      const interval = setInterval(async () => {
        try {
          // getting the list of flight inside the radius
          const listofFlights = await axios.get(
            `https://api.adsb.lol/v2/point/${lat}/${lon}/${rad}`
          );

          const flights = listofFlights.data.ac;

          // checking if there are no flights
          if (!flights || flights.length === 0) {
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
                .get(`https://api.adsbdb.com/v0/callsign/${flight.flight}`)
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
        }
      }, 7000); // Every 7 seconds

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
    });
  });
}
