import { AsyncLocalStorage } from 'node:async_hooks';

/** A single recorded before/after on one entity, drained into the row at the end. */
export interface RecordedChange {
    entityType: string;
    entityId: string | number | null;
    entityLabel?: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
}

/**
 * Something that happened to ONE record, worded by the service that did it.
 *
 * Exists because a single request can act on several records — a mixed cart
 * becomes one order per brand, a rider is assigned to a whole order group — and
 * "what happened to order 013" is unanswerable unless each of them gets a row
 * of its own, under its own branch and brand.
 */
export interface RecordedEvent {
    entityType: string;
    entityId: string | number | null;
    entityLabel?: string | null;
    /** What happened, in words: "Status changed from preparing to ready". */
    summary?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    tenantId?: number | null;
    branchId?: number | null;
    brandId?: number | null;
}

/** Per-request store opened by the middleware. */
export interface ActivityStore {
    requestId: string;
    changes: RecordedChange[];
    /** One row each, emitted only when the request succeeded. */
    events?: RecordedEvent[];
    /** What happened, in words, when the service can say it better than the route. */
    summary?: string | null;
    /** Set by a service when it knows the subject better than the route does. */
    entityType?: string;
    entityId?: string | number | null;
    entityLabel?: string | null;
    tenantId?: number | null;
    branchId?: number | null;
    brandId?: number | null;
    /** Extra context a service wants on the row (small, already safe to store). */
    extra?: Record<string, unknown>;
}

const storage = new AsyncLocalStorage<ActivityStore>();

/**
 * Request-scoped audit context, on top of `node:async_hooks` (no new dependency).
 *
 * Services call `ActivityContext.recordChange(...)` wherever a diff matters; the
 * middleware drains whatever accumulated when the response finishes.
 *
 * EVERY method here is a no-op when there is no active store. That is what keeps
 * seeds, cron jobs, specs and any direct service call runnable without an HTTP
 * request in flight — instrumentation can never be the reason something breaks.
 */
export const ActivityContext = {
    /** Runs `fn` inside a fresh store. Only the middleware should call this. */
    run<T>(store: ActivityStore, fn: () => T): T {
        return storage.run(store, fn);
    },

    /** The active store, or undefined outside a request. */
    get(): ActivityStore | undefined {
        return storage.getStore();
    },

    /** True when there is a request to attach audit data to. */
    isActive(): boolean {
        return storage.getStore() !== undefined;
    },

    /**
     * Record a before/after pair for the entity this request is changing.
     *
     * Pass plain snapshots — the diff itself is computed later, in the writer, so
     * that no request thread pays for diffing and so normalisation (TypeORM
     * returns `decimal` as strings) happens in exactly one place.
     */
    recordChange(
        entityType: string,
        entityId: string | number | null,
        before: Record<string, unknown> | null,
        after: Record<string, unknown> | null,
        entityLabel?: string | null,
    ): void {
        const store = storage.getStore();
        if (!store) return;
        // Bounded: a bulk loop must not grow the store without limit.
        if (store.changes.length >= 50) return;
        store.changes.push({
            entityType,
            entityId,
            entityLabel: entityLabel ?? null,
            before,
            after,
        });
    },

    /**
     * Record something that happened to one record, as a row of its own.
     *
     * Call it AFTER the write has succeeded. The middleware drops events when
     * the request ends in an error, so a rolled-back change is never reported
     * as having happened.
     */
    recordEvent(event: RecordedEvent): void {
        const store = storage.getStore();
        if (!store) return;
        store.events ??= [];
        // Bounded, like changes: a bulk loop must not grow the store forever.
        if (store.events.length >= 50) return;
        store.events.push(event);
    },

    /** Say what happened in words, when the route name would not. */
    setSummary(summary: string | null): void {
        const store = storage.getStore();
        if (!store) return;
        store.summary = summary ? summary.slice(0, 400) : null;
    },

    /** Name the subject when the route cannot (e.g. an id created mid-handler). */
    setSubject(
        entityType: string,
        entityId: string | number | null,
        entityLabel?: string | null,
    ): void {
        const store = storage.getStore();
        if (!store) return;
        store.entityType = entityType;
        store.entityId = entityId;
        if (entityLabel !== undefined) store.entityLabel = entityLabel;
    },

    /** Scope of the SUBJECT, not of the actor's own access. */
    setScope(scope: {
        tenantId?: number | null;
        branchId?: number | null;
        brandId?: number | null;
    }): void {
        const store = storage.getStore();
        if (!store) return;
        if (scope.tenantId !== undefined) store.tenantId = scope.tenantId;
        if (scope.branchId !== undefined) store.branchId = scope.branchId;
        if (scope.brandId !== undefined) store.brandId = scope.brandId;
    },

    /** Correlation id for this request; empty string outside one. */
    requestId(): string {
        return storage.getStore()?.requestId ?? '';
    },
};
