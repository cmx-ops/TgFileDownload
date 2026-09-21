import { useState, useEffect } from 'react';
import { getConfig, saveConfig, getStatus, getLogs } from '../lib/api';
import { onSse, type SseMessage } from '../lib/sse';
import { Save, Activity, Power, PowerOff, ArrowRight, Bot, Eye, EyeOff } from 'lucide-react';

export function ConfigPage() {
  const [botToken, setBotToken] = useState('');
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');
  const [chatId, setChatId] = useState('');
  const [downloadDir, setDownloadDir] = useState('./data/downloads');
  const [showBotToken, setShowBotToken] = useState(false);
  const [showApiHash, setShowApiHash] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  const loadLogs = async () => {
    try {
      const lines = await getLogs();
      setLogs(lines);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        if (cfg.bot_token) setBotToken(cfg.bot_token);
        if (cfg.api_id) setApiId(cfg.api_id);
        if (cfg.api_hash) setApiHash(cfg.api_hash);
        if (cfg.proxy) setProxyUrl(cfg.proxy);
        if (cfg.chat_id) setChatId(cfg.chat_id);
        if (cfg.download_dir) setDownloadDir(cfg.download_dir);
      })
      .catch(() => {});
    getStatus()
      .then((s) => setIsRunning(s.running))
      .catch(() => {});
    loadLogs();
  }, []);

  useEffect(() => {
    const unsub = onSse('bot_status', (msg: SseMessage) => {
      setIsRunning(msg.data.running as boolean);
    });
    return unsub;
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await saveConfig({
        bot_token: botToken,
        api_id: apiId,
        api_hash: apiHash,
        proxy: proxyUrl,
        chat_id: chatId,
        download_dir: downloadDir,
      });
      setSaved(true);
      // Refresh logs and status after a short delay so the backend has time to react
      setTimeout(() => {
        loadLogs();
        getStatus().then((s) => setIsRunning(s.running)).catch(() => {});
      }, 1500);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      loadLogs();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">配置</h2>
        <p className="text-gray-500 mt-1 text-sm">
          配置 Telegram Bot Token 和监听目标群组
        </p>
      </div>

      {/* Bot status */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
        isRunning ? 'border-green-500/30 bg-green-500/5' : 'border-gray-800 bg-gray-900/50'
      }`}>
        <div className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
        <div className="flex-1">
          <span className={`text-sm font-medium ${isRunning ? 'text-green-400' : 'text-gray-500'}`}>
            {isRunning ? 'Bot 运行中' : 'Bot 未启动'}
          </span>
        </div>
        {isRunning ? (
          <Power className="w-4 h-4 text-green-500" />
        ) : (
          <PowerOff className="w-4 h-4 text-gray-600" />
        )}
      </div>

      {/* Config form */}
      <div className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <Bot className="w-4 h-4 text-blue-400" />
            Bot Token
          </label>
          <div className="relative">
            <input
              type={showBotToken ? "text" : "password"}
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              className="w-full px-4 py-2.5 pr-10 bg-gray-900 border border-gray-800 rounded-lg text-sm
                         text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2
                         focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowBotToken(!showBotToken)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              tabIndex={-1}
            >
              {showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            api_id（可选，大文件下载需要）
          </label>
          <input
            type="text"
            value={apiId}
            onChange={(e) => setApiId(e.target.value)}
            placeholder="28459123"
            className="w-full px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm
                       text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2
                       focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
          />
          <p className="text-xs text-gray-600 mt-1">
            在 my.telegram.org/apps 创建应用获取，用于下载超过 20MB 的文件
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            api_hash（可选）
          </label>
          <div className="relative">
            <input
              type={showApiHash ? "text" : "password"}
              value={apiHash}
              onChange={(e) => setApiHash(e.target.value)}
              placeholder="a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
              className="w-full px-4 py-2.5 pr-10 bg-gray-900 border border-gray-800 rounded-lg text-sm
                         text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2
                         focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowApiHash(!showApiHash)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              tabIndex={-1}
            >
              {showApiHash ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-1">
            对应 api_id 的密钥，32 位字母数字组合。不配置时超过 20MB 的文件将跳过
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            代理地址（可选）
          </label>
          <input
            type="text"
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="socks5://127.0.0.1:7897"
            className="w-full px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm
                       text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2
                       focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
          />
          <p className="text-xs text-gray-600 mt-1">
            SOCKS5 代理地址，格式 socks5://ip:port。用于 MTProto 连接 Telegram，不需要代理时留空
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <ArrowRight className="w-4 h-4 text-blue-400" />
            Chat ID
          </label>
          <input
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="-5137025370"
            className="w-full px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm
                       text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2
                       focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
          />
          <p className="text-xs text-gray-600 mt-1">
            输入群组的 Chat ID（负数表示群组，如 -5137025370）
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            下载目录
          </label>
          <input
            type="text"
            value={downloadDir}
            onChange={(e) => setDownloadDir(e.target.value)}
            placeholder="./data/downloads"
            className="w-full px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm
                       text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2
                       focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
          />
          <p className="text-xs text-gray-600 mt-1">
            Docker 环境下建议使用 /app/data/downloads
          </p>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500
                       disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white text-sm
                       font-medium rounded-lg transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : saved ? '已保存' : '保存并重启'}
          </button>
          {saved && (
            <span className="text-sm text-green-400 animate-pulse">
              配置已保存，Bot 将自动重启
            </span>
          )}
        </div>

        {error && (
          <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Quick help */}
      <div className="border-t border-gray-800 pt-6">
        <h3 className="text-sm font-medium text-gray-400 mb-3">快速指南</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="px-4 py-3 bg-gray-900/50 rounded-lg border border-gray-800">
            <div className="text-xs font-semibold text-gray-300 mb-1">1. 获取 Token</div>
            <div className="text-xs text-gray-600">在 Telegram 中搜索 @BotFather，创建 Bot 即可获得 Token</div>
          </div>
          <div className="px-4 py-3 bg-gray-900/50 rounded-lg border border-gray-800">
            <div className="text-xs font-semibold text-gray-300 mb-1">2. 获取 Chat ID</div>
            <div className="text-xs text-gray-600">将 Bot 加入群组，发送消息后 Bot 日志会显示 Chat ID</div>
          </div>
          <div className="px-4 py-3 bg-gray-900/50 rounded-lg border border-gray-800">
            <div className="text-xs font-semibold text-gray-300 mb-1">3. 开始监控</div>
            <div className="text-xs text-gray-600">保存配置后前往"消息监控"页面查看实时消息</div>
          </div>
        </div>
      </div>

      {/* Server logs */}
      <div className="border-t border-gray-800 pt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-400">服务端日志</h3>
          <button
            onClick={loadLogs}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            刷新
          </button>
        </div>
        <div className="bg-gray-900/70 rounded-xl border border-gray-800 p-3 max-h-60 overflow-y-auto font-mono text-xs leading-relaxed">
          {logs.length === 0 ? (
            <div className="text-gray-600 italic">暂无日志，保存配置后将显示 Bot 启动信息...</div>
          ) : (
            logs.map((line, i) => {
              const isError = line.includes("[error]");
              const isWarn = line.includes("[warn]");
              return (
                <div
                  key={i}
                  className={`${
                    isError ? 'text-red-400' : isWarn ? 'text-yellow-400' : 'text-gray-400'
                  }`}
                >
                  {line}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}