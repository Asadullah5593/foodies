import {
    compareRepeatedCustomers,
    mapRepeatedCustomerRow,
    RepeatedCustomerRow,
} from './repeated-customers';

describe('mapRepeatedCustomerRow', () => {
    it('turns the query strings into numbers and rounds spend to paisa', () => {
        expect(
            mapRepeatedCustomerRow({
                customer_id: '10',
                record_name: 'John Doe',
                order_name: 'Johnny',
                phone: '03001234567',
                days: '6',
                spend: '12450.505',
            }),
        ).toEqual({
            customer_id: 10,
            name: 'John Doe',
            phone: '03001234567',
            days: 6,
            spend: 12450.51,
        });
    });

    it('falls back to the name typed on the order when the record has none', () => {
        const row = mapRepeatedCustomerRow({
            customer_id: 3,
            record_name: '   ',
            order_name: ' Sara ',
            phone: '03211234567',
            days: 2,
            spend: 900,
        });
        expect(row.name).toBe('Sara');
    });

    it('leaves the name null when neither exists, so the page can show the phone', () => {
        const row = mapRepeatedCustomerRow({
            customer_id: 4,
            record_name: null,
            order_name: null,
            phone: '03451234567',
            days: 3,
            spend: null,
        });
        expect(row.name).toBeNull();
        expect(row.spend).toBe(0);
    });
});

describe('compareRepeatedCustomers', () => {
    const row = (
        id: number,
        days: number,
        spend: number,
        name: string | null,
    ): RepeatedCustomerRow => ({
        customer_id: id,
        name,
        phone: `0300000000${id}`,
        days,
        spend,
    });

    it('puts the most days first, then the bigger spender, then by name', () => {
        const sorted = [
            row(1, 2, 500, 'Zara'),
            row(2, 5, 100, 'Ali'),
            row(3, 2, 900, 'Bilal'),
            row(4, 2, 500, 'Asma'),
        ].sort(compareRepeatedCustomers);
        expect(sorted.map((r) => r.customer_id)).toEqual([2, 3, 4, 1]);
    });

    it('sorts a nameless customer by phone and stays stable on full ties', () => {
        const sorted = [
            row(7, 2, 100, 'Same'),
            row(6, 2, 100, 'Same'),
            row(5, 2, 100, null),
        ].sort(compareRepeatedCustomers);
        expect(sorted.map((r) => r.customer_id)).toEqual([5, 6, 7]);
    });
});
