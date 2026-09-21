import { useState, useEffect, useCallback } from 'react';
import { getTasks, deleteTask, resolveDuplicateTask, type Task } from '../lib/api';
import { onSse, type SseMessage } from '../lib/sse';
import {
  ListTodo, Download, CheckCircle, XCircle, Clock, Trash2, FileIcon, RefreshCw,
  AlertTriangle, Loader2,
} from 'lucide-react';

const STATUS_CONFIG = {
  pending: { label: '等待中', icon: Clock, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  awaiting_confirmation: { label: '待确认', icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
  downloading: { label: '下载中', icon: Download, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  done: { label: '已完成', icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20' },
  failed: { label: '失败', icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
};

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
  const d = new Date(dateStr + 'Z');
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const res = await getTasks(100, 0);
      setTasks(res.tasks);
      setTotal(res.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Real-time updates via SSE
  useEffect(() => {
    const unsubCreated = onSse('task_created', (msg: SseMessage) => {
      const task = msg.data.task as unknown as Task;
      if (task && task.id) {
        setTasks((prev) => [task, ...prev]);
        setTotal((prev) => prev + 1);
      }
    });

    const unsubProgress = onSse('task_progress', (msg: SseMessage) => {
      const { taskId, progress, status } = msg.data as { taskId: string; progress: number; status: string };
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, progress, status: status as Task['status'] } : t
        )
      );
    });

    const unsubDone = onSse('task_done', (msg: SseMessage) => {
      const task = msg.data.task as unknown as Task;
      if (task && task.id) {
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, ...task } : t))
        );
      }
    });

    const unsubFailed = onSse('task_failed', (msg: SseMessage) => {
      const { taskId, error } = msg.data as { taskId: string; error: string };
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: 'failed' as Task['status'], error } : t
        )
      );
    });

    // Task was parked awaiting a duplicate decision, or resolved — replace it
    const unsubUpdated = onSse('task_updated', (msg: SseMessage) => {
      const task = msg.data.task as unknown as Task;
      if (task && task.id) {
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...task } : t)));
      }
    });

    return () => {
      unsubCreated();
      unsubProgress();
      unsubDone();
      unsubFailed();
      unsubUpdated();
    };
  }, []);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await deleteTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      setTotal((prev) => prev - 1);
    } catch {
      // ignore
    } finally {
      setDeleting(null);
    }
  };

  const handleResolve = async (id: string, action: 'download' | 'cancel') => {
    setResolving(id);
    try {
      await resolveDuplicateTask(id, action);
      // Optimistically reflect the decision; SSE will confirm the final state.
      setTasks((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                status: action === 'cancel' ? 'failed' : 'pending',
                error: action === 'cancel' ? '用户取消：本地已存在同名歌曲' : null,
              }
            : t
        )
      );
    } catch {
      // ignore
    } finally {
      setResolving(null);
    }
  };

  const activeCount = tasks.filter(
    (t) =>
      t.status === 'pending' ||
      t.status === 'downloading' ||
      t.status === 'awaiting_confirmation',
  ).length;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">下载任务</h2>
          <p className="text-gray-500 mt-1 text-sm">
            共 {total} 个任务
            {activeCount > 0 && (
              <span className="text-blue-400 ml-2">
                {activeCount} 个活跃
              </span>
            )}
          </p>
        </div>
        <button
          onClick={loadTasks}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-gray-200
                     bg-gray-900 border border-gray-800 rounded-lg hover:bg-gray-800 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      {/* Tasks list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 text-gray-600 animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-600">
          <ListTodo className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">暂无下载任务</p>
          <p className="text-xs mt-1">群组中有文件消息时会自动创建下载任务</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
            const StatusIcon = cfg.icon;

            return (
              <div
                key={task.id}
                className={`px-4 py-3 rounded-xl border ${cfg.bg} ${cfg.border} transition-all`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className={`w-9 h-9 rounded-lg ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
                    {task.status === 'done' ? (
                      <CheckCircle className={`w-5 h-5 ${cfg.color}`} />
                    ) : task.status === 'failed' ? (
                      <XCircle className={`w-5 h-5 ${cfg.color}`} />
                    ) : (
                      <FileIcon className={`w-5 h-5 ${cfg.color}`} />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-200 truncate">
                        {task.file_name}
                      </span>
                      <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.color} ${cfg.bg}`}>
                        <StatusIcon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                    </div>

                    {/* Progress bar for downloading */}
                    {(task.status === 'downloading' || task.status === 'pending') && (
                      <div className="mt-2 mb-1">
                        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                          <span>{task.progress}%</span>
                          {task.file_size && (
                            <span>{formatFileSize(task.file_size)}</span>
                          )}
                        </div>
                        <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Awaiting duplicate confirmation: inline action buttons */}
                    {task.status === 'awaiting_confirmation' && (
                      <div className="mt-2 mb-1">
                        <div className="text-xs text-orange-400/90 bg-orange-500/10 border border-orange-500/20 rounded px-2.5 py-1.5">
                          本地已存在相似歌曲，请选择是否继续下载
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => handleResolve(task.id, 'download')}
                            disabled={resolving === task.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                       text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                                       rounded-md transition-colors"
                          >
                            {resolving === task.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                            仍然下载
                          </button>
                          <button
                            onClick={() => handleResolve(task.id, 'cancel')}
                            disabled={resolving === task.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                       text-gray-300 bg-gray-800 hover:bg-gray-700 disabled:opacity-50
                                       rounded-md transition-colors"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            取消下载
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Metadata row */}
                    <div className="flex items-center gap-3 text-xs text-gray-600 mt-1">
                      {task.file_size && task.status !== 'downloading' && (
                        <span>{formatFileSize(task.file_size)}</span>
                      )}
                      {task.mime_type && (
                        <span className="truncate max-w-[200px]">{task.mime_type}</span>
                      )}
                      <span>{formatDate(task.created_at)}</span>
                      {task.target_path && (
                        <span className="truncate max-w-[200px] text-gray-700" title={task.target_path}>
                          {task.target_path}
                        </span>
                      )}
                    </div>

                    {/* Error message */}
                    {task.status === 'failed' && task.error && (
                      <div className="mt-1 text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded">
                        {task.error}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <button
                    onClick={() => handleDelete(task.id)}
                    disabled={deleting === task.id}
                    className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="删除任务"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}