import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { ConfigPage } from './pages/ConfigPage';
import { MonitorPage } from './pages/MonitorPage';
import { TasksPage } from './pages/TasksPage';
import { Settings, Radio, ListTodo, Menu, X } from 'lucide-react';
import { useState } from 'react';

function NavItem({ to, icon, label, onClick }: { to: string; icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-blue-600/20 text-blue-400'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
        }`
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

function MobileTab({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex flex-col items-center gap-0.5 py-2 px-3 text-xs font-medium transition-colors ${
          isActive ? 'text-blue-400' : 'text-gray-500'
        }`
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <BrowserRouter>
      <div className="flex h-screen bg-gray-950 text-gray-100">
        {/* ===== Desktop sidebar (hidden on mobile) ===== */}
        <aside className="hidden md:flex w-56 lg:w-64 border-r border-gray-800 flex-col flex-shrink-0">
          <div className="p-5 border-b border-gray-800">
            <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-sm font-bold">TF</span>
              Telegram 文件监视器
            </h1>
          </div>
          <nav className="flex-1 p-3 space-y-1">
            <NavItem to="/config" icon={<Settings className="w-5 h-5" />} label="配置" />
            <NavItem to="/monitor" icon={<Radio className="w-5 h-5" />} label="消息监控" />
            <NavItem to="/tasks" icon={<ListTodo className="w-5 h-5" />} label="下载任务" />
          </nav>
          <div className="p-4 border-t border-gray-800">
            <div className="text-xs text-gray-600">v1.0.0</div>
          </div>
        </aside>

        {/* ===== Mobile top bar (hidden on desktop) ===== */}
        <div className="md:hidden fixed top-0 left-0 right-0 z-20 flex items-center justify-between px-4 h-12 bg-gray-950 border-b border-gray-800">
          <h1 className="text-sm font-bold flex items-center gap-2">
            <span className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center text-xs font-bold">TF</span>
            Telegram 文件监视器
          </h1>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 text-gray-400 hover:text-gray-200 rounded-lg"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* ===== Mobile drawer overlay ===== */}
        {mobileMenuOpen && (
          <div
            className="md:hidden fixed inset-0 z-10 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
        <aside
          className={`md:hidden fixed top-12 right-0 bottom-14 z-10 w-56 bg-gray-950 border-l border-gray-800 transform transition-transform duration-200 ${
            mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <nav className="p-4 space-y-1">
            <NavItem to="/config" icon={<Settings className="w-5 h-5" />} label="配置" onClick={() => setMobileMenuOpen(false)} />
            <NavItem to="/monitor" icon={<Radio className="w-5 h-5" />} label="消息监控" onClick={() => setMobileMenuOpen(false)} />
            <NavItem to="/tasks" icon={<ListTodo className="w-5 h-5" />} label="下载任务" onClick={() => setMobileMenuOpen(false)} />
          </nav>
        </aside>

        {/* ===== Main content area ===== */}
        <main className="flex-1 overflow-auto pt-12 md:pt-0 pb-16 md:pb-0">
          <div className="max-w-5xl mx-auto p-4 md:p-6">
            <Routes>
              <Route path="/" element={<Navigate to="/config" replace />} />
              <Route path="/config" element={<ConfigPage />} />
              <Route path="/monitor" element={<MonitorPage />} />
              <Route path="/tasks" element={<TasksPage />} />
            </Routes>
          </div>
        </main>

        {/* ===== Mobile bottom tab bar (hidden on desktop) ===== */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 flex items-center justify-around bg-gray-950 border-t border-gray-800">
          <MobileTab to="/config" icon={<Settings className="w-5 h-5" />} label="配置" />
          <MobileTab to="/monitor" icon={<Radio className="w-5 h-5" />} label="监控" />
          <MobileTab to="/tasks" icon={<ListTodo className="w-5 h-5" />} label="任务" />
        </nav>
      </div>
    </BrowserRouter>
  );
}

export default App;