"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useSessionStore } from "@/lib/store/session-store";

export function TopNav({ cartCount = 0 }: { cartCount?: number }) {
  const pathname = usePathname();
  const customer = useSessionStore((s) => s.customer);
  const clearSession = useSessionStore((s) => s.clearSession);
  const userAddress = useSessionStore((s) => s.userAddress);
  const theme = useSessionStore((s) => s.theme);
  const setTheme = useSessionStore((s) => s.setTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const navItemClass =
    "relative px-3 py-2 text-sm font-medium text-[var(--foreground)]/80 transition hover:text-[var(--foreground)]";
  const activeNavItemClass =
    "relative px-3 py-2 text-sm font-semibold text-[var(--foreground)]";

  return (
    <header className="sticky top-0 z-40 mb-6 border-b border-[var(--border-soft)]/50 bg-[var(--surface)]/75 backdrop-blur">
      {/* Break out of AppShell container to full-width */}
      <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
        <div className="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center justify-between gap-4 px-3 py-3 sm:px-4 md:px-6">
        <div className="min-w-[260px]">
          <Link href="/" className="inline-flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/foodies-logo.png"
              alt="Foodies"
              className="h-14 w-14 rounded-full object-cover ring-1 ring-[var(--border-soft)]"
            />
            <span className="text-xl font-black tracking-wide text-red-500">FOODIES</span>
          </Link>
          <p className="mt-0.5 max-w-[540px] truncate text-xs text-[var(--muted)]">
            {userAddress || "Location not set yet"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <nav className="flex items-center gap-3">
            <Link
              href="/"
              className={
                pathname === "/" || pathname?.startsWith("/home")
                  ? activeNavItemClass
                  : navItemClass
              }
            >
              Home
              {pathname === "/" || pathname?.startsWith("/home") ? (
                <span className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-red-600" />
              ) : null}
            </Link>
            <Link
              href="/menu"
              className={pathname === "/menu" ? activeNavItemClass : navItemClass}
            >
              Menu
              {pathname === "/menu" ? (
                <span className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-red-600" />
              ) : null}
            </Link>
            {customer ? (
              <Link
                href="/orders"
                className={pathname?.startsWith("/orders") ? activeNavItemClass : navItemClass}
              >
                Orders
                {pathname?.startsWith("/orders") ? (
                  <span className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-red-600" />
                ) : null}
              </Link>
            ) : null}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/cart"
              className="relative rounded-full p-2 text-[var(--foreground)]/80 transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              aria-label="Open cart"
              title="Cart"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M6 6h15l-1.5 9h-12L6 6Zm0 0-1-2H2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {cartCount > 0 ? (
                <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">
                  {cartCount}
                </span>
              ) : null}
            </Link>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="rounded-full p-2 text-[var(--foreground)]/80 transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 4V2M12 22v-2M4 12H2m20 0h-2M5.64 5.64 4.22 4.22m15.56 15.56-1.42-1.42M18.36 5.64l1.42-1.42M5.64 18.36l-1.42 1.42M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 1 0 9.8 9.8Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>

          {customer ? (
            <button
              onClick={() => clearSession()}
              className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-semibold text-[var(--foreground)]/90 transition hover:brightness-110"
            >
              Logout
            </button>
          ) : (
            <Link
              href="/login"
              className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-semibold text-[var(--foreground)]/90 transition hover:brightness-110"
            >
              Login
            </Link>
          )}
          </div>
        </div>
        </div>
      </div>
    </header>
  );
}
