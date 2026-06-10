import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Protects the public kiosk submit endpoint with a shared secret sent in the
 * `x-kiosk-api-key` header. Compared in constant time against KIOSK_API_KEY.
 *
 * If KIOSK_API_KEY is unset the guard denies all requests (fail closed), so the
 * endpoint is never accidentally left open in production.
 */
@Injectable()
export class KioskApiKeyGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Request>();
        const headerVal = request.headers['x-kiosk-api-key'];
        const provided = (
            Array.isArray(headerVal) ? headerVal[0] : (headerVal ?? '')
        ).toString();
        const expected = process.env.KIOSK_API_KEY ?? '';

        if (!expected) {
            throw new UnauthorizedException(
                'Kiosk API key is not configured on the server',
            );
        }
        if (!this.safeEqual(provided, expected)) {
            throw new UnauthorizedException('Invalid kiosk API key');
        }
        return true;
    }

    private safeEqual(a: string, b: string): boolean {
        const ab = Buffer.from(a);
        const bb = Buffer.from(b);
        // timingSafeEqual requires equal-length buffers; length mismatch => reject.
        if (ab.length !== bb.length) return false;
        return timingSafeEqual(ab, bb);
    }
}
