import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/server-only deps must not be bundled.
  serverExternalPackages: ["@libsql/client", "libsql", "pdfkit"],
};

export default nextConfig;
