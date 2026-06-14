import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'crests.football-data.org',
        port: '',
        pathname: '/**',  // Allows all paths from this domain
      },
      {
        protocol: 'https',
        hostname: 'example.com',
        port: '',
        pathname: '/**',  // Allows all paths from this domain
      },
    ],
  }
};

export default nextConfig;
