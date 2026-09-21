// API base URL - proxied by Vite in dev, same origin in prod
const API_BASE = '/api';

export interface Config {
  bot_token?: string;
  botToken?: string;
  chat_id?: string;
  chatId?: string;
  download_dir?: string;
  downloadDir?: string;
  api_id?: string;
  apiId?: string;
  api_hash?: string;
  apiHash?: string;
  proxy?: string;
}

export interface Task {
  id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  status: 'pending' | 'downloading' | 'done' | 'failed' | 'awaiting_confirmation';
  progress: number;
  target_path: string | null;
  error: string | null;
  message_info: string | null;
  created_at: string;
  updated_at: string;
}

export interface TasksResponse {
  tasks: Task[];
  total: number;
}

export interface BotStatus {
  running: boolean;
}

export interface Song {
  file_name: string;
  file_size: number;
  ext: string;
  modified_at: string;
}

export interface SongsResponse {
  dir: string;
  songs: Song[];
  total: number;
}

export async function getConfig(): Promise<Config> {
  const res = await fetch(`${API_BASE}/config`);
  if (!res.ok) throw new Error('Failed to fetch config');
  return res.json();
}

export async function saveConfig(config: Config): Promise<void> {
  const res = await fetch(`${API_BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to save config');
}

export async function getTasks(limit = 50, offset = 0): Promise<TasksResponse> {
  const res = await fetch(`${API_BASE}/tasks?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error('Failed to fetch tasks');
  return res.json();
}

export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete task');
}

export async function getStatus(): Promise<BotStatus> {
  const res = await fetch(`${API_BASE}/status`);
  if (!res.ok) throw new Error('Failed to fetch status');
  return res.json();
}

export async function getLogs(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/logs`);
  if (!res.ok) throw new Error('Failed to fetch logs');
  const data = (await res.json()) as { logs: string[] };
  return data.logs;
}

export async function getSongs(search = ''): Promise<SongsResponse> {
  const q = search ? `?search=${encodeURIComponent(search)}` : '';
  const res = await fetch(`${API_BASE}/songs${q}`);
  if (!res.ok) throw new Error('Failed to fetch songs');
  return res.json();
}

export async function resolveDuplicateTask(
  id: string,
  action: 'download' | 'cancel',
): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${id}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error('Failed to resolve duplicate task');
}

export interface PendingDuplicate {
  taskId: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  performer?: string;
  title?: string;
  match: { file_name: string; file_size: number; ext: string; score: number };
}

export async function getPendingDuplicates(): Promise<PendingDuplicate[]> {
  const res = await fetch(`${API_BASE}/tasks/duplicates`);
  if (!res.ok) throw new Error('Failed to fetch pending duplicates');
  const data = (await res.json()) as { duplicates: PendingDuplicate[] };
  return data.duplicates;
}