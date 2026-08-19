import { describe, it, expect } from 'vitest';
import { hasRestriction, hasPermission } from '../hooks/useHasPermission';
import {
  NO_CANCEL_PERMISSION,
  selectableStatuses,
} from './orderStatusPermissions';

const FLOW = ['placed', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'];

describe('selectableStatuses', () => {
  it('drops cancelled for a no-cancel account', () => {
    expect(selectableStatuses(FLOW, true)).toEqual([
      'placed', 'accepted', 'preparing', 'ready', 'completed',
    ]);
  });

  it('leaves the list alone otherwise', () => {
    expect(selectableStatuses(FLOW, false)).toEqual(FLOW);
  });
});

describe('hasRestriction vs hasPermission', () => {
  const superAdmin = { is_super_admin: true, permissions: [] as string[] };

  it('a super admin passes every GRANT check', () => {
    expect(hasPermission(superAdmin, NO_CANCEL_PERMISSION)).toBe(true);
  });

  it('REGRESSION: but is NOT restricted by one they were never assigned', () => {
    // Using hasPermission here would strip cancel from the one account meant to
    // be unrestricted, and disagree with the server (which never enriches a
    // super admin's permissions, so it treats them as unrestricted).
    expect(hasRestriction(superAdmin, NO_CANCEL_PERMISSION)).toBe(false);
  });

  it('applies when it really is assigned', () => {
    expect(
      hasRestriction({ permissions: [NO_CANCEL_PERMISSION] }, NO_CANCEL_PERMISSION),
    ).toBe(true);
  });

  it.each([null, {}, { permissions: [] }])('treats %p as unrestricted', (user) => {
    expect(hasRestriction(user as never, NO_CANCEL_PERMISSION)).toBe(false);
  });
});
