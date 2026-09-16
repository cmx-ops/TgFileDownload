import { Hono } from "hono";
import { serve } from "bun";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { config } from "./routes/config.js";
import { tasks } from "./routes/tasks.js";
import { events, broadcast } from "./routes/events.js";
import { logs } from "./routes/logs.js";
import { startBot, stopBot, isBotRunning } from "./bot-manager.js";
import { getDb } from "./db/index.js";
import "./logger.js"; // activate log interceptor

const app = new Hono();

// CORS for development (Vite dev server on different port)
app.use("/*", cors());

// API routes
app.route("/api/config", config);
app.route("/api/tasks", tasks);
app.route("/api/events", events);
app.route("/api/logs", logs);

// Bot status endpoint
app.get("/api/status", (c) => {
  return c.json({ running: isBotRunning() });
});

// On startup, check if we have a saved config and auto-start the bot
const savedConfig = getDb()
  .query("SELECT key, value FROM config")
  .all() as { key: string; value: string }[];

const cfg: Record<string, string> = {};
for (const row of savedConfig) {
  cfg[row.key] = row.value;
}

// DB stores snake_case keys; accept both for robustness
const botToken = cfg.bot_token || cfg.botToken;
const chatId = cfg.chat_id || cfg.chatId;
const downloadDir = cfg.download_dir || cfg.downloadDir || "./data/downloads";

if (botToken && chatId) {
  console.log("[startup] found saved config, starting bot...");
  startBot({ botToken, chatId, downloadDir }).catch((err) =>
    console.error("[startup] bot start failed:", err)
  );
} else {
  console.log("[startup] no saved config found, waiting for user to configure.");
}

// Serve static frontend files in production (Docker)
// In dev mode, Vite proxy handles this
const DIST_DIR = process.env.FRONTEND_DIST || "../frontend/dist";

app.use(
  "/*",
  serveStatic({
    root: DIST_DIR,
    onNotFound: async (path, c) => {
      // SPA fallback: serve index.html for all non-API routes
      if (!path.startsWith("/api")) {
        const index = Bun.file(`${DIST_DIR}/index.html`);
        if (await index.exists()) {
          return new Response(index, {
            headers: { "Content-Type": "text/html" },
          });
        }
      }
      return c.notFound();
    },
  })
);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[server] shutting down...");
  await stopBot();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("[server] shutting down...");
  await stopBot();
  process.exit(0);
});

const PORT = Number(process.env.PORT) || 3000;
console.log(`[server] listening on http://localhost:${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};