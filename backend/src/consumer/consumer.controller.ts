import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Query,
    NotFoundException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BrandsService } from '../brands/brands.service';
import { BranchesService } from '../branches/branches.service';
import { MenuService } from '../menu/menu.service';
import { OrdersService } from '../orders/orders.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { Branch } from '../entities/branch.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

type BranchWithBrands = Branch & {
    branchBrands: Array<{ brand: { tenantId: number } }>;
};

@ApiTags('Consumer')
@Controller('public/consumer')
export class ConsumerController {
    constructor(
        private brandsService: BrandsService,
        private branchesService: BranchesService,
        private menuService: MenuService,
        private ordersService: OrdersService,
        private loyaltyService: LoyaltyService,
        @InjectRepository(Branch) private branchRepo: Repository<Branch>,
    ) {}

    @Get('brands')
    listBrands() {
        return this.brandsService.findAllPublic();
    }

    @Get('branches')
    listBranches(@Query('brand_id') brandId: string) {
        return this.branchesService.findAll(brandId ? +brandId : undefined);
    }

    @Get('menu')
    getMenu(@Query('branch_id') branchIdParam: string) {
        const branchId = branchIdParam ? +branchIdParam : undefined;
        if (!branchId) throw new NotFoundException('branch_id is required');
        return this.menuService.getBranchMenu(branchId);
    }

    @Post('orders')
    async placeOrder(
        @Body()
        dto: {
            branch_id: number;
            order_type: string;
            customer_name?: string;
            customer_phone?: string;
            delivery_address?: string;
            items: {
                menu_item_id: number;
                quantity: number;
                variant_id?: number;
                addons?: { addon_id: number; quantity?: number }[];
                notes?: string;
            }[];
            notes?: string;
            discount_code?: string;
        },
    ) {
        const branch = (await this.branchRepo.findOne({
            where: { id: dto.branch_id },
            relations: ['branchBrands', 'branchBrands.brand'],
        })) as BranchWithBrands | null;
        if (!branch || !branch.branchBrands?.length)
            throw new NotFoundException('Branch not found');
        const firstBrand = branch.branchBrands[0]?.brand;
        const tenantId = firstBrand?.tenantId ?? null;
        if (tenantId == null) throw new NotFoundException('Branch not found');
        return this.ordersService.createOrder(
            dto,
            tenantId,
            null,
            'consumer_app',
        );
    }

    @Get('orders/:id/status')
    async getOrderStatus(@Param('id') id: string) {
        const order = await this.ordersService.findOne(+id);
        return {
            id: order.id,
            order_number: order.order_number,
            status: order.status,
            total_amount: order.total_amount,
        };
    }

    /** Get loyalty balance by phone (branch_id identifies tenant via branch’s brand). */
    @Get('loyalty/balance')
    async getLoyaltyBalance(
        @Query('branch_id') branchIdParam: string,
        @Query('phone') phone: string,
    ) {
        const branchId = branchIdParam ? +branchIdParam : undefined;
        if (!branchId || !phone?.trim())
            throw new NotFoundException('branch_id and phone are required');
        const branch = (await this.branchRepo.findOne({
            where: { id: branchId },
            relations: ['branchBrands', 'branchBrands.brand'],
        })) as BranchWithBrands | null;
        if (!branch?.branchBrands?.length)
            throw new NotFoundException('Branch not found');
        const tenantId = branch.branchBrands[0]?.brand?.tenantId ?? null;
        if (tenantId == null) throw new NotFoundException('Branch not found');
        const result = await this.loyaltyService.getBalanceByPhone(
            tenantId,
            phone.trim(),
        );
        return result ?? { balance: 0, displayName: 'Reward Points', spendPerPoint: 1000, cashValuePerPoint: 10, minOrderToEarn: 1, minOrderToRedeem: 1 };
    }
}
