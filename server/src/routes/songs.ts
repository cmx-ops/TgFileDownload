import { Hono } from "hono";
import { scanSongs, resolveDownloadDir, type SongInfo } from "../songs.js";
import { getDb } from "../db/index.js";

const songs = new Hono();

function getConfiguredDir(): string {
  const db = getDb();
  const row = db.query("SELECT value FROM config WHERE key = ?").get("download_dir") as
    | { value: string } | undefined;
  return resolveDownloadDir(row?.value);
}

// GET /api/songs?search=xxx - list audio files in the download dir
songs.get("/", (c) => {
  const dir = getConfiguredDir();
  const search = (c.req.query("search") || "").trim().toLowerCase();

  let list: SongInfo[] = scanSongs(dir);
  if (search) {
    list = list.filter((s) => s.file_name.toLowerCase().includes(search));
  }

  return c.json({
    dir,
    songs: list,
    total: list.length,
  });
});

export { songs };