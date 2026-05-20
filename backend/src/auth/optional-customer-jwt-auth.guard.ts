import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Same as CustomerJwtAuthGuard but does not require a token; sets req.user when present. */
@Injectable()
export class OptionalCustomerJwtAuthGuard extends AuthGuard('customer-jwt') {
    handleRequest<TUser = unknown>(
        _err: unknown,
        user: TUser,
        _info?: unknown,
        _context?: ExecutionContext,
    ): TUser | null {
        return user ?? null;
    }
}
