import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/config";

/**
 * Where raw uploaded files live. Local disk for now; swap for a Vercel Blob
 * implementation when deploying (same interface).
 */
export interface FileStorage {
  put(key: string, data: Buffer, contentType: string): Promise<string>;
  get(storagePath: string): Promise<Buffer>;
}

class LocalFileStorage implements FileStorage {
  constructor(private root: string) {}

  async put(key: string, data: Buffer): Promise<string> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
    return key;
  }

  async get(storagePath: string): Promise<Buffer> {
    return readFile(this.resolve(storagePath));
  }

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return full;
  }
}

export const storage: FileStorage = new LocalFileStorage(path.join(dataDir, "uploads"));

export function sanitizeFilename(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 200) || "file";
}
