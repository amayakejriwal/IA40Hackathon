"""score.py <session-dir> <truth.json> → how well the agent split pages into documents and caught duplicates.
Pairwise: for every pair of usable pages, did the agent put them together iff the truth does?"""
import json, sys, itertools
L = json.load(open(f"{sys.argv[1]}/ledger.json")); T = json.load(open(sys.argv[2]))
# Score physical sheets, not captures: a sheet photographed twice counts once, and it doesn't
# matter which capture the agent kept (it may rightly prefer the sharper reshoot).
sheet = {}
for d, keep in T["duplicates"].items():
    while keep in T["duplicates"]: keep = T["duplicates"][keep]
    sheet[d] = keep
S = lambda p: sheet.get(p, p)
truth_doc = {p: i for i, d in enumerate(T["documents"]) for p in d}
agent_doc = {}
for p, v in L["pages"].items():
    if v.get("status") == "ok" and v.get("doc"):
        agent_doc.setdefault(S(p), v.get("doc"))
for p, v in L["pages"].items():  # a kept reshoot stands in for its sheet if the original was excluded
    if v.get("status") != "ok" and S(p) not in agent_doc:
        alt = [q for q, w in L["pages"].items() if w.get("status") == "ok" and w.get("doc") and S(q) == S(p)]
        if alt: agent_doc[S(p)] = L["pages"][alt[0]]["doc"]
pages = sorted(truth_doc)
tp = fp = fn = tn = 0
for a, b in itertools.combinations(pages, 2):
    same_t = truth_doc[a] == truth_doc[b]
    same_a = agent_doc.get(a) is not None and agent_doc.get(a) == agent_doc.get(b)
    tp += same_t and same_a; fn += same_t and not same_a; fp += same_a and not same_t; tn += not same_t and not same_a
exact = sum(1 for d in T["documents"] if len({agent_doc.get(p) for p in d}) == 1 and None not in {agent_doc.get(p) for p in d}
            and sum(1 for v in agent_doc.values() if v == agent_doc.get(d[0])) == len(d))
# A duplicate is caught when exactly one capture of the sheet is kept.
dups = {p: sum(1 for q, w in L["pages"].items() if S(q) == S(p) and w.get("status") == "ok") == 1 for p in T["duplicates"]}
false_dups = [p for p, v in L["pages"].items() if v.get("status") == "duplicate" and S(p) == p and p not in T["duplicates"]
              and not any(S(q) == p and w.get("status") == "ok" for q, w in L["pages"].items() if q != p)]
blanks = T.get("blank", [])
blank_ok = sum(1 for p in blanks if L["pages"].get(p, {}).get("status", "ok") != "ok")  # any exclusion (blank/retake/duplicate/removed) counts
missed_pages = [p for p in pages if p not in L["pages"]]
print(json.dumps({"documents_exact": f"{exact}/{len(T['documents'])}", "pair_precision": round(tp / (tp + fp), 2) if tp + fp else 1.0,
                  "pair_recall": round(tp / (tp + fn), 2) if tp + fn else 1.0, "duplicates_caught": f"{sum(dups.values())}/{len(dups)}",
                  "false_duplicates": false_dups, "blanks_caught": f"{blank_ok}/{len(blanks)}",
                  "missing_from_ledger": missed_pages, "agent_docs": len(L["documents"]), "true_docs": len(T["documents"]),
                  "status": L.get("status"), "exact_n": exact, "docs_n": len(T["documents"])}))
