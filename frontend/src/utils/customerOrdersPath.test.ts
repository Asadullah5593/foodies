import { describe, it, expect } from 'vitest';
import { customerOrdersPath } from './customerOrdersPath';

describe('customerOrdersPath', () => {
  const parse = (path: string) => new URL(path, 'http://x').searchParams;

  it('opens the Orders page on that customer, named for the banner', () => {
    const path = customerOrdersPath({ id: 412, name: 'Abdullah Arshad', phone: '03240201350' });
    expect(path.startsWith('/admin/orders?')).toBe(true);
    expect(parse(path).get('customer_id')).toBe('412');
    expect(parse(path).get('customer_label')).toBe('Abdullah Arshad (03240201350)');
  });

  it('sets no dates, so the history is not cut down to today', () => {
    const sp = parse(customerOrdersPath({ id: 1, name: 'A', phone: '03000000000' }));
    expect(sp.has('date_from')).toBe(false);
    expect(sp.has('date_to')).toBe(false);
  });

  it('falls back to the phone for a customer with no name', () => {
    for (const name of [null, undefined, '   ']) {
      const sp = parse(customerOrdersPath({ id: 7, name, phone: '03001234567' }));
      expect(sp.get('customer_label')).toBe('03001234567');
    }
  });

  it('can narrow to one brand, one branch and one status', () => {
    const sp = parse(
      customerOrdersPath(
        { id: 412, name: 'Abdullah Arshad', phone: '03240201350' },
        { brandId: 21, branchId: 10, status: 'completed' },
      ),
    );
    expect(sp.get('customer_id')).toBe('412');
    expect(sp.get('brand_id')).toBe('21');
    expect(sp.get('branch_id')).toBe('10');
    expect(sp.get('status')).toBe('completed');
    // Still the whole history of that slice, not today's.
    expect(sp.has('date_from')).toBe(false);
  });

  it('adds no narrowing it was not asked for', () => {
    const sp = parse(customerOrdersPath({ id: 1, name: 'A', phone: '03000000000' }, { brandId: null }));
    expect(sp.has('brand_id')).toBe(false);
    expect(sp.has('branch_id')).toBe(false);
    expect(sp.has('status')).toBe(false);
  });

  it('survives names that would break a query string', () => {
    const sp = parse(customerOrdersPath({ id: 9, name: 'Ali & Sons #1 ?x=1', phone: '03001234567' }));
    expect(sp.get('customer_id')).toBe('9');
    expect(sp.get('customer_label')).toBe('Ali & Sons #1 ?x=1 (03001234567)');
  });
});
