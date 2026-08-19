/**
 * Who did it.
 *
 * Three shapes of `req.user` reach us, and telling them apart wrong is how an
 * audit log ends up blaming the wrong person:
 *
 * - **staff / rider** — the admin JWT strategy returns `{ id, tenantId,
 *   isSuperAdmin, isRider }`, and RoleAccessGuard then enriches it.
 * - **customer** — the consumer strategy returns the full `Customer` ENTITY.
 *   `customer.entity.ts` declares `password` with no `select: false`, so this
 *   object can carry a bcrypt hash. We therefore read named fields off it and
 *   **never spread it**.
 * - **absent** — kiosk (shared API key, no JWT) or anonymous.
 */

export interface ActorInfo {
    actorType: 'staff' | 'rider' | 'customer' | 'kiosk' | 'anonymous';
    actorUserId: number | null;
    actorCustomerId: number | null;
    actorLabel: string | null;
    actorRoleSlugs: string[] | null;
    actorRoleNames: string[] | null;
    actorIsSuperAdmin: boolean;
    /** The actor's OWN tenant. Never used as the subject's scope. */
    actorTenantId: number | null;
}

/** Shape we read off `req.user` without ever spreading it. */
interface MaybeUser {
    id?: unknown;
    tenantId?: unknown;
    isSuperAdmin?: unknown;
    isRider?: unknown;
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    roles?: unknown;
}

const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, 160) : null;

const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

function readRoles(value: unknown): {
    slugs: string[] | null;
    names: string[] | null;
} {
    if (!Array.isArray(value) || value.length === 0) {
        return { slugs: null, names: null };
    }
    const slugs: string[] = [];
    const names: string[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const r = entry as { slug?: unknown; name?: unknown };
        const slug = str(r.slug);
        const name = str(r.name);
        if (slug) slugs.push(slug);
        if (name) names.push(name);
    }
    return {
        slugs: slugs.length ? slugs : null,
        names: names.length ? names : null,
    };
}

export function classifyActor(
    user: unknown,
    headers: Record<string, unknown>,
): ActorInfo {
    const base: ActorInfo = {
        actorType: 'anonymous',
        actorUserId: null,
        actorCustomerId: null,
        actorLabel: null,
        actorRoleSlugs: null,
        actorRoleNames: null,
        actorIsSuperAdmin: false,
        actorTenantId: null,
    };

    if (!user || typeof user !== 'object') {
        // Kiosk endpoints authenticate with a shared secret, not a JWT, so an
        // absent user there is a till rather than a stranger.
        if (headers['x-kiosk-api-key']) {
            return { ...base, actorType: 'kiosk', actorLabel: 'kiosk' };
        }
        return base;
    }

    const u = user as MaybeUser;
    const id = num(u.id);

    // Staff and riders carry tenantId; consumers never do. `'tenantId' in u` is
    // the discriminator, NOT its value — a super admin's tenantId is null.
    if ('tenantId' in u) {
        const { slugs, names } = readRoles(u.roles);
        return {
            actorType: u.isRider === true ? 'rider' : 'staff',
            actorUserId: id,
            actorCustomerId: null,
            actorLabel:
                str(u.name) ?? str(u.email) ?? (id ? `user#${id}` : null),
            actorRoleSlugs: slugs,
            actorRoleNames: names,
            // Super admins short-circuit RoleAccessGuard before it resolves
            // permissions or roles, so their arrays stay NULL. NULL means
            // "unknown / unrestricted"; `[]` would read as "held no
            // permissions", which is the opposite of the truth.
            actorIsSuperAdmin: u.isSuperAdmin === true || u.tenantId === null,
            actorTenantId: num(u.tenantId),
        };
    }

    // Consumer. Read named fields only — never spread, never JSON-stringify the
    // whole entity, or a bcrypt hash lands in the audit table.
    return {
        ...base,
        actorType: 'customer',
        actorCustomerId: id,
        actorLabel:
            str(u.name) ?? str(u.phone) ?? (id ? `customer#${id}` : null),
    };
}

/**
 * Client IP, honouring the proxy chain. Nginx sits in front in production, so
 * `req.ip` alone would record the proxy on every row.
 */
export function clientIp(
    headers: Record<string, unknown>,
    fallback?: string,
): string | null {
    const forwarded = headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        // Left-most entry is the original client.
        const first = forwarded.split(',')[0]?.trim();
        if (first) return first.slice(0, 64);
    }
    const real = headers['x-real-ip'];
    if (typeof real === 'string' && real.trim())
        return real.trim().slice(0, 64);
    return fallback ? fallback.slice(0, 64) : null;
}
