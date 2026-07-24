#!/usr/bin/env bash
# smoke-worker.sh (EYT-58) — boots the built worker, asserts it opens NO
# listening TCP port (ADR-001 §2: same module, no HTTP), then verifies
# graceful shutdown on SIGTERM. Requires the same strict test-preset env
# as smoke-api.sh.
set -euo pipefail

node apps/api/dist/worker.js & PID=$!
trap 'kill -9 $PID 2>/dev/null || true' EXIT

# True (exit 0) when $PID holds a listening TCP socket. Prefers ss; falls
# back to matching the process's socket inodes against listening entries
# (state 0A) in /proc/net/tcp{,6} for minimal environments without ss.
worker_has_listening_port() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | grep -q "pid=${PID},"
    return
  fi
  local inode table
  for inode in $(
    find "/proc/${PID}/fd" -type l -printf '%l\n' 2>/dev/null |
      sed -n 's/^socket:\[\([0-9]*\)\]$/\1/p'
  ); do
    # Check each table separately: a missing file (e.g. no IPv6) would be
    # a FATAL awk error that skips END and silently hides real listeners.
    for table in /proc/net/tcp /proc/net/tcp6; do
      [ -r "${table}" ] || continue
      if awk -v inode="${inode}" \
        '$4 == "0A" && $10 == inode { found = 1 } END { exit !found }' "${table}"; then
        return 0
      fi
    done
  done
  return 1
}

sleep 5

if ! kill -0 $PID 2>/dev/null; then
  echo "::error::Worker exited prematurely"
  exit 1
fi

if worker_has_listening_port; then
  echo "::error::Worker opened an unexpected listening port"
  exit 1
fi
echo "worker holds no listening TCP port"

kill -TERM $PID
for _ in $(seq 1 10); do
  kill -0 $PID 2>/dev/null || {
    trap - EXIT
    echo "worker shutdown OK"
    exit 0
  }
  sleep 1
done

echo "::error::Worker did not shut down gracefully"
exit 1
