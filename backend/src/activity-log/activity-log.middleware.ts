import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ActivityContext, type ActivityStore } from './activity-context';
import { ActivityLogWriter, type ActivityLogRow } from './activity-log.writer';
import { ActivityLogSettingsService } from './activity-log-settings.service';
import {
    captureLevel,
    isEnabled,
    piiMaskEnabled,
    readCollapseSeconds,
} from './activity-log.config';
import {
    deriveAction,
    deriveActionGroup,
    expectsDiff,
    hasTrailingVerb,
    isCriticalAction,
    isSensitiveRead,
    normalisePath,
    outcomeFor,
    refineAction,
    shouldCapture,
} from './activity-log.policy';
import { classifyActor, clientIp } from './activity-log.actor';
import { diffSnapshots, redactPayload } from './activity-log.redaction';
import {
    canonicalEntityType,
    labelFromResponse,
    scopeFromRequest,
    soleId,
} from './activity-log.subject';

/** Enrichment the interceptor leaves behind for us. Absent if it never ran. */
export interface InterceptorEnrichment {
    action?: string;
    entityType?: string;
    responseMeta?: Record<string, unknown> | null;
}

/** Where the interceptor parks its enrichment on the request object. */
export const ENRICHMENT_KEY = '__activityEnrichment';

/**
 * Owns the audit lifecycle for every request.
 *
 * Why middleware and not an interceptor: Nest runs guards BEFORE interceptors,
 * so a guard rejection (401/403) throws before any interceptor exists. Denied
 * access is the highest-value event in the whole table, so an interceptor-only
 * design would miss exactly what matters most. Middleware wraps the entire
 * request, including everything the guards do.
 *
 * The row is emitted on `res.on('finish')` — AFTER the response has been
 * flushed to the client. Audit work therefore adds zero latency to the user's
 * request by construction, not by being fast.
 *
 * Nothing in here may throw. Every handler is wrapped; a failure logs and the
 * request is unaffected.
 */
@Injectable()
export class ActivityLogMiddleware implements NestMiddleware {
    private readonly logger = new Logger(ActivityLogMiddleware.name);

    /**
     * Recent sensitive reads, for collapsing repeats: key → last logged time.
     * Bounded and swept, so it cannot grow into a leak.
     */
    private readonly recentReads = new Map<string, number>();
    private lastSweep = Date.now();

    constructor(
        private readonly writer: ActivityLogWriter,
        private readonly settings: ActivityLogSettingsService,
    ) {}

    use(req: Request, res: Response, next: NextFunction): void {
        // Correlation id is minted even when capture is off: it costs nothing,
        // and it lets the client and the server agree on a request identity for
        // support tickets regardless of the audit setting.
        const incoming = req.headers['x-request-id'];
        const requestId =
            typeof incoming === 'string' && /^[0-9a-f-]{36}$/i.test(incoming)
                ? incoming
                : randomUUID();
        try {
            res.setHeader('X-Request-Id', requestId);
        } catch {
            /* headers already sent — irrelevant to the caller */
        }

        if (!isEnabled()) return next();

        const startedAt = Date.now();
        const store: ActivityStore = { requestId, changes: [] };

        res.on('finish', () => {
            try {
                this.emit(req, res, store, startedAt);
            } catch (e) {
                // An audit failure must never surface to the user, and by now
                // the response has already gone out anyway.
                this.logger.error(`activity log emit failed: ${String(e)}`);
            }
        });

        // Everything downstream — guards, pipes, handler, services — runs inside
        // the store, so ActivityContext.recordChange() can find it.
        ActivityContext.run(store, () => next());
    }

