import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { Server } from "socket.io";
import { createServer } from "http";
import axios from "axios";

const PORT = 8000;

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// store intervals per socket

const flightIntervals: Record<string, NodeJS.Timeout> = {};

io.on("connection", (socket) => {
  console.log(`connected ${socket.id}`);

  // call upon getting the exact location from the client
  socket.on("getFlightsOnLocation", async (lat: any, lon: any, rad: any) => {
    // clear any existing interval for this socket
    if (flightIntervals[socket.id]) {
      clearInterval(flightIntervals[socket.id]);
    }

    // Start a new interval to fetch data every 5 seconds
    const interval = setInterval(async () => {
      try {
        // getting the list of flight inside the radius
        const listofFlights = await axios.get(
          `https://api.adsb.lol/v2/point/${lat}/${lon}/${rad}`
        );

        const flights = listofFlights.data.ac;

        // checking if there are no flights
        if (!flights || flights.length === 0) {
          console.log("No Flights");
          return;
        }

        // get the flight details
        const flightDetailsList = await Promise.all(
          flights.map((flight: any) => {
            return axios
              .get(`https://api.adsbdb.com/v0/callsign/${flight.flight}`)
              .then((res) => res.data.response.flightroute)
              .catch((err) => null);
          })

          // socket.emit("flightsOnLocation", listofFlights.data.ac);
          // socket.broadcast.emita("flightsOnLocation", listofFlights.data.ac);
        );

        // filter all flights

        const flightList = flightDetailsList.filter(
          (flight) => flight !== null
        );

        console.log(flightList);
      } catch (err: any) {
        console.log("API error:", err.message);
      }
    }, 10000); // Every 10 seconds

    // Store the interval for cleanup
    flightIntervals[socket.id] = interval;
  });

  socket.on("disconnect", () => {
    console.log(`disconnected ${socket.id}`);
    if (flightIntervals[socket.id]) {
      clearInterval(flightIntervals[socket.id]);
      delete flightIntervals[socket.id];
    }
  });
});

server.listen(PORT, () => {
  console.log(`App is listening on PORT ${PORT}`);
});
