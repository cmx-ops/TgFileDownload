import { Hono } from "hono";
import { getDb } from "../db/index.js";
import { startBot } from "../bot-manager.js";

const config = new Hono();

// GET /api/config - read all configuration
config.get("/", (c) => {
  const db = getDb();
  const rows = db.query("SELECT key, value FROM config").all() as {
    key: string;
    value: string;
  }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return c.json(result);
});

// PUT /api/config - save configuration (upsert) and (re)start bot
config.put("/", async (c) => {
  const body = (await c.req.json()) as Record<string, string>;
  const db = getDb();

  const upsert = db.query(
    `INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );

  db.transaction(() => {
    for (const [key, value] of Object.entries(body)) {
      upsert.run(key, value);
    }
  })();

  // (Re)start the bot with the new config
  const botToken = body.bot_token || body.botToken;
  const chatId = body.chat_id || body.chatId;
  const downloadDir = body.download_dir || body.downloadDir || "./data/downloads";

  console.log("[config] saved, (re)starting bot with token=", botToken?.slice(0, 10) + "...", "chatId=", chatId);

  if (botToken && chatId) {
    startBot({ botToken, chatId, downloadDir }).catch((err) => {
      console.error("[config] bot start failed:", err);
    });
  }

  return c.json({ ok: true });
});

export { config };