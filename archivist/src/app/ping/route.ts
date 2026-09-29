import os from "node:os";

/** Liveness check, matching the field-capture receiver's /ping. */
export async function GET() {
  return Response.json({ ok: true, host: os.hostname(), service: "archivist" });
}
