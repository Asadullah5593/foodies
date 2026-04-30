import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "unsplash.com" },
      // S3 virtual-hosted–style URLs: {bucket}.s3.{region}.amazonaws.com
      { protocol: "https", hostname: "*.s3.*.amazonaws.com", pathname: "/**" },
      { protocol: "https", hostname: "*.s3.amazonaws.com", pathname: "/**" },
      { protocol: "https", hostname: "s3.*.amazonaws.com", pathname: "/**" },
    ],
  },
};

export default nextConfig;
