import type { NextConfig } from 'next';

// MediaMTX internal URLs — only used server-side (Next.js proxy), never sent to browser.
// In Docker Compose: mediamtx:8888 (HLS), mediamtx:8889 (WebRTC/WHIP), mediamtx:9997 (API).
// In local dev without Docker: localhost:8888 / localhost:8889 / localhost:9997.
const MEDIAMTX_HLS_URL = process.env.MEDIAMTX_HLS_URL || process.env.NEXT_PUBLIC_MEDIAMTX_URL || 'http://localhost:8888';
const MEDIAMTX_WHIP_URL = process.env.MEDIAMTX_WHIP_URL || 'http://localhost:8889';
const MEDIAMTX_API_URL = process.env.MEDIAMTX_API_URL || 'http://localhost:9997';

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

      // LL-HLS playback: browser -> Next.js (/live/*) -> MediaMTX HLS port (same-origin, no CORS).
      {
        source: '/live/:path*',
        destination: `${MEDIAMTX_HLS_URL}/:path*`,
      },

      // WHIP ingest: browser -> Next.js (/whip/*) -> MediaMTX WebRTC port.
      // Routing through the proxy avoids the browser needing to reach MediaMTX
      // port 8889 directly, which can be blocked in Docker or behind NAT.
      {
        source: '/whip/:path*',
        destination: `${MEDIAMTX_WHIP_URL}/:path*`,
      },

      // WHEP playback (WebRTC): browser -> Next.js (/whep/*) -> MediaMTX WebRTC port.
      {
        source: '/whep/:path*',
        destination: `${MEDIAMTX_WHIP_URL}/:path*`,
      },

      // Stream thumbnail snapshots: browser -> Next.js (/thumbnail/:streamKey) ->
      // MediaMTX API port 9997. Returns a JPEG frame of the live stream.
      // Example: GET /thumbnail/abc123 -> http://mediamtx:9997/v3/paths/abc123/thumbnail
      {
        source: '/thumbnail/:streamKey',
        destination: `${MEDIAMTX_API_URL}/v3/paths/:streamKey/thumbnail`,
      },
    ];
  },
};

export default nextConfig;
