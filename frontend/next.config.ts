import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/:path*`,
      },
      {
        source: '/ws/:path*',
        destination: `${process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'}/ws/:path*`,
      },
      {
        source: '/live/:path*',
        destination: `${process.env.NEXT_PUBLIC_MEDIAMTX_URL || 'http://localhost:8888'}/:path*`,
      },
    ];
  },
};

export default nextConfig;
