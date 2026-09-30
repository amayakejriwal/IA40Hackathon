import { searchLibrary } from "@/lib/search";

/** Library search: `?q=acme invoice`. Every word must match. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json({ query: q, results: await searchLibrary(q) });
}
