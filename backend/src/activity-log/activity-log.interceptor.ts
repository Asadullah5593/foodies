import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import {
    ENRICHMENT_KEY,
    type InterceptorEnrichment,
} from './activity-log.middleware';
import { REQUIRE_PERMISSION_KEY } from '../roles/require-permission.decorator';
import { singularise } from './activity-log.policy';
import { isEnabled } from './activity-log.config';
import { pickResponseMeta } from './activity-log.redaction';

/**
 * Enrichment only. The middleware writes the row; this adds detail the request
 * object alone cannot provide — the handler's `@RequirePermission` name (a far
 * better action label than one derived from the URL) and an allow-listed pick
 * of the response body (for ids created mid-handler).
 *
 * Two properties matter:
 *
 * - **It never transforms the stream.** `tap` observes; it does not map. A bug
 *   here cannot alter what the client receives.
 * - **It is optional.** Guards run before interceptors, so on a 401/403 this
 *   never executes — and the middleware still emits a complete row. Nothing
 *   here is load-bearing.
 */
@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
    constructor(private readonly reflector: Reflector) {}

    intercept(
        context: ExecutionContext,
        next: CallHandler,
    ): Observable<unknown> {
        if (!isEnabled() || context.getType() !== 'http') {
            return next.handle();
        }

        return next.handle().pipe(
            tap({
                next: (body) => {
                    try {
                        this.enrich(context, body);
                    } catch {
                        // Enrichment is a nice-to-have; the row survives without it.
                    }
                },
                // Errors need no handling: the middleware reads the final status
                // code from the response, whatever the exception filter turned
                // the error into.
            }),
        );
    }

    private enrich(context: ExecutionContext, body: unknown): void {
        const req = context
            .switchToHttp()
            .getRequest<Record<string, unknown>>();
        if (!req) return;

        const handler = context.getHandler();
        const controller = context.getClass();

        // The permission a route demands is the most honest name for what it
        // does: `menu-items:edit` → `menu-item.edit`.
        // The decorator stores an ARRAY (any-of); the first entry names the
        // action best.
        const permissions = this.reflector.getAllAndOverride<
            string[] | undefined
        >(REQUIRE_PERMISSION_KEY, [handler, controller]);
        const permission = permissions?.[0];

        const enrichment: InterceptorEnrichment = {
            ...((req[ENRICHMENT_KEY] as InterceptorEnrichment) ?? {}),
            responseMeta: pickResponseMeta(body),
        };

        if (typeof permission === 'string' && permission.includes(':')) {
            const [resource, action] = permission.split(':');
            enrichment.action = `${singularise(resource)}.${action}`;
            enrichment.entityType = resource;
        } else {
            // Fall back to the controller name, which still beats a URL guess
            // for anything the route derivation gets wrong.
            enrichment.entityType =
                controller.name
                    ?.replace(/Controller$/, '')
                    .replace(/([a-z])([A-Z])/g, '$1-$2')
                    .toLowerCase() || undefined;
        }

        req[ENRICHMENT_KEY] = enrichment;
    }
}
