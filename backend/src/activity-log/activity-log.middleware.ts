import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ActivityContext, type ActivityStore } from './activity-context';
import { ActivityLogWriter, type ActivityLogRow } from './activity-log.writer';
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
    isCriticalAction,
    isSensitiveRead,
    normalisePath,
    outcomeFor,
    refineAction,
    shouldCapture,
} from './activity-log.policy';
import { classifyActor, clientIp } from './activity-log.actor';
import { diffSnapshots, redactPayload } from './activity-log.redaction';

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

    constructor(private readonly writer: ActivityLogWriter) {}

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

        if (!shouldCapture(captureLevel(), method, path, statusCode)) return;

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

        const action = refineAction(
            enrichment?.action || deriveAction(method, path),
            statusCode,
        );
        const piiMask = piiMaskEnabled();

        // Subject scope comes from what was acted ON, falling back to the
        // actor's tenant only so multi-tenant filtering still works.
        const tenantId = store.tenantId ?? actor.actorTenantId;

        const body = redactPayload(req.body, { route: path, piiMask });
        const query = redactPayload(req.query, { route: path, piiMask });

        const merged = this.mergeChanges(store, path, piiMask);

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
            branchId: store.branchId ?? null,
            brandId: store.brandId ?? null,
            action,
            actionGroup: deriveActionGroup(path),
            entityType: store.entityType ?? enrichment?.entityType ?? null,
            entityId:
                store.entityId != null
                    ? String(store.entityId).slice(0, 64)
                    : (this.idFromPath(path) ??
                      this.idFromResponse(enrichment?.responseMeta)),
            entityLabel: store.entityLabel ?? null,
            summary: null,
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

        // Rows you cannot afford to lose to a restart go straight to the DB;
        // everything else batches.
        if (isCriticalAction(action)) {
            void this.writer.writeImmediate(row);
        } else {
            this.writer.enqueue(row);
        }
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