    private emit(
        req: Request,
        res: Response,
        store: ActivityStore,
        startedAt: number,
    ): void {
        const method = (req.method || 'GET').toUpperCase();
        const path = normalisePath(req.originalUrl || req.url || '/');
        const statusCode = res.statusCode || 0;

        // Env is the hard override; the admin-set level refines it. Read from
        // the 30s cache, never a DB round trip on the request path.
        const level = this.settings.cached()?.capture_level ?? captureLevel();
        if (
            !shouldCapture(
                captureLevel() === 'off' ? 'off' : level,
                method,
                path,
                statusCode,
            )
        )
            return;

        // Collapse repeat views of the same screen by the same person.
        const headers = req.headers as unknown as Record<string, unknown>;
        const actor = classifyActor(req.user, headers);
        if (isSensitiveRead(method, path) && statusCode < 400) {
            if (this.isCollapsedRepeat(actor.actorUserId, path, req.url))
                return;
        }

        const enrichment = (req as unknown as Record<string, unknown>)[
            ENRICHMENT_KEY
        ] as InterceptorEnrichment | undefined;

        // The route wins when it ends in a verb: a permission name is shared by
        // every handler that needs it, so `/cash-outs/2/void` must not be
        // reported under the same action as recording a cash-out.
        const routeAction = deriveAction(method, path);
        const action = refineAction(
            hasTrailingVerb(path)
                ? routeAction
                : (enrichment?.action ?? routeAction),
            statusCode,
        );
        const piiMask =
            this.settings.cached()?.pii_mode === 'full'
                ? false
                : piiMaskEnabled();

        // Subject scope comes from what was acted ON, falling back to the
        // actor's tenant only so multi-tenant filtering still works.
        const tenantId = store.tenantId ?? actor.actorTenantId;

        const body = redactPayload(req.body, { route: path, piiMask });
        const query = redactPayload(req.query, { route: path, piiMask });

        const merged = this.mergeChanges(store, path, piiMask);

        // Subject precedence: an explicit setSubject wins; then whatever a
        // single recordChange() named (the service knows the entity better than
        // a URL or a permission slug does — "role"/"Cashier" beats "roles"/null);
        // then the interceptor's resource with an id from the path or response.
        const only = store.changes.length === 1 ? store.changes[0] : null;
        const entityType = canonicalEntityType(
            store.entityType ??
                only?.entityType ??
                enrichment?.entityType ??
                null,
        );
        const entityId =
            store.entityId ??
            only?.entityId ??
            this.idFromPath(path) ??
            this.idFromResponse(enrichment?.responseMeta);
        const entityLabel =
            store.entityLabel ??
            only?.entityLabel ??
            // Only a request about ONE record can borrow the response's name;
            // a list has no single record to be named after.
            (entityId != null
                ? labelFromResponse(enrichment?.responseMeta)
                : null);

        // Where it happened: what the service said, then what the request was
        // aimed at, then — for someone confined to a single branch or brand —
        // the only place they can act at all.
        const user = req.user as
            | { allowedBranchIds?: unknown; allowedBrandIds?: unknown }
            | undefined;
        const aimed = scopeFromRequest({
            params: req.params,
            query: req.query,
            body: req.body,
            response: enrichment?.responseMeta,
        });
        const branchId =
            store.branchId ?? aimed.branchId ?? soleId(user?.allowedBranchIds);
        const brandId =
            store.brandId ?? aimed.brandId ?? soleId(user?.allowedBrandIds);

        const row: ActivityLogRow = {
            createdAt: new Date(),
            requestId: store.requestId,
            sessionId: this.header(headers, 'x-session-id'),
            deviceId: this.header(headers, 'x-device-id'),
            actorType: actor.actorType,
            actorUserId: actor.actorUserId,
            actorCustomerId: actor.actorCustomerId,
            actorLabel: actor.actorLabel,
            actorRoleSlugs: actor.actorRoleSlugs,
            actorRoleNames: actor.actorRoleNames,
            actorIsSuperAdmin: actor.actorIsSuperAdmin,
            tenantId,
            branchId,
            brandId,
            action,
            actionGroup: deriveActionGroup(path),
            entityType,
            entityId: entityId != null ? String(entityId).slice(0, 64) : null,
            entityLabel: entityLabel ? entityLabel.slice(0, 200) : null,
            summary: store.summary ?? null,
            httpMethod: method,
            route: path.slice(0, 300),
            query: query.value,
            requestBody: body.value,
            responseMeta: enrichment?.responseMeta ?? null,
            statusCode,
            outcome: outcomeFor(statusCode),
            durationMs: Date.now() - startedAt,
            changes: merged.changes,
            changedFields: merged.changedFields,
            ip: clientIp(headers, req.ip),
            userAgent: this.header(headers, 'user-agent', 400),
            payloadTruncated: body.truncated || query.truncated,
            diffExpected: expectsDiff(method, path),
        };

        const rows = this.perRecordRows(row, store, path, piiMask);

        // Rows you cannot afford to lose to a restart go straight to the DB;
        // everything else batches.
        for (const each of rows) {
            if (isCriticalAction(action)) {
                void this.writer.writeImmediate(each);
            } else {
                this.writer.enqueue(each);
            }
        }
    }

