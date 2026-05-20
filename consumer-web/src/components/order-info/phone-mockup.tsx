import clsx from "clsx";

type PhoneMockupProps = {
  variant?: "home" | "menu" | "offers" | "track";
  className?: string;
  label?: string;
};

export function PhoneMockup({ variant = "home", className, label }: PhoneMockupProps) {
  return (
    <div className={clsx("flex flex-col items-center", className)}>
      <div className="relative w-[140px] overflow-hidden rounded-[1.75rem] border-[6px] border-zinc-900 bg-white shadow-xl sm:w-[160px]">
        <div className="bg-red-600 px-3 py-2 text-center text-[10px] font-bold text-white">FOODIES</div>
        <div className="min-h-[220px] bg-zinc-50 p-2 sm:min-h-[250px]">
          {variant === "home" && <HomeScreen />}
          {variant === "menu" && <MenuScreen />}
          {variant === "offers" && <OffersScreen />}
          {variant === "track" && <TrackScreen />}
        </div>
      </div>
      {label ? (
        <p className="mt-3 text-center text-xs font-bold uppercase tracking-wide text-red-600">{label}</p>
      ) : null}
    </div>
  );
}

function HomeScreen() {
  return (
    <>
      <div className="mb-2 h-6 rounded-md bg-zinc-200" />
      <p className="mb-2 text-[9px] font-bold text-zinc-800">Exclusive App Offers</p>
      <div className="mb-2 h-14 rounded-lg bg-red-100" />
      <p className="mb-1 text-[8px] font-semibold text-zinc-600">Popular Brands</p>
      <div className="grid grid-cols-3 gap-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className="aspect-square rounded-md bg-zinc-200" />
        ))}
      </div>
    </>
  );
}

function MenuScreen() {
  return (
    <>
      <div className="mb-2 aspect-[4/3] rounded-lg bg-amber-100" />
      <div className="mb-1 h-3 w-3/4 rounded bg-zinc-300" />
      <div className="mb-2 flex gap-1">
        {[1, 2, 3].map((i) => (
          <span key={i} className="h-4 flex-1 rounded bg-red-100" />
        ))}
      </div>
      <div className="h-8 rounded-lg bg-red-600" />
    </>
  );
}

function OffersScreen() {
  return (
    <>
      <p className="mb-2 text-[9px] font-bold text-zinc-800">Offers</p>
      <div className="mb-2 h-16 rounded-lg bg-red-600" />
      <div className="mb-2 h-10 rounded-lg bg-amber-200" />
      <div className="h-10 rounded-lg bg-zinc-200" />
    </>
  );
}

function TrackScreen() {
  return (
    <>
      <div className="mb-2 h-20 rounded-lg bg-emerald-100" />
      <div className="mb-1 flex items-center gap-1">
        <span className="h-6 w-6 rounded-full bg-zinc-300" />
        <div className="flex-1">
          <div className="h-2 w-full rounded bg-zinc-200" />
          <div className="mt-1 h-2 w-2/3 rounded bg-zinc-200" />
        </div>
      </div>
      <div className="mt-2 h-6 rounded-full bg-red-600" />
    </>
  );
}
