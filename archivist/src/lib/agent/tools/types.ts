import { z } from "zod";
import { db, newId, schema } from "@/lib/db";
import type { FieldSchema } from "@/lib/db/schema";
import { defineTool } from "./define";

export const listDocumentTypes = defineTool({
  name: "list_document_types",
  description: "List all known document types with their descriptions and typed field schemas.",
  parameters: z.object({}),
  async execute() {
    return db.select().from(schema.documentTypes);
  },
});

export const createDocumentType = defineTool({
  name: "create_document_type",
  description:
    "Create a new document type (data model) when no existing type fits. Define the typed fields to extract.",
  parameters: z.object({
    name: z.string().describe("snake_case identifier, e.g. 'lab_report'"),
    description: z.string(),
    fields: z
      .array(
        z.object({
          name: z.string(),
          type: z.enum(["string", "number", "boolean", "date"]),
          description: z.string(),
          required: z.boolean(),
        }),
      )
      .describe("Typed fields to extract for this document type"),
    expectedDocsPerGroup: z
      .number()
      .int()
      .nullable()
      .describe("How many documents make a complete set (e.g. 2 for front/back of an ID); null if open-ended"),
  }),
  async execute({ name, description, fields, expectedDocsPerGroup }) {
    const fieldSchema: FieldSchema = {
      type: "object",
      properties: Object.fromEntries(
        fields.map((f) => [
          f.name,
          { type: f.type === "date" ? "string" : f.type, description: f.type === "date" ? `${f.description} (ISO date)` : f.description },
        ]),
      ),
      required: fields.filter((f) => f.required).map((f) => f.name),
    };
    const [created] = await db
      .insert(schema.documentTypes)
      .values({ id: newId(), name, description, fieldSchema, expectedDocsPerGroup, createdBy: "agent" })
      .returning();
    return created;
  },
});

export const typeTools = [listDocumentTypes, createDocumentType];
