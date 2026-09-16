import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

// SSE event emitter - shared across modules
export type SseEvent =
  | { type: "task_created"; task: Record<string, unknown> }
  | { type: "task_progress"; taskId: string; progress: number; status: string }
  | { type: "task_done"; task: Record<string, unknown> }
  | { type: "task_failed"; taskId: string; error: string }
  | { type: "bot_status"; running: boolean }
  | { type: "message"; data: Record<string, unknown> };

// Store active SSE client streams
const clients = new Set<{ send: (event: SseEvent) => void }>();

export function broadcast(event: SseEvent): void {
  for (const client of clients) {
    try {
      client.send(event);
    } catch {
      clients.delete(client);
    }
  }
}

const events = new Hono();

// GET /api/events - SSE endpoint
events.get("/", (c) => {
  return streamSSE(c, async (stream) => {
    const client = {
      send: (event: SseEvent) => {
        stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
        });
      },
    };

    clients.add(client);

    // Send initial connection event
    client.send({ type: "bot_status", running: false } as SseEvent);

    // Keep connection alive with periodic heartbeats
    const heartbeat = setInterval(() => {
      stream.writeSSE({ data: '{"type":"heartbeat"}', event: "heartbeat" });
    }, 30000);

    stream.onAbort(() => {
      clearInterval(heartbeat);
      clients.delete(client);
    });

    // Wait indefinitely
    await new Promise(() => {});
  });
});

export { events };