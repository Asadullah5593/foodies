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

type StepIconType = (typeof STEPS)[number]["icon"];

function StepIcon({ type, size }: { type: StepIconType; size: "mobile" | "desktop" }) {
  const iconClass = size === "mobile" ? "h-8 w-8 text-zinc-900" : "h-11 w-11 text-zinc-900";
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (type === "download") {
    return (
      <svg viewBox="0 0 24 24" className={iconClass} aria-hidden>
        <rect x="7" y="2" width="10" height="16" rx="2" {...common} />
        <path {...common} d="M12 6v8M9 11l3 3 3-3" />
      </svg>
    );
  }
  if (type === "store") {
    return (
      <svg viewBox="0 0 24 24" className={iconClass} aria-hidden>
        <path {...common} d="M3 10l9-6 9 6" />
        <path {...common} d="M4 10v10h16V10" />
        <path {...common} d="M9 20v-6h6v6" />
        <path {...common} d="M7 10h2M11 10h2M15 10h2" strokeWidth={1.25} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={iconClass} aria-hidden>
      <circle cx="6" cy="17" r="2" {...common} />
      <circle cx="18" cy="17" r="2" {...common} />
      <path {...common} d="M4 17h2l2-8h8l2 8h2M8 9l1-4h6l1 4" />
    </svg>
  );
}

function MobileStepRow({ step }: { step: (typeof STEPS)[number] }) {
  return (
    <article className="flex items-start gap-3.5">
      <div className="relative z-10 grid h-14 w-14 shrink-0 place-items-center rounded-full bg-rose-50">
        <StepIcon type={step.icon} size="mobile" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-red-600 text-xs font-bold text-white">
            {step.n}
          </span>
          <h3 className="text-sm font-bold leading-snug text-zinc-900">{step.title}</h3>
        </div>
        <p className="mt-1.5 text-xs leading-snug text-zinc-600">{step.body}</p>
      </div>
    </article>
  );
}

function DesktopStepColumn({ step, index }: { step: (typeof STEPS)[number]; index: number }) {
  return (
    <article className="relative min-w-0">
      {index < STEPS.length - 1 ? (
        <div
          className="pointer-events-none absolute top-[2.625rem] z-0 h-0 border-t border-dashed border-zinc-300"
          style={{
            left: "calc(50% + 2.625rem)",
            right: "calc(-50% - 0.75rem)",
          }}
          aria-hidden
        />
      ) : null}

      <div className="flex justify-center">
        <div className="relative z-10 grid h-[5.25rem] w-[5.25rem] shrink-0 place-items-center rounded-full bg-rose-50">
          <StepIcon type={step.icon} size="desktop" />
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center text-center">
        <div className="flex items-center justify-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-red-600 text-sm font-bold text-white">
            {step.n}
          </span>
          <h3 className="text-base font-bold leading-snug text-zinc-900">{step.title}</h3>
        </div>
        <p className="mt-2 max-w-[16rem] text-sm leading-relaxed text-zinc-600">{step.body}</p>
      </div>
    </article>
  );
}

export function OrderInfoHowItWorks() {
  return (
    <section className="mb-6 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] py-8 shadow-sm md:py-14">
      <div className="px-4 md:px-8">
        <p className="text-center text-[10px] font-bold uppercase tracking-[0.22em] text-red-600 md:text-xs md:tracking-[0.25em]">
          How it works
        </p>
        <h2 className="mt-2 text-center text-2xl font-black text-zinc-900 md:mt-3 md:text-4xl">
          Ordering Made Simple
        </h2>

        <div className="mx-auto mt-8 max-w-5xl md:mt-14">
          <div className="flex flex-col gap-6 md:hidden">
            {STEPS.map((step) => (
              <MobileStepRow key={step.n} step={step} />
            ))}
          </div>

          <div className="hidden md:grid md:grid-cols-3 md:gap-x-8 lg:gap-x-12">
            {STEPS.map((step, index) => (
              <DesktopStepColumn key={step.n} step={step} index={index} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
