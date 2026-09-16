import { useState, useEffect, useRef } from 'react';
import { onSse, type SseMessage } from '../lib/sse';
import { getStatus } from '../lib/api';
import { Radio, FileText, Image, Film, Music, FileType, MessageSquare, User } from 'lucide-react';

interface MessageData {
  message_id: number;
  text: string | null;
  date: number;
  chat_id: number | null;
  from: { id: number; first_name: string; username?: string } | null;
  has_file: boolean;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getFileIcon(hasFile: boolean) {
  if (!hasFile) return <FileText className="w-4 h-4" />;
  return (
    <span className="flex -space-x-1">
      <Image className="w-4 h-4" />
      <Film className="w-4 h-4" />
    </span>
  );
}

export function MonitorPage() {
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    getStatus().then((s) => setIsRunning(s.running)).catch(() => {});
  }, []);

  useEffect(() => {
    const unsubBot = onSse('bot_status', (msg: SseMessage) => {
      setIsRunning(msg.data.running as boolean);
    });

    const unsubMsg = onSse('message', (msg: SseMessage) => {
      setMessages((prev) => [msg.data as unknown as MessageData, ...prev]);
    });

    // Connection indicator: first heartbeat means connected
    const unsubHb = onSse('heartbeat', () => {
      setConnected(true);
    });

    // Show connected after 1s if no heartbeat yet
    const timer = setTimeout(() => setConnected(true), 1000);

    return () => {
      unsubBot();
      unsubMsg();
      unsubHb();
      clearTimeout(timer);
    };
  }, []);

  // Auto-scroll to top on new messages
  useEffect(() => {
    if (autoScroll && messages.length > 0 && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [messages, autoScroll]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">消息监控</h2>
          <p className="text-gray-500 mt-1 text-sm">
            实时查看群组中的消息和文件上传
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Connection status */}
          <div className={`flex items-center gap-2 text-xs ${
            connected ? 'text-green-400' : 'text-yellow-400'
          }`}>
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-yellow-500'}`} />
            {connected ? '已连接' : '连接中...'}
          </div>
          {/* Bot status */}
          <div className={`flex items-center gap-2 text-xs ${
            isRunning ? 'text-green-400' : 'text-gray-600'
          }`}>
            <Radio className={`w-3.5 h-3.5 ${isRunning ? 'animate-pulse' : ''}`} />
            {isRunning ? '运行中' : '已停止'}
          </div>
        </div>
      </div>

      {/* Not running warning */}
      {!isRunning && (
        <div className="px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-sm text-yellow-400">
          Bot 未运行。请先在"配置"页面设置 Bot Token 和 Chat ID。
        </div>
      )}

      {/* Messages list */}
      <div
        ref={listRef}
        className="h-[calc(100vh-250px)] overflow-y-auto space-y-2 scrollbar-thin"
        onScroll={() => {
          if (listRef.current) {
            setAutoScroll(listRef.current.scrollTop === 0);
          }
        }}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600">
            <MessageSquare className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">等待消息中...</p>
            <p className="text-xs mt-1">群组中有新消息时会实时显示在这里</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={`${msg.message_id}-${msg.date}`}
              className={`px-4 py-3 rounded-xl border transition-all ${
                msg.has_file
                  ? 'bg-blue-500/5 border-blue-500/20'
                  : 'bg-gray-900/30 border-gray-800 hover:border-gray-700'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-200">
                      {msg.from?.first_name || '未知用户'}
                    </span>
                    {msg.from?.username && (
                      <span className="text-xs text-gray-600">
                        @{msg.from.username}
                      </span>
                    )}
                    <span className="text-xs text-gray-700 ml-auto">
                      {formatDate(msg.date)}
                    </span>
                  </div>
                  {/* Content */}
                  <div className="text-sm text-gray-400">
                    {msg.text ? (
                      <p className="break-words">{msg.text}</p>
                    ) : (
                      <span className="italic text-gray-600">（非文本消息）</span>
                    )}
                  </div>
                  {/* File indicator */}
                  {msg.has_file && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-500/10 rounded-md text-xs text-blue-400">
                        <FileType className="w-3.5 h-3.5" />
                        包含文件
                      </span>
                      <span className="text-xs text-gray-700">→ 自动下载中</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}