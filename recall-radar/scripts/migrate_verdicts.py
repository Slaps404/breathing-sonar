"""One-off: change verdicts primary key to (listing_id, sweep_id)."""
import sqlite3, sys
from pathlib import Path
db = Path(__file__).resolve().parent.parent / "data/recallradar.db"
con = sqlite3.connect(db)
sql = con.execute("SELECT sql FROM sqlite_master WHERE name='verdicts'").fetchone()[0]
if "PRIMARY KEY (listing_id, sweep_id)" in sql:
    print("already migrated"); sys.exit()
con.executescript("""
ALTER TABLE verdicts RENAME TO verdicts_old;
CREATE TABLE verdicts (listing_id TEXT, recall_id INTEGER, sweep_id TEXT, verdict TEXT, confidence REAL, reason TEXT,
  evidence TEXT, stage TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (listing_id, sweep_id));
INSERT OR REPLACE INTO verdicts SELECT listing_id, recall_id, sweep_id, verdict, confidence, reason, evidence, stage, created FROM verdicts_old;
DROP TABLE verdicts_old;""")
con.commit(); print("migrated", con.execute("select count(*) from verdicts").fetchone()[0])
