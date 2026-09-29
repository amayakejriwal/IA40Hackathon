import { after } from "next/server";
import { kickWorker } from "@/lib/jobs/queue";
import { PHONE_KINDS, SAFE_ID, receivePhoneItem, type PhoneKind } from "@/lib/ingest/phone";

const MAX_BYTES = 40 * 1024 * 1024;

/**
 * Field-capture iPhone app upload endpoint (same contract as
 * field-capture/receiver/receiver.py). Raw body; the phone only treats a 200
 * as delivered and retries anything else.
 */
export async function POST(request: Request, ctx: RouteContext<"/upload/[batch]/[item]/[kind]">) {
  const { batch, item, kind } = await ctx.params;
  if (!PHONE_KINDS.includes(kind as PhoneKind)) return Response.json({ error: "bad path" }, { status: 404 });
  if (!SAFE_ID.test(batch) || !SAFE_ID.test(item)) return Response.json({ error: "bad id" }, { status: 400 });

  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > MAX_BYTES) return Response.json({ error: "too large" }, { status: 413 });

  const { status, sha256 } = await receivePhoneItem(batch, item, kind as PhoneKind, body);
  if (status === 409) return Response.json({ error: "conflicting upload" }, { status: 409 });

  after(kickWorker);
  return Response.json({ ok: true, sha256 });
}
