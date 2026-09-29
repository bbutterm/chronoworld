#!/bin/bash
# Usage: run_jobs.sh <jobs.json> <raw_dir> <log>. jobs: [[skill, role, roEffect], ...]. Resumable (skips jobs with meta.json).
# Default 800x600 capture; if content touches the canvas edge, recapture on 1600x1200 at zoom 250 (same px scale), then 375.
cd "$(dirname "$0")"
JOBS=$1; RAW=$2; LOG=$3
export ELECTRON=/root/tools/howdeploy/CanvasTTY/node_modules/electron/dist/electron
URL=http://127.0.0.1:5173/applications/browser-examples
edge() { python3 - "$1" <<'PY'
import glob, sys, numpy as np
from PIL import Image
for f in sorted(glob.glob(sys.argv[1] + '/frame_*.png')):
    a = np.asarray(Image.open(f).convert('RGB')).max(2) > 6
    if a[:3].any() or a[-3:].any() or a[:, :3].any() or a[:, -3:].any():
        print(1); sys.exit()
print(0)
PY
}
cap() { # out effect page size zoom screen
  timeout 290 xvfb-run -a -s "-screen 0 $6" node capture_effect.mjs --url "$URL/$3" --effect "$2" --out "$1" --size "$4" --zoom "$5" >> "$LOG" 2>&1
  echo $?
}
python3 -c "import json,sys;[print(*j[:3]) for j in json.load(open(sys.argv[1]))]" "$JOBS" | while read skill role eff; do
  base="$RAW/${skill}__${role}__${eff}"
  if [ -f "$base/meta.json" ] || [ -f "$base.skip" ]; then continue; fi
  echo "=== $skill $role $eff $(date +%T)" >> "$LOG"
  rc=$(cap "$base" "$eff" capture-scro.html 800x600 0 1280x1024x24)
  echo "rc=$rc" >> "$LOG"
  if [ "$rc" != "0" ]; then echo "$rc" > "$base.skip"; continue; fi
  if [ "$(edge "$base")" = "1" ]; then
    for z in 250 375; do
      out="${base}__L$z"
      rc=$(cap "$out" "$eff" capture-scro-1600.html 1600x1200 $z 2048x1600x24)
      e=$(edge "$out"); echo "L$z rc=$rc edge=$e" >> "$LOG"
      [ "$e" = "0" ] && break
    done
  fi
done
echo DONE >> "$LOG"
