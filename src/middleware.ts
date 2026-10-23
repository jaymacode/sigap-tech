import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'sigap_session';
const PUBLIC_PATHS = ['/login', '/api/health'];

/**
 * Middleware: halaman non-publik wajib punya cookie sesi. Validasi role dilakukan di layout
 * server (`requireUser`) karena middleware edge tidak mengakses store.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!isPublic && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search =
      pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|svg|jpg|webp|woff2)$).*)',
  ],
};
