import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppConfigService, AppConfigResponse } from './app-config.service';

/**
 * Unauthenticated: the app reads this BEFORE anyone has logged in (and while an
 * out-of-date build may not be able to authenticate at all), so it sits under
 * the `public/` prefix every other no-auth surface uses (public/consumer,
 * public/kiosk) rather than inventing a root-level route of its own.
 *
 * `app-config` (no prefix) is a LEGACY ALIAS, not a second supported route: the
 * shipped v1.2.4 build hard-codes that path and cannot be changed without a
 * store release. Both paths are the same handler — there is no second
 * implementation to keep in sync. Delete the alias once no live build calls it;
 * the canonical path is the `public/` one and every new client uses only that.
 */
@ApiTags('Public')
@Controller(['public/app-config', 'app-config'])
export class AppConfigController {
    constructor(private readonly service: AppConfigService) {}

    @Get()
    @ApiOperation({
        summary: 'Mobile force-update config (public, never errors)',
    })
    // A cached "false" would outlive the moment someone flips the switch, which
    // is the one moment this endpoint exists for.
    @Header('Cache-Control', 'no-store')
    get(): Promise<AppConfigResponse> {
        return this.service.getPublicConfig();
    }
}
