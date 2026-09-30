import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, newId, schema } from "@/lib/db";
import type { DocumentGroup, DocumentType, FilingRule, Folder } from "@/lib/db/schema";
import { breadcrumb, humanCase, humanDate, isoDate, typeLabel } from "@/lib/format";

export { breadcrumb, humanDate, typeLabel };

/**
 * Turns an extracted, classified document into a place in the library that a
 * person can browse without help:
 *
 *   Finance / Invoices / Acme Supply Co / "Invoice 4471"  (Jul 27, 2026, 3 pages)
 *
 * The path comes from the document type's filing rule plus the document's
 * fields. Documents (groups of pages) are filed as a unit, and are re-filed as
 * later pages fill in missing fields, unless someone placed them by hand.
 */

const FALLBACK_RULE: FilingRule = {
  section: "Unsorted",
  collection: null,
  entityField: null,
  dateField: null,
  nameTemplate: "",
};

/** Plain-English descriptions for the sections the seeded types use. */
const SECTION_DESCRIPTIONS: Record<string, string> = {
  Finance: "Money in and out: invoices, receipts and statements",
  Taxes: "Tax forms, one folder per tax year",
  Medical: "Health records, one folder per patient",
  Identity: "IDs and licenses, one folder per person",
  Unsorted: "Documents the agent has not matched to a known type yet",
};

type PlanSegment = { name: string; description: string; ruleKey: string };

export type FilingPlan = {
  segments: PlanSegment[];
  displayName: string;
  documentDate: string | null;
};

// ---------- names ----------

const cleanValue = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).replace(/[\/\\]+/g, "-").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 80) : null;
};


/** Fill "Invoice {invoice_number}"; null if any placeholder has no value. */
function fillTemplate(template: string, fields: Record<string, unknown>): string | null {
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = cleanValue(fields[key]);
    if (!v) missing = true;
    return v ? (humanDate(v) ?? humanCase(v)) : "";
  });
  return missing ? null : out.replace(/\s+/g, " ").trim() || null;
}

// ---------- planning ----------

/** Merge a document's pages into one field set: the first non-empty value per field, in page order. */
export async function documentFields(groupId: string) {
  const pages = await db
    .select({ fields: schema.documents.extractedFields, title: schema.documents.title })
    .from(schema.documents)
    .where(eq(schema.documents.groupId, groupId))
    .orderBy(asc(schema.documents.pageNumber), asc(schema.documents.createdAt));
  const fields: Record<string, unknown> = {};
  for (const p of pages) {
    for (const [k, v] of Object.entries(p.fields ?? {})) {
      if (v != null && v !== "" && fields[k] == null) fields[k] = v;
    }
  }
  return { fields, pageCount: pages.length, firstTitle: pages.find((p) => p.title)?.title ?? null };
}

export function planFiling(
  type: DocumentType | null,
  group: Pick<DocumentGroup, "title">,
  fields: Record<string, unknown>,
  firstTitle: string | null,
): FilingPlan {
  const rule = type?.filingRule ?? (type && type.name !== "other" ? defaultRule(type) : FALLBACK_RULE);
  const label = type ? typeLabel(type.name) : "Document";

  const segments: PlanSegment[] = [];
  let key = rule.section;
  segments.push({
    name: rule.section,
    description: SECTION_DESCRIPTIONS[rule.section] ?? `${rule.section} documents`,
    ruleKey: key,
  });
  if (rule.collection) {
    key += `/${rule.collection}`;
    const per = rule.entityField ? `, one folder per ${rule.entityField.replace(/_/g, " ")}` : "";
    segments.push({ name: rule.collection, description: `${rule.collection}${per}`, ruleKey: key });
  }
  const entity = rule.entityField ? cleanValue(fields[rule.entityField]) : null;
  if (entity) {
    const name = humanCase(entity);
    segments.push({
      name,
      description: `${rule.collection ?? `${label}s`} for ${name}`,
      ruleKey: `${key}/${name.toLowerCase()}`,
    });
  }

  const documentDate = rule.dateField ? isoDate(fields[rule.dateField]) : null;
  const displayName =
    (rule.nameTemplate && fillTemplate(rule.nameTemplate, fields)) ||
    (firstTitle && !/^page \d+$/i.test(firstTitle) ? firstTitle : null) ||
    group.title ||
    label;

  return { segments, displayName, documentDate };
}

/** For a type the agent created without a rule: its own collection under "Other types". */
function defaultRule(type: DocumentType): FilingRule {
  return {
    section: "Other types",
    collection: `${typeLabel(type.name)}s`,
    entityField: null,
    dateField: Object.keys(type.fieldSchema.properties).find((k) => /date/.test(k)) ?? null,
    nameTemplate: "",
  };
}

