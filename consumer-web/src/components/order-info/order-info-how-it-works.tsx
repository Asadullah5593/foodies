const STEPS = [
  {
    n: 1,
    title: "Download the App",
    body: "Download the Foodies app from Play Store or App Store.",
    icon: "download",
  },
  {
    n: 2,
    title: "Choose Your Favorite",
    body: "Browse brands, customize your order and checkout.",
    icon: "store",
  },
  {
    n: 3,
    title: "Track & Enjoy",
    body: "We prepare your food and deliver it hot to your door.",
    icon: "scooter",
  },
] as const;

function StepIcon({ type }: { type: (typeof STEPS)[number]["icon"] }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (type === "download") {
    return (
      <svg viewBox="0 0 24 24" className="h-11 w-11 text-zinc-900" aria-hidden>
        <rect x="7" y="2" width="10" height="16" rx="2" {...common} />
        <path {...common} d="M12 6v8M9 11l3 3 3-3" />
      </svg>
    );
  }
  if (type === "store") {
    return (
      <svg viewBox="0 0 24 24" className="h-11 w-11 text-zinc-900" aria-hidden>
        <path {...common} d="M3 10l9-6 9 6" />
        <path {...common} d="M4 10v10h16V10" />
        <path {...common} d="M9 20v-6h6v6" />
        <path {...common} d="M7 10h2M11 10h2M15 10h2" strokeWidth={1.25} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-11 w-11 text-zinc-900" aria-hidden>
      <circle cx="6" cy="17" r="2" {...common} />
      <circle cx="18" cy="17" r="2" {...common} />
      <path {...common} d="M4 17h2l2-8h8l2 8h2M8 9l1-4h6l1 4" />
    </svg>
  );
}

function StepIconCircle({ type }: { type: (typeof STEPS)[number]["icon"] }) {
  return (
    <div className="relative z-10 grid h-20 w-20 place-items-center rounded-full bg-rose-50 sm:h-[5.25rem] sm:w-[5.25rem]">
      <StepIcon type={type} />
    </div>
  );
}

function StepCopy({ step }: { step: (typeof STEPS)[number] }) {
  return (
    <>
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-red-600 text-sm font-bold text-white">
          {step.n}
        </span>
        <h3 className="text-base font-bold leading-snug text-zinc-900 sm:text-lg">{step.title}</h3>
      </div>
      <p className="mt-2 pl-[2.375rem] text-sm leading-relaxed text-zinc-600">{step.body}</p>
    </>
  );
}

export function OrderInfoHowItWorks() {
  return (
    <section className="mb-6 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] py-10 shadow-sm sm:py-14">
      <div className="px-6 sm:px-8">
        <p className="text-center text-xs font-bold uppercase tracking-[0.25em] text-red-600">
          How it works
        </p>
        <h2 className="mt-3 text-center text-3xl font-black text-zinc-900 sm:text-4xl">
          Ordering Made Simple
        </h2>

        <div className="mx-auto mt-12 max-w-5xl sm:mt-14">
          <div className="grid gap-12 sm:grid-cols-3 sm:gap-6 lg:gap-10">
            {STEPS.map((step, index) => (
              <article key={step.n} className="relative">
                {index < STEPS.length - 1 ? (
                  <div
                    className="pointer-events-none absolute top-10 z-0 hidden h-0 border-t border-dashed border-zinc-300 sm:top-[2.625rem] sm:block"
                    style={{
                      left: "calc(50% + 2.625rem)",
                      right: "calc(-50% - 0.75rem)",
                    }}
                    aria-hidden
                  />
                ) : null}

                <div className="flex justify-center sm:justify-center">
                  <StepIconCircle type={step.icon} />
                </div>

                <div className="mt-6 sm:mt-8">
                  <StepCopy step={step} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
