import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
} from '@nestjs/common';

/** Use after JwtAuthGuard. Ensures the authenticated user has rider role. */
@Injectable()
export class RiderAuthGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const user = request.user as { id: number; isRider?: boolean };
        if (!user?.isRider) {
            throw new ForbiddenException('Rider access only');
        }
        return true;
    }
}
