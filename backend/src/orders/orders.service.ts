import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { OrderItemAddon } from '../entities/order-item-addon.entity';
import { OrderItemModifier } from '../entities/order-item-modifier.entity';
import { Branch } from '../entities/branch.entity';
import { Tenant } from '../entities/tenant.entity';
import { Discount } from '../entities/discount.entity';
import { MenuService } from '../menu/menu.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ShiftsService } from '../shifts/shifts.service';
import { CustomersService } from '../customers/customers.service';
import { InventoryConsumptionService } from '../inventory/inventory-consumption.service';
import { normalizePakistaniPhone } from '../utils/phone';
import { assertMenuItemAvailableForOrderType } from '../utils/menu-order-type';

@Injectable()
export class OrdersService {
    constructor(
        @InjectRepository(Order) private orderRepo: Repository<Order>,
        @InjectRepository(OrderItem)
        private orderItemRepo: Repository<OrderItem>,
        @InjectRepository(OrderItemAddon)
        private orderItemAddonRepo: Repository<OrderItemAddon>,
        @InjectRepository(OrderItemModifier)
        private orderItemModifierRepo: Repository<OrderItemModifier>,
        @InjectRepository(Branch) private branchRepo: Repository<Branch>,
        @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
        @InjectRepository(Discount) private discountRepo: Repository<Discount>,
        private menuService: MenuService,
        private loyaltyService: LoyaltyService,
        private shiftsService: ShiftsService,
        private customersService: CustomersService,
        private inventoryConsumptionService: InventoryConsumptionService,
        private dataSource: DataSource,
    ) {}

