const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const dataFolder = path.join(__dirname, 'data');
const dbPath = path.join(dataFolder, 'vault.db');

let dbPromise = null;

const ensureDataFolder = () => {
  if (!fs.existsSync(dataFolder)) {
    fs.mkdirSync(dataFolder, { recursive: true });
  }
};

const getDb = async () => {
  if (!dbPromise) {
    ensureDataFolder();
    dbPromise = open({
      filename: dbPath,
      driver: sqlite3.Database
    });
  }
  return dbPromise;
};

const createSchema = async (db) => {
  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entry_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_entry_files_entry_id ON entry_files(entry_id);
  `);
};

const initDatabase = async () => {
  const db = await getDb();
  await createSchema(db);
  return db;
};

module.exports = {
  initDatabase
};
