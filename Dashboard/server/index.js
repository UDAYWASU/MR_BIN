import express from "express";
import cors from "cors";
import { dbq, initDb } from "./db.js";

const PORT = process.env.PORT || 4000;
const app = express();
app.use(cors());
app.use(express.json());

const CATEGORIES = ["plastic", "paper", "metal", "organic", "e_waste"];
const clients = new Set();

function nowIso() {
  return new Date().toISOString();
}

function sendSse(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(data);
}

async function getBins() {
  const bins = await dbq.all("SELECT * FROM bins ORDER BY id ASC");
  return bins.map((b) => ({
    ...b,
    fill_percent: Math.min(100, Math.round((b.current_fill_kg / b.capacity_kg) * 100))
  }));
}

async function getOverview() {
  const categoryRows = await dbq.all(
    `SELECT category, ROUND(SUM(weight_kg), 2) AS total_kg
     FROM waste_events
     GROUP BY category`
  );
  const totalRow = await dbq.get(
    "SELECT ROUND(COALESCE(SUM(weight_kg), 0), 2) AS total_kg FROM waste_events"
  );
  const contaminationRow = await dbq.get(
    `SELECT COUNT(*) AS count FROM waste_events WHERE contamination = 1`
  );

  const byCategory = {};
  for (const category of CATEGORIES) byCategory[category] = 0;
  for (const r of categoryRows) byCategory[r.category] = r.total_kg || 0;

  return {
    total_waste_kg: totalRow?.total_kg || 0,
    contamination_events: contaminationRow?.count || 0,
    by_category_kg: byCategory
  };
}

app.get("/api/overview", async (_req, res) => {
  const overview = await getOverview();
  res.json(overview);
});

app.get("/api/bins", async (_req, res) => {
  res.json(await getBins());
});

app.get("/api/tasks", async (req, res) => {
  const assignee = req.query.assignee;
  const params = [];
  let sql = `
    SELECT t.*, b.name AS bin_name, b.location AS bin_location
    FROM tasks t
    JOIN bins b ON b.id = t.bin_id
  `;
  if (assignee) {
    sql += " WHERE assigned_to = ?";
    params.push(assignee);
  }
  sql += " ORDER BY CASE t.status WHEN 'assigned' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.created_at DESC";
  res.json(await dbq.all(sql, params));
});

app.post("/api/tasks", async (req, res) => {
  const { binId, title, details, priority = "medium", assignedTo } = req.body || {};
  if (!binId || !title || !assignedTo) {
    return res.status(400).json({ error: "binId, title and assignedTo are required" });
  }
  const createdAt = nowIso();
  const result = await dbq.run(
    `INSERT INTO tasks (bin_id, title, details, priority, status, assigned_to, assigned_by, created_at)
     VALUES (?, ?, ?, ?, 'assigned', ?, 'admin', ?)`,
    [binId, title, details || "", priority, assignedTo, createdAt]
  );
  const task = await dbq.get("SELECT * FROM tasks WHERE id = ?", [result.lastID]);
  sendSse("task_created", task);
  return res.status(201).json(task);
});

app.patch("/api/tasks/:id/status", async (req, res) => {
  const { status } = req.body || {};
  if (!["assigned", "in_progress", "completed"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const completedAt = status === "completed" ? nowIso() : null;
  await dbq.run("UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?", [
    status,
    completedAt,
    req.params.id
  ]);
  const updated = await dbq.get("SELECT * FROM tasks WHERE id = ?", [req.params.id]);
  sendSse("task_updated", updated);
  return res.json(updated);
});

app.post("/api/events", async (req, res) => {
  const { nodeId, category, weightKg, confidence, contamination } = req.body || {};
  if (!nodeId || !category || typeof weightKg !== "number") {
    return res.status(400).json({ error: "nodeId, category, weightKg required" });
  }
  const bin = await dbq.get("SELECT * FROM bins WHERE node_id = ?", [nodeId]);
  if (!bin) return res.status(404).json({ error: "Unknown nodeId" });

  const createdAt = nowIso();
  await dbq.run(
    `INSERT INTO waste_events (bin_id, category, weight_kg, confidence, contamination, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [bin.id, category, weightKg, confidence || 0.75, contamination ? 1 : 0, createdAt]
  );
  const nextFill = Math.min(bin.capacity_kg, bin.current_fill_kg + weightKg);
  const cleaningStatus =
    nextFill / bin.capacity_kg > 0.9 ? "needs_cleaning" : bin.cleaning_status;
  await dbq.run(
    "UPDATE bins SET current_fill_kg = ?, cleaning_status = ?, updated_at = ? WHERE id = ?",
    [nextFill, cleaningStatus, createdAt, bin.id]
  );

  const payload = {
    message: "event_recorded",
    nodeId,
    category,
    weightKg,
    contamination: !!contamination,
    createdAt
  };
  sendSse("waste_event", payload);
  return res.status(201).json(payload);
});

app.post("/api/bins/:id/cleaned", async (req, res) => {
  const id = req.params.id;
  const timestamp = nowIso();
  await dbq.run(
    "UPDATE bins SET current_fill_kg = 0, cleaning_status = 'ok', last_cleaned_at = ?, updated_at = ? WHERE id = ?",
    [timestamp, timestamp, id]
  );
  const updated = await dbq.get("SELECT * FROM bins WHERE id = ?", [id]);
  sendSse("bin_cleaned", updated);
  res.json(updated);
});

app.get("/api/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "Cache-Control": "no-cache"
  });
  res.flushHeaders();
  res.write(`event: connected\ndata: {"ok":true}\n\n`);
  clients.add(res);
  req.on("close", () => {
    clients.delete(res);
  });
});

// Demo simulator so dashboard looks alive without hardware connected.
setInterval(async () => {
  const bins = await dbq.all("SELECT * FROM bins ORDER BY RANDOM() LIMIT 1");
  if (bins.length === 0) return;
  const bin = bins[0];
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const weightKg = Number((Math.random() * 0.6 + 0.1).toFixed(2));
  const contamination = Math.random() < 0.08;
  const nextFill = Math.min(bin.capacity_kg, bin.current_fill_kg + weightKg);
  const status = nextFill / bin.capacity_kg > 0.9 ? "needs_cleaning" : bin.cleaning_status;
  const createdAt = nowIso();
  await dbq.run(
    `INSERT INTO waste_events (bin_id, category, weight_kg, confidence, contamination, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [bin.id, category, weightKg, Number((0.8 + Math.random() * 0.18).toFixed(2)), contamination ? 1 : 0, createdAt]
  );
  await dbq.run(
    "UPDATE bins SET current_fill_kg = ?, cleaning_status = ?, updated_at = ? WHERE id = ?",
    [nextFill, status, createdAt, bin.id]
  );
  sendSse("sim_tick", { binId: bin.id, category, weightKg, contamination, createdAt });
}, 6000);

await initDb();
app.listen(PORT, () => {
  console.log(`Smart waste server running on http://localhost:${PORT}`);
});