    async createOrder(
        dto: {
            branch_id: number;
            order_type: string;
            table_number?: string;
            customer_name?: string;
            customer_phone?: string;
            delivery_address?: string;
            items: Array<
                | {
                      menu_item_id: number;
                      quantity: number;
                      variant_id?: number;
                      addons?: { addon_id: number; quantity?: number }[];
                      modifiers?: { modifier_id: number; quantity?: number }[];
                      notes?: string;
                      branch_id?: number;
                  }
                | {
                      deal_menu_item_id: number;
                      quantity: number;
                      components: Array<{
                          slot_index: number;
                          menu_item_id: number;
                          quantity: number;
                          variant_id?: number;
                          addons?: { addon_id: number; quantity?: number }[];
                          modifiers?: {
                              modifier_id: number;
                              quantity?: number;
                          }[];
                          notes?: string;
                      }>;
                      branch_id?: number;
                  }
            >;
            notes?: string;
            discount_code?: string;
            /** Points to redeem as discount (requires customer_phone). */
            loyalty_points_to_redeem?: number;
            /** When set, must match normalized customer_phone for same tenant. */
            customer_id?: number;
            /** Optional drop-off coordinates (e.g. consumer map picker). */
            latitude?: number;
            longitude?: number;
            /** Optional branch coordinates snapshot (from client). */
            branch_latitude?: number;
            branch_longitude?: number;
        },
        tenantId: number,
        createdBy: number | null,
        source: 'pos' | 'consumer_app' | 'consumer_web' = 'pos',
    ) {
        const tenant = await this.tenantRepo.findOne({
            where: { id: tenantId },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        // Resolve branch per line (for multi-branch carts). Load all involved branches and their brands.
        // Note: we will expand deal items below, so use dto.items only for initial branch list.
        const lineBranchIds = dto.items.map(
            (line) =>
                (line as { branch_id?: number }).branch_id ?? dto.branch_id,
        );
        const uniqueBranchIds = [...new Set(lineBranchIds)];
        const branches = await this.branchRepo.find({
            where: uniqueBranchIds.map((id) => ({ id })),
            relations: ['branchBrands', 'branchBrands.brand'],
        });
        const branchMap = new Map<
            number,
            { branch: (typeof branches)[0]; brandIds: Set<number> }
        >();
        type BranchWithBrands = (typeof branches)[0] & {
            branchBrands?: Array<{ brandId: number; brand?: { id: number } }>;
        };
        for (const b of branches) {
            const raw = b as BranchWithBrands;
            const brandIds = new Set<number>(
                (raw.branchBrands ?? [])
                    .map((bb) => Number(bb.brandId ?? bb.brand?.id))
                    .filter((id: number) => Number.isFinite(id)),
            );
            branchMap.set(b.id, { branch: b, brandIds });
        }
        const primaryBranch = branchMap.get(dto.branch_id)?.branch;
        if (!primaryBranch) throw new NotFoundException('Branch not found');

        const expandedItems = await this.expandDealItems(
            dto.branch_id,
            dto.items,
            dto.order_type,
        );

        let customerPhoneNormalized: string | null = null;
        let explicitCustomerId: number | null = null;

        if (source === 'pos') {
            if (!dto.customer_name?.trim()) {
                throw new BadRequestException(
                    'Customer name is required for POS orders',
                );
            }
            if (!dto.customer_phone?.trim()) {
                throw new BadRequestException(
                    'Customer phone is required for POS orders (use Pakistani format: 03XXXXXXXXX)',
                );
            }
            customerPhoneNormalized = normalizePakistaniPhone(
                dto.customer_phone.trim(),
            );
            if (!customerPhoneNormalized) {
                throw new BadRequestException(
                    'Invalid Pakistani phone number. Use format: 03XXXXXXXXX (e.g. 03001234567)',
                );
            }
            if (dto.order_type === 'delivery') {
                if (!dto.delivery_address?.trim()) {
                    throw new BadRequestException(
                        'Delivery address is required for delivery orders',
                    );
                }
            }
            for (const bid of uniqueBranchIds) {
                const openShift =
                    await this.shiftsService.findOpenByBranch(bid);
                if (!openShift) {
                    throw new ForbiddenException(
                        `No shift is open for branch ID ${bid}. Open a shift in Admin → Shifts before placing POS orders.`,
                    );
                }
            }
        } else {
            if (dto.customer_phone?.trim()) {
                customerPhoneNormalized = normalizePakistaniPhone(
                    dto.customer_phone.trim(),
                );
                if (!customerPhoneNormalized) {
                    throw new BadRequestException(
                        'Invalid Pakistani phone number. Use format: 03XXXXXXXXX (e.g. 03001234567)',
                    );
                }
            }
            if ((dto.loyalty_points_to_redeem ?? 0) > 0) {
                if (!customerPhoneNormalized) {
                    throw new BadRequestException(
                        'customer_phone is required to redeem loyalty points',
                    );
                }
            }
            if (dto.customer_id != null) {
                if (!customerPhoneNormalized) {
                    throw new BadRequestException(
                        'customer_phone is required when customer_id is provided',
                    );
                }
                const cust = await this.customersService.findOne(
                    dto.customer_id,
                    tenantId,
                );
                if (cust.phone !== customerPhoneNormalized) {
                    throw new BadRequestException(
                        'customer_id does not match customer_phone',
                    );
                }
                explicitCustomerId = cust.id;
            }
        }

        const lineDetails: {
            menuItemId: number;
            categoryId: number;
            brandId: number;
            branchId: number;
            itemSubtotal: number;
        }[] = [];
        const itemBrandIds = new Set<number>();
        let subtotal = 0;
        type MenuItemWithAddons = {
            addons?: Array<{ id: number; price: number }>;
        };
        type ExpandedLine = (typeof expandedItems)[number];
        const orderItemInputs: {
            menuItem: MenuItemWithAddons;
            line: ExpandedLine;
            unitPrice: number;
            itemSubtotal: number;
            itemName: string;
            brandId: number;
            branchId: number;
        }[] = [];

        for (const line of expandedItems) {
            const lineBranchId = line.branch_id ?? dto.branch_id;
            const branchInfo = branchMap.get(lineBranchId);
            if (!branchInfo) continue;

            const menuItem = await this.menuService.findMenuItem(
                line.menu_item_id,
            );
            if (!menuItem) continue;
            assertMenuItemAvailableForOrderType(menuItem, dto.order_type);
            const menuItemBrandId = Number(
                (menuItem as { brandId?: number; brand?: { id: number } })
                    .brandId ??
                    (menuItem as { brand?: { id: number } }).brand?.id,
            );
            if (
                !Number.isFinite(menuItemBrandId) ||
                !branchInfo.brandIds.has(menuItemBrandId)
            )
                continue;

            let unitPrice: number;
            if (line.deal_unit_price !== undefined) {
                unitPrice = line.deal_unit_price;
            } else {
                unitPrice = await this.menuService.getEffectiveUnitPrice(
                    lineBranchId,
                    line.menu_item_id,
                );
            }
            if (line.variant_id) {
                const variant = menuItem.variants?.find(
                    (v) => v.id === line.variant_id,
                );
                if (variant) unitPrice += Number(variant.priceModifier);
            }
            const quantity = line.quantity ?? 1;
            let itemSubtotal = unitPrice * quantity;
            const itemName = menuItem.name;
            if (line.addons?.length) {
                for (const addonLine of line.addons) {
                    const addon = menuItem.addons?.find(
                        (a) => a.id === addonLine.addon_id,
                    );
                    if (addon)
                        itemSubtotal +=
                            Number(addon.price) * (addonLine.quantity ?? 1);
                }
            }
            const menuItemWithModifiers = menuItem as {
                modifierGroups?: Array<{
                    modifiers?: Array<{
                        id: number;
                        name: string;
                        price: number;
                    }>;
                }>;
            };
            if (
                line.modifiers?.length &&
                menuItemWithModifiers.modifierGroups
            ) {
                const allModifiers = (
                    menuItemWithModifiers.modifierGroups ?? []
                ).flatMap((mg) => mg.modifiers ?? []);
                for (const modLine of line.modifiers) {
                    const mod = allModifiers.find(
                        (m) => m.id === modLine.modifier_id,
                    );
                    if (mod)
                        itemSubtotal +=
                            Number(mod.price) * (modLine.quantity ?? 1);
                }
            }

            lineDetails.push({
                menuItemId: menuItem.id,
                categoryId: menuItem.categoryId,
                brandId: menuItemBrandId,
                branchId: lineBranchId,
                itemSubtotal,
            });
            itemBrandIds.add(menuItemBrandId);
            subtotal += itemSubtotal;
            orderItemInputs.push({
                menuItem,
                line,
                unitPrice,
                itemSubtotal,
                itemName,
                brandId: menuItemBrandId,
                branchId: lineBranchId,
            });
        }

        if (lineDetails.length === 0)
            throw new BadRequestException('No valid items in order');
        const orderBrandId =
            itemBrandIds.size === 1 ? [...itemBrandIds][0] : null;

        // Resolve discounts at full-cart level and allocate to each line (use primary branch for discount context)
        const auto = await this.resolveAutoDiscount(
            tenantId,
            subtotal,
            source,
            primaryBranch.id,
            orderBrandId,
            lineDetails,
        );
        const lineAuto = this.allocateDiscountToLines(
            lineDetails,
            subtotal,
            auto.discountAmount,
            auto.scope,
            auto.scopeIds,
            auto.discountableAmount,
            orderBrandId,
            auto.eligibilityBrandIds ?? null,
        );
        const afterAuto = subtotal - auto.discountAmount;
        const lineAfterAuto = lineDetails.map(
            (l, i) =>
                Math.round((l.itemSubtotal - (lineAuto[i] ?? 0)) * 100) / 100,
        );
        const coupon = await this.resolveCouponDiscount(
            tenantId,
            dto.discount_code?.trim() ?? null,
            afterAuto,
            source,
            primaryBranch.id,
            orderBrandId,
            lineDetails,
            lineAfterAuto,
        );
        const lineCoupon = this.allocateDiscountToLinesUsingBase(
            lineDetails,
            lineAfterAuto,
            afterAuto,
            coupon.discountAmount,
            coupon.scope,
            coupon.scopeIds,
            coupon.discountableAmount,
            orderBrandId,
            coupon.eligibilityBrandIds ?? null,
        );
        const combinedLineDiscount = lineDetails.map(
            (_, i) => (lineAuto[i] ?? 0) + (lineCoupon[i] ?? 0),
        );

        const taxRate = Number(tenant.defaultTaxRate) || 0;
        const serviceChargeRate = 0;
        const deliveryFeeTotal =
            dto.order_type === 'delivery'
                ? Number(primaryBranch.deliveryFlatFee) || 0
                : 0;
        const orderGroupId = randomUUID();

        // Group line indices by (branchId, brandId) so each branch receives its orders
        const groupKey = (branchId: number, brandId: number) =>
            `${branchId}-${brandId}`;
        const groupToIndices = new Map<string, number[]>();
        lineDetails.forEach((line, idx) => {
            const key = groupKey(line.branchId, line.brandId);
            if (!groupToIndices.has(key)) groupToIndices.set(key, []);
            groupToIndices.get(key)!.push(idx);
        });
        const sortedGroups = [...groupToIndices.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key]) => key);

        // Loyalty redeem: apply to first order in group for supported sources.
        let customerId: number | null = explicitCustomerId;
        if (customerId == null && customerPhoneNormalized) {
            const customer = await this.customersService.findByPhone(
                tenantId,
                customerPhoneNormalized,
            );
            if (customer) customerId = customer.id;
        }

        let loyaltyDiscountAmount = 0;
        let loyaltyPointsToRedeem = 0;
        const firstKey = sortedGroups[0];
        const firstIndices = groupToIndices.get(firstKey)!;
        const firstOrderSubtotal = firstIndices.reduce(
            (s, i) => s + lineDetails[i].itemSubtotal,
            0,
        );
        const firstOrderLineDiscount = firstIndices.reduce(
            (s, i) => s + (combinedLineDiscount[i] ?? 0),
            0,
        );
        const firstOrderAfterDiscount =
            Math.round((firstOrderSubtotal - firstOrderLineDiscount) * 100) /
            100;
        if (
            (source === 'pos' ||
                source === 'consumer_web' ||
                source === 'consumer_app') &&
            dto.customer_phone?.trim() &&
            (dto.loyalty_points_to_redeem ?? 0) > 0
        ) {
            const preview = await this.loyaltyService.getRedeemPreview(
                tenantId,
                customerPhoneNormalized ?? dto.customer_phone.trim(),
                firstOrderAfterDiscount,
            );
            if (preview) {
                loyaltyPointsToRedeem = Math.min(
                    dto.loyalty_points_to_redeem!,
                    preview.redeemablePoints,
                );
                loyaltyDiscountAmount =
                    loyaltyPointsToRedeem * preview.cashValuePerPoint;
                loyaltyDiscountAmount = Math.min(
                    loyaltyDiscountAmount,
                    firstOrderAfterDiscount,
                );
                loyaltyDiscountAmount =
                    Math.round(loyaltyDiscountAmount * 100) / 100;
                if (loyaltyDiscountAmount > 0) {
                    loyaltyPointsToRedeem = Math.floor(
                        loyaltyDiscountAmount / preview.cashValuePerPoint,
                    );
                } else {
                    loyaltyPointsToRedeem = 0;
                }
            }
        }

        // Pre-generate order numbers per branch (each branch gets sequential numbers)
        const ordersPerBranch = new Map<number, number>();
        for (const key of sortedGroups) {
            const [branchIdStr] = key.split('-');
            const branchId = Number(branchIdStr);
            ordersPerBranch.set(
                branchId,
                (ordersPerBranch.get(branchId) ?? 0) + 1,
            );
        }
        const orderNumbersByBranch = new Map<number, string[]>();
        for (const [branchId, count] of ordersPerBranch) {
            orderNumbersByBranch.set(
                branchId,
                await this.generateOrderNumbers(branchId, count),
            );
        }
        const branchOrderIndex = new Map<number, number>();

        const deliveryLatitude =
            dto.latitude != null && Number.isFinite(Number(dto.latitude))
                ? Number(dto.latitude)
                : null;
        const deliveryLongitude =
            dto.longitude != null && Number.isFinite(Number(dto.longitude))
                ? Number(dto.longitude)
                : null;

        const branchLatitude =
            dto.branch_latitude != null &&
            Number.isFinite(Number(dto.branch_latitude))
                ? Number(dto.branch_latitude)
                : null;
        const branchLongitude =
            dto.branch_longitude != null &&
            Number.isFinite(Number(dto.branch_longitude))
                ? Number(dto.branch_longitude)
                : null;

        const createdOrderIds: number[] = [];
        let deliveryFeeAssigned = false;
        let firstOrderIdForLoyalty: number | null = null;

        for (const key of sortedGroups) {
            const [branchIdStr, brandIdStr] = key.split('-');
            const branchId = Number(branchIdStr);
            const brandId = Number(brandIdStr);
            const indices = groupToIndices.get(key)!;
            const orderNumIdx = branchOrderIndex.get(branchId) ?? 0;
            const orderNumber =
                orderNumbersByBranch.get(branchId)![orderNumIdx];
            branchOrderIndex.set(branchId, orderNumIdx + 1);
            const brandSubtotal = indices.reduce(
                (s, i) => s + lineDetails[i].itemSubtotal,
                0,
            );
            const brandDiscountAmount = indices.reduce(
                (s, i) => s + (combinedLineDiscount[i] ?? 0),
                0,
            );
            const isFirstOrder = key === firstKey;
            let afterDiscount =
                Math.round((brandSubtotal - brandDiscountAmount) * 100) / 100;
            if (isFirstOrder && loyaltyDiscountAmount > 0) {
                afterDiscount =
                    Math.round((afterDiscount - loyaltyDiscountAmount) * 100) /
                    100;
            }
            const brandTax = Math.round(afterDiscount * taxRate * 100) / 100;
            const brandServiceCharge =
                Math.round(afterDiscount * serviceChargeRate * 100) / 100;
            const brandDeliveryFee =
                !deliveryFeeAssigned && deliveryFeeTotal > 0
                    ? deliveryFeeTotal
                    : 0;
            if (brandDeliveryFee > 0) deliveryFeeAssigned = true;
            const totalAmount =
                Math.round(
                    (afterDiscount +
                        brandTax +
                        brandServiceCharge +
                        brandDeliveryFee) *
                        100,
                ) / 100;
            const order = await this.orderRepo.save(
                this.orderRepo.create({
                    tenantId,
                    brandId,
                    orderGroupId,
                    branchId,
                    orderNumber,
                    orderType: dto.order_type,
                    tableNumber: dto.table_number ?? null,
                    customerName: dto.customer_name ?? null,
                    customerPhone:
                        customerPhoneNormalized ??
                        dto.customer_phone?.trim() ??
                        null,
                    customerId,
                    deliveryAddress: dto.delivery_address ?? null,
                    deliveryLatitude,
                    deliveryLongitude,
                    branchLatitude,
                    branchLongitude,
                    status: 'placed',
                    source,
                    notes: dto.notes ?? null,
                    subtotal: brandSubtotal,
                    discountAmount: brandDiscountAmount,
                    taxAmount: brandTax,
                    serviceCharge: brandServiceCharge,
                    deliveryFee: brandDeliveryFee,
                    totalAmount,
                    // Persist the user-entered discount code if provided, even if it ends up ineligible.
                    // This matches consumer expectations (they want to see what they tried to apply).
                    discountCode:
                        dto.discount_code?.trim() ||
                        coupon.discountCode ||
                        auto.discountCode ||
                        null,
                    discountId: coupon.discountId ?? auto.discountId ?? null,
                    loyaltyPointsRedeemed: isFirstOrder
                        ? loyaltyPointsToRedeem
                        : 0,
                    ...(createdBy != null && {
                        creator: { id: createdBy } as { id: number },
                    }),
                    placedAt: new Date(),
                }),
            );
            createdOrderIds.push(order.id);
            if (isFirstOrder && loyaltyPointsToRedeem > 0) {
                firstOrderIdForLoyalty = order.id;
            }

            const brandInputs = indices.map((i) => orderItemInputs[i]);
            for (const {
                menuItem,
                line,
                unitPrice,
                itemSubtotal,
                itemName,
                brandId: bid,
            } of brandInputs) {
                const orderItem = await this.orderItemRepo.save(
                    this.orderItemRepo.create({
                        orderId: order.id,
                        menuItemId: line.menu_item_id,
                        brandId: bid,
                        variantId: line.variant_id ?? null,
                        nameSnapshot: itemName,
                        priceSnapshot: unitPrice,
                        quantity: line.quantity ?? 1,
                        unitPrice,
                        subtotal: itemSubtotal,
                        notes: line.notes ?? null,
                        dealId: line.deal_id ?? null,
                        dealSlotIndex: line.deal_slot_index ?? null,
                    }),
                );
                if (line.addons?.length) {
                    for (const addonLine of line.addons) {
                        const addon = menuItem.addons?.find(
                            (a: { id: number; price: number }) =>
                                a.id === addonLine.addon_id,
                        );
                        if (addon) {
                            const addonQty = addonLine.quantity ?? 1;
                            await this.orderItemAddonRepo.save(
                                this.orderItemAddonRepo.create({
                                    orderItemId: orderItem.id,
                                    addonId: addon.id,
                                    quantity: addonQty,
                                    unitPrice: Number(addon.price),
                                    subtotal: Number(addon.price) * addonQty,
                                }),
                            );
                        }
                    }
                }
                const menuItemModGroups = (
                    menuItem as {
                        modifierGroups?: Array<{
                            modifiers?: Array<{
                                id: number;
                                name: string;
                                price: number;
                            }>;
                        }>;
                    }
                ).modifierGroups;
                const allMods = (menuItemModGroups ?? []).flatMap(
                    (mg) => mg.modifiers ?? [],
                );
                if (line.modifiers?.length && allMods.length > 0) {
                    for (const modLine of line.modifiers) {
                        const mod = allMods.find(
                            (m) => m.id === modLine.modifier_id,
                        );
                        if (mod) {
                            const qty = modLine.quantity ?? 1;
                            await this.orderItemModifierRepo.save(
                                this.orderItemModifierRepo.create({
                                    orderItemId: orderItem.id,
                                    modifierId: mod.id,
                                    nameSnapshot: mod.name,
                                    priceSnapshot: Number(mod.price),
                                    quantity: qty,
                                }),
                            );
                        }
                    }
                }
            }
        }

        if (
            firstOrderIdForLoyalty != null &&
            loyaltyPointsToRedeem > 0 &&
            customerPhoneNormalized
        ) {
            // Deduct inventory (FEFO) for all created orders before applying loyalty redemption,
            // so we never redeem points for an order that later fails stock deduction.
            try {
                for (const id of createdOrderIds) {
                    await this.inventoryConsumptionService.consumeForOrder(id);
                }
            } catch (e) {
                // Best-effort rollback: reverse any consumption already posted and cancel the created orders.
                for (const id of createdOrderIds) {
                    try {
                        await this.inventoryConsumptionService.reverseConsumptionForOrder(
                            id,
                            createdBy,
                        );
                    } catch {
                        void 0;
                    }
                    try {
                        await this.updateStatus(id, tenantId, 'cancelled');
                    } catch {
                        void 0;
                    }
                }
                throw e;
            }

            await this.loyaltyService.redeemForOrder(
                tenantId,
                customerPhoneNormalized,
                firstOrderIdForLoyalty,
                loyaltyPointsToRedeem,
                firstOrderAfterDiscount,
            );
        }

        // If no loyalty redemption block ran, still deduct inventory now.
        if (
            !(
                firstOrderIdForLoyalty != null &&
                loyaltyPointsToRedeem > 0 &&
                customerPhoneNormalized
            )
        ) {
            try {
                for (const id of createdOrderIds) {
                    await this.inventoryConsumptionService.consumeForOrder(id);
                }
            } catch (e) {
                for (const id of createdOrderIds) {
                    try {
                        await this.inventoryConsumptionService.reverseConsumptionForOrder(
                            id,
                            createdBy,
                        );
                    } catch {
                        void 0;
                    }
                    try {
                        await this.updateStatus(id, tenantId, 'cancelled');
                    } catch {
                        void 0;
                    }
                }
                throw e;
            }
        }

        const orders = await Promise.all(
            createdOrderIds.map((id) => this.findOne(id)),
        );
        const loyalty =
            customerPhoneNormalized != null
                ? await this.loyaltyService.getBalanceByPhone(
                      tenantId,
                      customerPhoneNormalized,
                  )
                : null;
        const loyaltyPointsBalance = loyalty?.balance ?? 0;
        return {
            order_group_id: orderGroupId,
            orders: orders.map((o) => ({
                ...o,
                loyalty_points_balance: loyaltyPointsBalance,
            })),
        };
    }

