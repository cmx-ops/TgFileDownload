export interface SseMessage {
  type: string;
  data: Record<string, unknown>;
}

type SseHandler = (event: SseMessage) => void;

const handlers = new Map<string, Set<SseHandler>>();
let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect(): void {
  if (eventSource) return;

  eventSource = new EventSource('/api/events');

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as SseMessage;
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
  };

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
  if (!handlers.has(type)) {
    handlers.set(type, new Set());
  }
  handlers.get(type)!.add(handler);

  // Connect on first handler
  if (handlers.size > 0 && !eventSource) {
    connect();
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