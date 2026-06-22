import { mapSourceToWalletType } from './loyalty.service';

describe('mapSourceToWalletType (wallet routing)', () => {
    it('routes POS orders to the brand-scoped POS wallet', () => {
        expect(mapSourceToWalletType('pos')).toBe('pos');
    });

    it('routes mobile-app orders to the shared APP wallet', () => {
        expect(mapSourceToWalletType('consumer_app')).toBe('app');
    });

    it('grants NO loyalty to kiosk orders', () => {
        expect(mapSourceToWalletType('kiosk')).toBeNull();
    });

    it('grants NO loyalty to consumer-web orders', () => {
        expect(mapSourceToWalletType('consumer_web')).toBeNull();
    });

    it('grants NO loyalty to unknown sources', () => {
        expect(mapSourceToWalletType('')).toBeNull();
        expect(mapSourceToWalletType('something_else')).toBeNull();
    });
});
