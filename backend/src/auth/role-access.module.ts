import { Module } from '@nestjs/common';
import { RoleAccessGuard } from './role-access.guard';

/** Standalone module for role-based access guard (avoids circular deps with AuthModule). */
@Module({
    providers: [RoleAccessGuard],
    exports: [RoleAccessGuard],
})
export class RoleAccessModule {}
