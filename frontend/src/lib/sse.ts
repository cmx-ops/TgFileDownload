export interface SseMessage {
  type: string;
  data: Record<string, unknown>;
}

type SseHandler = (event: SseMessage) => void;

const handlers = new Map<string, Set<SseHandler>>();
let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Dispatch an SSE frame to all registered handlers for its `type` field.
// Works for both named events (event: task_progress) and unnamed ones.
function handleEvent(event: MessageEvent) {
  try {
    const raw = JSON.parse(event.data as string) as Record<string, unknown>;
    // Backend sends flat events: {"type":"bot_status","running":true}
    // Frontend handlers expect nested: { type, data: { running: true } }.
    // Normalize once here so page code can read msg.data.* everywhere.
    const { type: _type, ...rest } = raw;
    const data: SseMessage = { type: String(_type), data: rest };
    const typeHandlers = handlers.get(data.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        handler(data);
      }
    }
    // Also notify wildcard listeners
    const wildcardHandlers = handlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        handler(data);
      }
    }
  } catch {
    // Ignore parse errors
  }
}

function connect(): void {
  if (eventSource) return;

  eventSource = new EventSource('/api/events');

  // Frames without an `event:` field arrive via onmessage...
  eventSource.onmessage = handleEvent;
  // ...while named events (task_progress, task_done, ...) need explicit
  // addEventListener for each subscribed type.
  for (const type of handlers.keys()) {
    eventSource.addEventListener(type, handleEvent);
  }

  eventSource.onerror = () => {
    disconnect();
    // Reconnect after 3 seconds
    reconnectTimer = setTimeout(connect, 3000);
  };
}

function disconnect(): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

export function onSse(type: string, handler: SseHandler): () => void {
  const isNewType = !handlers.has(type);
  if (!handlers.has(type)) {
    handlers.set(type, new Set());
  }
  handlers.get(type)!.add(handler);

  // Connect on first handler
  if (handlers.size > 0 && !eventSource) {
    connect();
  } else if (eventSource && isNewType) {
    // Connection already open but this is a brand-new event type:
    // named events require an explicit addEventListener per type.
    eventSource.addEventListener(type, handleEvent);
  }

  // Return unsubscribe function
  return () => {
    handlers.get(type)?.delete(handler);
    if (handlers.get(type)?.size === 0) {
      handlers.delete(type);
    }
    if (handlers.size === 0) {
      disconnect();
    }
  };
}

export function offSse(type: string, handler: SseHandler): void {
  handlers.get(type)?.delete(handler);
}