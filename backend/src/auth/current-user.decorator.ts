import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type JwtUser = {
    id: number;
    tenantId: number | null;
    isSuperAdmin?: boolean;
};

export const CurrentUser = createParamDecorator(
    (data: unknown, ctx: ExecutionContext): JwtUser | number | null => {
        const request = ctx.switchToHttp().getRequest<{ user: JwtUser }>();
        const user = request.user;
        return data === 'id'
            ? user.id
            : data === 'tenantId'
              ? user.tenantId
              : user;
    },
);
