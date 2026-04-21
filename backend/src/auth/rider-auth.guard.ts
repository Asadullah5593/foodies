import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';

type RiderUser = { id: number; isRider?: boolean };

/** Use after JwtAuthGuard. Ensures the authenticated user has rider role. */
@Injectable()
export class RiderAuthGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context
            .switchToHttp()
            .getRequest<Request & { user?: RiderUser }>();
        const user = request.user;
        if (!user?.isRider) {
            throw new ForbiddenException('Rider access only');
        }
        return true;
    }
}
