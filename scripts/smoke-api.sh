#!/usr/bin/env bash
# smoke-api.sh (EYT-58) — boots the built API, checks /health (must be 200)
# and /ready (must equal EXPECT_READY, default 200), then verifies graceful
# shutdown on SIGTERM. Requires NODE_ENV/API_PORT/DATABASE_URL/SUPABASE_URL/
# SUPABASE_ANON_KEY in the environment (strict test preset, no defaults).
set -euo pipefail

node apps/api/dist/main.js & PID=$!
trap 'kill -9 $PID 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done

curl -fsS "http://127.0.0.1:${API_PORT}/health"
echo

READY_STATUS=$(curl -s -o /tmp/ready.json -w "%{http_code}" "http://127.0.0.1:${API_PORT}/ready")
echo "ready=${READY_STATUS} $(cat /tmp/ready.json)"
[ "${READY_STATUS}" = "${EXPECT_READY:-200}" ]

kill -TERM $PID
for _ in $(seq 1 10); do
  kill -0 $PID 2>/dev/null || {
    trap - EXIT
    echo "graceful shutdown OK"
    exit 0
  }
  sleep 1
done

echo "::error::API did not shut down gracefully"
exit 1
