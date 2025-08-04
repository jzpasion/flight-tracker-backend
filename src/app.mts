import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { createServer } from "http";
import { initSocket } from "./socket/socketService.mjs";
import initFlightHandler from "./api/apicalls.mjs";

const PORT = 8000;

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const server = createServer(app);

const io = initSocket(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});
initFlightHandler(io);
server.listen(PORT, () => {
  console.log(`App is listening on PORT ${PORT}`);
});
