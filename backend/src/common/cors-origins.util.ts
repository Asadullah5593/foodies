/**
 * Shared CORS allowlist for both the HTTP app (main.ts) and socket.io gateways.
 *
 * Set CORS_ORIGINS to a comma-separated list of exact browser origins
 * (scheme + host + optional port, NO trailing slash), e.g.
 *   CORS_ORIGINS=https://pos.example.com,https://kiosk.example.com
 *
 * Returns `true` (reflect any origin — previous behavior) when unset, so an
 * unconfigured environment keeps working instead of blocking all browsers.
 *
 * Note: native mobile apps and server-to-server calls send no Origin header
 * and are unaffected by this list; CORS is a browser-enforced mechanism.
 */
export function getCorsOrigin(): string[] | true {
    const origins = (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((o) => o.trim().replace(/\/+$/, ''))
        .filter(Boolean);
    return origins.length > 0 ? origins : true;
}