    async findOne(id: number) {
        const order = await this.orderRepo.findOne({
            where: { id },
            relations: [
                'orderItems',
                'orderItems.menuItem',
                'orderItems.menuItem.category',
                'orderItems.variant',
                'orderItems.addons',
                'orderItems.addons.addon',
                'orderItems.modifiers',
                'brand',
            ],
        });
        if (!order) throw new NotFoundException('Order not found');
        return {
            id: order.id,
            order_number: order.orderNumber,
            order_type: order.orderType,
            status: order.status,
            order_group_id: order.orderGroupId ?? null,
            brand_id: order.brandId ?? null,
            brand_name: order.brand?.name ?? null,
            subtotal: Number(order.subtotal),
            discount_amount: Number(order.discountAmount),
            tax_amount: Number(order.taxAmount),
            service_charge: Number(order.serviceCharge),
            delivery_fee: Number(order.deliveryFee),
            total_amount: Number(order.totalAmount),
            discount_code: order.discountCode,
            delivery_address: order.deliveryAddress ?? null,
            delivery_latitude:
                order.deliveryLatitude != null
                    ? Number(order.deliveryLatitude)
                    : null,
            delivery_longitude:
                order.deliveryLongitude != null
                    ? Number(order.deliveryLongitude)
                    : null,
            branch_latitude:
                order.branchLatitude != null
                    ? Number(order.branchLatitude)
                    : null,
            branch_longitude:
                order.branchLongitude != null
                    ? Number(order.branchLongitude)
                    : null,
            customer_latitude:
                order.deliveryLatitude != null
                    ? Number(order.deliveryLatitude)
                    : null,
            customer_longitude:
                order.deliveryLongitude != null
                    ? Number(order.deliveryLongitude)
                    : null,
            loyalty_points_redeemed: order.loyaltyPointsRedeemed ?? 0,
            items:
                order.orderItems?.map((oi) => ({
                    id: oi.id,
                    name_snapshot: oi.nameSnapshot ?? oi.menuItem?.name,
                    price_snapshot:
                        oi.priceSnapshot != null
                            ? Number(oi.priceSnapshot)
                            : Number(oi.unitPrice),
                    quantity: oi.quantity,
                    unit_price: Number(oi.unitPrice),
                    subtotal: Number(oi.subtotal),
                    notes: oi.notes ?? null,
                    deal_id: oi.dealId ?? null,
                    deal_slot_index: oi.dealSlotIndex ?? null,
                    variant_id: oi.variantId ?? null,
                    variant_name:
                        (oi.variant as { name?: string } | null)?.name ?? null,
                    category:
                        (oi.menuItem as { category?: { name: string } } | null)
                            ?.category?.name ?? null,
                    addons:
                        oi.addons?.map((a) => ({
                            id: a.id,
                            addon_id: a.addonId,
                            name:
                                (a.addon as { name?: string } | undefined)
                                    ?.name ?? null,
                            quantity: a.quantity,
                            unit_price: Number(a.unitPrice),
                            subtotal: Number(a.subtotal),
                        })) ?? [],
                    modifiers:
                        (
                            oi as {
                                modifiers?: Array<{
                                    nameSnapshot: string;
                                    priceSnapshot: number;
                                    quantity?: number | null;
                                }>;
                            }
                        ).modifiers?.map((m) => ({
                            name: m.nameSnapshot,
                            price: Number(m.priceSnapshot),
                            quantity:
                                (m as { quantity?: number | null }).quantity ??
                                1,
                        })) ?? [],
                })) ?? [],
        };
    }

    /** List orders for consumer by customer phone (order history). */
    async findByCustomerPhone(
        customerPhone: string,
        options?: {
            branchId?: number;
            tenantId?: number;
            limit?: number;
            sources?: Array<'consumer_app' | 'consumer_web'>;
        },
    ) {
        const normalized = normalizePakistaniPhone(
            typeof customerPhone === 'string' ? customerPhone.trim() : '',
        );
        if (!normalized)
            throw new BadRequestException('Valid phone is required');
        const qb = this.orderRepo
            .createQueryBuilder('o')
            .where('o.customerPhone = :phone', { phone: normalized })
            .orderBy('o.placedAt', 'DESC')
            .take(options?.limit ?? 50);
        const sources =
            options?.sources && options.sources.length > 0
                ? options.sources
                : ['consumer_app'];
        qb.andWhere('o.source IN (:...sources)', { sources });
        if (options?.tenantId != null)
            qb.andWhere('o.tenantId = :tenantId', {
                tenantId: options.tenantId,
            });
        if (options?.branchId != null)
            qb.andWhere('o.branchId = :branchId', {
                branchId: options.branchId,
            });
        const orders = await qb.getMany();
        return orders.map((o) => ({
            id: o.id,
            order_number: o.orderNumber,
            status: o.status,
            total_amount: Number(o.totalAmount),
            placed_at: o.placedAt?.toISOString() ?? null,
            branch_id: o.branchId,
            loyalty_points_redeemed: o.loyaltyPointsRedeemed ?? 0,
        }));
    }

    /** Get full order details for consumer; only if customerPhone matches. */
    async findOneByCustomerPhone(orderId: number, customerPhone: string) {
        const normalized = normalizePakistaniPhone(
            typeof customerPhone === 'string' ? customerPhone.trim() : '',
        );
        if (!normalized)
            throw new BadRequestException('Valid phone is required');
        const order = await this.orderRepo.findOne({
            where: { id: orderId },
            relations: [
                'orderItems',
                'orderItems.menuItem',
                'orderItems.menuItem.category',
                'orderItems.variant',
                'orderItems.addons',
                'orderItems.addons.addon',
                'brand',
                'payments',
            ],
        });
        if (!order) throw new NotFoundException('Order not found');
        if (order.customerPhone !== normalized)
            throw new NotFoundException('Order not found');
        return {
            id: order.id,
            order_number: order.orderNumber,
            order_type: order.orderType,
            status: order.status,
            order_group_id: order.orderGroupId ?? null,
            brand_id: order.brandId ?? null,
            brand_name: order.brand?.name ?? null,
            customer_id: order.customerId ?? null,
            subtotal: Number(order.subtotal),
            discount_amount: Number(order.discountAmount),
            tax_amount: Number(order.taxAmount),
            service_charge: Number(order.serviceCharge),
            delivery_fee: Number(order.deliveryFee),
            total_amount: Number(order.totalAmount),
            discount_code: order.discountCode,
            delivery_address: order.deliveryAddress ?? null,
            delivery_latitude:
                order.deliveryLatitude != null
                    ? Number(order.deliveryLatitude)
                    : null,
            delivery_longitude:
                order.deliveryLongitude != null
                    ? Number(order.deliveryLongitude)
                    : null,
            branch_latitude:
                order.branchLatitude != null
                    ? Number(order.branchLatitude)
                    : null,
            branch_longitude:
                order.branchLongitude != null
                    ? Number(order.branchLongitude)
                    : null,
            loyalty_points_redeemed: order.loyaltyPointsRedeemed ?? 0,
            placed_at: order.placedAt?.toISOString() ?? null,
            items:
                order.orderItems?.map((oi) => ({
                    id: oi.id,
                    name_snapshot: oi.nameSnapshot ?? oi.menuItem?.name,
                    price_snapshot:
                        oi.priceSnapshot != null
                            ? Number(oi.priceSnapshot)
                            : Number(oi.unitPrice),
                    quantity: oi.quantity,
                    unit_price: Number(oi.unitPrice),
                    subtotal: Number(oi.subtotal),
                    category:
                        (oi.menuItem as { category?: { name: string } } | null)
                            ?.category?.name ?? null,
                })) ?? [],
            payments: (order.payments ?? []).map((p) => ({
                id: p.id,
                payment_method: p.paymentMethod,
                amount: Number(p.amount),
                status: p.status,
                reference_number: p.referenceNumber ?? null,
                paid_at: p.paidAt?.toISOString() ?? null,
            })),
        };
    }

    /** Cancel order by consumer; only if phone matches and status is placed. */
    async cancelByCustomerPhone(orderId: number, customerPhone: string) {
        const normalized = normalizePakistaniPhone(
            typeof customerPhone === 'string' ? customerPhone.trim() : '',
        );
        if (!normalized)
            throw new BadRequestException('Valid phone is required');
        const order = await this.orderRepo.findOne({
            where: { id: orderId },
        });
        if (!order) throw new NotFoundException('Order not found');
        if (order.customerPhone !== normalized)
            throw new NotFoundException('Order not found');
        if (order.status !== 'placed')
            throw new BadRequestException(
                'Only orders with status "placed" can be cancelled',
            );
        await this.updateStatus(order.id, order.tenantId, 'cancelled');
        return { message: 'Order cancelled' };
    }

    /** Get all orders in a group (for viewing a customer's multi-brand order). */
    async getOrderGroup(orderGroupId: string) {
        const orders = await this.orderRepo.find({
            where: { orderGroupId },
            relations: [
                'brand',
                'orderItems',
                'orderItems.menuItem',
                'orderItems.menuItem.category',
                'orderItems.variant',
                'orderItems.addons',
                'orderItems.addons.addon',
                'orderItems.modifiers',
                'orderItems.modifiers.modifier',
            ],
            order: { id: 'ASC' },
        });
        if (orders.length === 0)
            throw new NotFoundException('Order group not found');
        return {
            order_group_id: orderGroupId,
            orders: orders.map((o) => ({
                id: o.id,
                order_number: o.orderNumber,
                brand_id: o.brandId,
                brand_name: o.brand?.name ?? null,
                status: o.status,
                subtotal: Number(o.subtotal),
                discount_amount: Number(o.discountAmount),
                tax_amount: Number(o.taxAmount),
                service_charge: Number(o.serviceCharge),
                delivery_fee: Number(o.deliveryFee),
                total_amount: Number(o.totalAmount),
                items:
                    o.orderItems?.map((oi) => ({
                        id: oi.id,
                        name_snapshot:
                            oi.nameSnapshot ??
                            (oi.menuItem as { name?: string } | null)?.name,
                        quantity: oi.quantity,
                        unit_price: Number(oi.unitPrice),
                        subtotal: Number(oi.subtotal),
                        deal_id: oi.dealId ?? null,
                        deal_slot_index: oi.dealSlotIndex ?? null,
                        variant_name:
                            (oi.variant as { name?: string } | null)?.name ??
                            null,
                        addons:
                            oi.addons?.map((a) => ({
                                name: (a.addon as { name?: string } | undefined)
                                    ?.name,
                                quantity: a.quantity,
                                unit_price: Number(a.unitPrice),
                                subtotal: Number(a.subtotal),
                            })) ?? [],
                        modifiers:
                            (
                                oi as {
                                    modifiers?: Array<{
                                        nameSnapshot: string | null;
                                        priceSnapshot: number | null;
                                        modifier?: {
                                            name?: string;
                                            price?: number;
                                        };
                                    }>;
                                }
                            ).modifiers?.map((m) => ({
                                name:
                                    m.nameSnapshot ??
                                    (
                                        m.modifier as
                                            | { name?: string }
                                            | undefined
                                    )?.name ??
                                    null,
                                unit_price:
                                    m.priceSnapshot != null
                                        ? Number(m.priceSnapshot)
                                        : Number(
                                              (
                                                  m.modifier as
                                                      | { price?: number }
                                                      | undefined
                                              )?.price ?? 0,
                                          ),
                            })) ?? [],
                        category:
                            (
                                oi.menuItem as {
                                    category?: { name: string };
                                } | null
                            )?.category?.name ?? null,
                    })) ?? [],
                loyalty_points_earned: o.loyaltyPointsEarned ?? 0,
                loyalty_points_redeemed: o.loyaltyPointsRedeemed ?? 0,
            })),
        };
    }

