import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/:path*`,
      },
      // NOTE: WebSocket connections go directly from browser to backend.
      // Next.js rewrites do NOT support ws:// destinations, and cannot
      // proxy WebSocket upgrade requests. The frontend WS client connects
      // directly to the backend using NEXT_PUBLIC_WS_URL.
      {
        source: '/live/:path*',
        destination: `${process.env.NEXT_PUBLIC_MEDIAMTX_URL || 'http://localhost:8888'}/:path*`,
      },
    ];
  },
};

export default nextConfig;