// ---------- folders ----------

export async function getRootFolder() {
  const [root] = await db.select().from(schema.folders).where(isNull(schema.folders.parentId)).limit(1);
  if (!root) throw new Error("Root folder missing; run `npm run db:setup`");
  return root;
}

const childPath = (parentPath: string, name: string) => `${parentPath === "/" ? "" : parentPath}/${name}`;

/**
 * Walk (and create as needed) the folders for a plan. A folder is found by the
 * rule slot it was made for, so a rename or move by the Librarian sticks.
 */
async function ensureFolders(segments: PlanSegment[]): Promise<Folder> {
  let parent = await getRootFolder();
  for (const seg of segments) {
    const [byKey] = await db.select().from(schema.folders).where(eq(schema.folders.ruleKey, seg.ruleKey));
    if (byKey) {
      parent = byKey;
      continue;
    }
    const [byName] = await db
      .select()
      .from(schema.folders)
      .where(and(eq(schema.folders.parentId, parent.id), sql`lower(${schema.folders.name}) = ${seg.name.toLowerCase()}`));
    if (byName) {
      if (!byName.ruleKey) await db.update(schema.folders).set({ ruleKey: seg.ruleKey }).where(eq(schema.folders.id, byName.id));
      parent = byName;
      continue;
    }
    const [created] = await db
      .insert(schema.folders)
      .values({
        id: newId(),
        parentId: parent.id,
        name: seg.name,
        path: childPath(parent.path, seg.name),
        description: seg.description,
        ruleKey: seg.ruleKey,
        createdBy: "agent",
      })
      .returning();
    parent = created;
  }
  return parent;
}

/** Remove folders the agent made that are now empty, walking up from `folderId`. */
export async function pruneEmptyFolders(folderId: string | null) {
  let id = folderId;
  while (id) {
    const [folder] = await db.select().from(schema.folders).where(eq(schema.folders.id, id));
    if (!folder || !folder.parentId || folder.createdBy !== "agent") return;
    const docs = await db.$count(schema.documents, eq(schema.documents.folderId, id));
    const kids = await db.$count(schema.folders, eq(schema.folders.parentId, id));
    if (docs > 0 || kids > 0) return;
    await db.delete(schema.folders).where(eq(schema.folders.id, id));
    id = folder.parentId;
  }
}

// ---------- filing ----------

/** Put every page of a document in `folderId` and record who placed it there. */
export async function placeDocument(groupId: string, folderId: string, filedBy: "rule" | "agent" | "user") {
  const [group] = await db.select().from(schema.documentGroups).where(eq(schema.documentGroups.id, groupId));
  const previous = group?.folderId ?? null;
  await db.update(schema.documents).set({ folderId }).where(eq(schema.documents.groupId, groupId));
  await db.update(schema.documentGroups).set({ folderId, filedBy }).where(eq(schema.documentGroups.id, groupId));
  if (previous && previous !== folderId) await pruneEmptyFolders(previous);
}

export type FiledResult = { groupId: string; displayName: string; path: string; folderId: string; moved: boolean };

/**
 * File a page's whole document by its type's rule. Documents placed by hand
 * keep their folder (new pages join them there); rule-filed ones follow the rule.
 */
export async function fileDocumentOfPage(documentId: string): Promise<FiledResult> {
  const [page] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId));
  if (!page) throw new Error(`Document ${documentId} not found`);
  if (!page.groupId) throw new Error("Page is not in a document yet; add it to a group before filing");

  const [group] = await db.select().from(schema.documentGroups).where(eq(schema.documentGroups.id, page.groupId));
  const typeId = group.documentTypeId ?? page.documentTypeId;
  const [type] = typeId ? await db.select().from(schema.documentTypes).where(eq(schema.documentTypes.id, typeId)) : [];
  const { fields, firstTitle } = await documentFields(group.id);
  const plan = planFiling(type ?? null, group, fields, firstTitle);

  const [current] = group.folderId ? await db.select().from(schema.folders).where(eq(schema.folders.id, group.folderId)) : [];
  const keepByHand = current && group.filedBy && group.filedBy !== "rule";
  const target = keepByHand ? current : await ensureFolders(plan.segments);

  await db
    .update(schema.documentGroups)
    .set({ displayName: plan.displayName, documentDate: plan.documentDate })
    .where(eq(schema.documentGroups.id, group.id));
  await placeDocument(group.id, target.id, keepByHand ? group.filedBy! : "rule");

  return {
    groupId: group.id,
    displayName: plan.displayName,
    path: target.path,
    folderId: target.id,
    moved: group.folderId !== target.id,
  };
}
