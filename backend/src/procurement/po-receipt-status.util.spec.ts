import {
    areAllPoLinesFullyReceived,
    hasAnyPostedGrnReceiptAgainstPo,
    nextPurchaseOrderReceiptStatus,
} from './po-receipt-status.util';

describe('po-receipt-status.util', () => {
    it('areAllPoLinesFullyReceived is false when one SKU is short even if totals match', () => {
        const ordered = new Map<number, number>([
            [1, 10],
            [2, 10],
        ]);
        const received = new Map<number, number>([
            [1, 20],
            [2, 0],
        ]);
        expect(areAllPoLinesFullyReceived(ordered, received)).toBe(false);
    });

    it('areAllPoLinesFullyReceived is true only when every line is satisfied', () => {
        const ordered = new Map<number, number>([
            [1, 10],
            [2, 10],
        ]);
        const received = new Map<number, number>([
            [1, 10],
            [2, 10],
        ]);
        expect(areAllPoLinesFullyReceived(ordered, received)).toBe(true);
    });

    it('nextPurchaseOrderReceiptStatus returns partially_received when any line has receipt', () => {
        const ordered = new Map<number, number>([
            [1, 10],
            [2, 10],
        ]);
        const received = new Map<number, number>([
            [1, 5],
            [2, 0],
        ]);
        expect(nextPurchaseOrderReceiptStatus(ordered, received)).toBe('partially_received');
        expect(hasAnyPostedGrnReceiptAgainstPo(ordered, received)).toBe(true);
    });

    it('nextPurchaseOrderReceiptStatus returns closed when every line is fully received', () => {
        const ordered = new Map<number, number>([
            [1, 10],
            [2, 5],
        ]);
        const received = new Map<number, number>([
            [1, 10],
            [2, 5],
        ]);
        expect(nextPurchaseOrderReceiptStatus(ordered, received)).toBe('closed');
    });

    it('nextPurchaseOrderReceiptStatus returns created when nothing received', () => {
        const ordered = new Map<number, number>([
            [1, 10],
        ]);
        const received = new Map<number, number>([]);
        expect(nextPurchaseOrderReceiptStatus(ordered, received)).toBe('created');
    });
});
