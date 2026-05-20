import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COMING_SOON_PATH = "/coming-soon";
const PREVIEW_COOKIE = "foodies_site_preview";
const PREVIEW_QUERY = "preview";
const PREVIEW_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function isComingSoonEnabled(): boolean {
  return process.env.COMING_SOON_ENABLED === "true";
}

function getBypassSecret(): string | undefined {
  const secret = process.env.COMING_SOON_BYPASS_SECRET?.trim();
  return secret || undefined;
}

function hasPreviewCookie(request: NextRequest): boolean {
  return request.cookies.get(PREVIEW_COOKIE)?.value === "1";
}

function isValidPreviewToken(request: NextRequest, secret: string): boolean {
  const token = request.nextUrl.searchParams.get(PREVIEW_QUERY);
  return token !== null && token.length > 0 && token === secret;
}

function stripPreviewParam(url: URL): URL {
  const next = new URL(url);
  next.searchParams.delete(PREVIEW_QUERY);
  return next;
}

function setPreviewCookie(response: NextResponse, request: NextRequest): void {
  const secure =
    request.nextUrl.protocol === "https:" ||
    process.env.NODE_ENV === "production";

  response.cookies.set(PREVIEW_COOKIE, "1", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: PREVIEW_MAX_AGE,
  });
}

export function proxy(request: NextRequest) {
  if (!isComingSoonEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const bypassSecret = getBypassSecret();

  if (bypassSecret && isValidPreviewToken(request, bypassSecret)) {
    const destination = stripPreviewParam(request.nextUrl);
    const response = NextResponse.redirect(destination, 307);
    setPreviewCookie(response, request);
    return response;
  }

  if (hasPreviewCookie(request)) {
    return NextResponse.next();
  }

  if (pathname === COMING_SOON_PATH || pathname.startsWith(`${COMING_SOON_PATH}/`)) {
    return NextResponse.next();
  }

  const comingSoonUrl = new URL(COMING_SOON_PATH, request.url);
  return NextResponse.redirect(comingSoonUrl, 307);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|html)$).*)",
  ],
};
