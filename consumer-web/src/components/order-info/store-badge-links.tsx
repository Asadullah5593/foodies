import Link from "next/link";
import clsx from "clsx";

type StoreBadgeLinksProps = {
  appStoreUrl: string;
  playStoreUrl: string;
  className?: string;
};

/** Preserve official badge aspect ratio — never set both width and height. */
const badgeClass = "block h-11 w-auto";

export function StoreBadgeLinks({ appStoreUrl, playStoreUrl, className }: StoreBadgeLinksProps) {
  return (
    <div className={clsx("flex flex-wrap items-center gap-3", className)}>
      <Link
        href={appStoreUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded-md ring-offset-2 transition hover:opacity-90 focus-visible:outline focus-visible:ring-2 focus-visible:ring-red-600"
        aria-label="Download on the App Store"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/order-info/app-store-badge.svg"
          alt=""
          width={180}
          height={54}
          className={badgeClass}
        />
      </Link>
      <Link
        href={playStoreUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded-md ring-offset-2 transition hover:opacity-90 focus-visible:outline focus-visible:ring-2 focus-visible:ring-red-600"
        aria-label="Get it on Google Play"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/order-info/google-play-badge.svg"
          alt=""
          width={180}
          height={53}
          className={badgeClass}
        />
      </Link>
    </div>
  );
}
