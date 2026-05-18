const S3_HOST_PATTERN = /\.s3(\.[a-z0-9-]+)?\.amazonaws\.com$/i;
const CLOUDFRONT_HOST_PATTERN = /\.cloudfront\.net$/i;

function configuredMediaOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_MEDIA_ORIGIN?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Origin for preconnect (env or null). */
export function getMediaOrigin(): string | null {
  return configuredMediaOrigin();
}

function hostMatchesMediaOrigin(hostname: string): boolean {
  const origin = configuredMediaOrigin();
  if (!origin) return false;
  try {
    return new URL(origin).hostname === hostname;
  } catch {
    return false;
  }
}

/** True for http(s) URLs served from S3, CloudFront, or NEXT_PUBLIC_MEDIA_ORIGIN. */
export function isRemoteMediaUrl(src: string): boolean {
  if (!src?.trim()) return false;
  if (src.startsWith("data:")) return false;
  if (!src.startsWith("http://") && !src.startsWith("https://")) return false;
  try {
    const { hostname } = new URL(src);
    return (
      S3_HOST_PATTERN.test(hostname) ||
      CLOUDFRONT_HOST_PATTERN.test(hostname) ||
      hostMatchesMediaOrigin(hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Use unoptimized next/image for placeholders and remote CDN/S3 URLs
 * so the browser loads directly from S3/CloudFront (not /_next/image).
 */
export function shouldUnoptimizeImage(src: string): boolean {
  if (!src?.trim()) return true;
  if (src.startsWith("data:")) return true;
  return isRemoteMediaUrl(src);
}
