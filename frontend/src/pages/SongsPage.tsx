import { useState, useEffect, useCallback } from 'react';
import { getSongs, type Song } from '../lib/api';
import { onSse } from '../lib/sse';
import { Music, Search, RefreshCw, FileMusic, FileAudio } from 'lucide-react';

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '未知';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function SongsPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [total, setTotal] = useState(0);
  const [dir, setDir] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadSongs = useCallback(async () => {
    try {
      const res = await getSongs(search);
      setSongs(res.songs);
      setTotal(res.total);
      setDir(res.dir);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    setLoading(true);
    loadSongs();
  }, [loadSongs]);

  // Refresh the list whenever a download finishes so new songs appear.
  useEffect(() => {
    const unsubDone = onSse('task_done', () => loadSongs());
    const unsubResolved = onSse('duplicate_resolved', () => loadSongs());
    return () => {
      unsubDone();
      unsubResolved();
    };
  }, [loadSongs]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">歌曲库</h2>
          <p className="text-gray-500 mt-1 text-sm flex items-center gap-1">
            <FileMusic className="w-3.5 h-3.5" />
            {dir || '扫描下载目录中的音频文件'}
            <span className="text-gray-600 ml-2">共 {total} 首</span>
          </p>
        </div>
        <button
          onClick={loadSongs}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-gray-200
                     bg-gray-900 border border-gray-800 rounded-lg hover:bg-gray-800 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      {/* Search box */}
      <div className="relative">
        <Search className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="按歌曲名搜索..."
          className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm
                     text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2
                     focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
        />
      </div>

      {/* Songs list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 text-gray-600 animate-spin" />
        </div>
      ) : songs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-600">
          <Music className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">{search ? '没有匹配的歌曲' : '下载目录中暂无音频文件'}</p>
          <p className="text-xs mt-1">{search ? '换个关键词试试' : '下载歌曲后会自动出现在这里'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {songs.map((song) => (
            <div
              key={`${song.file_name}-${song.file_size}`}
              className="px-4 py-3 rounded-xl border border-gray-800 bg-gray-900/30 hover:bg-gray-900/50 transition-colors flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <FileAudio className="w-5 h-5 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-200 truncate">
                  {song.file_name}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-600 mt-0.5">
                  <span className="uppercase">{song.ext}</span>
                  <span>{formatFileSize(song.file_size)}</span>
                  <span>{formatDate(song.modified_at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}