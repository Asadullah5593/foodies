/**
 * Browse-only flow: CTAs send users to /order-info (app stores / deep link).
 * Override via NEXT_PUBLIC_* in .env.local — see consumer-web/.env.example
 */

const env = (key: string, fallback: string) =>
  (typeof process !== "undefined" && process.env[key]) || fallback;

const defaultHeroLine1 = "Better Food.";
const defaultHeroLine2 = "Better Experience.";
const defaultHeroHighlight = "Only on Foodies App.";

/** Split legacy single-line hero env into line1 + line2 so SSR and client match. */
function resolveHeroLines(): { heroLine1: string; heroLine2: string } {
  const raw1 = env("NEXT_PUBLIC_ORDER_HERO_LINE1", defaultHeroLine1).trim();
  const raw2 = env("NEXT_PUBLIC_ORDER_HERO_LINE2", "").trim();
  if (raw2) return { heroLine1: raw1, heroLine2: raw2 };

  const needle = defaultHeroLine2.trim();
  const idx = raw1.indexOf(needle);
  if (idx > 0) {
    const before = raw1.slice(0, idx).trim();
    const after = raw1.slice(idx).trim();
    if (before && after) {
      return { heroLine1: before, heroLine2: after };
    }
  }

  return { heroLine1: raw1, heroLine2: defaultHeroLine2 };
}

const heroLines = resolveHeroLines();
const defaultHeroSubtitle =
  "Skip the line and order faster. Exclusive app-only offers, real-time order tracking, and a lot more.";
const defaultDownloadTitle = "Get the Foodies App Now";
const defaultDownloadBody =
  "Order pickup or delivery from your favourite brands — all in one place.";
const defaultShowcaseTitle = "The Complete Foodies Experience in Your Pocket";

export const orderRedirectConfig = {
  ctaLabel: env("NEXT_PUBLIC_ORDER_CTA_LABEL", "Order on Foodies App"),
  playStoreUrl: env(
    "NEXT_PUBLIC_PLAY_STORE_URL",
    "https://play.google.com/store/apps",
  ),
  appStoreUrl: env("NEXT_PUBLIC_APP_STORE_URL", "https://apps.apple.com"),
  /** Optional: custom scheme or universal link attempted on mobile */
  appDeepLink: env("NEXT_PUBLIC_APP_DEEP_LINK", ""),

  pageTitle: env("NEXT_PUBLIC_ORDER_PAGE_TITLE", "Foodies App"),

  heroLine1: heroLines.heroLine1,
  heroLine2: heroLines.heroLine2,
  heroHighlight: env("NEXT_PUBLIC_ORDER_HERO_HIGHLIGHT", defaultHeroHighlight),
  heroSubtitle: env(
    "NEXT_PUBLIC_ORDER_HERO_SUBTITLE",
    env("NEXT_PUBLIC_ORDER_HERO_BODY", defaultHeroSubtitle),
  ),
  /** @deprecated Use heroLine1 + heroHighlight */
  heroTitle: env(
    "NEXT_PUBLIC_ORDER_HERO_TITLE",
    `${defaultHeroLine1} ${defaultHeroHighlight}`,
  ),
  /** @deprecated Use heroSubtitle */
  heroBody: env("NEXT_PUBLIC_ORDER_HERO_BODY", defaultHeroSubtitle),

  showcaseTitle: env("NEXT_PUBLIC_ORDER_SHOWCASE_TITLE", defaultShowcaseTitle),
  showcaseEyebrow: env("NEXT_PUBLIC_ORDER_SHOWCASE_EYEBROW", "EVERYTHING YOU LOVE"),

  phoneMockupUrl: env("NEXT_PUBLIC_ORDER_PHONE_MOCKUP_URL", ""),
  secondaryFoodImageUrl: env(
    "NEXT_PUBLIC_ORDER_SECONDARY_FOOD_IMAGE_URL",
    "https://images.unsplash.com/photo-1473093299877-4fe7cda0e0c5?auto=format&fit=crop&w=800&q=80",
  ),

  downloadTitle: env(
    "NEXT_PUBLIC_ORDER_DOWNLOAD_TITLE",
    env("NEXT_PUBLIC_ORDER_INFO_HEADLINE", defaultDownloadTitle),
  ),
  downloadBody: env(
    "NEXT_PUBLIC_ORDER_DOWNLOAD_BODY",
    env("NEXT_PUBLIC_ORDER_INFO_BODY", defaultDownloadBody),
  ),

  /** Lifestyle / download section image (public path or full URL) */
  heroImageUrl: env(
    "NEXT_PUBLIC_ORDER_HERO_IMAGE_URL",
    env(
      "NEXT_PUBLIC_ORDER_BANNER_IMAGE_URL",
      "https://images.unsplash.com/photo-1561758033-d89a9ad46330?auto=format&fit=crop&w=1600&q=80",
    ),
  ),

  /** Pre-made QR image (public path or full URL). If empty, qrTargetUrl is encoded instead. */
  qrImageUrl: env("NEXT_PUBLIC_ORDER_QR_IMAGE_URL", ""),

  /** URL encoded into a generated QR when qrImageUrl is empty */
  qrTargetUrl: env(
    "NEXT_PUBLIC_ORDER_QR_TARGET_URL",
    env("NEXT_PUBLIC_APP_STORE_URL", "https://apps.apple.com"),
  ),

  /** @deprecated Use downloadTitle — kept for backward compatibility */
  headline: env(
    "NEXT_PUBLIC_ORDER_INFO_HEADLINE",
    defaultDownloadTitle,
  ),
  /** @deprecated Use downloadBody */
  body: env(
    "NEXT_PUBLIC_ORDER_INFO_BODY",
    defaultDownloadBody,
  ),
  /** @deprecated Use heroImageUrl */
  bannerImageUrl: env(
    "NEXT_PUBLIC_ORDER_BANNER_IMAGE_URL",
    "https://images.unsplash.com/photo-1561758033-d89a9ad46330?auto=format&fit=crop&w=1600&q=80",
  ),
} as const;

/** Resolve a public asset path or pass through absolute URLs. */
export function resolveOrderInfoAssetUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
