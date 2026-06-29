"""Run this once to add live→private transition columns."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("DATABASE_URL", "postgresql://rogan:rogan@postgres:5432/rogan")
from sqlalchemy import text
from app.database import engine

ALTER_STMTS = [
    "ALTER TABLE streams ADD COLUMN IF NOT EXISTS active_private_show_id VARCHAR",
    "ALTER TABLE private_shows ADD COLUMN IF NOT EXISTS live_stream_id VARCHAR",
    "ALTER TABLE private_shows ADD COLUMN IF NOT EXISTS countdown_seconds INTEGER",
    "ALTER TABLE private_shows ADD COLUMN IF NOT EXISTS announced_at TIMESTAMP",
]
with engine.connect() as conn:
    for stmt in ALTER_STMTS:
        try:
            conn.execute(text(stmt))
            print(f"OK: {stmt[:60]}")
        except Exception as e:
            print(f"Skip: {e}")
    conn.commit()
print("Migration done.")