    /**
     * One row per record the request acted on.
     *
     * A request usually concerns one record and yields the one row it always
     * did. When a service reported events — a cart that became three orders, a
     * rider assigned to a group — each record gets its own row, under its own
     * branch and brand, so its history is complete on its own.
     *
     * Events are dropped when the request failed: they are recorded as the work
     * is done, and a later error may have rolled that work back.
     */
    private perRecordRows(
        row: ActivityLogRow,
        store: ActivityStore,
        route: string,
        piiMask: boolean,
    ): ActivityLogRow[] {
        const events = store.events ?? [];
        if (!events.length || row.outcome !== 'success') return [row];

        return events.map((event, index) => {
            const diff =
                event.before || event.after
                    ? diffSnapshots(event.before ?? null, event.after ?? null, {
                          route,
                          piiMask,
                      })
                    : null;
            return {
                ...row,
                tenantId: event.tenantId ?? row.tenantId,
                branchId: event.branchId ?? row.branchId,
                brandId: event.brandId ?? row.brandId,
                entityType: canonicalEntityType(event.entityType),
                entityId:
                    event.entityId != null
                        ? String(event.entityId).slice(0, 64)
                        : null,
                entityLabel: event.entityLabel
                    ? event.entityLabel.slice(0, 200)
                    : null,
                summary: event.summary
                    ? event.summary.slice(0, 400)
                    : row.summary,
                changes: diff?.changes ?? null,
                changedFields: diff?.changes ? Object.keys(diff.changes) : null,
                // The payload belongs to the request, not to each record in it.
                requestBody: index === 0 ? row.requestBody : null,
                diffExpected: false,
            };
        });
    }

    /**
     * Fold every recordChange() from this request into one diff. Most requests
     * touch one entity; when several are touched the fields are namespaced so
     * nothing silently overwrites.
     */
    private mergeChanges(
        store: ActivityStore,
        route: string,
        piiMask: boolean,
    ): {
        changes: Record<string, { before: unknown; after: unknown }> | null;
        changedFields: string[] | null;
    } {
        if (!store.changes.length) {
            return { changes: null, changedFields: null };
        }
        const single = store.changes.length === 1;
        const changes: Record<string, { before: unknown; after: unknown }> = {};
        const fields: string[] = [];

        for (const c of store.changes) {
            const diff = diffSnapshots(c.before, c.after, { route, piiMask });
            if (!diff.changes) continue;
            for (const [field, value] of Object.entries(diff.changes)) {
                const key = single
                    ? field
                    : `${c.entityType}#${c.entityId ?? '?'}.${field}`;
                changes[key] = value;
                fields.push(key);
            }
        }
        if (!fields.length) return { changes: null, changedFields: null };
        return { changes, changedFields: fields };
    }

    /**
     * True when this exact (actor, route, query) was already logged inside the
     * collapse window.
     */
    private isCollapsedRepeat(
        actorUserId: number | null,
        path: string,
        url: string | undefined,
    ): boolean {
        const windowMs = readCollapseSeconds() * 1000;
        if (windowMs <= 0) return false;
        const now = Date.now();

        // Sweep occasionally so the map cannot grow unbounded.
        if (now - this.lastSweep > windowMs) {
            for (const [k, at] of this.recentReads) {
                if (now - at > windowMs) this.recentReads.delete(k);
            }
            this.lastSweep = now;
        }

        const key = `${actorUserId ?? 'anon'}|${url ?? path}`;
        const last = this.recentReads.get(key);
        if (last !== undefined && now - last < windowMs) return true;
        this.recentReads.set(key, now);
        return false;
    }

    /**
     * A create has no id in its path — the id only exists once the row is
     * written — so fall back to the one the response just reported.
     */
    private idFromResponse(
        meta: Record<string, unknown> | null | undefined,
    ): string | null {
        const id = meta?.id;
        if (typeof id === 'number' || typeof id === 'string') {
            return String(id).slice(0, 64);
        }
        return null;
    }

    /** Trailing numeric/uuid segment of the path, when there is one. */
    private idFromPath(path: string): string | null {
        const segments = path.split('/').filter(Boolean);
        for (let i = segments.length - 1; i >= 0; i--) {
            const s = segments[i];
            if (/^\d+$/.test(s) || /^[0-9a-f-]{36}$/i.test(s)) return s;
        }
        return null;
    }

    private header(
        headers: Record<string, unknown>,
        name: string,
        max = 64,
    ): string | null {
        const v = headers[name];
        return typeof v === 'string' && v.trim()
            ? v.trim().slice(0, max)
            : null;
    }
}
