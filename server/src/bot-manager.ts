import { Bot } from "node-telegram-bot-api";
import type { Api } from "node-telegram-bot-api";
import { getDb } from "./db/index.js";
import { broadcast } from "./routes/events.js";
import { downloadFile } from "./file-downloader.js";
import { scanSongs, findDuplicate, resolveDownloadDir, isAudioFile } from "./songs.js";
import crypto from "node:crypto";

let currentBot: Bot | null = null;
let currentConfig: { botToken: string; chatId: string; downloadDir: string } | null = null;

// ---- Download concurrency pool ----
// Multiple files can be downloaded in parallel. A slow file no longer blocks
// the rest of the queue. Adjust the number of workers to balance throughput
// vs. resource usage (each worker holds an MTProto/HTTP connection).
const MAX_CONCURRENT_DOWNLOADS = 3;
let activeDownloads = 0;
const downloadQueue: Array<() => void> = [];

// ---- Pending duplicate-check tasks ----
// A task that matched an existing local song is parked here until the user
// decides (download anyway / cancel) via the API.
interface PendingDuplicate {
  taskId: string;
  config: { botToken: string; chatId: string; downloadDir: string };
  file: {
    fileId: string;
    fileName: string;
    mimeType?: string;
    fileSize?: number;
    chatId?: number;
    messageId?: number;
  };
  match: { file_name: string; file_size: number; ext: string; score: number };
  performer?: string;
  title?: string;
}
const pendingDuplicates = new Map<string, PendingDuplicate>();

function acquireSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
      activeDownloads++;
      resolve();
    } else {
      downloadQueue.push(resolve);
    }
  });
}

function releaseSlot(): void {
  const next = downloadQueue.shift();
  if (next) {
    next(); // hand the slot to the next waiting task (activeDownloads stays the same)
  } else {
    activeDownloads--;
  }
}

/** Queue a download job for a (already created) task. */
function queueDownload(
  config: { botToken: string; downloadDir: string },
  taskId: string,
  file: PendingDuplicate["file"],
): void {
  const run = async () => {
    try {
      await downloadFile(config.botToken, taskId, file, config.downloadDir);
    } catch (err) {
      console.error(`[download] task ${taskId} failed:`, err);
    } finally {
      releaseSlot();
    }
  };
  acquireSlot().then(run);
}

export function isBotRunning(): boolean {
  return currentBot?.isRunning() ?? false;
}

export function getApi(): Api | null {
  return currentBot?.api ?? null;
}

/**
 * Return all tasks currently awaiting a duplicate decision, in the same
 * sanitized shape as the `duplicate_found` SSE event (no credentials).
 * The frontend polls this on load so the modal still appears even if the
 * SSE event was emitted before the page opened.
 */
export function listPendingDuplicates(): Array<{
  taskId: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  performer?: string;
  title?: string;
  match: { file_name: string; file_size: number; ext: string; score: number };
}> {
  return Array.from(pendingDuplicates.values()).map((p) => ({
    taskId: p.taskId,
    fileName: p.file.fileName,
    fileSize: p.file.fileSize ?? null,
    mimeType: p.file.mimeType ?? null,
    performer: p.performer,
    title: p.title,
    match: p.match,
  }));
}

/**
 * Resolve a duplicate-pending task: either download anyway or cancel it.
 * Called from the REST API when the user clicks a button in the modal or the
 * action buttons in the task list.
 */
