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
