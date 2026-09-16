// In-memory ring buffer for server logs (last 200 lines)
const MAX_LOG_LINES = 200;
const logBuffer: string[] = [];

// Save references to original console methods BEFORE overwriting them
const _origLog = console.log;
const _origError = console.error;
const _origWarn = console.warn;

function timestamp(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function appendToBuffer(level: string, msg: string): void {
  const line = `[${timestamp()}] ${level} ${msg}`;
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer.shift();
  }
}

export function getLogs(): string[] {
  return [...logBuffer];
}

// Override console methods - use _origXxx internally to avoid recursion
console.log = (...args: unknown[]) => {
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  appendToBuffer("[log]", msg);
  _origLog(...args);
};

console.error = (...args: unknown[]) => {
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  appendToBuffer("[error]", msg);
  _origError(...args);
};

console.warn = (...args: unknown[]) => {
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  appendToBuffer("[warn]", msg);
  _origWarn(...args);
};