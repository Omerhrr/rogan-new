#!/bin/bash
set -e

echo "Waiting for postgres TCP on postgres:5432..."
for i in $(seq 1 30); do
  if python -c "import socket; s=socket.create_connection(('postgres',5432),timeout=2); s.close()" 2>/dev/null; then
    echo "Postgres reachable."
    break
  fi
  echo "  attempt $i/30, retrying in 2s..."
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "ERROR: postgres never became reachable after 60s"
    exit 1
  fi
done

alembic upgrade head || (
  echo "Migration failed — stamping head and retrying..."
  alembic stamp head
  alembic upgrade head
)
