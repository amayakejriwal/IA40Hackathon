import { desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, newId, schema } from "@/lib/db";
import { defineTool } from "./define";

const MAX_CANDIDATES = 20;

/**
 * Candidates are the incomplete groups, plus any group (complete or not) whose
 * title or grouping key mentions one of the document's entities. Same-type and
 * entity matches come first; the agent makes the final call.
 */
export const findCandidateGroups = defineTool({
  name: "find_candidate_groups",
  description:
    "Find existing document groups this document might belong to. Pass the document's type and its key entities (names, account/case numbers) from ocr_document. Returns each group's grouping key, expected vs received count and its members' titles.",
  parameters: z.object({
    documentTypeId: z.string().nullable(),
    entities: z.array(z.string()).describe("Key identifying values, e.g. ['Jane Doe', 'ACCT 1234-55']"),
  }),
  step: "grouping",
  async execute({ documentTypeId, entities }) {
    const terms = entities.map((e) => e.trim().toLowerCase()).filter((e) => e.length >= 3);
    const mentions = terms.flatMap((t) => [
      like(sql`lower(${schema.documentGroups.title})`, `%${t}%`),
      like(sql`lower(${schema.documentGroups.groupingKey})`, `%${t}%`),
    ]);
    const groups = await db
      .select()
      .from(schema.documentGroups)
      .where(or(eq(schema.documentGroups.status, "incomplete"), ...mentions))
      .orderBy(desc(schema.documentGroups.updatedAt))
      .limit(100);

    const score = (g: (typeof groups)[number]) => {
      const haystack = `${g.title} ${g.groupingKey ?? ""}`.toLowerCase();
      const entityHits = terms.filter((t) => haystack.includes(t)).length;
      return entityHits * 2 + (documentTypeId && g.documentTypeId === documentTypeId ? 1 : 0);
    };
    const ranked = groups
      .map((g) => ({ g, s: score(g) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_CANDIDATES);
    if (ranked.length === 0) return [];

    const members = await db
      .select({
        groupId: schema.documents.groupId,
        id: schema.documents.id,
        title: schema.documents.title,
        pageNumber: schema.documents.pageNumber,
      })
      .from(schema.documents)
      .where(inArray(schema.documents.groupId, ranked.map(({ g }) => g.id)));

    return ranked.map(({ g, s }) => ({
      id: g.id,
      title: g.title,
      documentTypeId: g.documentTypeId,
      groupingKey: g.groupingKey,
      expectedCount: g.expectedCount,
      receivedCount: g.receivedCount,
      status: g.status,
      matchScore: s,
      members: members.filter((m) => m.groupId === g.id).map(({ id, title, pageNumber }) => ({ id, title, pageNumber })),
    }));
  },
});

export const createGroup = defineTool({
  name: "create_group",
  description: "Create a new document group (a set of related documents, e.g. all pages of one tax return).",
  parameters: z.object({
    title: z.string(),
    documentTypeId: z.string().nullable(),
    groupingKey: z.string().nullable().describe("What ties the group together, e.g. 'patient:Jane Doe'"),
    expectedCount: z.number().int().nullable().describe("How many documents the group expects; null if unknown"),
  }),
  async execute(input) {
    const [group] = await db.insert(schema.documentGroups).values({ id: newId(), ...input }).returning();
    return group;
  },
});

export const addToGroup = defineTool({
  name: "add_to_group",
  description: "Add the document to a group. Marks the group complete once it has the expected number of documents.",
  parameters: z.object({ documentId: z.string(), groupId: z.string() }),
  async execute({ documentId, groupId }) {
    const [doc] = await db
      .select({ groupId: schema.documents.groupId })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    if (!doc) throw new Error(`Document ${documentId} not found`);
    if (doc.groupId === groupId) {
      const [current] = await db.select().from(schema.documentGroups).where(eq(schema.documentGroups.id, groupId));
      return current;
    }
    if (doc.groupId) {
      // Moving between groups (e.g. on reprocess): the old group loses a member.
      await db
        .update(schema.documentGroups)
        .set({ receivedCount: sql`max(${schema.documentGroups.receivedCount} - 1, 0)`, status: "incomplete" })
        .where(eq(schema.documentGroups.id, doc.groupId));
    }
    await db.update(schema.documents).set({ groupId }).where(eq(schema.documents.id, documentId));
    const [group] = await db
      .update(schema.documentGroups)
      .set({ receivedCount: sql`${schema.documentGroups.receivedCount} + 1` })
      .where(eq(schema.documentGroups.id, groupId))
      .returning();
    if (!group) throw new Error(`Group ${groupId} not found`);
    if (group.expectedCount && group.receivedCount >= group.expectedCount) {
      await db.update(schema.documentGroups).set({ status: "complete" }).where(eq(schema.documentGroups.id, groupId));
      group.status = "complete";
    }
    return group;
  },
});

export const groupTools = [findCandidateGroups, createGroup, addToGroup];
