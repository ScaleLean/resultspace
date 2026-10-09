#!/usr/bin/env bash
# Hourly local backup: a consistent copy (VACUUM INTO) of every SQLite file in the data directory,
# integrity-checked, keeping the newest 72. Run it from cron or a systemd timer, e.g. hourly.
set -euo pipefail
umask 077
DATA=${RS_DATA_DIR:-$HOME/.local/share/resultspace/data}
ROOT=${BACKUP_ROOT:-$HOME/.local/share/resultspace/backups}
KEEP=${KEEP:-72}
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=$ROOT/hourly-$TS
mkdir -p "$OUT"
n=0
for f in "$DATA"/*.sqlite; do
  b=$(basename "$f")
  sqlite3 "file:$f?mode=ro" "vacuum into '$OUT/$b'"
  [ "$(sqlite3 "$OUT/$b" 'pragma integrity_check')" = ok ] || { echo "integrity FAILED $b"; exit 1; }
  n=$((n+1))
done
[ "$n" -ge "${MIN_FILES:-8}" ] || { echo "only $n files"; exit 1; }
ls -1d "$ROOT"/hourly-* | sort | head -n -"$KEEP" | xargs -r rm -rf
echo "ok $TS files=$n size=$(du -sh "$OUT" | cut -f1)"
