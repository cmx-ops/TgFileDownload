import { Bot } from "node-telegram-bot-api";
import type { Api } from "node-telegram-bot-api";
import { getDb } from "./db/index.js";
import { broadcast } from "./routes/events.js";
import { downloadFile } from "./file-downloader.js";
import crypto from "node:crypto";

let currentBot: Bot | null = null;
let currentConfig: { botToken: string; chatId: string; downloadDir: string } | null = null;

export function isBotRunning(): boolean {
  return currentBot?.isRunning() ?? false;
}

export function getApi(): Api | null {
  return currentBot?.api ?? null;
}

/**
 * Start or restart the bot with the given config.
 * If config hasn't changed, it's a no-op.
 */
export async function startBot(config: {
  botToken: string;
  chatId: string;
  downloadDir: string;
}): Promise<void> {
  // Skip if config hasn't changed and bot is already running
  if (
    currentConfig &&
    currentConfig.botToken === config.botToken &&
    currentConfig.chatId === config.chatId &&
    currentConfig.downloadDir === config.downloadDir &&
    currentBot?.isRunning()
  ) {
    return;
  }

  // Stop existing bot
  await stopBot();

  if (!config.botToken) return;

  currentConfig = config;
  currentBot = new Bot(config.botToken);

  // Register message handler
  currentBot.on("message", async (ctx) => {
    // Only process messages from the configured chat
    if (ctx.chatId !== Number(config.chatId)) return;

    const msg = ctx.message;
    if (!msg) return;

    // Broadcast received message to SSE clients
    broadcast({
      type: "message",
      data: {
        message_id: msg.message_id,
        text: msg.text || null,
        date: msg.date,
        chat_id: ctx.chatId,
        from: msg.from
          ? { id: msg.from.id, first_name: msg.from.first_name, username: msg.from.username }
          : null,
        has_file: !!(
          msg.photo ||
          msg.video ||
          msg.document ||
          msg.audio ||
          msg.animation ||
          msg.voice ||
          msg.sticker
        ),
      },
    });

    // Collect all files from the message
    const files: Array<{
      fileId: string;
      fileName: string;
      mimeType?: string;
      fileSize?: number;
      chatId?: number;
      messageId?: number;
    }> = [];

    // Photos: send the largest one
    if (msg.photo && msg.photo.length > 0) {
      const best = msg.photo[msg.photo.length - 1];
      files.push({
        fileId: best.file_id,
        fileName: `photo_${best.file_id}.jpg`,
        mimeType: "image/jpeg",
        fileSize: best.file_size,
        chatId: ctx.chatId,
        messageId: msg.message_id,
      });
    }

    // Video
    if (msg.video) {
      files.push({
        fileId: msg.video.file_id,
        fileName: msg.video.file_name || `video_${msg.video.file_id}.mp4`,
        mimeType: msg.video.mime_type || "video/mp4",
        fileSize: msg.video.file_size,
        chatId: ctx.chatId,
        messageId: msg.message_id,
      });
    }

    // Document
    if (msg.document) {
      files.push({
        fileId: msg.document.file_id,
        fileName: msg.document.file_name || `doc_${msg.document.file_id}`,
        mimeType: msg.document.mime_type || "application/octet-stream",
        fileSize: msg.document.file_size,
        chatId: ctx.chatId,
        messageId: msg.message_id,
      });
    }

    // Audio
    if (msg.audio) {
      files.push({
        fileId: msg.audio.file_id,
        fileName: msg.audio.file_name || `audio_${msg.audio.file_id}.mp3`,
        mimeType: msg.audio.mime_type || "audio/mpeg",
        fileSize: msg.audio.file_size,
        chatId: ctx.chatId,
        messageId: msg.message_id,
      });
    }

    // Animation (GIF)
    if (msg.animation) {
      files.push({
        fileId: msg.animation.file_id,
        fileName: msg.animation.file_name || `anim_${msg.animation.file_id}.gif`,
        mimeType: msg.animation.mime_type || "video/mp4",
        fileSize: msg.animation.file_size,
        chatId: ctx.chatId,
        messageId: msg.message_id,
      });
    }

    // Voice
    if (msg.voice) {
      files.push({
        fileId: msg.voice.file_id,
        fileName: `voice_${msg.voice.file_id}.ogg`,
        mimeType: msg.voice.mime_type || "audio/ogg",
        fileSize: msg.voice.file_size,
        chatId: ctx.chatId,
        messageId: msg.message_id,
      });
    }

    // Sticker
    if (msg.sticker) {
      files.push({
        fileId: msg.sticker.file_id,
        fileName: `sticker_${msg.sticker.file_id}.webp`,
        mimeType: "image/webp",
        fileSize: msg.sticker.file_size,
        chatId: ctx.chatId,
        messageId: msg.message_id,
      });
    }

    // Process each file: create a task and download it
    for (const file of files) {
      const taskId = crypto.randomUUID();
      const db = getDb();

      // Create task record
      db.query(
        `INSERT INTO tasks (id, file_name, file_size, mime_type, status, progress, message_info, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', 0, ?, datetime('now'), datetime('now'))`
      ).run(taskId, file.fileName, file.fileSize ?? null, file.mimeType ?? null, JSON.stringify({
        message_id: msg.message_id,
        date: msg.date,
        chat_id: ctx.chatId,
      }));

      const task = db
        .query("SELECT * FROM tasks WHERE id = ?")
        .get(taskId) as Record<string, unknown>;

      broadcast({ type: "task_created", task });

      // Download the file in background
      downloadFile(config.botToken, taskId, file, config.downloadDir).catch((err) => {
        console.error(`[download] task ${taskId} failed:`, err);
      });
    }
  });

  // Start polling
  currentBot.startPolling().catch((err) => {
    console.error("[bot] polling error:", err);
  });

  broadcast({ type: "bot_status", running: true });
}

/**
 * Stop the currently running bot.
 */
export async function stopBot(): Promise<void> {
  if (currentBot) {
    currentBot.stop();
    // Give it a moment to clean up
    await new Promise((r) => setTimeout(r, 100));
    await currentBot.close().catch(() => {});
    currentBot = null;
    currentConfig = null;
    broadcast({ type: "bot_status", running: false });
  }
}