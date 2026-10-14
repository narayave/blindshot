import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["exifr"], // its optional fs/zlib imports break when bundled
};

export default nextConfig;
