import { describe, it, expect } from 'vitest';
import { getDefaultLandingPath, canAccessPath } from './pathPermissions';

/** Tenant user with exactly these permissions. */
const withPerms = (permissions: string[]) => ({
  tenant_id: 1,
  is_super_admin: false,
  permissions,
});

describe('getDefaultLandingPath', () => {
  it('sends till staff to the POS when they have no dashboard', () => {
    // Cashiers and call-centre agents: POS + order history, no dashboard:view.
    // They must land on the POS, not the admin order list.
    expect(getDefaultLandingPath(withPerms(['orders:create', 'orders:view']))).toBe(
      '/pos/orders',
    );
  });

  it('still prefers the dashboard for anyone who can see it', () => {
    expect(
      getDefaultLandingPath(
        withPerms(['dashboard:view', 'orders:create', 'orders:view']),
      ),
    ).toBe('/admin/dashboard');
  });

  it('sends an order-history-only user to the admin orders list', () => {
    // No orders:create, so the POS is not an option.
    expect(getDefaultLandingPath(withPerms(['orders:view']))).toBe('/admin/orders');
  });

  it('keeps sending riders to the rider app', () => {
    expect(
      getDefaultLandingPath({
        tenant_id: 1,
        is_rider: true,
        permissions: ['deliveries:view'],
      }),
    ).toBe('/rider');
  });

  it('falls back to the dashboard when there is no user', () => {
    expect(getDefaultLandingPath(null)).toBe('/admin/dashboard');
  });
});

describe('canAccessPath — shortcuts in the top bar', () => {
  it('shows the POS shortcut only with orders:create', () => {
    expect(canAccessPath(withPerms(['orders:create']), '/pos/orders')).toBe(true);
    expect(canAccessPath(withPerms(['orders:view']), '/pos/orders')).toBe(false);
  });

  it('shows the Orders shortcut only with orders:view', () => {
    expect(canAccessPath(withPerms(['orders:view']), '/admin/orders')).toBe(true);
    expect(canAccessPath(withPerms(['orders:create']), '/admin/orders')).toBe(false);
  });
});

describe('canAccessPath — Rider Supervisor sub-module', () => {
  // The delivery manager holds exactly one permission.
  const deliveryManager = withPerms(['rider-supervisor:view']);

  it('grants the delivery manager the supervisor sub-module', () => {
    expect(canAccessPath(deliveryManager, '/admin/rider-hrm/supervisor')).toBe(true);
  });

  it('hides every other Rider HRM area from the delivery manager', () => {
    for (const p of [
      '/admin/rider-hrm',
      '/admin/rider-hrm/profiles',
      '/admin/rider-hrm/attendance',
      '/admin/rider-hrm/breaks',
      '/admin/rider-hrm/comp-plans',
      '/admin/rider-hrm/payroll',
      '/admin/rider-hrm/metrics',
      '/admin/rider-hrm/pool-sharing',
      '/admin/rider-hrm/request-riders',
    ]) {
      expect(canAccessPath(deliveryManager, p)).toBe(false);
    }
  });

  it('lands a supervisor-only user on the supervisor page', () => {
    expect(getDefaultLandingPath(deliveryManager)).toBe(
      '/admin/rider-hrm/supervisor',
    );
  });

  it('is standalone — the old rider-hrm permissions do not grant it', () => {
    expect(
      canAccessPath(
        withPerms(['deliveries:view', 'shifts:manage']),
        '/admin/rider-hrm/supervisor',
      ),
    ).toBe(false);
  });

  it('keeps pool-sharing reachable for an owner/GM who also has the supervisor view', () => {
    const owner = withPerms([
      'deliveries:view',
      'shifts:manage',
      'rider-sharing:manage',
      'rider-supervisor:view',
    ]);
    expect(canAccessPath(owner, '/admin/rider-hrm/supervisor')).toBe(true);
    expect(canAccessPath(owner, '/admin/rider-hrm/pool-sharing')).toBe(true);
  });
});

describe('canAccessPath — Orders rider-ops banner gating', () => {
  // The Orders page gates "Open Rider HRM", "Configure Branch Radius" and the
  // auto-assign pill on the routes they link to, so an orders-only user never
  // sees dead-end actions.
  it('hides both banner actions from an orders-only user (e.g. a cashier)', () => {
    const cashier = withPerms(['orders:view', 'orders:create']);
    expect(canAccessPath(cashier, '/admin/rider-hrm')).toBe(false);
    expect(canAccessPath(cashier, '/admin/branches')).toBe(false);
  });

  it('gates the two actions independently', () => {
    // Rider-ops access but no branch config → Open Rider HRM only.
    const riderOps = withPerms(['orders:view', 'deliveries:view']);
    expect(canAccessPath(riderOps, '/admin/rider-hrm')).toBe(true);
    expect(canAccessPath(riderOps, '/admin/branches')).toBe(false);
    // Branch config but no rider-hrm → Configure Branch Radius + pill only.
    const branchCfg = withPerms(['orders:view', 'branches:view']);
    expect(canAccessPath(branchCfg, '/admin/rider-hrm')).toBe(false);
    expect(canAccessPath(branchCfg, '/admin/branches')).toBe(true);
  });
});
