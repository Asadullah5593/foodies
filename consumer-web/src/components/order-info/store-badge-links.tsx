import Link from "next/link";
import clsx from "clsx";

type StoreBadgeLinksProps = {
  appStoreUrl: string;
  playStoreUrl: string;
  className?: string;
  /** On mobile: stack Play Store under App Store with smaller badges. */
  mobileStack?: boolean;
};

const badgeClass = "block h-11 w-auto";

export function StoreBadgeLinks({
  appStoreUrl,
  playStoreUrl,
  className,
  mobileStack = false,
}: StoreBadgeLinksProps) {
  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-3",
        mobileStack && "max-md:flex-col max-md:items-start max-md:gap-2",
        className,
      )}
    >
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
          className={clsx(badgeClass, mobileStack && "max-md:h-9 max-md:max-w-[132px]")}
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
          className={clsx(badgeClass, mobileStack && "max-md:h-9 max-md:max-w-[132px]")}
        />
      </Link>
    </div>
  );
}
