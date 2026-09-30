/**
 * Seeds the root library folder and a starter vocabulary of document types.
 * Idempotent: safe to re-run.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import type { FieldSchema, FilingRule } from "../src/lib/db/schema";

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });

const types: {
  name: string;
  description: string;
  fields: FieldSchema["properties"];
  required?: string[];
  expected?: number;
  filing: FilingRule;
}[] = [
  {
    name: "invoice",
    filing: { section: "Finance", collection: "Invoices", entityField: "vendor", dateField: "invoice_date", nameTemplate: "Invoice {invoice_number}" },
    description: "A bill requesting payment for goods or services.",
    fields: { vendor: str("Issuing company"), invoice_number: str("Invoice number"), invoice_date: str("ISO date"), due_date: str("ISO date"), total: num("Total amount due"), currency: str("ISO currency code") },
    required: ["vendor", "total"],
  },
  {
    name: "receipt",
    filing: { section: "Finance", collection: "Receipts", entityField: "merchant", dateField: "date", nameTemplate: "{merchant} receipt" },
    description: "Proof of a completed purchase.",
    fields: { merchant: str("Merchant name"), date: str("ISO date"), total: num("Total paid"), payment_method: str("Card / cash / etc.") },
    required: ["merchant", "total"],
  },
  {
    name: "id_card",
    filing: { section: "Identity", collection: null, entityField: "full_name", dateField: null, nameTemplate: "{issuing_authority} ID" },
    description: "Government-issued identification (driver's license, passport, ID card). Front and back are separate scans.",
    fields: { full_name: str("Name on the ID"), id_number: str("Document number"), date_of_birth: str("ISO date"), expiry_date: str("ISO date"), issuing_authority: str("State / country"), side: str("front or back") },
    required: ["full_name"],
    expected: 2,
  },
  {
    name: "tax_form",
    filing: { section: "Taxes", collection: null, entityField: "tax_year", dateField: null, nameTemplate: "{form_type} from {employer_or_payer}" },
    description: "Tax documents such as W-2, 1099, 1040.",
    fields: { form_type: str("e.g. W-2, 1099-INT"), tax_year: num("Tax year"), taxpayer_name: str("Taxpayer"), employer_or_payer: str("Employer or payer"), amount: num("Primary amount reported") },
    required: ["form_type", "tax_year"],
  },
  {
    name: "medical_record",
    filing: { section: "Medical", collection: null, entityField: "patient_name", dateField: "visit_date", nameTemplate: "{record_kind}, {provider}" },
    description: "Clinical notes, lab results, prescriptions, or visit summaries.",
    fields: { patient_name: str("Patient"), provider: str("Doctor or facility"), visit_date: str("ISO date"), record_kind: str("lab result / visit note / prescription"), summary: str("Key findings") },
    required: ["patient_name"],
  },
  {
    name: "bank_statement",
    filing: { section: "Finance", collection: "Bank statements", entityField: "institution", dateField: "period_end", nameTemplate: "Statement ending {period_end}" },
    description: "Periodic account statement from a bank or card issuer.",
    fields: { institution: str("Bank name"), account_last4: str("Last 4 digits"), period_start: str("ISO date"), period_end: str("ISO date"), ending_balance: num("Ending balance") },
    required: ["institution"],
  },
  {
    name: "other",
    filing: { section: "Unsorted", collection: null, entityField: null, dateField: null, nameTemplate: "" },
    description: "Fallback for documents that do not match any known type yet.",
    fields: { description: str("What the document is") },
  },
];

async function main() {
  const { db, newId, schema } = await import("../src/lib/db");
  const { and, eq, isNull } = await import("drizzle-orm");

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
        filingRule: t.filing,
        createdBy: "seed",
      })
      .onConflictDoNothing({ target: schema.documentTypes.name });
    // Backfill the filing rule on databases seeded before rules existed.
    await db
      .update(schema.documentTypes)
      .set({ filingRule: t.filing })
      .where(and(eq(schema.documentTypes.name, t.name), isNull(schema.documentTypes.filingRule)));
  }

  console.log(`Seeded root folder and ${types.length} document types.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
