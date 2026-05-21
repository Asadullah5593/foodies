import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COMING_SOON_PATH = "/coming-soon";
const PREVIEW_COOKIE = "foodies_site_preview";
const PREVIEW_QUERY = "preview";
const PREVIEW_LOGOUT = "logout";
const PREVIEW_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** Dynamic access so Next.js does not bake env values in at build time. */
function readEnv(name: string): string | undefined {
  return process.env[name]?.trim();
}

function isComingSoonEnabled(): boolean {
  const value = readEnv("COMING_SOON_ENABLED")?.toLowerCase();
  return value === "true" || value === "1";
}

function getBypassSecret(): string | undefined {
  return readEnv("COMING_SOON_BYPASS_SECRET") || undefined;
}

function isPreviewLogout(request: NextRequest): boolean {
  const token = request.nextUrl.searchParams.get(PREVIEW_QUERY)?.trim().toLowerCase();
  return token === PREVIEW_LOGOUT;
}

function clearPreviewCookie(response: NextResponse): void {
  response.cookies.set(PREVIEW_COOKIE, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
}

function hasPreviewCookie(request: NextRequest): boolean {
  return request.cookies.get(PREVIEW_COOKIE)?.value === "1";
}

function getPreviewTokenFromRequest(
  request: NextRequest,
  secret: string,
): string | null {
  const queryToken = request.nextUrl.searchParams.get(PREVIEW_QUERY);
  if (queryToken) {
    return queryToken;
  }

  const { pathname } = request.nextUrl;
  const previewPathPrefix = "/preview/";
  if (pathname.startsWith(previewPathPrefix)) {
    const segment = pathname.slice(previewPathPrefix.length).split("/")[0];
    return segment || null;
  }

  // Allow /{secret} when it matches exactly (e.g. /fockme)
  const pathSecret = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  if (pathSecret && !pathSecret.includes("/") && pathSecret === secret) {
    return pathSecret;
  }

  return null;
}

function isValidPreviewToken(request: NextRequest, secret: string): boolean {
  const token = getPreviewTokenFromRequest(request, secret);
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
  if (isPreviewLogout(request)) {
    const destination = new URL(COMING_SOON_PATH, request.url);
    const response = NextResponse.redirect(destination, 307);
    clearPreviewCookie(response);
    return response;
  }

  if (!isComingSoonEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const bypassSecret = getBypassSecret();

  if (bypassSecret && isValidPreviewToken(request, bypassSecret)) {
    const destination = request.nextUrl.searchParams.has(PREVIEW_QUERY)
      ? stripPreviewParam(request.nextUrl)
      : new URL("/", request.url);
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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|html|mp4|webm|mov)$).*)",
  ],
};
