#!/usr/bin/env bash
# Run as the same Linux account used to deploy the backend, without sudo.
set -euo pipefail
backend_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
state_dir="${REGISTRATION_SHEET_SYNC_STATE_DIR:-/home/ubuntu/aoa-data/registration-sheet-sync}"
node_bin="$(command -v node)"
for tool in flock crontab; do command -v "$tool" >/dev/null || { echo "Missing required command: $tool" >&2; exit 1; }; done
# Cron treats percent signs specially, including inside shell quotes.
for value in "$backend_dir" "$state_dir" "$node_bin"; do
  if [[ "$value" == *%* || "$value" == *$'\n'* ]]; then echo 'Paths must not contain percent signs or newlines.' >&2; exit 1; fi
done
"$node_bin" --input-type=module - "$state_dir/config.json" <<'JS'
import fs from 'node:fs';
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const url = new URL(config.url);
if (!config.secret || url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) throw new Error('Invalid sheet-sync configuration');
JS
# Quote values for cron's POSIX shell, including paths containing spaces.
quote() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
marker='# aoa-registration-sheet-sync'
existing="$(crontab -l 2>/dev/null || true)"
entry="0 * * * * REGISTRATION_SHEET_SYNC_STATE_DIR=$(quote "$state_dir") REGISTRATION_SHEET_SYNC_NODE=$(quote "$node_bin") /bin/bash $(quote "$backend_dir/scripts/server/run-registration-sheet-sync.sh") $marker"
{ printf '%s\n' "$existing" | sed '/# aoa-registration-sheet-sync$/d'; printf '%s\n' "$entry"; } | crontab -
echo 'Installed registration sheet sync at the start of every hour (server timezone).'
