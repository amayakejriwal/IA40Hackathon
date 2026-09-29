"""bench_report.py [sim/bench-*.jsonl] → per-batch and overall accuracy/latency for each model run."""
import glob, json, subprocess, sys, statistics as st

rows = []
for f in sys.argv[1:] or sorted(glob.glob("sim/bench-*.jsonl")):
    for line in open(f):
        r = json.loads(line); S = f"sessions/{r['session']}"
        run = json.load(open(f"{S}/run.json"))
        truth = f"sim/truth/{r['batch']}.json"
        try:
            score = json.loads(subprocess.run(["python3", "sim/score.py", S, truth], capture_output=True, text=True, check=True).stdout)
        except Exception:
            score = None
        ev = [json.loads(x) for x in open(f"{S}/activity.jsonl")]
        stop = next((e["at"] for e in ev if e["kind"] == "session" and e["text"].startswith("stop")), None)
        lag = subprocess.run(["python3", "sim/lag.py", S], capture_output=True, text=True).stdout
        med = next((float(l.split("median lag ")[1].split("s")[0]) for l in lag.splitlines() if "median lag" in l), None)
        rows.append({"model": run["model"], "mode": run["mode"], "batch": r["batch"], "score": score, "lag": med,
                     "finish": (ev[-1]["at"] - stop) / 1000 if stop else None, "errors": sum(e["kind"] == "error" for e in ev)})

for model in sorted({r["model"] + "/" + r["mode"] for r in rows}):
    R = [r for r in rows if r["model"] + "/" + r["mode"] == model]
    print(f"\n== {model}")
    print(f"{'batch':20} {'exact':>7} {'prec':>5} {'rec':>5} {'dups':>6} {'blank':>6} {'lag':>6} {'finish':>7} status")
    for r in R:
        s = r["score"] or {}
        print(f"{r['batch']:20} {s.get('documents_exact', '-'):>7} {s.get('pair_precision', '-'):>5} {s.get('pair_recall', '-'):>5} "
              f"{s.get('duplicates_caught', '-'):>6} {s.get('blanks_caught', '-'):>6} {r['lag'] or 0:6.1f} {r['finish'] or 0:7.0f} {s.get('status', 'no truth')}")
    S = [r["score"] for r in R if r["score"]]
    if S:
        ex = sum(s["exact_n"] for s in S); n = sum(s["docs_n"] for s in S)
        print(f"{'TOTAL':20} {ex}/{n} docs exact ({ex / n:.0%}) · mean pair precision {st.mean(s['pair_precision'] for s in S):.2f} "
              f"· recall {st.mean(s['pair_recall'] for s in S):.2f} · median lag {st.median([r['lag'] for r in R if r['lag']] or [0]):.0f}s "
              f"· median finish {st.median([r['finish'] for r in R if r['finish']] or [0]):.0f}s after Stop · errors {sum(r['errors'] for r in R)}")
