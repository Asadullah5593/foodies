import {
    sourceToOfferChannel,
    offerAllowedOnChannel,
} from './offer-preview.util';

describe('sourceToOfferChannel', () => {
    it('treats call_centre as POS — agents order through the till', () => {
        expect(sourceToOfferChannel('call_centre')).toBe('pos');
        expect(sourceToOfferChannel('pos')).toBe('pos');
    });

    it('still maps the consumer surfaces', () => {
        expect(sourceToOfferChannel('consumer_app')).toBe('app');
        expect(sourceToOfferChannel('consumer_web')).toBe('web');
        expect(sourceToOfferChannel('kiosk')).toBe('kiosk');
    });

    it('returns null for a source it does not know', () => {
        expect(sourceToOfferChannel('whatsapp')).toBeNull();
        expect(sourceToOfferChannel('')).toBeNull();
    });
});

describe('a POS-restricted offer on a call-centre order', () => {
    // The regression this fixes: a weekend BOGO scoped to channels ['pos']
    // refused every call-centre order, because call_centre mapped to null and
    // offerAllowedOnChannel rejects an unknown channel.
    it('applies, exactly as it does on the till', () => {
        expect(
            offerAllowedOnChannel(
                ['pos'],
                false,
                sourceToOfferChannel('call_centre'),
            ),
        ).toBe(true);
    });

    it('still does not leak onto the app or web', () => {
        expect(
            offerAllowedOnChannel(
                ['pos'],
                false,
                sourceToOfferChannel('consumer_app'),
            ),
        ).toBe(false);
        expect(
            offerAllowedOnChannel(
                ['pos'],
                false,
                sourceToOfferChannel('consumer_web'),
            ),
        ).toBe(false);
    });

    it('honours the legacy posOnly flag for call centre too', () => {
        expect(
            offerAllowedOnChannel(
                null,
                true,
                sourceToOfferChannel('call_centre'),
            ),
        ).toBe(true);
    });
});
