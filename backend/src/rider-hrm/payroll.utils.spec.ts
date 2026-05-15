import { componentAmount, proratedAmount } from './payroll.utils';

describe('payroll utils', () => {
    it('prorates base salary by attendance ratio with cap 1', () => {
        expect(proratedAmount(30000, 6240, 12480)).toBe(15000);
        expect(proratedAmount(30000, 13000, 12480)).toBe(30000);
    });

    it('calculates per-ride and timely component amounts', () => {
        expect(
            componentAmount('per_ride', 100, {
                completedRides: 12,
                timelyDeliveries: 8,
                avgRating: 4.5,
            }),
        ).toBe(1200);
        expect(
            componentAmount('timely_delivery', 25, {
                completedRides: 12,
                timelyDeliveries: 8,
                avgRating: 4.5,
            }),
        ).toBe(200);
    });

    it('applies rating threshold bonus only when rating is eligible', () => {
        expect(
            componentAmount('rating_threshold_bonus', 500, {
                completedRides: 10,
                timelyDeliveries: 7,
                avgRating: 4.2,
                minRating: 4.0,
            }),
        ).toBe(500);
        expect(
            componentAmount('rating_threshold_bonus', 500, {
                completedRides: 10,
                timelyDeliveries: 7,
                avgRating: 3.8,
                minRating: 4.0,
            }),
        ).toBe(0);
    });
});
