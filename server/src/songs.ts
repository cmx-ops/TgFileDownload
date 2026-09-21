import { existsSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";

export interface SongInfo {
  file_name: string;
  file_size: number;
  ext: string;
  modified_at: string;
}

// Audio extensions we care about (song files)
const AUDIO_EXTS = new Set([
  ".flac", ".mp3", ".m4a", ".aac", ".wav", ".ogg",
  ".ape", ".wma", ".opus", ".alac", ".aiff",
]);

/** True if the given file path looks like an audio song file. */
export function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTS.has(extname(filePath).toLowerCase());
}

/**
 * Scan a directory recursively and return all audio files inside.
 * Returns file name (relative to dir), size in bytes, extension and mtime.
 */
export function scanSongs(dir: string): SongInfo[] {
  if (!existsSync(dir)) return [];
  const out: SongInfo[] = [];

  const walk = (current: string): void => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      try {
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && isAudioFile(entry.name)) {
          const st = statSync(full);
          out.push({
            file_name: entry.name,
            file_size: st.size,
            ext: extname(entry.name).toLowerCase().replace(".", ""),
            modified_at: new Date(st.mtimeMs).toISOString(),
          });
        }
      } catch {
        // skip unreadable files
      }
    }
  };

  walk(dir);
  // Newest first
  out.sort((a, b) => b.modified_at.localeCompare(a.modified_at));
  return out;
}

// ---------------------------------------------------------------------------
// Filename normalization + fuzzy matching (for duplicate detection)
// ---------------------------------------------------------------------------

/** Characters used as separators / noise in filenames */
const NOISE_CHARS = /[＿_\-—–·‥…,，.。、;；!！?？()[\]{}【】「」『』“”"'\s~～:：/\\|*]+/g;
/** Common filler words that add no distinguishing value */
const FILLER_WORDS = new Set([
  "hq", "hd", "cd", "flac", "mp3", "wav", "ape", "m4a", "aac", "ogg", "opus",
  "官方", "完整版", "高清", "无损", "高音质", "试听", "现场", "live", "remastered", "remix",
  "单曲", "专辑版", "正式版", "纯音乐", "伴奏", "演唱会", "版",
]);

/**
 * Normalize a filename for comparison:
 *  - strip extension & leading track numbers ("06. 搁浅" -> "搁浅")
 *  - lowercase, normalize separators to a single space
 *  - drop filler words (hq, 无损, ...)
 */
export function normalizeName(rawName: string): string {
  let name = basename(rawName);
  // strip extension
  const dot = name.lastIndexOf(".");
  if (dot > 0) name = name.slice(0, dot);

  // strip leading track number: "06. xxx", "06-xxx", "06 xxx", "第01首 xxx"
  name = name.replace(/^\s*(?:第?\s*[0-9０-９]{1,3}\s*[首曲轨]?\s*[.\-、]?\s*)+/, "");
  // also strip pure-number-suffix like " - 06"
  name = name.replace(/\s*[-–—]?\s*[0-9０-９]{1,3}\s*$/, "");

  name = name.toLowerCase();
  name = name.replace(NOISE_CHARS, " ");
  // strip filler words
  name = name
    .split(" ")
    .filter((w) => w.length > 0 && !FILLER_WORDS.has(w))
    .join(" ");
  return name.trim();
}

/** Split a normalized name into core tokens ("张雨生 王杰 姚可杰 邰正宵 永远不回头"). */
export function nameTokens(normalized: string): string[] {
  return normalized.split(" ").filter((t) => t.length > 0);
}

/**
 * Compute a similarity score in [0, 1] between two filenames.
 * 1.0 = they share the identical core title
 * Strategy: find the longest common token/segment and weigh it.
 */
export function similarityScore(aRaw: string, bRaw: string): number {
  const a = normalizeName(aRaw);
  const b = normalizeName(bRaw);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;

  // Length ratio: very different lengths are unlikely duplicates
  const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);

  // If one name is a strict subset of the other (as tokens), that's a strong
  // match: "开始懂了" ⊂ "开始懂了 孙燕姿 我要的幸福"
  const setA = new Set(ta);
  const setB = new Set(tb);
  const common = ta.filter((t) => setB.has(t)).length;
  if (common === 0) return 0;

  const smallerSet = Math.min(setA.size, setB.size);
  const coverage = common / smallerSet; // 0..1

  // Strong rule: the smaller name's tokens all appear in the larger one.
  // e.g. "搁浅" vs "搁浅 周杰伦" -> coverage=1, ratio=0.5
  if (coverage >= 0.999) {
    return Math.max(0.85, ratio);
  }

  // Otherwise weight coverage, tempered by length ratio.
  return coverage * (0.5 + 0.5 * ratio);
}

/**
 * Check whether `candidate` is a duplicate of any existing song.
 * Returns the best-matching SongInfo if the score passes the threshold, else null.
 */
export function findDuplicate(
  candidateRawName: string,
  existingSongs: SongInfo[],
  threshold = 0.7,
): { song: SongInfo; score: number } | null {
  let best: { song: SongInfo; score: number } | null = null;
  for (const song of existingSongs) {
    const score = similarityScore(candidateRawName, song.file_name);
    if (score >= threshold) {
      if (!best || score > best.score) {
        best = { song, score };
      }
    }
  }
  return best;
}

/** Convenience: resolve the actual download dir from config (or default). */
export function resolveDownloadDir(
  configured: string | undefined,
  cwd: string = process.cwd(),
): string {
  const dir = (configured || "./data/downloads").trim();
  if (dir.startsWith("/") || /^[A-Za-z]:[\\/]/.test(dir)) {
    return dir;
  }
  return join(cwd, dir);
}