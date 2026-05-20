const FEATURES = [
  {
    icon: "tag",
    title: "Exclusive Offers",
    body: "Enjoy app-only deals and discounts.",
  },
  {
    icon: "bolt",
    title: "Faster Ordering",
    body: "Quick and easy ordering in just a few taps.",
  },
  {
    icon: "map",
    title: "Real-time Tracking",
    body: "Track your order in real time from kitchen to door.",
  },
  {
    icon: "star",
    title: "Loyalty Rewards",
    body: "Earn points on every order and redeem exciting rewards.",
  },
] as const;

function FeatureIcon({ type }: { type: (typeof FEATURES)[number]["icon"] }) {
  const stroke = "currentColor";
  const common = { fill: "none", stroke, strokeWidth: 2, strokeLinecap: "round" as const };
  if (type === "tag") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
        <path {...common} d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
        <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (type === "bolt") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
        <path {...common} d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    );
  }
  if (type === "map") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
        <path {...common} d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
        <circle cx="12" cy="9" r="2.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
      <path {...common} d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01z" />
    </svg>
  );
}

export function OrderInfoFeatures() {
  return (
    <section className="mb-6 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] py-10 shadow-sm sm:py-12">
      <div className="grid gap-8 px-6 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <article key={f.title} className="flex flex-col items-center text-center">
            <div className="grid h-20 w-20 place-items-center rounded-full bg-rose-50 text-red-600">
              <FeatureIcon type={f.icon} />
            </div>
            <h3 className="mt-4 text-base font-bold text-zinc-900">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">{f.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
