import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, newId, schema } from "@/lib/db";
import { defineTool } from "./define";

// TODO(step 3): rank candidates by grouping key / entity overlap, not just type.
export const findCandidateGroups = defineTool({
  name: "find_candidate_groups",
  description:
    "Find existing incomplete document groups this document might belong to (same type/topic, still expecting documents).",
  parameters: z.object({ documentTypeId: z.string().nullable() }),
  step: "grouping",
  async execute({ documentTypeId }) {
    return db
      .select()
      .from(schema.documentGroups)
      .where(
        and(
          eq(schema.documentGroups.status, "incomplete"),
          documentTypeId ? eq(schema.documentGroups.documentTypeId, documentTypeId) : undefined,
        ),
      )
      .limit(20);
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
