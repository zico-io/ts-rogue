import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { serveSessions } from "./pty";

export const TERMINAL_PATH = "/api/terminal";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, dir: import.meta.dirname });
await app.prepare();

const server = createServer(app.getRequestHandler());
serveSessions(new WebSocketServer({ server, path: TERMINAL_PATH }));

server.listen(port, () => {
  console.log(`ts-rogue on http://localhost:${port}`);
});
