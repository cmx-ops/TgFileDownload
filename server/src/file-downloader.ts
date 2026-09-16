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

  // Step 2: stream download
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get("content-length")) || fileSize;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no response body stream");

  const fs = await import("node:fs");
  const writer = fs.createWriteStream(destPath);
  let downloaded = 0;
  let lastProgress = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    writer.write(Buffer.from(value));
    downloaded += value.length;

    const pct = contentLength > 0 ? Math.min(Math.floor((downloaded / contentLength) * 100), 100) : 0;
    if (pct > lastProgress) {
      lastProgress = pct;
      onProgress(downloaded, contentLength);
    }
  }

  writer.end();
}