import { Hono } from "hono";
import { getDb } from "../db/index.js";
import { resolveDuplicate, listPendingDuplicates } from "../bot-manager.js";

const tasks = new Hono();

// GET /api/tasks - list all tasks, newest first
tasks.get("/", (c) => {
  const db = getDb();
  const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

  const rows = db
    .query(
      `SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as Array<Record<string, unknown>>;

  const total = (db.query("SELECT COUNT(*) as count FROM tasks").get() as { count: number }).count;

  return c.json({ tasks: rows, total });
});

// GET /api/duplicates - list tasks awaiting a duplicate decision
tasks.get("/duplicates", (c) => {
  return c.json({ duplicates: listPendingDuplicates() });
});

// POST /api/tasks/:id/resolve - resolve a duplicate-pending task
// Body: { action: "download" | "cancel" }
tasks.post("/:id/resolve", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { action?: string };
  const action = body.action === "cancel" ? "cancel" : "download";

  const ok = resolveDuplicate(id, action);
  if (!ok) {
    return c.json({ ok: false, error: "task not found or not awaiting duplicate decision" }, 404);
  }
  return c.json({ ok: true, action });
});

// DELETE /api/tasks/:id - delete a task record
tasks.delete("/:id", (c) => {
  const id = c.req.param("id");
  const db = getDb();
  db.query("DELETE FROM tasks WHERE id = ?").run(id);
  return c.json({ ok: true });
});

export { tasks };