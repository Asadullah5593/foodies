import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BankCardsService } from './bank-cards.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';

type CardUser = { id: number; tenantId: number | null };
type CardBody = {
    name?: string;
    bank?: string | null;
    network?: string | null;
    bin_prefixes?: string[] | null;
    is_active?: boolean;
};

@ApiTags('Admin – Bank Cards')
@ApiBearerAuth()
@Controller('admin/bank-cards')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class BankCardsController {
    constructor(private service: BankCardsService) {}

    /** POS + admin: list the tenant's cards. `?active=1` returns only active ones (for the POS picker). */
    @Get()
    index(@CurrentUser() user: CardUser, @Query('active') active?: string) {
        return this.service.findAll(
            user.tenantId,
            active === '1' || active === 'true',
        );
    }

    @Post()
    store(@CurrentUser() user: CardUser, @Body() body: CardBody) {
        if (user.tenantId == null)
            throw new ForbiddenException('Bank cards are managed per tenant');
        return this.service.create(user.tenantId, body);
    }

    @Put(':id')
    update(
        @CurrentUser() user: CardUser,
        @Param('id') id: string,
        @Body() body: CardBody,
    ) {
        if (user.tenantId == null)
            throw new ForbiddenException('Bank cards are managed per tenant');
        return this.service.update(+id, user.tenantId, body);
    }

    @Delete(':id')
    remove(@CurrentUser() user: CardUser, @Param('id') id: string) {
        if (user.tenantId == null)
            throw new ForbiddenException('Bank cards are managed per tenant');
        return this.service.remove(+id, user.tenantId);
    }
}
