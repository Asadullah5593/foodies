import { ValidationPipe } from '@nestjs/common';
import { CreatePaymentSessionDto } from './dto/create-payment-session.dto';
import { PaymentsEpgController } from './payments-epg.controller';

/**
 * Card checkout must accept the deal shape the shipped app sends, exactly as
 * the cash route (POST /public/consumer/orders) already does. Each body goes
 * through the same global ValidationPipe production runs, so a field the pipe
 * would strip is caught here rather than on a customer's phone.
 */
describe('PaymentsEpgController.createSession — legacy deal payload', () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });

    type SessionInput = {
        cart: { items: Array<Record<string, unknown>> };
        customerId: number | null;
    };

    async function send(body: Record<string, unknown>, customerId?: number) {
        const createSession = jest
            .fn<Promise<unknown>, [SessionInput]>()
            .mockResolvedValue({ status: 'pending' });
        const controller = new PaymentsEpgController({
            createSession,
        } as never);
        const dto = (await pipe.transform(body, {
            type: 'body',
            metatype: CreatePaymentSessionDto,
        })) as CreatePaymentSessionDto;
        await controller.createSession(
            { user: customerId != null ? { id: customerId } : null },
            dto,
        );
        expect(createSession).toHaveBeenCalledTimes(1);
        return createSession.mock.calls[0][0];
    }

    const cart = (items: unknown[]) => ({
        branch_id: 16,
        order_type: 'delivery',
        customer_phone: '03001234567',
        items,
    });

    it('translates the BOGO deal the live app (v1.2.4) sends on card checkout', async () => {
        // The shape from the app developer's report: deal 3022, two slots.
        const { cart: sent } = await send(
            cart([
                {
                    menu_item_id: 3022,
                    quantity: 1,
                    deal_items: [
                        { slot_index: 0, choice_item_id: 2859 },
                        { slot_index: 1, choice_item_id: 2859 },
                    ],
                },
            ]),
        );
        expect(sent.items).toEqual([
            {
                deal_menu_item_id: 3022,
                quantity: 1,
                components: [
                    { slot_index: 0, menu_item_id: 2859 },
                    { slot_index: 1, menu_item_id: 2859 },
                ],
            },
        ]);
    });

    it("keeps each slot's size, options and add-ons through the pipe and the translation", async () => {
        // A real line captured from the shipped app (sized pizza slots).
        const { cart: sent } = await send(
            cart([
                {
                    addons: [],
                    quantity: 2,
                    modifiers: [],
                    variant_id: null,
                    menu_item_id: 2514,
                    deal_items: [
                        {
                            addons: [{ addon_id: 7, quantity: 1 }],
                            modifiers: [{ modifier_id: 91, quantity: 1 }],
                            slot_index: 0,
                            variant_id: 1537,
                            choice_item_id: 2422,
                        },
                        {
                            addons: [],
                            modifiers: [],
                            slot_index: 1,
                            variant_id: 1538,
                            choice_item_id: 2423,
                        },
                    ],
                },
            ]),
        );
        const line = sent.items[0];
        expect(line).not.toHaveProperty('menu_item_id');
        expect(line).not.toHaveProperty('deal_items');
        expect(line).not.toHaveProperty('variant_id');
        expect(line.deal_menu_item_id).toBe(2514);
        expect(line.quantity).toBe(2);
        expect(line.components).toEqual([
            {
                slot_index: 0,
                menu_item_id: 2422,
                variant_id: 1537,
                modifiers: [{ modifier_id: 91, quantity: 1 }],
                addons: [{ addon_id: 7, quantity: 1 }],
            },
            { slot_index: 1, menu_item_id: 2423, variant_id: 1538 },
        ]);
    });

    it('passes the new app (v1.2.5) deal shape through untouched', async () => {
        const deal = {
            deal_menu_item_id: 3022,
            quantity: 1,
            components: [
                { slot_index: 0, menu_item_id: 2859, variant_id: 1601 },
                { slot_index: 1, menu_item_id: 2860, variant_id: 1601 },
            ],
        };
        const { cart: sent } = await send(cart([deal]));
        expect(sent.items).toEqual([deal]);
    });

    it('leaves plain items alone and converts only the deal in a mixed cart', async () => {
        const drink = {
            menu_item_id: 500,
            quantity: 2,
            variant_id: 12,
            modifiers: [{ modifier_id: 3, quantity: 1 }],
        };
        const { cart: sent } = await send(
            cart([
                drink,
                {
                    menu_item_id: 3022,
                    quantity: 1,
                    deal_items: [
                        { slot_index: 0, choice_item_id: 2859 },
                        { slot_index: 1, choice_item_id: 2861 },
                    ],
                },
            ]),
        );
        expect(sent.items[0]).toEqual(drink);
        expect(sent.items[1]).toEqual({
            deal_menu_item_id: 3022,
            quantity: 1,
            components: [
                { slot_index: 0, menu_item_id: 2859 },
                { slot_index: 1, menu_item_id: 2861 },
            ],
        });
    });

    it('still hands the signed-in customer and the rest of the cart to the service', async () => {
        const sent = await send(
            {
                ...cart([{ menu_item_id: 500, quantity: 1 }]),
                delivery_address: 'House 1',
            },
            42,
        );
        expect(sent.customerId).toBe(42);
        expect(sent.cart).toMatchObject({
            branch_id: 16,
            order_type: 'delivery',
            customer_phone: '03001234567',
            delivery_address: 'House 1',
        });
    });
});
