"use client";

import { useEffect } from "react";

export function TopNav() {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
  }, []);

  return (
    <header className="sticky top-0 z-40 mb-6 border-b border-[var(--border-soft)] bg-[var(--surface)]/90 backdrop-blur">
      <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
        <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-center gap-3 px-3 py-3 sm:px-4 md:px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/foodies-logo.png"
            alt="Foodies"
            className="h-12 w-12 rounded-full object-cover ring-1 ring-[var(--border-soft)]"
          />
          <span className="text-xl font-black tracking-wide text-red-600">FOODIES</span>
        </div>
      </div>
    </header>
  );
}
