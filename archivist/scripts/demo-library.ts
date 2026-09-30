/**
 * Fills the library with a few realistic, already-extracted documents and files
 * them by rule, to exercise filing and search without an OpenAI key.
 *
 *   npx tsx scripts/demo-library.ts          add the demo documents
 *   npx tsx scripts/demo-library.ts --clean  remove them again
 *
 * Demo rows are tagged with source file names starting "demo-".
 */
import { config } from "dotenv";
config({ path: ".env.local" });

type Page = { fields: Record<string, unknown>; text: string; title?: string };
type Doc = { type: string; pages: Page[] };

const DOCS: Doc[] = [
  {
    type: "invoice",
    pages: [
      { fields: { invoice_number: "4471", invoice_date: "2026-07-27", total: 1284.5, currency: "USD" }, text: "INVOICE 4471\nBill to: Harbor Clinic\nDate: July 27, 2026" },
      { fields: { vendor: "ACME SUPPLY CO", due_date: "2026-08-26" }, text: "Acme Supply Co\nRemit to 200 Market St\nTotal due $1,284.50" },
    ],
  },
  { type: "invoice", pages: [{ fields: { vendor: "Acme Supply Co", invoice_number: "4502", invoice_date: "2026-08-30", total: 310 }, text: "INVOICE 4502 Acme Supply Co gloves and masks" }] },
  { type: "receipt", pages: [{ fields: { merchant: "Blue Bottle Coffee", date: "2026-09-02", total: 14.25, payment_method: "Visa" }, text: "Blue Bottle Coffee\n2 latte 1 croissant\nTotal 14.25" }] },
  { type: "medical_record", pages: [{ fields: { patient_name: "Jane Doe", provider: "Harbor Clinic", visit_date: "2026-08-12", record_kind: "Lab result", summary: "Normal CBC" }, text: "Harbor Clinic laboratory report. Patient: Jane Doe. Complete blood count within normal limits." }] },
  { type: "tax_form", pages: [{ fields: { form_type: "W-2", tax_year: 2025, taxpayer_name: "Jane Doe", employer_or_payer: "Harbor Clinic", amount: 68250 }, text: "Form W-2 Wage and Tax Statement 2025 Harbor Clinic" }] },
  { type: "bank_statement", pages: [{ fields: { institution: "First National Bank", account_last4: "1234", period_end: "2026-08-31", ending_balance: 5120.77 }, text: "First National Bank statement for account ending 1234" }] },
  { type: "utility_bill", pages: [{ fields: { provider: "Pacific Gas and Electric", billing_period: "August 2026", amount_due: 142.1, due_date: "2026-09-20" }, text: "PG&E Energy Statement August 2026 Amount due $142.10" }] },
  { type: "other", pages: [{ fields: {}, title: "Handwritten note about box 7", text: "Remember to call the county about the parcel map" }] },
];

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A plain paper-style page image: the text's lines, then gray bars for body copy. */
function pageSvg(text: string, pageNumber: number, pageCount: number) {
  const lines = text.split("\n").flatMap((l) => l.match(/.{1,44}(\s|$)/g) ?? [l]).map((l) => l.trim()).filter(Boolean).slice(0, 9);
  const heading = `<text x="70" y="120" font-size="34" font-weight="700" fill="#1d1d1f">${esc(lines[0] ?? "")}</text>`;
  const body = lines
    .slice(1)
    .map((l, i) => `<text x="70" y="${190 + i * 38}" font-size="22" fill="#3a3a3c">${esc(l)}</text>`)
    .join("");
  const top = 190 + (lines.length - 1) * 38 + 50;
  const bars = [0.92, 0.85, 0.9, 0.7, 0.88, 0.8, 0.6]
    .map((w, i) => `<rect x="70" y="${top + i * 34}" width="${Math.round(710 * w)}" height="12" rx="6" fill="#e5e5ea"/>`)
    .join("");
  const footer = pageCount > 1 ? `<text x="780" y="1050" font-size="18" text-anchor="end" fill="#8e8e93">Page ${pageNumber} of ${pageCount}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="850" height="1100" viewBox="0 0 850 1100" font-family="Helvetica, Arial, sans-serif"><rect width="850" height="1100" fill="#fdfdfb"/>${heading}${body}${bars}${footer}</svg>`;
}

async function main() {
  const { db, newId, schema } = await import("../src/lib/db");
  const { eq, like, inArray } = await import("drizzle-orm");
  const { fileDocumentOfPage, pruneEmptyFolders } = await import("../src/lib/filing");
  const { storage } = await import("../src/lib/storage");

  const demoPages = await db.select().from(schema.documents).where(like(schema.documents.filename, "demo-%"));
  if (process.argv.includes("--clean")) {
    const groupIds = [...new Set(demoPages.map((p) => p.groupId).filter((g): g is string => !!g))];
    const folderIds = [...new Set(demoPages.map((p) => p.folderId).filter((f): f is string => !!f))];
    if (demoPages.length) await db.delete(schema.documents).where(inArray(schema.documents.id, demoPages.map((p) => p.id)));
    if (groupIds.length) await db.delete(schema.documentGroups).where(inArray(schema.documentGroups.id, groupIds));
    for (const f of folderIds) await pruneEmptyFolders(f);
    await db.delete(schema.documentTypes).where(eq(schema.documentTypes.name, "utility_bill"));
    console.log(`Removed ${demoPages.length} demo pages and ${groupIds.length} documents.`);
    return;
  }
  if (demoPages.length) return console.log("Demo documents already present; run with --clean first.");

  // A type the agent would create on its own, with its own filing rule.
  await db
    .insert(schema.documentTypes)
    .values({
      id: newId(),
      name: "utility_bill",
      description: "Monthly bill from a utility company",
      fieldSchema: { type: "object", properties: { provider: { type: "string" }, billing_period: { type: "string" }, amount_due: { type: "number" }, due_date: { type: "string" } } },
      filingRule: { section: "Home", collection: "Utility bills", entityField: "provider", dateField: "due_date", nameTemplate: "Bill for {billing_period}" },
      createdBy: "agent",
    })
    .onConflictDoNothing();
  const types = new Map((await db.select().from(schema.documentTypes)).map((t) => [t.name, t.id]));

  let n = 0;
  for (const doc of DOCS) {
    const groupId = newId();
    await db.insert(schema.documentGroups).values({ id: groupId, title: `demo ${doc.type}`, documentTypeId: types.get(doc.type), receivedCount: doc.pages.length });
    for (const [i, page] of doc.pages.entries()) {
      const id = newId();
      const svg = Buffer.from(pageSvg(page.text, i + 1, doc.pages.length));
      const storagePath = await storage.put(`demo/${id}.svg`, svg, "image/svg+xml");
      await db.insert(schema.documents).values({
        id,
        filename: `demo-${++n}.svg`,
        mimeType: "image/svg+xml",
        sizeBytes: svg.length,
        storagePath,
        status: "done",
        title: page.title ?? null,
        ocrText: page.text,
        documentTypeId: types.get(doc.type),
        groupId,
        pageNumber: i + 1,
        extractedFields: page.fields,
      });
      const filed = await fileDocumentOfPage(id);
      console.log(`${filed.moved ? "filed " : "kept  "} ${filed.displayName.padEnd(34)} ${filed.path}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
