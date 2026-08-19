import type { CaptureLevel } from './activity-log.policy';

/**
 * Runtime configuration for the activity log.
 *
 * Phase 1 reads the environment only. Phase 6 (§8 of the plan) adds DB-backed
 * settings an owner can change from the admin panel — at which point THIS file
 * keeps the env var as the hard override, because an emergency brake must not
 * depend on the database being reachable.
 *
 * Deliberately a plain module, not a Nest provider: `role-access.guard.ts` reads
 * `isEnabled()` on the hot auth path, and a pure function import cannot create a
 * DI cycle or add a constructor dependency to the guard.
 */

/**
 * Master switch. Ships **false**: the feature lands dark, is enabled in staging,
 * load-tested and secret-swept, and only then turned on in production.
 */
export function isEnabled(): boolean {
    return (
        String(process.env.ACTIVITY_LOG_ENABLED || '')
            .trim()
            .toLowerCase() === 'true'
    );
}

/** How much to capture. See activity-log.policy.ts for what each level means. */
export function captureLevel(): CaptureLevel {
    if (!isEnabled()) return 'off';
    const raw = String(process.env.ACTIVITY_LOG_CAPTURE_LEVEL || '')
        .trim()
        .toLowerCase();
    if (raw === 'off') return 'off';
    if (raw === 'mutations') return 'mutations';
    if (raw === 'all') return 'all';
    return 'mutations+sensitive_reads';
}

/**
 * Mask phones/emails in payloads and diffs. Default ON: you keep "the phone
 * changed, roughly how" without copying the customer database into the audit
 * table.
 */
export function piiMaskEnabled(): boolean {
    return (
        String(process.env.ACTIVITY_LOG_PII_MODE || 'mask')
            .trim()
            .toLowerCase() !== 'full'
    );
}

/**
 * Collapse window for repeated sensitive reads, in seconds. Without this, report
 * polling alone is ~8k rows/day of "the same person opened the same screen".
 */
export function readCollapseSeconds(): number {
    const raw = Number(process.env.ACTIVITY_LOG_READ_COLLAPSE_SECONDS);
    if (!Number.isFinite(raw) || raw < 0) return 300;
    return Math.min(3600, Math.floor(raw));
}
