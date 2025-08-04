// socketioService.ts
import { Server as HTTPServer } from "http";
import { Server as IOServer, ServerOptions } from "socket.io";

let io: IOServer;

export function initSocket(
  httpServer: HTTPServer,
  opts?: Partial<ServerOptions>
): IOServer {
  io = new IOServer(httpServer, opts);
  return io;
}

export function getIO(): IOServer {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}
