import Image from "next/image";

export default function ComingSoonPage() {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-[#f5f5f0] px-4 py-6 sm:px-6 sm:py-8">
      <div className="relative mx-auto w-full max-w-6xl">
        <div className="relative aspect-[2/1] w-full min-h-[200px] sm:min-h-[280px]">
          <Image
            src="/coming_soon_banner.png"
            alt="Something Delicious — Coming Soon"
            fill
            priority
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 90vw, 1152px"
            className="object-contain object-center"
          />
        </div>
      </div>
    </main>
  );
}
