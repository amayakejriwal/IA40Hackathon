import mammoth from "mammoth";
import PDFDocument from "pdfkit";

/**
 * Normalizes uploads so everything downstream (OCR, preview, filing) only ever
 * sees images and PDFs. Word documents are rendered to a text PDF; the original
 * file is kept alongside it.
 */

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type NormalizedUpload = {
  data: Buffer;
  mimeType: string;
  /** Set when the upload was converted: the file as received. */
  original?: { data: Buffer; mimeType: string };
};

export const isDocx = (filename: string, mimeType: string) => mimeType === DOCX_MIME || /\.docx$/i.test(filename);

export async function normalizeUpload(filename: string, mimeType: string, data: Buffer): Promise<NormalizedUpload> {
  if (!isDocx(filename, mimeType)) return { data, mimeType };
  const { value: text } = await mammoth.extractRawText({ buffer: data });
  return { data: await textToPdf(text), mimeType: "application/pdf", original: { data, mimeType: DOCX_MIME } };
}

/** Characters per line: Letter width less margins, in 9.5pt Courier (0.6em per character). */
const WIDTH = 86;
const FIRST_COLUMN = 26;

/**
 * Letter-size pages in a monospaced font. Word lays out tables of names, roles
 * and amounts with runs of tabs against tab stops; plain text loses the stops,
 * so tab-separated cells are laid out as columns: the first cell at a fixed
 * width, the rest after it, and a short trailing cell (an amount, a resolution
 * number) right-aligned.
 */
function textToPdf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 60, font: "Courier" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(9.5).text(layout(text), { lineGap: 2 });
    doc.end();
  });
}

/** mammoth ends each paragraph with a blank line; keep one line per paragraph, and one blank line per empty one. */
export function layout(text: string) {
  const paragraphs = text.replace(/\r\n?/g, "\n").split("\n\n");
  const lines = paragraphs.map((p) => p.split("\n").map(layoutLine).join("\n"));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function layoutLine(line: string) {
  if (!line.includes("\t")) return line.trim();
  const indented = /^\s*\t/.test(line);
  // Cells between tab runs; a lone "$" belongs to the amount after it.
  const cells: string[] = [];
  for (const cell of line.split(/\t+/).map((c) => c.trim()).filter(Boolean)) {
    if (cells.at(-1) === "$") cells[cells.length - 1] = `$${cell.replace(/^\s+/, "")}`;
    else cells.push(cell);
  }
  if (cells.length === 0) return "";
  const last = cells.at(-1)!;
  const trailing = cells.length > 1 && last.length <= 20 && /\d/.test(last) ? cells.pop()! : null;
  let left = indented
    ? " ".repeat(FIRST_COLUMN) + cells.join("  ")
    : cells.length > 1
      ? cells[0].padEnd(FIRST_COLUMN - 1) + " " + cells.slice(1).join("  ")
      : cells[0];
  if (!trailing) return left;
  if (left.length + 2 + trailing.length > WIDTH) left += "\n";
  const lastLine = left.split("\n").at(-1)!;
  return left + " ".repeat(Math.max(2, WIDTH - lastLine.length - trailing.length)) + trailing;
}
