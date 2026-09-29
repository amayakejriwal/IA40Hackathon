import { getBoard } from "@/lib/board";

/** Operator board data. `?scope=all|web|<batch id>`; defaults to the latest capture session. */
export async function GET(request: Request) {
  const scope = new URL(request.url).searchParams.get("scope");
  return Response.json(await getBoard(scope));
}
