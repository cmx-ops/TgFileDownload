import { Hono } from "hono";
import { getLogs } from "../logger.js";

const logs = new Hono();

// GET /api/logs - return recent server logs
logs.get("/", (c) => {
  return c.json({ logs: getLogs() });
});

export { logs };