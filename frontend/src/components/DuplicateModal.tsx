import { useState, useEffect } from 'react';
import { onSse, type SseMessage } from '../lib/sse';
import {
  resolveDuplicateTask,
  getPendingDuplicates,
  type PendingDuplicate,
} from '../lib/api';
import { Copy, FileAudio, AlertTriangle, Download, X, Loader2 } from 'lucide-react';

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

export function DuplicateModal() {
  // Queue of duplicates waiting for a decision (first item is shown).
  const [queue, setQueue] = useState<PendingDuplicate[]>([]);
  const [acting, setActing] = useState<null | 'download' | 'cancel'>(null);

  const dup = queue[0] ?? null;

  // Pull any already-pending duplicates on mount — covers the case where the
  // `duplicate_found` event fired before this page was open.
  useEffect(() => {
    getPendingDuplicates()
      .then((list) => {
        if (list.length === 0) return;
        setQueue((prev) => {
          const known = new Set(prev.map((p) => p.taskId));
          const fresh = list.filter((p) => !known.has(p.taskId));
          return [...prev, ...fresh];
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = onSse('duplicate_found', (msg: SseMessage) => {
      const d = msg.data as unknown as PendingDuplicate;
      if (d && d.taskId && d.match) {
        setQueue((prev) => {
          if (prev.some((p) => p.taskId === d.taskId)) return prev;
          return [...prev, d];
        });
      }
    });

    // Another tab (or the task list) resolved a duplicate: drop it from here.
    const unsubResolved = onSse('duplicate_resolved', (msg: SseMessage) => {
      const { taskId } = msg.data as { taskId: string };
      if (taskId) {
        setQueue((prev) => prev.filter((p) => p.taskId !== taskId));
      }
    });

    return () => {
      unsub();
      unsubResolved();
    };
  }, []);

  /** Hide the current item locally without resolving it. */
  const dismiss = () => setQueue((prev) => prev.slice(1));

  if (!dup) return null;

  const handleAction = async (action: 'download' | 'cancel') => {
    setActing(action);
    try {
      await resolveDuplicateTask(dup.taskId, action);
      // Remove from queue and show the next one, if any.
      setQueue((prev) => prev.filter((p) => p.taskId !== dup.taskId));
    } catch {
      // keep modal open so the user can retry
    } finally {
      setActing(null);
    }
  };

  const isAudio = (dup.mimeType ?? '').startsWith('audio');
  const singer = dup.performer;
  const songTitle = dup.title;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop — clicking it only hides the modal locally. The task stays
          awaiting confirmation and remains actionable from the task list. */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={dismiss} />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800 bg-yellow-500/10">
          <div className="w-9 h-9 rounded-lg bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-yellow-400">本地已存在相似歌曲</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              是否仍然下载？{queue.length > 1 && `（还有 ${queue.length - 1} 个待处理）`}
            </p>
          </div>
          <button
            onClick={dismiss}
            className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg transition-colors"
            title="稍后处理（可在下载任务页操作）"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {/* New file */}
          <div>
            <div className="text-xs text-gray-500 mb-1">新消息文件</div>
            <div className="flex items-center gap-2.5 px-3 py-2.5 bg-gray-800/50 rounded-lg border border-gray-800">
              <FileAudio className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-100 truncate">{dup.fileName}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {formatFileSize(dup.fileSize)}
                  {isAudio && <span className="ml-2 text-gray-600">{dup.mimeType}</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Match indicator */}
          <div className="flex items-center justify-center text-gray-600">
            <Copy className="w-4 h-4 rotate-90" />
          </div>

          {/* Existing file */}
          <div>
            <div className="text-xs text-gray-500 mb-1">本地已存在</div>
            <div className="flex items-center gap-2.5 px-3 py-2.5 bg-yellow-500/5 rounded-lg border border-yellow-500/20">
              <FileAudio className="w-4 h-4 text-yellow-400 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-100 truncate">{dup.match.file_name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {formatFileSize(dup.match.file_size)}
                  <span className="ml-2 uppercase">{dup.match.ext}</span>
                  <span className="ml-2 text-gray-600">
                    匹配度 {Math.round(dup.match.score * 100)}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Song title / singer info (when provided by Telegram) */}
          {(songTitle || singer) && (
            <div className="text-xs text-gray-500 bg-gray-900/60 rounded-lg px-3 py-2 border border-gray-800">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {songTitle && <span>歌曲：{songTitle}</span>}
                {singer && <span>歌手：{singer}</span>}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-800">
          <button
            onClick={() => handleAction('cancel')}
            disabled={acting !== null}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium
                       text-gray-300 bg-gray-800 hover:bg-gray-700 disabled:opacity-50
                       rounded-lg transition-colors"
          >
            {acting === 'cancel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            取消下载
          </button>
          <button
            onClick={() => handleAction('download')}
            disabled={acting !== null}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium
                       text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                       rounded-lg transition-colors"
          >
            {acting === 'download' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            仍然下载
          </button>
        </div>
      </div>
    </div>
  );
}
