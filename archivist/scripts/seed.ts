/**
 * Seeds the root library folder and a starter vocabulary of document types.
 * Idempotent: safe to re-run.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import type { FieldSchema } from "../src/lib/db/schema";

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });

const types: { name: string; description: string; fields: FieldSchema["properties"]; required?: string[]; expected?: number }[] = [
  {
    name: "invoice",
    description: "A bill requesting payment for goods or services.",
    fields: { vendor: str("Issuing company"), invoice_number: str("Invoice number"), invoice_date: str("ISO date"), due_date: str("ISO date"), total: num("Total amount due"), currency: str("ISO currency code") },
    required: ["vendor", "total"],
  },
  {
    name: "receipt",
    description: "Proof of a completed purchase.",
    fields: { merchant: str("Merchant name"), date: str("ISO date"), total: num("Total paid"), payment_method: str("Card / cash / etc.") },
    required: ["merchant", "total"],
  },
  {
    name: "id_card",
    description: "Government-issued identification (driver's license, passport, ID card). Front and back are separate scans.",
    fields: { full_name: str("Name on the ID"), id_number: str("Document number"), date_of_birth: str("ISO date"), expiry_date: str("ISO date"), issuing_authority: str("State / country"), side: str("front or back") },
    required: ["full_name"],
    expected: 2,
  },
  {
    name: "tax_form",
    description: "Tax documents such as W-2, 1099, 1040.",
    fields: { form_type: str("e.g. W-2, 1099-INT"), tax_year: num("Tax year"), taxpayer_name: str("Taxpayer"), employer_or_payer: str("Employer or payer"), amount: num("Primary amount reported") },
    required: ["form_type", "tax_year"],
  },
  {
    name: "medical_record",
    description: "Clinical notes, lab results, prescriptions, or visit summaries.",
    fields: { patient_name: str("Patient"), provider: str("Doctor or facility"), visit_date: str("ISO date"), record_kind: str("lab result / visit note / prescription"), summary: str("Key findings") },
    required: ["patient_name"],
  },
  {
    name: "bank_statement",
    description: "Periodic account statement from a bank or card issuer.",
    fields: { institution: str("Bank name"), account_last4: str("Last 4 digits"), period_start: str("ISO date"), period_end: str("ISO date"), ending_balance: num("Ending balance") },
    required: ["institution"],
  },
  {
    name: "other",
    description: "Fallback for documents that do not match any known type yet.",
    fields: { description: str("What the document is") },
  },
];

async function main() {
  const { db, newId, schema } = await import("../src/lib/db");
  const { isNull } = await import("drizzle-orm");

  const [root] = await db.select().from(schema.folders).where(isNull(schema.folders.parentId));
  if (!root) {
    await db.insert(schema.folders).values({
      id: newId(),
      parentId: null,
      name: "Library",
      path: "/",
      description: "Root of the document library",
      createdBy: "seed",
    });
  }

  for (const t of types) {
    await db
      .insert(schema.documentTypes)
      .values({
        id: newId(),
        name: t.name,
        description: t.description,
        fieldSchema: { type: "object", properties: t.fields, required: t.required ?? [] },
        expectedDocsPerGroup: t.expected ?? null,
        createdBy: "seed",
      })
      .onConflictDoNothing({ target: schema.documentTypes.name });
  }

  console.log(`Seeded root folder and ${types.length} document types.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
