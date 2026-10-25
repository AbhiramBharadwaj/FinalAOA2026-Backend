#!/usr/bin/env bash
set -euo pipefail
umask 077
backend_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
state_dir="${REGISTRATION_SHEET_SYNC_STATE_DIR:-/home/ubuntu/aoa-data/registration-sheet-sync}"
node_bin="${REGISTRATION_SHEET_SYNC_NODE:-$(command -v node)}"
mkdir -p "$state_dir/logs"
exec >> "$state_dir/logs/$(date +%F).log" 2>&1
exec 9> "$state_dir/sync.lock"
if ! flock -n 9; then
  echo "$(date -Is) Skipped: previous scheduled sync is still running."
  exit 0
fi
export REGISTRATION_SHEET_SYNC_CONFIG="$state_dir/config.json"
echo "$(date -Is) Starting registration sheet sync."
cd "$backend_dir"
status=0
"$node_bin" scripts/sync-registration-sheets.js --apply || status=$?
echo "$(date -Is) Registration sheet sync finished with exit code $status."
find "$state_dir/logs" -type f -name '*.log' -mtime +30 -delete
exit "$status"
