#!/bin/zsh
# eval.sh <receiver-batch-dir | scenario.json> [truth.json] → run a session through the live relay, wait, score it.
set -e
cd ${0:A:h:h}
src=$1; truth=${2:-sim/truth/${src:t}.json}
if [[ $src == *.json ]]; then node sim/replay.mjs $src >/dev/null; else node sim/import_batch.mjs $src >/dev/null; fi
S=$(ls -d sessions/s-* | tail -1)
until grep -q '"status": "done"' $S/ledger.json || [[ -n $(find $S/activity.jsonl -mmin +4) ]]; do sleep 5; done
print "session $S  status=$(python3 -c "import json;print(json.load(open('$S/ledger.json'))['status'])")"
python3 sim/lag.py $S | tail -1
[[ -f $truth ]] && python3 sim/score.py $S $truth
