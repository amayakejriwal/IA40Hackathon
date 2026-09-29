import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { customAlphabet } from "nanoid";
import { dataDir } from "@/lib/config";
import * as schema from "./schema";

function createDb() {
  mkdirSync(dataDir, { recursive: true });
  const client = createClient({ url: `file:${dataDir}/app.db` });
  return drizzle(client, { schema });
}

// Reuse one client across hot reloads in dev.
const globalForDb = globalThis as unknown as { __db?: ReturnType<typeof createDb> };
export const db = globalForDb.__db ?? (globalForDb.__db = createDb());

export const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);

export { schema };
