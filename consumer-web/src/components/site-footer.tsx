"use client";

import clsx from "clsx";

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer
      className={clsx("mt-10 overflow-hidden rounded-2xl bg-zinc-900 text-white", className)}
    >
      <div className="grid gap-6 px-6 py-8 md:grid-cols-3 md:px-10">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-white/70">Visit us</p>
          <p className="mt-2 text-sm font-bold">Foodies Food Court</p>
          <p className="mt-1 text-sm text-white/70">City Center Mall</p>
        </div>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-white/70">Opening hours</p>
          <p className="mt-2 text-sm font-bold">10:00 AM - 10:00 PM</p>
          <p className="mt-1 text-sm text-white/70">Everyday</p>
        </div>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-white/70">Follow us</p>
          <div className="mt-3 flex gap-3">
            {["Facebook", "Instagram", "Twitter"].map((s) => (
              <span key={s} className="grid h-10 w-10 place-items-center rounded-full bg-white/10">
                <span className="text-xs font-black">{s.slice(0, 1)}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
