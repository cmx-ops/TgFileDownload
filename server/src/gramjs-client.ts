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
import { getDb } from "./db/index.js";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
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

  const saved = newClient.session.save() as string;
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
 * Download a large file via MTProto using gramjs's idiomatic API.
 *
 * Flow:
 *   tg.getEntity(chatId) -> resolves chat/channel with proper accessHash
 *   tg.getMessages(entity, { ids: [msgId] }) -> returns Message[]
 *   tg.downloadMedia(message) -> Buffer (no size limit)
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
  console.log("[gramjs] got message, has media: " + !!msg.media);

  const buffer: Buffer = await tg.downloadMedia(msg, {
    progressCallback: (progress: number, total: number) => {
      onProgress(progress, total);
    },
  } as never);

  if (!buffer || buffer.byteLength === 0) {
    throw new Error("downloaded empty buffer");
  }

  writeFileSync(absPath, buffer);
  const stats = statSync(absPath);
  console.log("[gramjs] download complete: " + absPath + " (" + stats.size + " bytes)");
}

export function isSmallFile(fileSize: number | undefined | null): boolean {
  if (fileSize === undefined || fileSize === null || fileSize === 0) return true;
  return fileSize <= TWENTY_MB;
}