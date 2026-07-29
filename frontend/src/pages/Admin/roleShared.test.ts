import { describe, it, expect } from 'vitest';
import {
  Permission,
  Role,
  groupByResource,
  resourceGroupKey,
  resourceLabel,
  ceilingFieldValues,
} from './roleShared';

const perm = (id: number, name: string, resource: string): Permission => ({
  id,
  name,
  resource,
  action: name.split(':').slice(1).join(':'),
});

/** One permission from each rider resource, plus two non-rider ones. */
const PERMISSIONS: Permission[] = [
  perm(1, 'rider-attendance:manage', 'rider-attendance'),
  perm(2, 'rider-comp-plans:view', 'rider-comp-plans'),
  perm(3, 'rider-comp-plans:create', 'rider-comp-plans'),
  perm(4, 'rider-hrm:view', 'rider-hrm'),
  perm(5, 'rider-payroll:run', 'rider-payroll'),
  perm(6, 'rider-profiles:edit', 'rider-profiles'),
  perm(7, 'rider-share:request', 'rider-share'),
  perm(8, 'rider-sharing:manage', 'rider-sharing'),
  perm(9, 'rider-supervisor:view', 'rider-supervisor'),
  perm(10, 'orders:view', 'orders'),
  perm(11, 'deliveries:view', 'deliveries'),
];

describe('resourceGroupKey', () => {
  it('folds every rider-* resource into one "rider" section', () => {
    for (const r of [
      'rider-attendance',
      'rider-comp-plans',
      'rider-hrm',
      'rider-payroll',
      'rider-profiles',
      'rider-share',
      'rider-sharing',
      'rider-supervisor',
    ]) {
      expect(resourceGroupKey(r)).toBe('rider');
    }
  });

  it('leaves unrelated resources alone', () => {
    expect(resourceGroupKey('orders')).toBe('orders');
    expect(resourceGroupKey('deliveries')).toBe('deliveries');
    // Not a rider family member — no accidental prefix match.
    expect(resourceGroupKey('riders-something')).toBe('riders-something');
    expect(resourceGroupKey('')).toBe('other');
  });
});

describe('groupByResource', () => {
  it('renders one Rider section holding every rider permission', () => {
    const grouped = groupByResource(PERMISSIONS);
    expect([...grouped.keys()].sort()).toEqual(['deliveries', 'orders', 'rider']);
    expect(grouped.get('rider')!.map((p) => p.id)).toEqual([1, 3, 2, 4, 5, 6, 7, 8, 9]);
    // Section heading comes out as plain "Rider".
    expect(resourceLabel('rider')).toBe('Rider');
  });

  it('keeps each family together and ordered inside the merged section', () => {
    const names = groupByResource(PERMISSIONS)
      .get('rider')!
      .map((p) => p.name);
    expect(names).toEqual([
      'rider-attendance:manage',
      'rider-comp-plans:create',
      'rider-comp-plans:view',
      'rider-hrm:view',
      'rider-payroll:run',
      'rider-profiles:edit',
      'rider-share:request',
      'rider-sharing:manage',
      'rider-supervisor:view',
    ]);
  });

  it('does not lose any permission when merging', () => {
    const grouped = groupByResource(PERMISSIONS);
    const total = [...grouped.values()].reduce((n, arr) => n + arr.length, 0);
    expect(total).toBe(PERMISSIONS.length);
  });
});

describe('resourceLabel stays exact per permission', () => {
  it('still labels each rider resource individually (Permissions table)', () => {
    // Grouping must not blur the Resource column on the Roles page.
    expect(resourceLabel('rider-payroll')).toBe('Rider Payroll');
    expect(resourceLabel('rider-comp-plans')).toBe('Rider Comp Plans');
    expect(resourceLabel('rider-supervisor')).toBe('Rider Supervisor');
  });
});

describe('ceilingFieldValues', () => {
  const role = (over: Partial<Role> = {}): Role => ({
    id: 1,
    name: 'Cashier',
    slug: 'pos_cashier',
    ...over,
  });

  it('reads the camelCase keys the API actually returns', () => {
    // The write payload is snake_case (max_staff_discount_percent) but the read
    // comes off the entity camelCase. Reading the wrong one blanks the form.
    expect(ceilingFieldValues(role({ maxStaffDiscountPercent: 10 })).percent).toBe('10');
  });

  it('normalises the string decimals pg returns', () => {
    const v = ceilingFieldValues(
      role({ maxStaffDiscountPercent: '5.00', maxStaffDiscountAmount: '500.00' }),
    );
    expect(v.percent).toBe('5');
    expect(v.amount).toBe('500');
  });

  it('keeps a deliberate 0 — that role may grant nothing', () => {
    expect(ceilingFieldValues(role({ maxStaffDiscountPercent: 0 })).percent).toBe('0');
  });

  it('blanks a null ceiling (no limit of that kind)', () => {
    const v = ceilingFieldValues(
      role({ maxStaffDiscountPercent: null, maxStaffDiscountAmount: undefined }),
    );
    expect(v.percent).toBe('');
    expect(v.amount).toBe('');
  });

  it('survives a role that has not loaded yet', () => {
    expect(ceilingFieldValues(undefined)).toEqual({ percent: '', amount: '' });
  });
});
