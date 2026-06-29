import { NextRequest, NextResponse } from 'next/server';

// Stream keys are UUIDs: 8-4-4-4-12 hex chars
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const firstSegment = pathname.split('/')[1] ?? '';

  if (UUID_RE.test(firstSegment)) {
    const url = req.nextUrl.clone();
    url.pathname = `/live${pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything EXCEPT Next.js internals, API proxy, known media
  // prefixes, thumbnail proxy (handled by next.config.ts rewrite), and
  // static assets.
  matcher: ['/((?!_next|api|live|whip|whep|thumbnail|favicon\\.ico|robots\\.txt).*)'],
};
