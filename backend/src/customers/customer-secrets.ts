/**
 * Columns of `customers` that must never leave the server.
 *
 * `password` is the bcrypt hash of a customer's mobile-app / website login. The
 * admin API used to send whole rows — hash included — to every account that can
 * list customers, which is every cashier: the POS customer picker loads the
 * same list. A hash is not a password, but it is exactly what an offline
 * cracking run needs, and nothing in the admin ever reads it.
 *
 * A deny-list on purpose: the admin pages read most of the row (name, phone,
 * email, source, createdAt, brandIds…), so the rule that matters is "these
 * never go out", and it is applied at every exit of the admin customers API.
 */
const SECRET_COLUMNS = ['password'] as const;

type Secret = (typeof SECRET_COLUMNS)[number];

/** A customer row with its secrets removed — safe to send to the admin. */
export function withoutSecrets<T extends object>(row: T): Omit<T, Secret> {
    const safe = { ...row } as Record<string, unknown>;
    for (const column of SECRET_COLUMNS) delete safe[column];
    return safe as Omit<T, Secret>;
}
