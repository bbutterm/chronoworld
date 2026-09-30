#!/bin/bash
# Capture client STR files that roBrowser's table does not reference: run_str.sh <raw_dir> <log> key:role:strfile ...
cd "$(dirname "$0")"; RAW=$1; LOG=$2; shift 2
export ELECTRON=/root/tools/howdeploy/CanvasTTY/node_modules/electron/dist/electron
for j in "$@"; do IFS=: read key role file <<< "$j"
  out="$RAW/${key}__${role}__str_${file}"; [ -f "$out/meta.json" ] && continue
  echo "=== $key $role $file" >> "$LOG"
  timeout 290 xvfb-run -a -s "-screen 0 1280x1024x24" node capture_effect.mjs --url http://127.0.0.1:5173/applications/browser-examples/capture-scro.html \
     --effect x --str "$file" --out "$out" >> "$LOG" 2>&1; echo "rc=$?" >> "$LOG"
done; echo DONE >> "$LOG"
