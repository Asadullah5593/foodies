import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cart } from '../entities/cart.entity';
import { CartItem } from '../entities/cart-item.entity';
import { isUniqueViolation } from '../common/db-concurrency';

@Injectable()
export class CartService {
    constructor(
        @InjectRepository(Cart) private cartRepo: Repository<Cart>,
        @InjectRepository(CartItem) private cartItemRepo: Repository<CartItem>,
    ) {}

    async getOrCreateCart(customerId: number, branchId: number): Promise<Cart> {
        const load = () =>
            this.cartRepo.findOne({
                where: { customerId, branchId },
                relations: ['items', 'items.menuItem', 'items.variant'],
            });
        let cart = await load();
        if (!cart) {
            try {
                cart = await this.cartRepo.save(
                    this.cartRepo.create({ customerId, branchId }),
                );
            } catch (e) {
                // Concurrent first-touch (app + web on the same phone): the
                // (customer, branch) unique index rejects the loser — reuse the
                // winner's cart instead of 500ing.
                if (isUniqueViolation(e)) {
                    cart = await load();
                }
                if (!cart) throw e;
            }
        }
        return cart;
    }

    async getCart(customerId: number, branchId: number) {
        const cart = await this.getOrCreateCart(customerId, branchId);
        const items = await this.cartItemRepo.find({
            where: { cartId: cart.id },
            relations: ['menuItem', 'variant'],
            order: { id: 'ASC' },
        });
        return {
            cart_id: cart.id,
            branch_id: cart.branchId,
            items: items.map((i) => ({
                id: i.id,
                menu_item_id: i.menuItemId,
                menu_item_name: i.menuItem?.name ?? null,
                variant_id: i.variantId,
                variant_name: i.variant?.name ?? null,
                quantity: i.quantity,
                notes: i.notes ?? null,
                addons: i.addons ?? [],
                modifiers: i.modifiers ?? [],
            })),
        };
    }

    async addItem(
        customerId: number,
        branchId: number,
        dto: {
            menu_item_id: number;
            quantity: number;
            variant_id?: number;
            addons?: { addon_id: number; quantity?: number }[];
            modifiers?: { modifier_id: number; quantity?: number }[];
            notes?: string;
        },
    ) {
        const cart = await this.getOrCreateCart(customerId, branchId);
        const quantity = Math.max(1, Math.floor(dto.quantity ?? 1));
        const item = await this.cartItemRepo.save(
            this.cartItemRepo.create({
                cartId: cart.id,
                menuItemId: dto.menu_item_id,
                variantId: dto.variant_id ?? null,
                quantity,
                notes: dto.notes?.trim() || null,
                addons: dto.addons ?? null,
                modifiers: dto.modifiers ?? null,
            }),
        );
        return {
            id: item.id,
            menu_item_id: item.menuItemId,
            variant_id: item.variantId,
            quantity: item.quantity,
            notes: item.notes,
            addons: item.addons,
            modifiers: item.modifiers,
        };
    }

    async updateItem(
        cartItemId: number,
        customerId: number,
        updates: {
            quantity?: number;
            variant_id?: number | null;
            addons?: { addon_id: number; quantity?: number }[] | null;
            modifiers?: { modifier_id: number; quantity?: number }[] | null;
            notes?: string | null;
        },
    ) {
        const item = await this.cartItemRepo.findOne({
            where: { id: cartItemId },
            relations: ['cart'],
        });
        if (!item || item.cart.customerId !== customerId)
            throw new NotFoundException('Cart item not found');

        const hasQuantityUpdate =
            updates.quantity !== undefined && updates.quantity !== null;
        if (
            hasQuantityUpdate &&
            Math.max(0, Math.floor(updates.quantity ?? 1)) === 0
        ) {
            // Scoped delete: if a concurrent remove already deleted the row, report
            // NotFound rather than a false success.
            const del = await this.cartItemRepo.delete({
                id: cartItemId,
                cartId: item.cartId,
            });
            if (!del.affected)
                throw new NotFoundException('Cart item not found');
            return { message: 'Item removed', quantity: 0 };
        }

        // Build a column-scoped patch (only the provided fields) and apply it as an
        // atomic UPDATE. If a concurrent remove deleted the row, affected=0 → NotFound
        // instead of the stale in-memory entity being returned as a false success.
        const patch: {
            quantity?: number;
            variantId?: number | null;
            addons?: { addon_id: number; quantity?: number }[] | null;
            modifiers?: { modifier_id: number; quantity?: number }[] | null;
            notes?: string | null;
        } = {};
        if (hasQuantityUpdate) {
            patch.quantity = Math.max(1, Math.floor(updates.quantity ?? 1));
        }
        if (updates.variant_id !== undefined) {
            patch.variantId = updates.variant_id ?? null;
        }
        if (updates.addons !== undefined) {
            patch.addons = updates.addons ?? null;
        }
        if (updates.modifiers !== undefined) {
            patch.modifiers = updates.modifiers ?? null;
        }
        if (updates.notes !== undefined) {
            patch.notes = updates.notes?.trim() || null;
        }

        const res = await this.cartItemRepo.update(
            { id: cartItemId, cartId: item.cartId },
            patch,
        );
        if (!res.affected) throw new NotFoundException('Cart item not found');
        Object.assign(item, patch);
        return {
            id: item.id,
            menu_item_id: item.menuItemId,
            variant_id: item.variantId,
            quantity: item.quantity,
            notes: item.notes,
            addons: item.addons ?? [],
            modifiers: item.modifiers ?? [],
        };
    }

    async removeItem(cartItemId: number, customerId: number) {
        const item = await this.cartItemRepo.findOne({
            where: { id: cartItemId },
            relations: ['cart'],
        });
        if (!item || item.cart.customerId !== customerId)
            throw new NotFoundException('Cart item not found');
        const del = await this.cartItemRepo.delete({
            id: cartItemId,
            cartId: item.cartId,
        });
        if (!del.affected) throw new NotFoundException('Cart item not found');
        return { message: 'Item removed' };
    }

    async clearCart(customerId: number, branchId: number) {
        const cart = await this.cartRepo.findOne({
            where: { customerId, branchId },
        });
        if (cart) {
            await this.cartItemRepo.delete({ cartId: cart.id });
        }
        return { message: 'Cart cleared' };
    }
}
