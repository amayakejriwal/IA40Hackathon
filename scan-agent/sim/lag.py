"""lag.py <session-dir> → per-event lag from arrival to first ledger mention, and finish time."""
import json, re, sys
d = sys.argv[1]
ev = [json.loads(x) for x in open(f"{d}/activity.jsonl")]
arr = {e["id"]: e["at"] for e in ev if e["kind"] in ("page", "audio")}
seen, lags = set(), []
for e in ev:
    if e["kind"] == "ledger":
        for i in re.findall(r"\b([pa]\d{4}(?:-[0-9a-f]+)?)\b", e.get("msg") or ""):
            if i in arr and i not in seen:
                seen.add(i); lags.append((e["at"] - arr[i]) / 1000)
                print(f"{i} lag {lags[-1]:5.1f}s  {e['msg'][:100]}")
stop = next(e["at"] for e in ev if e["kind"] == "session" and e["text"].startswith("stop"))
print(f"median lag {sorted(lags)[len(lags)//2]:.1f}s · max {max(lags):.1f}s · done {(ev[-1]['at']-stop)/1000:.0f}s after Stop · "
      f"{sum(e['kind']=='cmd' for e in ev)} commands · {sum(e['kind']=='nudge' for e in ev)} nudges · {sum(e['kind']=='error' for e in ev)} errors")
