import { ReportsService } from './reports.service';

/**
 * resolveDayRange is private but is the whole of the dashboard's time filter, so
 * reach it directly rather than standing up the repositories it never touches.
 */
const resolve = (filters: {
    date_from?: string;
    date_to?: string;
    time_from?: string;
    time_to?: string;
}): { dateFrom: Date; dateTo: Date } =>
    (
        ReportsService.prototype as unknown as {
            resolveDayRange: (f: typeof filters) => { dateFrom: Date; dateTo: Date };
        }
    ).resolveDayRange(filters);

/** Local wall-clock, which is what a branch reads off its own clock. */
const local = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
    ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
        d.getMinutes(),
    ).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

describe('ReportsService date/time range', () => {
    it('starts a plain date at LOCAL midnight, not UTC midnight', () => {
        // Regression: `new Date('2026-06-16')` is UTC midnight = 05:00 in a UTC+5
        // branch, so the opening day used to lose its first five hours of trade.
        const { dateFrom } = resolve({ date_from: '2026-06-16', date_to: '2026-07-15' });
        expect(local(dateFrom)).toBe('2026-06-16 00:00:00');
    });

    it('ends a plain date at the last moment of that local day', () => {
        const { dateTo } = resolve({ date_from: '2026-06-16', date_to: '2026-07-15' });
        expect(local(dateTo)).toBe('2026-07-15 23:59:59');
        expect(dateTo.getMilliseconds()).toBe(999);
    });

    it('applies a time window to the bounds', () => {
        const { dateFrom, dateTo } = resolve({
            date_from: '2026-07-15',
            date_to: '2026-07-15',
            time_from: '18:00',
            time_to: '23:59',
        });
        expect(local(dateFrom)).toBe('2026-07-15 18:00:00');
        // The end minute is inclusive: an order at 23:59:30 belongs to a 23:59 bound.
        expect(local(dateTo)).toBe('2026-07-15 23:59:59');
    });

    it('keeps the end minute inclusive for a mid-day bound', () => {
        const { dateTo } = resolve({
            date_from: '2026-07-15',
            date_to: '2026-07-15',
            time_from: '09:00',
            time_to: '17:30',
        });
        expect(local(dateTo)).toBe('2026-07-15 17:30:59');
    });

    it('ignores a malformed time rather than skewing the window', () => {
        const { dateFrom, dateTo } = resolve({
            date_from: '2026-07-15',
            date_to: '2026-07-15',
            time_from: 'not-a-time',
            time_to: '',
        });
        expect(local(dateFrom)).toBe('2026-07-15 00:00:00');
        expect(local(dateTo)).toBe('2026-07-15 23:59:59');
    });

    it('clamps out-of-range clock values', () => {
        const { dateFrom } = resolve({
            date_from: '2026-07-15',
            date_to: '2026-07-15',
            time_from: '99:99',
        });
        expect(local(dateFrom)).toBe('2026-07-15 23:59:00');
    });

    it('falls back to today when the date is missing or malformed', () => {
        const { dateFrom, dateTo } = resolve({ date_from: 'garbage' });
        const today = new Date();
        expect(dateFrom.getDate()).toBe(today.getDate());
        expect(local(dateFrom).endsWith('00:00:00')).toBe(true);
        expect(local(dateTo).endsWith('23:59:59')).toBe(true);
    });
});
