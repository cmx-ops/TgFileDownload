import { Hono } from "hono";
import { getDb } from "../db/index.js";

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

// DELETE /api/tasks/:id - delete a task record
tasks.delete("/:id", (c) => {
  const id = c.req.param("id");
  const db = getDb();
  db.query("DELETE FROM tasks WHERE id = ?").run(id);
  return c.json({ ok: true });
});

export { tasks };