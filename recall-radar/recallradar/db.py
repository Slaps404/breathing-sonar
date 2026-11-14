"""SQLite storage. One file, data/recallradar.db. FTS5 gives fast keyword search over recalls."""
import sqlite3

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS recalls (
  recall_id INTEGER PRIMARY KEY,
  number TEXT, date TEXT, title TEXT, description TEXT,
  products TEXT,      -- product names joined
  models TEXT,        -- extracted model numbers, space separated, uppercase
  brands TEXT,        -- company / brand names
  hazard TEXT, injuries TEXT, remedy TEXT, remedy_type TEXT,
  units TEXT, url TEXT, images TEXT,  -- images: JSON list of {url, caption}
  raw TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS recalls_fts USING fts5(
  title, products, brands, models, description,
  content='recalls', content_rowid='recall_id', tokenize='porter unicode61'
);
CREATE TABLE IF NOT EXISTS listings (
  listing_id TEXT PRIMARY KEY,
  title TEXT, price TEXT, city TEXT, thumb TEXT, query TEXT,
  description TEXT, photos TEXT, lat REAL, lon REAL, post_date TEXT,
  detail_fetched INTEGER DEFAULT 0, first_seen TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS identities (   -- what the vision model thinks the item is
  listing_id TEXT PRIMARY KEY, data TEXT
);
CREATE TABLE IF NOT EXISTS verdicts (
  listing_id TEXT, recall_id INTEGER, sweep_id TEXT,
  verdict TEXT, confidence REAL, reason TEXT, evidence TEXT, stage TEXT,
  created TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (listing_id, sweep_id)
);
CREATE TABLE IF NOT EXISTS sweeps (
  sweep_id TEXT PRIMARY KEY, started TEXT, finished TEXT, stats TEXT, queries TEXT
);
"""


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    return con