export function resolveDuplicate(
  taskId: string,
  action: "download" | "cancel",
): boolean {
  const db = getDb();
  const pending = pendingDuplicates.get(taskId);

  // Fall back to the DB when the in-memory entry is gone (e.g. after a restart
  // the task is stuck in awaiting_confirmation but we can still act on it).
  if (!pending) {
    const row = db.query("SELECT * FROM tasks WHERE id = ?").get(taskId) as
      | { status: string } | undefined;
    if (!row || row.status !== "awaiting_confirmation") return false;

    if (action === "cancel") {
      db.query(
        `UPDATE tasks SET status = 'failed', error = '用户取消：本地已存在同名歌曲', updated_at = datetime('now') WHERE id = ?`,
      ).run(taskId);
      broadcast({ type: "task_failed", taskId, error: "用户取消：本地已存在同名歌曲" });
    } else {
      // No in-memory file info survived the restart, so we cannot re-download.
      const msg = '服务已重启，无法恢复下载，请重新转发该文件';
      db.query(
        `UPDATE tasks SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(msg, taskId);
      broadcast({ type: "task_failed", taskId, error: msg });
    }

    const updated = db.query("SELECT * FROM tasks WHERE id = ?").get(taskId) as Record<string, unknown>;
    broadcast({ type: "task_updated", task: updated });
    broadcast({ type: "duplicate_resolved", taskId, action });
    return true;
  }

  pendingDuplicates.delete(taskId);

  if (action === "cancel") {
    db.query(
      `UPDATE tasks SET status = 'failed', error = '用户取消：本地已存在同名歌曲', updated_at = datetime('now') WHERE id = ?`,
    ).run(taskId);
    broadcast({ type: "task_failed", taskId, error: "用户取消：本地已存在同名歌曲" });
  } else {
    // Proceed with the download as normal. Reset status back to pending so the
    // list stops showing the confirmation UI.
    db.query(
      `UPDATE tasks SET status = 'pending', error = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).run(taskId);
    const updated = db.query("SELECT * FROM tasks WHERE id = ?").get(taskId) as Record<string, unknown>;
    broadcast({ type: "task_updated", task: updated });
    queueDownload(pending.config, taskId, pending.file);
  }

  broadcast({ type: "duplicate_resolved", taskId, action });
  return true;
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

    // Process each file: create a task; check for local duplicates first
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

      // Duplicate detection: only for audio files, compare against what is
      // already in the download directory with fuzzy filename matching.
      const isAudio = isAudioFile(file.fileName) || (file.mimeType ?? "").startsWith("audio");
      let duplicate: ReturnType<typeof findDuplicate> = null;

      if (isAudio) {
        const dir = resolveDownloadDir(config.downloadDir);
        const existing = scanSongs(dir);
        duplicate = findDuplicate(file.fileName, existing);
        if (duplicate) {
          console.log(
            `[duplicate] task ${taskId} "${file.fileName}" matches existing "${duplicate.song.file_name}" (score=${duplicate.score.toFixed(2)})`
          );
        }
      }

      if (duplicate) {
        // Park the task and ask the user what to do.
        const performer = "audio" in msg && msg.audio ? msg.audio.performer : undefined;
        const title = "audio" in msg && msg.audio ? msg.audio.title : undefined;

        // Use a distinct status so the task list can render action buttons
        // as a fallback when the modal is missed or dismissed.
        db.query(
          `UPDATE tasks SET status = 'awaiting_confirmation', updated_at = datetime('now') WHERE id = ?`,
        ).run(taskId);
        const parkedTask = db
          .query("SELECT * FROM tasks WHERE id = ?")
          .get(taskId) as Record<string, unknown>;

        pendingDuplicates.set(taskId, {
          taskId,
          config,
          file,
          match: {
            file_name: duplicate.song.file_name,
            file_size: duplicate.song.file_size,
            ext: duplicate.song.ext,
            score: duplicate.score,
          },
          performer,
          title,
        });
        broadcast({ type: "task_updated", task: parkedTask });
        broadcast({
          type: "duplicate_found",
          taskId,
          fileName: file.fileName,
          fileSize: file.fileSize ?? null,
          mimeType: file.mimeType ?? null,
          performer,
          title,
          match: {
            file_name: duplicate.song.file_name,
            file_size: duplicate.song.file_size,
            ext: duplicate.song.ext,
            score: duplicate.score,
          },
        });
      } else {
        // No duplicate (or not an audio file): download directly.
        queueDownload(config, taskId, file);
      }
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