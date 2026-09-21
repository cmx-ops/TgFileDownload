/**
 * GramJS (MTProto) client manager for downloading large files (>20MB).
 *
 * Uses the `telegram` npm package to establish an MTProto connection.
 * Supports SOCKS5 proxy via the `ALL_PROXY` environment variable.
 *
 * Session strings are persisted in the SQLite `config` table.
 *
 * Download strategy (gramjs-idiomatic):
 *   1. Connect via MTProto as bot
 *   2. `await client.getEntity(chatId)` -- resolves chat/channel
 *   3. `await client.getMessages(entity, { ids: [msgId] })` -- returns Message[]
 *   4. `await client.downloadMedia(message)` -- downloads file (no 20MB limit)
 *   5. Write Buffer to disk
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram";
import bigInt from "big-integer";
import { getDb } from "./db/index.js";
import { resolve } from "node:path";
import { mkdirSync, openSync, writeSync, closeSync, statSync } from "node:fs";
import { dirname } from "node:path";

interface GramJsProxy {
  ip: string;
  port: number;
  socksType: 4 | 5;
  username?: string;
  password?: string;
  timeout?: number;
}

let client: TelegramClient | null = null;
let currentApiId = 0;
let currentApiHash = "";

const SESSION_DB_KEY = "tg_session";
const TWENTY_MB = 20 * 1024 * 1024;

function detectProxy(): GramJsProxy | undefined {
  const db = getDb();
  const row = db.query("SELECT value FROM config WHERE key = ?").get("proxy") as
    | { value: string } | undefined;
  const proxyStr = row?.value;
  if (!proxyStr) return undefined;
  try {
    const url = new URL(proxyStr);
    if (url.protocol !== "socks5:" && url.protocol !== "socks5h:") return undefined;
    const proxy: GramJsProxy = {
      ip: url.hostname,
      port: Number(url.port) || 7897,
      socksType: 5,
    };
    if (url.username) proxy.username = url.username;
    if (url.password) proxy.password = url.password;
    console.log("[gramjs] using proxy " + proxy.ip + ":" + proxy.port);
    return proxy;
  } catch {
    return undefined;
  }
}

export async function getOrCreateClient(
  botToken: string,
  apiId: number,
  apiHash: string,
): Promise<TelegramClient> {
  if (client && currentApiId === apiId && currentApiHash === apiHash) return client;

  if (client) {
    try { await client.disconnect(); client.destroy(); } catch { /* ignore */ }
    client = null;
  }

  currentApiId = apiId;
  currentApiHash = apiHash;

  const db = getDb();
  const row = db.query("SELECT value FROM config WHERE key = ?").get(SESSION_DB_KEY) as
    | { value: string } | undefined;

  const proxy = detectProxy();
  const session = row?.value ? new StringSession(row.value) : new StringSession("");

  const newClient = new TelegramClient(session, apiId, apiHash, {
    useWSS: false,
    proxy,
    connectionRetries: 3,
    retryDelay: 2000,
    timeout: 30,
  });

  console.log("[gramjs] connecting" + (proxy ? " via SOCKS5 proxy" : " (direct)") + "...");
  try {
    await newClient.start({ botAuthToken: botToken });
  } catch (err) {
    console.log("[gramjs] connection failed:", err);
    throw err;
  }

  const saved = String(newClient.session.save() ?? "");
  if (saved) {
    db.query(
      `INSERT INTO config (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(SESSION_DB_KEY, saved);
    console.log("[gramjs] session saved to db");
  }

  console.log("[gramjs] client ready (apiId=" + apiId + ")");
  client = newClient;
  return newClient;
}

export function readMtProtoCredentials(): { apiId: number; apiHash: string } | null {
  const db = getDb();
  const apiIdRow = db.query("SELECT value FROM config WHERE key = ?").get("api_id") as
    | { value: string } | undefined;
  const apiHashRow = db.query("SELECT value FROM config WHERE key = ?").get("api_hash") as
    | { value: string } | undefined;
  if (!apiIdRow?.value || !apiHashRow?.value) return null;
  const apiId = Number(apiIdRow.value);
  if (Number.isNaN(apiId) || apiId <= 0) return null;
  return { apiId, apiHash: apiHashRow.value };
}

/**
 * Download a large file via MTProto using gramjs's low-level downloadFile API.
 *
 * Why switch from `downloadMedia` to the low-level `iterDownload`?
 *   - `downloadMedia` uses one sequential chunk fetch at a time (one RTT per
 *     chunk, throttled by latency). On a high-latency connection this caps
 *     bulk download speed well below the pipe bandwidth.
 *   - GramJS's low-level `downloadFile`/`iterDownload` can be given a larger
 *     `requestSize` and run several workers in parallel, so multiple chunks
 *     are in flight at once — effectively raising throughput on slow/high-
 *     latency links.
 *
 * Flow:
 *   tg.getEntity(chatId) -> resolves chat/channel with proper accessHash
 *   tg.getMessages(entity, { ids: [msgId] }) -> returns Message[]
 *   extract document/photo location from the media
 *   tg.downloadFile(loc, { outputFile, fileSize, workers, partSizeKb }) -> file
 */
export async function downloadLargeFile(
  botToken: string,
  apiId: number,
  apiHash: string,
  _fileId: string,
  chatId: number,
  messageId: number,
  destPath: string,
  onProgress: (downloaded: number, total: number) => void,
): Promise<void> {
  const tg = await getOrCreateClient(botToken, apiId, apiHash);

  const absPath = resolve(destPath);
  mkdirSync(dirname(absPath), { recursive: true });

  console.log("[gramjs] resolving entity for chat " + chatId + "...");
  const entity = await tg.getEntity(chatId);

  console.log("[gramjs] getting message " + messageId + "...");
  const msgs = await tg.getMessages(entity, { ids: [messageId] });

  if (!msgs || msgs.length === 0) {
    throw new Error("message " + messageId + " not found");
  }

  const msg = msgs[0];

  let location: Api.TypeInputFileLocation;
  let fileSize: number;
  let dcId: number | undefined;
  const thumbSize = "";

  const media = msg.media;

  // ---- Extract download location + size from the media ----
  // Normalize: pull the inner document/photo out of MessageMediaDocument/Photo
  const innerMedia =
    media instanceof Api.MessageMediaDocument
      ? media.document
      : media instanceof Api.MessageMediaPhoto
        ? media.photo
        : media;

  const doc =
    innerMedia instanceof Api.Document && !(innerMedia instanceof Api.DocumentEmpty)
      ? innerMedia
      : null;
  const photo =
    innerMedia instanceof Api.Photo && !(innerMedia instanceof Api.PhotoEmpty)
      ? innerMedia
      : null;

  const bigintSize = (v: unknown): number => {
    if (typeof v === "bigint") return Number(v);
    if (typeof v === "number") return v;
    if (v && typeof v === "object" && "toJSNumber" in (v as object)) {
      return (v as { toJSNumber: () => number }).toJSNumber();
    }
    return 0;
  };

  if (doc) {
    location = new Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference,
      thumbSize,
    });
    fileSize = bigintSize(doc.size);
    dcId = doc.dcId;
  } else if (photo) {
    const sizes = photo.sizes;
    if (!sizes || sizes.length === 0) {
      throw new Error("photo has no sizes");
    }
    // pick the largest photo size (last one is usually the biggest)
    const last = sizes[sizes.length - 1] as Api.PhotoSize;
    location = new Api.InputPhotoFileLocation({
      id: photo.id,
      accessHash: photo.accessHash,
      fileReference: photo.fileReference,
      thumbSize: last.type ?? "",
    });
    fileSize = bigintSize(last.size);
    dcId = photo.dcId;
  } else {
    throw new Error("unsupported media type for download: " + media?.className);
  }

  // Parallelism: more workers = more concurrent chunk fetches.
  // 4 for normal files; scale up a bit for very large ones, cap at 8 to be
  // nice to Telegram's rate limits.
  const WORKERS = Math.min(8, Math.max(4, Math.ceil(fileSize / (256 * 1024 * 1024))));

  console.log(
    "[tg] downloading %d bytes (dc=%s) with %d parallel worker(s)...",
    fileSize,
    dcId ?? "auto",
    WORKERS,
  );

  // ---- Parallel segmented download ----
  // GramJS's high-level downloadFile()/iterDownload() fetch chunks
  // *sequentially* (one upload.getFile at a time). On high-latency or proxied
  // links that single round-trip-per-chunk caps throughput well below the
  // actual pipe bandwidth.
  //
  // Here we split the file into several disjoint byte ranges and fetch each
  // range in its own worker using the low-level upload.getFile request, then
  // write each chunk straight to the correct file offset. Multiple chunks are
  // in flight simultaneously, so throughput scales with parallelism.
  const PARTS = 512 * 1024; // 512KB per request (max gramjs uses)
  await parallelSegmentedDownload(tg, location, dcId, fileSize, PARTS, WORKERS, absPath, onProgress);

  const stats = statSync(absPath);
  console.log("[tg] download complete: " + absPath + " (" + stats.size + " bytes)");
}

/**
 * Download a file by splitting it into N disjoint byte ranges, fetching each
 * range concurrently with the low-level `upload.getFile` request, and writing
 * every chunk directly to the correct offset of the destination file.
 */
async function parallelSegmentedDownload(
  client: TelegramClient,
  location: Api.TypeInputFileLocation,
  dcId: number | undefined,
  fileSize: number,
  partSize: number,
  workers: number,
  destPath: string,
  onProgress: (downloaded: number, total: number) => void,
): Promise<void> {
  const totalParts = Math.max(1, Math.ceil(fileSize / partSize));
  const fd = openSync(destPath, "w");
  let completedBytes = 0;
  let lastReported = -1;
  let partIdx = 0;
  let actualDc = dcId;

  const requestError = new Error(
    `download failed: target file was not fully written (expected ${fileSize} bytes)`,
  );

  try {
    // Each worker pulls the next available part until the queue is drained.
    async function worker(): Promise<void> {
      while (true) {
        const idx = partIdx++;
        if (idx >= totalParts) return;
        const offset = idx * partSize;

        // Telegram `upload.getFile` returns at most `limit` bytes starting at
        // `offset`. The offset is a `long`; use the library's BigInteger type.
        const request = new Api.upload.GetFile({
          location,
          offset: bigInt(offset),
          limit: partSize,
        });
        const result = await client.invoke(request, actualDc);

        if (!(result instanceof Api.upload.File) || !result.bytes) {
          throw requestError;
        }

        const chunk = result.bytes as Buffer;
        // The last request may return fewer bytes than requested; that's fine.
        writeSync(fd, chunk, 0, chunk.length, offset);

        completedBytes += chunk.length;
        const pct = fileSize > 0 ? Math.floor((completedBytes / fileSize) * 100) : 100;
        if (pct > lastReported) {
          lastReported = pct;
          onProgress(completedBytes, fileSize);
        }
      }
    }

    await Promise.all(Array.from({ length: workers }, () => worker()));
  } finally {
    closeSync(fd);
  }

  // Verify we wrote the full file (the last part is often short, so compare
  // against the number of parts we intended to write).
  if (completedBytes < fileSize) {
    throw requestError;
  }
}

export function isSmallFile(fileSize: number | undefined | null): boolean {
  if (fileSize === undefined || fileSize === null || fileSize === 0) return true;
  return fileSize <= TWENTY_MB;
}