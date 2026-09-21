import { getDb } from "./db/index.js";
import { broadcast } from "./routes/events.js";
import {
  isSmallFile,
  readMtProtoCredentials,
  downloadLargeFile,
} from "./gramjs-client.js";

const TELEGRAM_FILE_BASE = "https://api.telegram.org/file/bot";

export interface FileInfo {
  fileId: string;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
  chatId?: number;
  messageId?: number;
}

/**
 * Download a file from Telegram to the local filesystem.
 *
 * Two download paths:
 *   - size <= 20 MB (or unknown)  ->  Bot API getFile + fetch  (existing)
 *   - size > 20 MB  ->  MTProto via gramjs (large-file support)
 *
 * Progress is reported to SQLite and broadcast via SSE on every ~1% change.
 */
export async function downloadFile(
  botToken: string,
  taskId: string,
  file: FileInfo,
  downloadDir: string,
): Promise<void> {
  const db = getDb();

  try {
    db.query(
      "UPDATE tasks SET status = 'downloading', updated_at = datetime('now') WHERE id = ?",
    ).run(taskId);
    broadcast({ type: "task_progress", taskId, progress: 0, status: "downloading" });

    const apiToken = botToken.replace(/^bot/, "");
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.mkdirSync(downloadDir, { recursive: true });
    const targetPath = path.join(downloadDir, file.fileName);

    if (isSmallFile(file.fileSize)) {
      // ---- Path A: Bot API (works for files <= 20 MB) ----
      await downloadViaBotAPI(apiToken, file, targetPath, (downloaded, total) => {
        const db2 = getDb();
        const pct = total > 0 ? Math.min(Math.floor((downloaded / total) * 100), 100) : 0;
        db2.query(
          "UPDATE tasks SET progress = ?, updated_at = datetime('now') WHERE id = ?",
        ).run(pct, taskId);
        broadcast({ type: "task_progress", taskId, progress: pct, status: "downloading" });
      });
    } else {
      // ---- Path B: MTProto / gramjs (no size limit) ----
      const creds = readMtProtoCredentials();
      if (!creds) {
        throw new Error(
          "文件超过20MB，需要配置 api_id 和 api_hash（在 my.telegram.org/apps 获取）",
        );
      }

      console.log(
        "[download] large file (%d bytes), using MTProto",
        file.fileSize,
      );

      await downloadLargeFile(
        botToken,
        creds.apiId,
        creds.apiHash,
        file.fileId,
        file.chatId!,
        file.messageId!,
        targetPath,
        (downloaded, total) => {
          const db2 = getDb();
          const pct = total > 0 ? Math.min(Math.floor((downloaded / total) * 100), 100) : 0;
          db2.query(
            "UPDATE tasks SET progress = ?, updated_at = datetime('now') WHERE id = ?",
          ).run(pct, taskId);
          broadcast({ type: "task_progress", taskId, progress: pct, status: "downloading" });
        },
      );
    }

    // Mark complete
    db.query(
      `UPDATE tasks SET status = 'done', progress = 100, target_path = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(targetPath, taskId);

    const task = db.query("SELECT * FROM tasks WHERE id = ?").get(taskId) as Record<string, unknown>;
    broadcast({ type: "task_done", task });
    console.log("[download] completed: %s -> %s", file.fileName, targetPath);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    getDb()
      .query(
        `UPDATE tasks SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(errorMsg, taskId);
    broadcast({ type: "task_failed", taskId, error: errorMsg });
    console.error("[download] failed: %s: %s", file.fileName, errorMsg);
  }
}

/**
 * Download via standard Bot API (getFile + fetch).
 *
 * Streams the response body to disk with proper backpressure (pipe to the
 * Node writable stream instead of a manual read/write loop, which avoided
 * buffering the whole chunk list in memory and let disk I/O pace the network).
 */
async function downloadViaBotAPI(
  apiToken: string,
  file: FileInfo,
  destPath: string,
  onProgress: (downloaded: number, total: number) => void,
): Promise<void> {
  // Step 1: resolve file path
  const fileRes = await fetch(
    `https://api.telegram.org/bot${apiToken}/getFile?file_id=${file.fileId}`,
  );
  const fileData = (await fileRes.json()) as {
    ok: boolean;
    result?: { file_path?: string; file_size?: number };
  };

  if (!fileData.ok || !fileData.result?.file_path) {
    throw new Error(`getFile failed: ${JSON.stringify(fileData)}`);
  }

  const filePath = fileData.result.file_path;
  const fileSize = file.fileSize ?? fileData.result.file_size ?? 0;
  const downloadUrl = `${TELEGRAM_FILE_BASE}${apiToken}/${filePath}`;

  // Step 2: stream download with backpressure-aware piping
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get("content-length")) || fileSize;
  if (!response.body) throw new Error("no response body stream");

  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");
  const fs = await import("node:fs");

  // High-water mark of 1MB: larger chunks read per disk write, fewer syscalls
  const fileStream = fs.createWriteStream(destPath, { highWaterMark: 1024 * 1024 });
  const nodeStream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);

  let downloaded = 0;
  let lastProgress = 0;

  nodeStream.on("data", (chunk: Buffer) => {
    downloaded += chunk.length;
    const pct =
      contentLength > 0 ? Math.min(Math.floor((downloaded / contentLength) * 100), 100) : 0;
    if (pct > lastProgress) {
      lastProgress = pct;
      onProgress(downloaded, contentLength);
    }
  });

  await pipeline(nodeStream, fileStream);

  // Final progress tick
  if (contentLength > 0) onProgress(Math.min(downloaded, contentLength), contentLength);
}