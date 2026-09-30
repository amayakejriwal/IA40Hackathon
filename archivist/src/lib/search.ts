import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { breadcrumb, humanCase, humanDate, typeLabel } from "@/lib/format";

/**
 * Library search over documents (not pages): name, type, folder, every
 * extracted field and the full text. Every word in the query must match
 * somewhere. Each result says, in plain words, why it matched.
 *
 * Scans in memory, which is fine for a hackathon-sized library; move to SQLite
 * FTS5 when it grows past a few thousand documents.
 */

export type SearchResult = {
  groupId: string;
  name: string;
  type: string | null;
  breadcrumb: string;
  date: string | null;
  pageCount: number;
  firstPageId: string;
  /** Why it matched: a field ("Vendor: Acme Supply Co") or a snippet of the text. */
  match: { label: string; text: string } | null;
};

type Candidate = {
  result: SearchResult;
  name: string;
  meta: string; // type + folder
  fields: [string, string][];
  text: string;
  /** ISO date, for ordering ties newest first. */
  iso: string;
};

const WEIGHTS = { name: 8, field: 4, meta: 3, text: 1 };

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const fieldLabel = (k: string) => typeLabel(k);

function snippet(text: string, term: string) {
  const i = norm(text).indexOf(term);
  if (i < 0) return null;
  const start = Math.max(0, i - 50);
  const end = Math.min(text.length, i + term.length + 70);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

async function loadCandidates(): Promise<Candidate[]> {
  const groups = await db
    .select({ group: schema.documentGroups, typeName: schema.documentTypes.name })
    .from(schema.documentGroups)
    .leftJoin(schema.documentTypes, eq(schema.documentTypes.id, schema.documentGroups.documentTypeId));
  const folderPaths = new Map(
    (await db.select({ id: schema.folders.id, path: schema.folders.path }).from(schema.folders)).map((f) => [f.id, f.path]),
  );
  const pages = await db
    .select({
      id: schema.documents.id,
      groupId: schema.documents.groupId,
      title: schema.documents.title,
      summary: schema.documents.summary,
      ocrText: schema.documents.ocrText,
      fields: schema.documents.extractedFields,
      folderId: schema.documents.folderId,
    })
    .from(schema.documents)
    .orderBy(asc(schema.documents.pageNumber), asc(schema.documents.createdAt));

  const byGroup = new Map<string, typeof pages>();
  for (const p of pages) if (p.groupId) byGroup.set(p.groupId, [...(byGroup.get(p.groupId) ?? []), p]);

  return groups.flatMap(({ group, typeName }) => {
    const members = byGroup.get(group.id);
    if (!members?.length) return [];
    // Older documents carry their folder only on their pages.
    const folderId = group.folderId ?? members.find((p) => p.folderId)?.folderId;
    const path = folderId ? folderPaths.get(folderId) : null;
    const fields = new Map<string, string>();
    for (const p of members) {
      for (const [k, v] of Object.entries(p.fields ?? {})) {
        if (v != null && v !== "" && !fields.has(k)) fields.set(k, String(v));
      }
    }
    const name = group.displayName ?? group.title;
    const type = typeName && typeName !== "other" ? typeLabel(typeName) : null;
    const crumb = breadcrumb(path);
    return [
      {
        result: {
          groupId: group.id,
          name,
          type,
          breadcrumb: crumb,
          date: humanDate(group.documentDate),
          pageCount: members.length,
          firstPageId: members[0].id,
          match: null,
        },
        name: norm(`${name} ${group.title}`),
        meta: norm(`${type ?? ""} ${crumb}`),
        fields: [...fields.entries()],
        text: members.map((p) => [p.summary, p.ocrText].filter(Boolean).join("\n")).join("\n"),
        iso: group.documentDate ?? "",
      },
    ];
  });
}

export async function searchLibrary(query: string, limit = 30): Promise<SearchResult[]> {
  const terms = norm(query).split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return [];
  const candidates = await loadCandidates();

  const scored: { r: SearchResult; score: number; iso: string }[] = [];
  for (const c of candidates) {
    const normText = norm(c.text);
    let score = 0;
    let match: SearchResult["match"] = null;
    let all = true;
    for (const t of terms) {
      const field = c.fields.find(([, v]) => norm(v).includes(t));
      const hit = c.name.includes(t)
        ? WEIGHTS.name
        : field
          ? WEIGHTS.field
          : c.meta.includes(t)
            ? WEIGHTS.meta
            : normText.includes(t)
              ? WEIGHTS.text
              : 0;
      if (!hit) {
        all = false;
        break;
      }
      score += hit;
      // Explain the match with the most specific evidence that is not already visible in the name.
      if (!match && field && !c.name.includes(t)) match = { label: fieldLabel(field[0]), text: humanCase(field[1]) };
      if (!match && hit === WEIGHTS.text) {
        const s = snippet(c.text, t);
        if (s) match = { label: "Text", text: s };
      }
    }
    if (all) scored.push({ r: { ...c.result, match }, score, iso: c.iso });
  }

  return scored
    .sort((a, b) => b.score - a.score || b.iso.localeCompare(a.iso))
    .slice(0, limit)
    .map((s) => s.r);
}

