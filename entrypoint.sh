#!/bin/sh
set -e
# Ensure /app/data and /app/workspace are writable by node (SQLite + clone dirs)
chown -R node:node /app/data /app/workspace
exec gosu node "$@"
