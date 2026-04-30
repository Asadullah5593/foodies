/**
 * Browse-only flow: CTAs send users to /order-info (app stores / deep link).
 * Override via NEXT_PUBLIC_* in .env.local.
 */

const env = (key: string, fallback: string) =>
  (typeof process !== "undefined" && process.env[key]) || fallback;

export const orderRedirectConfig = {
  ctaLabel: env("NEXT_PUBLIC_ORDER_CTA_LABEL", "Order on McDelivery"),
  playStoreUrl: env(
    "NEXT_PUBLIC_PLAY_STORE_URL",
    "https://play.google.com/store/apps",
  ),
  appStoreUrl: env("NEXT_PUBLIC_APP_STORE_URL", "https://apps.apple.com"),
  /** Optional: custom scheme or universal link attempted on mobile */
  appDeepLink: env("NEXT_PUBLIC_APP_DEEP_LINK", ""),
  bannerImageUrl: env(
    "NEXT_PUBLIC_ORDER_BANNER_IMAGE_URL",
    "https://images.unsplash.com/photo-1561758033-d89a9ad46330?auto=format&fit=crop&w=1600&q=80",
  ),
  /** Local public path or full URL for QR (optional) */
  qrImageUrl: env("NEXT_PUBLIC_ORDER_QR_IMAGE_URL", ""),
  headline: env(
    "NEXT_PUBLIC_ORDER_INFO_HEADLINE",
    "Order in our mobile app",
  ),
  body: env(
    "NEXT_PUBLIC_ORDER_INFO_BODY",
    "To place your order, please use our mobile application. Download it below for the best experience.",
  ),
} as const;
