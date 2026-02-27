import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "waste.db");

export const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

export const dbq = { run, all, get };

export async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS bins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      capacity_kg REAL NOT NULL DEFAULT 50,
      current_fill_kg REAL NOT NULL DEFAULT 0,
      cleaning_status TEXT NOT NULL DEFAULT 'ok',
      last_cleaned_at TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS waste_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bin_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      weight_kg REAL NOT NULL,
      confidence REAL NOT NULL,
      contamination INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(bin_id) REFERENCES bins(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bin_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      details TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'assigned',
      assigned_to TEXT NOT NULL,
      assigned_by TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(bin_id) REFERENCES bins(id)
    )
  `);

  const row = await get("SELECT COUNT(*) AS count FROM bins");
  if (!row || row.count === 0) {
    const now = new Date().toISOString();
    await run(
      `INSERT INTO bins (node_id, name, location, capacity_kg, current_fill_kg, cleaning_status, last_cleaned_at, updated_at)
       VALUES
       ('BIN-001', 'Plastic Pod', 'Block A', 60, 22, 'ok', ?, ?),
       ('BIN-002', 'Paper Vault', 'Block A', 70, 31, 'scheduled', ?, ?),
       ('BIN-003', 'Metal Dock', 'Block B', 65, 18, 'ok', ?, ?),
       ('BIN-004', 'Organic Bay', 'Block B', 55, 42, 'needs_cleaning', ?, ?),
       ('BIN-005', 'E-Waste Cube', 'Main Gate', 80, 11, 'ok', ?, ?)
      `,
      [now, now, now, now, now, now, now, now, now, now]
    );
  }
}
