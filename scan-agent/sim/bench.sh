#!/bin/zsh
# bench.sh <port> <batch-dir>... → replays each phone batch through the relay on <port>, one at a time,
# waits for the agent to finish, and appends {batch, session} to sim/bench-<port>.jsonl. Score later with bench_report.py.
cd ${0:A:h:h}
port=$1; shift
for b in "$@"; do
  sid=$(node sim/import_batch.mjs $b --relay http://localhost:$port | awk '/^SESSION/{print $2}')
  S=sessions/$sid
  until grep -q '"status": "done"' $S/ledger.json 2>/dev/null || [[ -n $(find $S/activity.jsonl -mmin +4 2>/dev/null) ]]; do sleep 5; done
  print "{\"batch\": \"${b:t}\", \"session\": \"$sid\"}" >> sim/bench-$port.jsonl
  print "$port ${b:t} → $sid"
done