    /** Per-brand invoice: brand, category, item breakdown for one order. */
    async getOrderInvoice(orderId: number) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId },
            relations: [
                'brand',
                'branch',
                'orderItems',
                'orderItems.menuItem',
                'orderItems.menuItem.category',
                'orderItems.variant',
                'orderItems.addons',
                'orderItems.addons.addon',
                'orderItems.modifiers',
                'orderItems.modifiers.modifier',
            ],
        });
        if (!order) throw new NotFoundException('Order not found');
        const loyalty = order.customerPhone
            ? await this.loyaltyService.getBalanceByPhone(
                  order.tenantId,
                  order.customerPhone,
              )
            : null;
        const loyaltyBalance = loyalty?.balance ?? 0;
        return {
            order_id: order.id,
            order_number: order.orderNumber,
            order_group_id: order.orderGroupId ?? null,
            brand: order.brand
                ? { id: order.brand.id, name: order.brand.name }
                : null,
            branch: order.branch
                ? { id: order.branch.id, name: order.branch.name }
                : null,
            order_type: order.orderType,
            table_number: order.tableNumber,
            placed_at: order.placedAt?.toISOString() ?? null,
            items:
                order.orderItems?.map((oi) => ({
                    category:
                        (oi.menuItem as { category?: { name: string } } | null)
                            ?.category?.name ?? null,
                    name:
                        oi.nameSnapshot ??
                        (oi.menuItem as { name?: string } | null)?.name,
                    quantity: oi.quantity,
                    unit_price: Number(oi.unitPrice),
                    subtotal: Number(oi.subtotal),
                    deal_id: oi.dealId ?? null,
                    deal_slot_index: oi.dealSlotIndex ?? null,
                    variant_name:
                        (oi.variant as { name?: string } | null)?.name ?? null,
                    addons:
                        oi.addons?.map((a) => ({
                            name: (a.addon as { name?: string } | undefined)
                                ?.name,
                            quantity: a.quantity,
                            unit_price: Number(a.unitPrice),
                            subtotal: Number(a.subtotal),
                        })) ?? [],
                    modifiers:
                        (
                            oi as {
                                modifiers?: Array<{
                                    nameSnapshot: string | null;
                                    priceSnapshot: number | null;
                                    modifier?: {
                                        name?: string;
                                        price?: number;
                                    };
                                }>;
                            }
                        ).modifiers?.map((m) => ({
                            name:
                                m.nameSnapshot ??
                                (m.modifier as { name?: string } | undefined)
                                    ?.name ??
                                null,
                            unit_price:
                                m.priceSnapshot != null
                                    ? Number(m.priceSnapshot)
                                    : Number(
                                          (
                                              m.modifier as
                                                  | { price?: number }
                                                  | undefined
                                          )?.price ?? 0,
                                      ),
                        })) ?? [],
                })) ?? [],
            subtotal: Number(order.subtotal),
            discount_amount: Number(order.discountAmount),
            tax_amount: Number(order.taxAmount),
            service_charge: Number(order.serviceCharge),
            delivery_fee: Number(order.deliveryFee),
            total_amount: Number(order.totalAmount),
            loyalty_points_earned: order.loyaltyPointsEarned ?? 0,
            loyalty_points_redeemed: order.loyaltyPointsRedeemed ?? 0,
            loyalty_points_remaining: Number(loyaltyBalance ?? 0),
        };
    }

    /** Main customer-facing invoice: breakdown by brand plus gross total. */
    async getOrderGroupMainInvoice(orderGroupId: string) {
        const group = await this.getOrderGroup(orderGroupId);
        const firstOrder = await this.orderRepo.findOne({
            where: { orderGroupId },
            select: ['id', 'tenantId', 'customerPhone'],
        });
        const groupLoyalty = firstOrder?.customerPhone
            ? await this.loyaltyService.getBalanceByPhone(
                  firstOrder.tenantId,
                  firstOrder.customerPhone,
              )
            : null;
        const groupLoyaltyBalance = groupLoyalty?.balance ?? 0;
        const grossTotal = group.orders.reduce(
            (sum, o) => sum + Number(o.total_amount),
            0,
        );
        return {
            order_group_id: orderGroupId,
            orders: group.orders.map((o) => ({
                order_id: o.id,
                order_number: o.order_number,
                brand_name: o.brand_name,
                items: o.items,
                subtotal: o.subtotal,
                discount_amount: o.discount_amount,
                tax_amount: o.tax_amount,
                service_charge: o.service_charge,
                delivery_fee: o.delivery_fee,
                total_amount: o.total_amount,
                loyalty_points_earned:
                    (o as { loyalty_points_earned?: number })
                        .loyalty_points_earned ?? 0,
                loyalty_points_redeemed:
                    (o as { loyalty_points_redeemed?: number })
                        .loyalty_points_redeemed ?? 0,
                loyalty_points_remaining: Number(groupLoyaltyBalance ?? 0),
            })),
            gross_total: Math.round(grossTotal * 100) / 100,
            loyalty_points_remaining: Number(groupLoyaltyBalance ?? 0),
        };
    }

    async updateStatus(
        id: number,
        tenantId: number | null,
        status: string,
        allowedBranchIds?: number[] | null,
    ) {
        const order = await this.orderRepo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
        });
        if (!order) throw new NotFoundException('Order not found');
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            !allowedBranchIds.includes(order.branchId)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }

        const wasCompleted = order.status === 'completed';
        if (wasCompleted && status !== 'completed') {
            await this.loyaltyService.revokeEarnedPoints(id);
            order.completedAt = null;
        }

        order.status = status;
        if (status === 'completed') {
            order.completedAt = new Date();
            await this.orderRepo.save(order);
            await this.loyaltyService.earnOnOrderComplete(id);
            await this.shiftsService.addCompletedOrderAmount(
                order.branchId,
                Number(order.totalAmount),
            );
        } else if (status === 'cancelled') {
            order.cancelledAt = new Date();
            await this.orderRepo.save(order);
            // Reverse inventory consumption allocations (if any).
            try {
                await this.inventoryConsumptionService.reverseConsumptionForOrder(
                    order.id,
                    null,
                );
            } catch {
                void 0;
            }
        } else {
            await this.orderRepo.save(order);
        }
        return this.findForAdmin(id, tenantId);
    }

    async findForAdmin(
        id: number,
        tenantId: number | null,
        allowedBranchIds?: number[] | null,
    ) {
        const order = await this.orderRepo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
            relations: [
                'branch',
                'brand',
                'creator',
                'rider',
                'orderItems',
                'orderItems.menuItem',
                'orderItems.variant',
                'orderItems.addons',
                'orderItems.addons.addon',
                'orderItems.modifiers',
                'orderItems.modifiers.modifier',
                'payments',
            ],
        });
        if (
            order &&
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            !allowedBranchIds.includes(order.branchId)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        if (!order) throw new NotFoundException('Order not found');
        return {
            id: order.id,
            order_number: order.orderNumber,
            order_type: order.orderType,
            order_group_id: order.orderGroupId ?? null,
            table_number: order.tableNumber,
            customer_name: order.customerName,
            customer_phone: order.customerPhone,
            delivery_address: order.deliveryAddress,
            status: order.status,
            rider_id: order.riderId ?? null,
            rider: order.rider
                ? { id: order.rider.id, name: order.rider.name }
                : null,
            delivery_status: order.deliveryStatus ?? null,
            delivery_failed_reason: order.deliveryFailedReason ?? null,
            source: order.source,
            subtotal: Number(order.subtotal),
            discount_amount: Number(order.discountAmount),
            discount_code: order.discountCode,
            loyalty_points_earned: order.loyaltyPointsEarned ?? 0,
            loyalty_points_redeemed: order.loyaltyPointsRedeemed ?? 0,
            tax_amount: Number(order.taxAmount),
            service_charge: Number(order.serviceCharge),
            delivery_fee: Number(order.deliveryFee),
            total_amount: Number(order.totalAmount),
            placed_at: order.placedAt?.toISOString() ?? null,
            completed_at: order.completedAt?.toISOString() ?? null,
            branch: order.branch
                ? {
                      id: order.branch.id,
                      name: order.branch.name,
                      code: order.branch.code,
                  }
                : null,
            brand: order.brand
                ? { id: order.brand.id, name: order.brand.name }
                : null,
            creator: order.creator
                ? { id: order.creator.id, name: order.creator.name }
                : null,
            brand_id: order.brandId ?? null,
            items:
                order.orderItems?.map((oi) => ({
                    id: oi.id,
                    brand_id: oi.brandId ?? null,
                    name_snapshot: oi.nameSnapshot ?? oi.menuItem?.name,
                    price_snapshot:
                        oi.priceSnapshot != null
                            ? Number(oi.priceSnapshot)
                            : Number(oi.unitPrice),
                    quantity: oi.quantity,
                    unit_price: Number(oi.unitPrice),
                    subtotal: Number(oi.subtotal),
                    notes: oi.notes,
                    variant_id: oi.variantId ?? null,
                    variant_name:
                        (oi as { variant?: { name: string } }).variant?.name ??
                        null,
                    addons:
                        oi.addons?.map((a) => ({
                            name: a.addon?.name,
                            unit_price: Number(a.unitPrice),
                            quantity: a.quantity,
                            subtotal: Number(a.subtotal),
                        })) ?? [],
                    modifiers:
                        (
                            oi as {
                                modifiers?: Array<{
                                    nameSnapshot: string | null;
                                    priceSnapshot: number | null;
                                    modifier?: {
                                        name?: string;
                                        price?: number;
                                    };
                                }>;
                            }
                        ).modifiers?.map((m) => ({
                            name:
                                m.nameSnapshot ??
                                (m.modifier as { name?: string } | undefined)
                                    ?.name ??
                                null,
                            unit_price:
                                m.priceSnapshot != null
                                    ? Number(m.priceSnapshot)
                                    : Number(
                                          (
                                              m.modifier as
                                                  | { price?: number }
                                                  | undefined
                                          )?.price ?? 0,
                                      ),
                        })) ?? [],
                })) ?? [],
            payments:
                order.payments?.map((p) => ({
                    id: p.id,
                    method: p.paymentMethod,
                    amount: Number(p.amount),
                    status: p.status,
                    paid_at: p.paidAt?.toISOString() ?? null,
                })) ?? [],
        };
    }

    async findAllAdmin(
        tenantId: number | null,
        filters: {
            branch_id?: number;
            status?: string;
            date_from?: string;
            date_to?: string;
            has_rider?: boolean;
        },
        allowedBranchIds?: number[] | null,
    ) {
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            filters.branch_id != null &&
            !allowedBranchIds.includes(filters.branch_id)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }

        const qb = this.orderRepo
            .createQueryBuilder('o')
            .leftJoinAndSelect('o.branch', 'b')
            .leftJoinAndSelect('o.brand', 'brand')
            .leftJoinAndSelect('o.creator', 'c')
            .leftJoinAndSelect('o.rider', 'rider')
            .leftJoinAndSelect('o.orderItems', 'oi')
            .leftJoinAndSelect('oi.menuItem', 'mi')
            .orderBy('o.createdAt', 'DESC')
            .take(50);

        if (tenantId != null)
            qb.andWhere('o.tenantId = :tenantId', { tenantId });
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            qb.andWhere('o.branchId IN (:...allowedBranchIds)', {
                allowedBranchIds,
            });
        }
        if (filters.branch_id)
            qb.andWhere('o.branchId = :branchId', {
                branchId: filters.branch_id,
            });
        if (filters.status)
            qb.andWhere('o.status = :status', { status: filters.status });
        if (filters.date_from)
            qb.andWhere('date(o.placed_at) >= :dateFrom', {
                dateFrom: filters.date_from,
            });
        if (filters.date_to)
            qb.andWhere('date(o.placed_at) <= :dateTo', {
                dateTo: filters.date_to,
            });
        if (filters.has_rider === true) qb.andWhere('o.riderId IS NOT NULL');

        return qb.getMany();
    }

    /** List users with Rider role for the tenant (from branch_users for tenant's branches). */
    async listRiders(tenantId: number) {
        const rows: Array<{
            id: number;
            name: string;
            email: string | null;
            phone: string | null;
        }> = await this.dataSource.query(
            `SELECT DISTINCT u.id, u.name, u.email, u.phone
             FROM users u
             INNER JOIN branch_users bu ON bu.user_id = u.id
             INNER JOIN roles r ON r.id = bu.role_id AND r.slug = 'rider'
             INNER JOIN branches b ON b.id = bu.branch_id
             INNER JOIN branch_brands bb ON bb.branch_id = b.id
             INNER JOIN brands br ON br.id = bb.brand_id AND br.tenant_id = $1
             WHERE u.status = 'active'
             ORDER BY u.name`,
            [tenantId],
        );
        return rows;
    }

    /** Assign a rider to an order. Admin only. */
    async assignRider(
        orderId: number,
        tenantId: number,
        riderId: number,
        allowedBranchIds?: number[] | null,
    ) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId, tenantId },
        });
        if (!order) throw new NotFoundException('Order not found');
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            !allowedBranchIds.includes(order.branchId)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        const riders = await this.listRiders(tenantId);
        if (!riders.some((r) => r.id === riderId)) {
            throw new BadRequestException('Invalid rider for this tenant');
        }
        order.riderId = riderId;
        order.deliveryStatus = 'accepted';
        order.deliveryFailedReason = null;
        await this.orderRepo.save(order);
        return this.findForAdmin(orderId, tenantId, allowedBranchIds);
    }

    /** Change rider only while delivery_status is still 'accepted' (rider has not yet picked up). */
    async changeRider(
        orderId: number,
        tenantId: number,
        riderId: number,
        allowedBranchIds?: number[] | null,
    ) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId, tenantId },
        });
        if (!order) throw new NotFoundException('Order not found');
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            !allowedBranchIds.includes(order.branchId)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        if (order.deliveryStatus !== 'accepted') {
            throw new BadRequestException(
                'Rider can only be changed before they have picked up the order',
            );
        }
        const riders = await this.listRiders(tenantId);
        if (!riders.some((r) => r.id === riderId)) {
            throw new BadRequestException('Invalid rider for this tenant');
        }
        order.riderId = riderId;
        await this.orderRepo.save(order);
        return this.findForAdmin(orderId, tenantId, allowedBranchIds);
    }

    /** Assign the same rider to all orders in a group. Admin only. */
    async assignRiderToGroup(
        orderGroupId: string,
        tenantId: number,
        riderId: number,
        allowedBranchIds?: number[] | null,
    ) {
        const riders = await this.listRiders(tenantId);
        if (!riders.some((r) => r.id === riderId)) {
            throw new BadRequestException('Invalid rider for this tenant');
        }
        const orders = await this.orderRepo.find({
            where: { orderGroupId, tenantId },
        });
        if (orders.length === 0) {
            throw new NotFoundException('Order group not found');
        }
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            const notAllowed = orders.filter(
                (o) => !allowedBranchIds.includes(o.branchId),
            );
            if (notAllowed.length > 0) {
                throw new ForbiddenException(
                    'You do not have access to some orders in this group',
                );
            }
        }
        for (const order of orders) {
            order.riderId = riderId;
            order.deliveryStatus = 'accepted';
            order.deliveryFailedReason = null;
            await this.orderRepo.save(order);
        }
        return {
            order_group_id: orderGroupId,
            updated_count: orders.length,
            orders: await Promise.all(
                orders.map((o) =>
                    this.findForAdmin(o.id, tenantId, allowedBranchIds),
                ),
            ),
        };
    }

    /** Change rider for entire group only while all orders have delivery_status 'accepted' (not yet picked up). */
    async changeRiderForGroup(
        orderGroupId: string,
        tenantId: number,
        riderId: number,
        allowedBranchIds?: number[] | null,
    ) {
        const orders = await this.orderRepo.find({
            where: { orderGroupId, tenantId },
        });
        if (orders.length === 0) {
            throw new NotFoundException('Order group not found');
        }
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            const notAllowed = orders.filter(
                (o) => !allowedBranchIds.includes(o.branchId),
            );
            if (notAllowed.length > 0) {
                throw new ForbiddenException(
                    'You do not have access to some orders in this group',
                );
            }
        }
        const notAccepted = orders.filter(
            (o) => o.deliveryStatus !== 'accepted',
        );
        if (notAccepted.length > 0) {
            throw new BadRequestException(
                'Rider can only be changed for the group before any order has been picked up by the rider',
            );
        }
        const riders = await this.listRiders(tenantId);
        if (!riders.some((r) => r.id === riderId)) {
            throw new BadRequestException('Invalid rider for this tenant');
        }
        for (const order of orders) {
            order.riderId = riderId;
            await this.orderRepo.save(order);
        }
        return {
            order_group_id: orderGroupId,
            updated_count: orders.length,
        };
    }

    /** Orders assigned to this rider (for rider app). */
    async findAllForRider(riderUserId: number) {
        const orders = await this.orderRepo.find({
            where: { riderId: riderUserId },
            relations: [
                'branch',
                'brand',
                'orderItems',
                'orderItems.menuItem',
                'orderItems.addons',
                'orderItems.addons.addon',
            ],
            order: { placedAt: 'DESC' },
        });
        return orders.map((o) => ({
            id: o.id,
            order_number: o.orderNumber,
            order_group_id: o.orderGroupId ?? null,
            status: o.status,
            delivery_status: o.deliveryStatus ?? null,
            delivery_failed_reason: o.deliveryFailedReason ?? null,
            customer_name: o.customerName,
            customer_phone: o.customerPhone,
            delivery_address: o.deliveryAddress,
            delivery_latitude:
                o.deliveryLatitude != null ? Number(o.deliveryLatitude) : null,
            delivery_longitude:
                o.deliveryLongitude != null
                    ? Number(o.deliveryLongitude)
                    : null,
            branch_latitude:
                o.branchLatitude != null ? Number(o.branchLatitude) : null,
            branch_longitude:
                o.branchLongitude != null ? Number(o.branchLongitude) : null,
            placed_at: o.placedAt?.toISOString() ?? null,
            total_amount: Number(o.totalAmount),
            branch: o.branch
                ? {
                      id: o.branch.id,
                      name: o.branch.name,
                      address: o.branch.address,
                      // Backward-compatible keys (existing clients may use them)
                      latitude:
                          o.branch.latitude != null
                              ? Number(o.branch.latitude)
                              : null,
                      longitude:
                          o.branch.longitude != null
                              ? Number(o.branch.longitude)
                              : null,
                  }
                : null,
            brand_name: o.brand?.name ?? null,
            items:
                o.orderItems?.map((oi) => ({
                    id: oi.id,
                    name_snapshot: oi.nameSnapshot ?? oi.menuItem?.name,
                    quantity: oi.quantity,
                    unit_price: Number(oi.unitPrice),
                })) ?? [],
        }));
    }

    /** Single order for rider (must be assigned to them). */
    async findForRider(orderId: number, riderUserId: number) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId, riderId: riderUserId },
            relations: [
                'branch',
                'brand',
                'orderItems',
                'orderItems.menuItem',
                'orderItems.addons',
                'orderItems.addons.addon',
            ],
        });
        if (!order) throw new NotFoundException('Order not found');
        return {
            id: order.id,
            order_number: order.orderNumber,
            order_group_id: order.orderGroupId ?? null,
            status: order.status,
            delivery_status: order.deliveryStatus ?? null,
            delivery_failed_reason: order.deliveryFailedReason ?? null,
            customer_name: order.customerName,
            customer_phone: order.customerPhone,
            delivery_address: order.deliveryAddress,
            delivery_latitude:
                order.deliveryLatitude != null
                    ? Number(order.deliveryLatitude)
                    : null,
            delivery_longitude:
                order.deliveryLongitude != null
                    ? Number(order.deliveryLongitude)
                    : null,
            branch_latitude:
                order.branchLatitude != null
                    ? Number(order.branchLatitude)
                    : null,
            branch_longitude:
                order.branchLongitude != null
                    ? Number(order.branchLongitude)
                    : null,
            placed_at: order.placedAt?.toISOString() ?? null,
            total_amount: Number(order.totalAmount),
            branch: order.branch
                ? {
                      id: order.branch.id,
                      name: order.branch.name,
                      address: order.branch.address,
                      // Backward-compatible keys (existing clients may use them)
                      latitude:
                          order.branch.latitude != null
                              ? Number(order.branch.latitude)
                              : null,
                      longitude:
                          order.branch.longitude != null
                              ? Number(order.branch.longitude)
                              : null,
                  }
                : null,
            brand_name: order.brand?.name ?? null,
            items:
                order.orderItems?.map((oi) => ({
                    id: oi.id,
                    name_snapshot: oi.nameSnapshot ?? oi.menuItem?.name,
                    quantity: oi.quantity,
                    unit_price: Number(oi.unitPrice),
                    addons:
                        oi.addons?.map((a) => ({
                            name: a.addon?.name,
                            quantity: a.quantity,
                        })) ?? [],
                })) ?? [],
        };
    }

    /** Rider updates delivery status. Allowed: accepted, picked_up, delivered, delivery_failed (reason required). */
    async updateDeliveryStatus(
        orderId: number,
        riderUserId: number,
        deliveryStatus: string,
        deliveryFailedReason?: string | null,
    ) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId, riderId: riderUserId },
        });
        if (!order) throw new NotFoundException('Order not found');
        const allowed = [
            'accepted',
            'picked_up',
            'delivered',
            'delivery_failed',
        ];
        if (!allowed.includes(deliveryStatus)) {
            throw new BadRequestException(
                `Invalid delivery status. Allowed: ${allowed.join(', ')}`,
            );
        }
        if (deliveryStatus === 'delivery_failed') {
            const reason =
                typeof deliveryFailedReason === 'string'
                    ? deliveryFailedReason.trim()
                    : '';
            if (!reason) {
                throw new BadRequestException(
                    'Delivery failed reason is required',
                );
            }
            order.deliveryFailedReason = reason;
        } else {
            order.deliveryFailedReason = null;
        }
        order.deliveryStatus = deliveryStatus;
        if (deliveryStatus === 'delivered') {
            order.status = 'completed';
            order.completedAt = new Date();
            await this.orderRepo.save(order);
            await this.loyaltyService.earnOnOrderComplete(order.id);
            await this.shiftsService.addCompletedOrderAmount(
                order.branchId,
                Number(order.totalAmount),
            );
        } else {
            await this.orderRepo.save(order);
        }
        return this.findForRider(orderId, riderUserId);
    }

    /**
     * Quote/preview: same calculation as createOrder but no persistence.
     * Returns original amount (subtotal), discount_amount, tax, service_charge, delivery_fee, total_amount.
     */
    async quote(
        dto: {
            branch_id: number;
            order_type: string;
            items: {
                menu_item_id: number;
                quantity: number;
                variant_id?: number;
                addons?: { addon_id: number; quantity?: number }[];
                modifiers?: { modifier_id: number; quantity?: number }[];
            }[];
            discount_code?: string;
            customer_phone?: string;
            loyalty_points_to_redeem?: number;
        },
        tenantId: number,
        source: 'pos' | 'consumer_app' | 'consumer_web' = 'pos',
    ) {
        const branch = await this.branchRepo.findOne({
            where: { id: dto.branch_id },
            relations: ['branchBrands', 'branchBrands.brand'],
        });
        type BranchWithBrands = Branch & { branchBrands?: unknown[] };
        if (!branch || !(branch as BranchWithBrands).branchBrands?.length)
            throw new NotFoundException('Branch not found');
        const tenant = await this.tenantRepo.findOne({
            where: { id: tenantId },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const expandedQuoteItems = await this.expandDealItems(
            dto.branch_id,
            dto.items as Array<
                | {
                      menu_item_id: number;
                      quantity?: number;
                      variant_id?: number;
                      addons?: { addon_id: number; quantity?: number }[];
                      modifiers?: { modifier_id: number; quantity?: number }[];
                      branch_id?: number;
                  }
                | {
                      deal_menu_item_id: number;
                      quantity?: number;
                      components: Array<{
                          slot_index: number;
                          menu_item_id: number;
                          quantity?: number;
                          variant_id?: number;
                          addons?: { addon_id: number; quantity?: number }[];
                          modifiers?: {
                              modifier_id: number;
                              quantity?: number;
                          }[];
                      }>;
                      branch_id?: number;
                  }
            >,
            dto.order_type,
        );
        const { subtotal, lineDetails, orderBrandId } =
            await this.computeSubtotalAndLinesWithBrands(
                dto.branch_id,
                expandedQuoteItems,
                dto.order_type,
            );

        const auto = await this.resolveAutoDiscount(
            tenantId,
            subtotal,
            source,
            branch.id,
            orderBrandId,
            lineDetails,
        );
        const lineAuto = this.allocateDiscountToLines(
            lineDetails,
            subtotal,
            auto.discountAmount,
            auto.scope,
            auto.scopeIds,
            auto.discountableAmount,
            orderBrandId,
            auto.eligibilityBrandIds ?? null,
        );
        const afterAuto = subtotal - auto.discountAmount;
        const lineAfterAuto = lineDetails.map(
            (l, i) =>
                Math.round((l.itemSubtotal - (lineAuto[i] ?? 0)) * 100) / 100,
        );
        const coupon = await this.resolveCouponDiscount(
            tenantId,
            dto.discount_code?.trim() ?? null,
            afterAuto,
            source,
            branch.id,
            orderBrandId,
            lineDetails,
            lineAfterAuto,
        );
        const lineCoupon = this.allocateDiscountToLinesUsingBase(
            lineDetails,
            lineAfterAuto,
            afterAuto,
            coupon.discountAmount,
            coupon.scope,
            coupon.scopeIds,
            coupon.discountableAmount,
            orderBrandId,
            coupon.eligibilityBrandIds ?? null,
        );
        const totalDiscount = auto.discountAmount + coupon.discountAmount;
        const combinedLineDiscount = lineDetails.map(
            (_, i) => (lineAuto[i] ?? 0) + (lineCoupon[i] ?? 0),
        );

        let afterDiscount = subtotal - totalDiscount;
        let loyaltyDiscount = 0;
        let loyaltyPointsRedeemed = 0;
        if (
            (source === 'pos' ||
                source === 'consumer_web' ||
                source === 'consumer_app') &&
            dto.customer_phone?.trim() &&
            (dto.loyalty_points_to_redeem ?? 0) > 0
        ) {
            const normalized = normalizePakistaniPhone(
                dto.customer_phone.trim(),
            );
            if (normalized) {
                const preview = await this.loyaltyService.getRedeemPreview(
                    tenantId,
                    normalized,
                    afterDiscount,
                );
                if (preview) {
                    loyaltyPointsRedeemed = Math.min(
                        dto.loyalty_points_to_redeem!,
                        preview.redeemablePoints,
                    );
                    loyaltyDiscount =
                        loyaltyPointsRedeemed * preview.cashValuePerPoint;
                    loyaltyDiscount = Math.min(loyaltyDiscount, afterDiscount);
                    loyaltyDiscount = Math.round(loyaltyDiscount * 100) / 100;
                    afterDiscount =
                        Math.round((afterDiscount - loyaltyDiscount) * 100) /
                        100;
                }
            }
        }
        const taxRate = Number(tenant.defaultTaxRate) || 0;
        const serviceChargeRate = 0;
        const taxAmount = Math.round(afterDiscount * taxRate * 100) / 100;
        const serviceCharge =
            Math.round(afterDiscount * serviceChargeRate * 100) / 100;
        const deliveryFee =
            dto.order_type === 'delivery'
                ? Number(branch.deliveryFlatFee) || 0
                : 0;
        const totalAmount =
            Math.round(
                (afterDiscount + taxAmount + serviceCharge + deliveryFee) * 100,
            ) / 100;

        const line_breakdown = lineDetails.map((line, i) => ({
            menu_item_id: line.menuItemId,
            brand_id: (line as { brandId?: number }).brandId ?? null,
            subtotal: line.itemSubtotal,
            discount_amount: combinedLineDiscount[i] ?? 0,
            after_discount:
                Math.round(
                    (line.itemSubtotal - (combinedLineDiscount[i] ?? 0)) * 100,
                ) / 100,
        }));

        return {
            subtotal,
            auto_discount_amount: auto.discountAmount,
            coupon_discount_amount: coupon.discountAmount,
            discount_amount: totalDiscount,
            discount_code: coupon.discountCode ?? null,
            loyalty_discount: loyaltyDiscount,
            loyalty_points_redeemed: loyaltyPointsRedeemed,
            tax_amount: taxAmount,
            service_charge: serviceCharge,
            delivery_fee: deliveryFee,
            total_amount: totalAmount,
            line_breakdown,
        };
    }

    private async expandDealItems(
        defaultBranchId: number,
        items: Array<
            | {
                  menu_item_id: number;
                  quantity?: number;
                  variant_id?: number;
                  addons?: { addon_id: number; quantity?: number }[];
                  modifiers?: { modifier_id: number; quantity?: number }[];
                  notes?: string;
                  branch_id?: number;
              }
            | {
                  deal_menu_item_id: number;
                  quantity?: number;
                  components: Array<{
                      slot_index: number;
                      menu_item_id: number;
                      quantity?: number;
                      variant_id?: number;
                      addons?: { addon_id: number; quantity?: number }[];
                      modifiers?: { modifier_id: number; quantity?: number }[];
                      notes?: string;
                  }>;
                  branch_id?: number;
              }
        >,
        orderType: string,
    ): Promise<
        Array<{
            menu_item_id: number;
            quantity: number;
            variant_id?: number;
            addons?: { addon_id: number; quantity?: number }[];
            modifiers?: { modifier_id: number; quantity?: number }[];
            notes?: string;
            branch_id?: number;
            deal_id?: number;
            deal_slot_index?: number;
            deal_unit_price?: number;
        }>
    > {
        const expanded: Array<{
            menu_item_id: number;
            quantity: number;
            variant_id?: number;
            addons?: { addon_id: number; quantity?: number }[];
            modifiers?: { modifier_id: number; quantity?: number }[];
            notes?: string;
            branch_id?: number;
            deal_id?: number;
            deal_slot_index?: number;
            deal_unit_price?: number;
        }> = [];
        for (const line of items) {
            const raw = line as {
                deal_menu_item_id?: number;
                quantity?: number;
                components?: Array<{
                    slot_index: number;
                    menu_item_id: number;
                    quantity?: number;
                    variant_id?: number;
                    addons?: { addon_id: number; quantity?: number }[];
                    modifiers?: { modifier_id: number; quantity?: number }[];
                    notes?: string;
                }>;
                branch_id?: number;
            };
            if (raw.deal_menu_item_id != null && raw.components?.length) {
                const dealRoot = await this.menuService.findMenuItem(
                    raw.deal_menu_item_id,
                );
                if (dealRoot) {
                    assertMenuItemAvailableForOrderType(dealRoot, orderType);
                }
                for (const comp of raw.components) {
                    const compItem = await this.menuService.findMenuItem(
                        comp.menu_item_id,
                    );
                    if (compItem) {
                        assertMenuItemAvailableForOrderType(
                            compItem,
                            orderType,
                        );
                    }
                }
                const branchId = raw.branch_id ?? defaultBranchId;
                const dealPrice = await this.menuService.getEffectiveUnitPrice(
                    branchId,
                    raw.deal_menu_item_id,
                );
                const qty = raw.quantity ?? 1;
                for (let q = 0; q < qty; q++) {
                    raw.components.forEach((comp, idx) => {
                        expanded.push({
                            menu_item_id: comp.menu_item_id,
                            quantity: comp.quantity ?? 1,
                            variant_id: comp.variant_id,
                            addons: comp.addons,
                            modifiers: comp.modifiers,
                            notes: comp.notes,
                            branch_id: raw.branch_id ?? defaultBranchId,
                            deal_id: raw.deal_menu_item_id,
                            deal_slot_index: comp.slot_index,
                            deal_unit_price: idx === 0 ? dealPrice : 0,
                        });
                    });
                }
            } else {
                const normal = line as {
                    menu_item_id: number;
                    quantity?: number;
                    variant_id?: number;
                    addons?: { addon_id: number; quantity?: number }[];
                    modifiers?: { modifier_id: number; quantity?: number }[];
                    notes?: string;
                    branch_id?: number;
                };
                expanded.push({
                    menu_item_id: normal.menu_item_id,
                    quantity: normal.quantity ?? 1,
                    variant_id: normal.variant_id,
                    addons: normal.addons,
                    modifiers: normal.modifiers,
                    notes: normal.notes,
                    branch_id: normal.branch_id,
                });
            }
        }
        return expanded;
    }

    /** Compute subtotal and line details; derive orderBrandId from items (single brand or null for multi-brand). */
    private async computeSubtotalAndLinesWithBrands(
        branchId: number,
        items: Array<{
            menu_item_id: number;
            quantity: number;
            variant_id?: number;
            addons?: { addon_id: number; quantity?: number }[];
            modifiers?: { modifier_id: number; quantity?: number }[];
            deal_unit_price?: number;
        }>,
        orderType: string,
    ): Promise<{
        subtotal: number;
        lineDetails: {
            menuItemId: number;
            categoryId: number;
            brandId: number;
            itemSubtotal: number;
        }[];
        orderBrandId: number | null;
    }> {
        const branch = (await this.branchRepo.findOne({
            where: { id: branchId },
            relations: ['branchBrands'],
        })) as
            | (Branch & {
                  branchBrands?: Array<{
                      brandId: number;
                      brand?: { id: number };
                  }>;
              })
            | null;
        const branchBrandIds = new Set(
            (branch?.branchBrands ?? [])
                .map((bb) => Number(bb.brandId ?? bb.brand?.id))
                .filter((id: number) => Number.isFinite(id)),
        );
        const lineDetails: {
            menuItemId: number;
            categoryId: number;
            brandId: number;
            itemSubtotal: number;
        }[] = [];
        const itemBrandIds = new Set<number>();
        let subtotal = 0;
        for (const line of items) {
            const menuItem = await this.menuService.findMenuItem(
                line.menu_item_id,
            );
            if (!menuItem) continue;
            assertMenuItemAvailableForOrderType(menuItem, orderType);
            const brandId = Number(
                (menuItem as { brandId?: number; brand?: { id: number } })
                    .brandId ??
                    (menuItem as { brand?: { id: number } }).brand?.id,
            );
            if (!Number.isFinite(brandId) || !branchBrandIds.has(brandId))
                continue;
            itemBrandIds.add(brandId);
            let unitPrice: number;
            if (
                (line as { deal_unit_price?: number }).deal_unit_price !==
                undefined
            ) {
                unitPrice = (line as { deal_unit_price: number })
                    .deal_unit_price;
            } else {
                unitPrice = await this.menuService.getEffectiveUnitPrice(
                    branchId,
                    line.menu_item_id,
                );
            }
            const isDealPriceLine =
                (line as { deal_unit_price?: number }).deal_unit_price !==
                undefined;
            let itemSubtotalForDetail: number;
            if (isDealPriceLine) {
                // Deal line: base is the fixed deal price (one deal unit); still add addons and modifiers for this component.
                itemSubtotalForDetail = (line as { deal_unit_price: number })
                    .deal_unit_price;
            } else {
                if (line.variant_id && menuItem.variants?.length) {
                    const variant = menuItem.variants.find(
                        (v) => v.id === line.variant_id,
                    );
                    if (variant) unitPrice += Number(variant.priceModifier);
                }
                const quantity = line.quantity ?? 1;
                itemSubtotalForDetail = unitPrice * quantity;
            }
            // Add addons and modifiers for both deal and non-deal lines (deal components can have addons e.g. extra dip).
            if (line.addons?.length) {
                for (const addonLine of line.addons) {
                    const addon = menuItem.addons?.find(
                        (a) => a.id === addonLine.addon_id,
                    );
                    if (addon)
                        itemSubtotalForDetail +=
                            Number(addon.price) * (addonLine.quantity ?? 1);
                }
            }
            const allModsQuote = (
                (
                    menuItem as {
                        modifierGroups?: Array<{
                            modifiers?: Array<{ id: number; price: number }>;
                        }>;
                    }
                ).modifierGroups ?? []
            ).flatMap((mg) => mg.modifiers ?? []);
            if (line.modifiers?.length && allModsQuote.length > 0) {
                for (const modLine of line.modifiers) {
                    const mod = allModsQuote.find(
                        (m) => m.id === modLine.modifier_id,
                    );
                    if (mod)
                        itemSubtotalForDetail +=
                            Number(mod.price) * (modLine.quantity ?? 1);
                }
            }
            subtotal += itemSubtotalForDetail;
            lineDetails.push({
                menuItemId: menuItem.id,
                categoryId: menuItem.categoryId,
                brandId,
                itemSubtotal: itemSubtotalForDetail,
            });
        }
        const orderBrandId =
            itemBrandIds.size === 1 ? [...itemBrandIds][0] : null;
        return { subtotal, lineDetails, orderBrandId };
    }

    /** Compute order subtotal and per-line details (menuItemId, categoryId, itemSubtotal) for scope-based discount. */
    private async computeSubtotalAndLines(
        items: {
            menu_item_id: number;
            quantity: number;
            variant_id?: number;
            addons?: { addon_id: number; quantity?: number }[];
            modifiers?: { modifier_id: number; quantity?: number }[];
        }[],
    ): Promise<{
        subtotal: number;
        lineDetails: {
            menuItemId: number;
            categoryId: number;
            itemSubtotal: number;
        }[];
    }> {
        const lineDetails: {
            menuItemId: number;
            categoryId: number;
            itemSubtotal: number;
        }[] = [];
        let subtotal = 0;
        for (const line of items) {
            const menuItem = await this.menuService.findMenuItem(
                line.menu_item_id,
            );
            if (!menuItem) continue;
            let unitPrice = Number(menuItem.basePrice);
            if (line.variant_id && menuItem.variants?.length) {
                const variant = menuItem.variants.find(
                    (v) => v.id === line.variant_id,
                );
                if (variant) unitPrice += Number(variant.priceModifier);
            }
            const quantity = line.quantity ?? 1;
            let itemSubtotal = unitPrice * quantity;
            if (line.addons?.length) {
                for (const addonLine of line.addons) {
                    const addon = menuItem.addons?.find(
                        (a) => a.id === addonLine.addon_id,
                    );
                    if (addon)
                        itemSubtotal +=
                            Number(addon.price) * (addonLine.quantity ?? 1);
                }
            }
            const allModsSub = (
                (
                    menuItem as {
                        modifierGroups?: Array<{
                            modifiers?: Array<{ id: number; price: number }>;
                        }>;
                    }
                ).modifierGroups ?? []
            ).flatMap((mg) => mg.modifiers ?? []);
            if (line.modifiers?.length && allModsSub.length > 0) {
                for (const modLine of line.modifiers) {
                    const mod = allModsSub.find(
                        (m) => m.id === modLine.modifier_id,
                    );
                    if (mod)
                        itemSubtotal +=
                            Number(mod.price) * (modLine.quantity ?? 1);
                }
            }
            subtotal += itemSubtotal;
            lineDetails.push({
                menuItemId: menuItem.id,
                categoryId: menuItem.categoryId,
                itemSubtotal,
            });
        }
        return { subtotal, lineDetails };
    }

    private readonly discountResultEmpty: {
        discountAmount: number;
        discountCode: string | null;
        discountId: number | null;
        scope: string;
        scopeIds: number[];
        discountableAmount: number;
        eligibilityBrandIds: number[] | null;
    } = {
        discountAmount: 0,
        discountCode: null,
        discountId: null,
        scope: 'whole_order',
        scopeIds: [],
        discountableAmount: 0,
        eligibilityBrandIds: null,
    };

    /** Line detail for discount; brandId required for multi-brand orders so brand-scoped discounts apply to eligible portion only. */
    private lineDetailBrandId(
        line: { brandId?: number },
        index: number,
        lineDetails: { brandId?: number }[],
    ): number | undefined {
        return line.brandId ?? lineDetails[index]?.brandId;
    }

    /**
     * Check if discount is valid for current time and day in branch timezone.
     * validDaysOfWeek: 0=Sun, 1=Mon, …, 6=Sat.
     */
    private async isDiscountValidForBranchTime(
        discount: Discount,
        branchId: number,
    ): Promise<boolean> {
        const hasTime =
            discount.validTimeStart != null || discount.validTimeEnd != null;
        const hasDays =
            Array.isArray(discount.validDaysOfWeek) &&
            discount.validDaysOfWeek.length > 0;
        if (!hasTime && !hasDays) return true;

        const branch = await this.branchRepo.findOne({
            where: { id: branchId },
            select: ['timezone'],
        });
        const tz = branch?.timezone ?? 'UTC';

        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz,
            hour: 'numeric',
            minute: 'numeric',
            hour12: false,
            weekday: 'short',
        });
        const parts = formatter.formatToParts(now);
        let hour = 0,
            minute = 0,
            dayOfWeek = 0;
        for (const p of parts) {
            if (p.type === 'hour') hour = parseInt(p.value, 10);
            if (p.type === 'minute') minute = parseInt(p.value, 10);
            if (p.type === 'weekday')
                dayOfWeek = [
                    'Sun',
                    'Mon',
                    'Tue',
                    'Wed',
                    'Thu',
                    'Fri',
                    'Sat',
                ].indexOf(p.value);
        }
        const currentMinutes = hour * 60 + minute;

        if (hasDays) {
            const days = discount.validDaysOfWeek as number[];
            if (!days.includes(dayOfWeek)) return false;
        }

        if (hasTime) {
            const parseTime = (t: string | null): number | null => {
                if (!t) return null;
                const s = String(t).trim();
                const [h, m] = s.split(':').map((x) => parseInt(x, 10) || 0);
                return h * 60 + m;
            };
            const startM = parseTime(discount.validTimeStart);
            const endM = parseTime(discount.validTimeEnd);
            if (startM != null && currentMinutes < startM) return false;
            if (endM != null && currentMinutes > endM) return false;
        }

        return true;
    }

    /** Resolve best auto-applied discount. Multi-brand: brand-scoped discounts apply to the eligible portion only. */
    private async resolveAutoDiscount(
        tenantId: number,
        subtotal: number,
        source: string,
        branchId: number,
        brandId: number | null,
        lineDetails: {
            menuItemId: number;
            categoryId: number;
            itemSubtotal: number;
            brandId?: number;
        }[],
    ): Promise<{
        discountAmount: number;
        discountCode: string | null;
        discountId: number | null;
        scope: string;
        scopeIds: number[];
        discountableAmount: number;
        eligibilityBrandIds: number[] | null;
    }> {
        const discounts = await this.discountRepo.find({
            where: { tenantId, isActive: true, requiresCode: false },
        });
        const now = new Date();
        let best = {
            ...this.discountResultEmpty,
            eligibilityBrandIds: null as number[] | null,
        };
        for (const discount of discounts) {
            if (discount.validFrom && now < discount.validFrom) continue;
            if (discount.validUntil && now > discount.validUntil) continue;
            if (!(await this.isDiscountValidForBranchTime(discount, branchId)))
                continue;
            if (
                discount.minOrderAmount != null &&
                Number(discount.minOrderAmount) > subtotal
            )
                continue;
            if (discount.posOnly && source !== 'pos') continue;
            const eligibilityBranchIds = discount.eligibilityBranchIds ?? null;
            const eligibilityBrandIds = discount.eligibilityBrandIds ?? null;
            if (
                eligibilityBranchIds != null &&
                eligibilityBranchIds.length > 0 &&
                !eligibilityBranchIds.includes(branchId)
            )
                continue;
            const brandSet =
                eligibilityBrandIds != null && eligibilityBrandIds.length > 0
                    ? new Set(
                          (eligibilityBrandIds as unknown[]).map(
                              (id: unknown) => Number(id),
                          ),
                      )
                    : null;
            if (brandId != null) {
                if (brandSet != null && !brandSet.has(Number(brandId)))
                    continue;
            } else {
                if (brandSet != null) {
                    const hasEligibleLine = lineDetails.some((l, i) => {
                        const lineBrand = this.lineDetailBrandId(
                            l,
                            i,
                            lineDetails,
                        );
                        return (
                            lineBrand != null && brandSet.has(Number(lineBrand))
                        );
                    });
                    if (!hasEligibleLine) continue;
                }
            }
            const scope = discount.applicationScope ?? 'whole_order';
            const scopeIds = (discount.applicationScopeIds ?? []).map(
                (id: unknown) => Number(id),
            );
            const inScope = (
                l: { menuItemId: number; categoryId: number },
                i: number,
            ) => {
                if (
                    scope === 'category' &&
                    scopeIds.length > 0 &&
                    !scopeIds.includes(l.categoryId)
                )
                    return false;
                if (
                    scope === 'products' &&
                    scopeIds.length > 0 &&
                    !scopeIds.includes(l.menuItemId)
                )
                    return false;
                if (brandSet != null && brandId == null) {
                    const lineBrand = this.lineDetailBrandId(
                        lineDetails[i],
                        i,
                        lineDetails,
                    );
                    if (lineBrand == null || !brandSet.has(Number(lineBrand)))
                        return false;
                }
                return true;
            };
            let discountableAmount = 0;
            lineDetails.forEach((l, i) => {
                if (inScope(l, i)) discountableAmount += l.itemSubtotal;
            });
            if (discountableAmount <= 0) continue;
            let discountAmount = 0;
            if (discount.type === 'flat') {
                discountAmount = Math.min(
                    Number(discount.value),
                    discountableAmount,
                );
                if (discount.maxDiscountAmount != null)
                    discountAmount = Math.min(
                        discountAmount,
                        Number(discount.maxDiscountAmount),
                    );
            } else {
                discountAmount =
                    (discountableAmount * Number(discount.value)) / 100;
                if (discount.maxDiscountAmount != null)
                    discountAmount = Math.min(
                        discountAmount,
                        Number(discount.maxDiscountAmount),
                    );
            }
            if (discountAmount > best.discountAmount) {
                best = {
                    discountAmount,
                    discountCode: discount.code ?? null,
                    discountId: discount.id,
                    scope,
                    scopeIds,
                    discountableAmount,
                    eligibilityBrandIds,
                };
            }
        }
        return best;
    }

    /** Resolve coupon/promo discount (by code). Multi-brand: brand-scoped discounts apply to eligible portion only. */
    private async resolveCouponDiscount(
        tenantId: number,
        code: string | null,
        baseAmount: number,
        source: string,
        branchId: number,
        brandId: number | null,
        lineDetails: {
            menuItemId: number;
            categoryId: number;
            itemSubtotal: number;
            brandId?: number;
        }[],
        lineAfterAuto: number[] | null,
    ): Promise<{
        discountAmount: number;
        discountCode: string | null;
        discountId: number | null;
        scope: string;
        scopeIds: number[];
        discountableAmount: number;
        eligibilityBrandIds: number[] | null;
    }> {
        const empty = {
            ...this.discountResultEmpty,
            discountableAmount: baseAmount,
            eligibilityBrandIds: null as number[] | null,
        };
        if (!code?.trim()) return empty;
        const discount = await this.discountRepo.findOne({
            where: { code: code.trim(), tenantId, isActive: true },
        });
        if (!discount) return empty;
        const now = new Date();
        if (discount.validFrom && now < discount.validFrom) return empty;
        if (discount.validUntil && now > discount.validUntil) return empty;
        if (!(await this.isDiscountValidForBranchTime(discount, branchId)))
            return empty;
        if (
            discount.minOrderAmount != null &&
            Number(discount.minOrderAmount) > baseAmount
        )
            return empty;
        if (discount.posOnly && source !== 'pos') return empty;
        const eligibilityBranchIds = discount.eligibilityBranchIds ?? null;
        const eligibilityBrandIds = discount.eligibilityBrandIds ?? null;
        if (
            eligibilityBranchIds != null &&
            eligibilityBranchIds.length > 0 &&
            !eligibilityBranchIds.includes(branchId)
        )
            return empty;
        const brandSet =
            eligibilityBrandIds != null && eligibilityBrandIds.length > 0
                ? new Set(
                      (eligibilityBrandIds as unknown[]).map((id: unknown) =>
                          Number(id),
                      ),
                  )
                : null;
        if (brandId != null) {
            if (brandSet != null && !brandSet.has(Number(brandId)))
                return empty;
        } else {
            if (brandSet != null) {
                const hasEligibleLine = lineDetails.some((l, i) => {
                    const lineBrand = this.lineDetailBrandId(l, i, lineDetails);
                    return lineBrand != null && brandSet.has(Number(lineBrand));
                });
                if (!hasEligibleLine) return empty;
            }
        }
        const scope = discount.applicationScope ?? 'whole_order';
        const scopeIds = (discount.applicationScopeIds ?? []).map(
            (id: unknown) => Number(id),
        );
        const inScope = (
            l: { menuItemId: number; categoryId: number },
            i: number,
        ) => {
            if (
                scope === 'category' &&
                scopeIds.length > 0 &&
                !scopeIds.includes(l.categoryId)
            )
                return false;
            if (
                scope === 'products' &&
                scopeIds.length > 0 &&
                !scopeIds.includes(l.menuItemId)
            )
                return false;
            if (brandSet != null && brandId == null) {
                const lineBrand = this.lineDetailBrandId(
                    lineDetails[i],
                    i,
                    lineDetails,
                );
                if (lineBrand == null || !brandSet.has(Number(lineBrand)))
                    return false;
            }
            return true;
        };
        let discountableAmount = 0;
        if (
            lineAfterAuto != null &&
            lineAfterAuto.length === lineDetails.length
        ) {
            lineDetails.forEach((l, i) => {
                if (inScope(l, i)) discountableAmount += lineAfterAuto[i] ?? 0;
            });
        } else {
            lineDetails.forEach((l, i) => {
                if (inScope(l, i)) discountableAmount += l.itemSubtotal;
            });
        }
        discountableAmount = Math.min(discountableAmount, baseAmount);
        if (discountableAmount <= 0) return empty;
        let discountAmount = 0;
        if (discount.type === 'flat') {
            discountAmount = Math.min(
                Number(discount.value),
                discountableAmount,
            );
            if (discount.maxDiscountAmount != null)
                discountAmount = Math.min(
                    discountAmount,
                    Number(discount.maxDiscountAmount),
                );
        } else {
            discountAmount =
                (discountableAmount * Number(discount.value)) / 100;
            if (discount.maxDiscountAmount != null)
                discountAmount = Math.min(
                    discountAmount,
                    Number(discount.maxDiscountAmount),
                );
        }
        return {
            discountAmount,
            discountCode: discount.code ?? null,
            discountId: discount.id,
            scope,
            scopeIds,
            discountableAmount,
            eligibilityBrandIds,
        };
    }

    /** Allocate discount to lines using "after auto" amounts (for coupon stacking). When multi-brand + brand filter, only eligible lines get share. */
    private allocateDiscountToLinesUsingBase(
        lineDetails: {
            menuItemId: number;
            categoryId: number;
            itemSubtotal: number;
            brandId?: number;
        }[],
        baseAmounts: number[],
        totalBase: number,
        discountAmount: number,
        scope: string,
        scopeIds: number[],
        discountableAmount: number,
        orderBrandId: number | null,
        eligibilityBrandIds: number[] | null,
    ): number[] {
        if (
            discountAmount <= 0 ||
            lineDetails.length === 0 ||
            totalBase <= 0 ||
            discountableAmount <= 0
        )
            return lineDetails.map(() => 0);
        const brandSet =
            eligibilityBrandIds != null && eligibilityBrandIds.length > 0
                ? new Set(eligibilityBrandIds.map((id: number) => Number(id)))
                : null;
        const inScope = (i: number) => {
            const l = lineDetails[i];
            if (scope === 'whole_order') {
                void 0; /* all lines in scope */
            } else if (
                scope === 'category' &&
                scopeIds.length > 0 &&
                !scopeIds.includes(l.categoryId)
            )
                return false;
            else if (
                scope === 'products' &&
                scopeIds.length > 0 &&
                !scopeIds.includes(l.menuItemId)
            )
                return false;
            if (brandSet != null && orderBrandId == null) {
                const lineBrand = this.lineDetailBrandId(l, i, lineDetails);
                if (lineBrand == null || !brandSet.has(Number(lineBrand)))
                    return false;
            }
            return true;
        };
        const allocated = lineDetails.map((_, i) =>
            !inScope(i)
                ? 0
                : Math.round(
                      discountAmount *
                          (baseAmounts[i] / discountableAmount) *
                          100,
                  ) / 100,
        );
        const sum = allocated.reduce((a, b) => a + b, 0);
        if (sum !== discountAmount && allocated.length > 0) {
            const diff = Math.round((discountAmount - sum) * 100) / 100;
            let lastIdx = -1;
            for (let i = lineDetails.length - 1; i >= 0; i--)
                if (inScope(i)) {
                    lastIdx = i;
                    break;
                }
            if (lastIdx >= 0)
                allocated[lastIdx] =
                    Math.round((allocated[lastIdx] + diff) * 100) / 100;
        }
        return allocated;
    }

    /** Allocate total discount to lines by scope (proportional to discountable amount). When multi-brand + brand filter, only eligible lines get share. */
    private allocateDiscountToLines(
        lineDetails: {
            menuItemId: number;
            categoryId: number;
            itemSubtotal: number;
            brandId?: number;
        }[],
        subtotal: number,
        discountAmount: number,
        scope: string,
        scopeIds: number[],
        discountableAmount: number,
        orderBrandId: number | null,
        eligibilityBrandIds: number[] | null,
    ): number[] {
        if (discountAmount <= 0 || lineDetails.length === 0)
            return lineDetails.map(() => 0);
        const brandSet =
            eligibilityBrandIds != null && eligibilityBrandIds.length > 0
                ? new Set(eligibilityBrandIds.map((id: number) => Number(id)))
                : null;
        const inScope = (i: number) => {
            const l = lineDetails[i];
            if (scope === 'whole_order') {
                void 0; /* all lines in scope */
            } else if (
                scope === 'category' &&
                scopeIds.length > 0 &&
                !scopeIds.includes(l.categoryId)
            )
                return false;
            else if (
                scope === 'products' &&
                scopeIds.length > 0 &&
                !scopeIds.includes(l.menuItemId)
            )
                return false;
            if (brandSet != null && orderBrandId == null) {
                const lineBrand = this.lineDetailBrandId(l, i, lineDetails);
                if (lineBrand == null || !brandSet.has(Number(lineBrand)))
                    return false;
            }
            return true;
        };
        if (discountableAmount <= 0) return lineDetails.map(() => 0);
        const allocated = lineDetails.map((l, i) => {
            if (!inScope(i)) return 0;
            return (
                Math.round(
                    discountAmount *
                        (l.itemSubtotal / discountableAmount) *
                        100,
                ) / 100
            );
        });
        const sum = allocated.reduce((a, b) => a + b, 0);
        if (sum !== discountAmount && allocated.length > 0) {
            const diff = Math.round((discountAmount - sum) * 100) / 100;
            let lastIdx = -1;
            for (let i = lineDetails.length - 1; i >= 0; i--)
                if (inScope(i)) {
                    lastIdx = i;
                    break;
                }
            if (lastIdx >= 0)
                allocated[lastIdx] =
                    Math.round((allocated[lastIdx] + diff) * 100) / 100;
        }
        return allocated;
    }

    private async generateOrderNumber(branchId: number): Promise<string> {
        const [num] = await this.generateOrderNumbers(branchId, 1);
        return num;
    }

    /** Generate multiple order numbers in one go (e.g. for multi-brand split) so they are unique and sequential. */
    private async generateOrderNumbers(
        branchId: number,
        howMany: number,
    ): Promise<string[]> {
        const branch = await this.branchRepo.findOne({
            where: { id: branchId },
        });
        const code = branch?.code ?? 'BR';
        const todayStr = new Date().toISOString().slice(0, 10);
        const todayNoDash = todayStr.replace(/-/g, '');
        const count = await this.orderRepo
            .createQueryBuilder('o')
            .where('o.branchId = :branchId', { branchId })
            .andWhere('date(o.placed_at) = :today', { today: todayStr })
            .getCount();
        const result: string[] = [];
        for (let i = 0; i < howMany; i++) {
            result.push(
                `${code}-${todayNoDash}-${String(count + i + 1).padStart(4, '0')}`,
            );
        }
        return result;
    }
}
