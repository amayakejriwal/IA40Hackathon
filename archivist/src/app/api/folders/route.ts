import { getFolderTree } from "@/lib/folders";

export async function GET() {
  return Response.json({ tree: await getFolderTree() });
}
