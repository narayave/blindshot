import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // self-contained server bundle for Azure Static Web Apps (250 MB limit)
  serverExternalPackages: ["exifr"], // its optional fs/zlib imports break when bundled
};

export default nextConfig;
