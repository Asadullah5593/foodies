import { describe, it, expect } from 'vitest';
import type { ActivityLogRow } from '../../services/api/activityLogService';
import {
  areaLabel,
  describeActivity,
  describeDevice,
  describeGroup,
  fieldLabel,
  groupActivity,
  isoDay,
} from './activityLogText';

const row = (over: Partial<ActivityLogRow> = {}): ActivityLogRow => ({
  id: '1',
  created_at: '2026-09-28T09:40:59.000Z',
  request_id: null,
  actor_type: 'staff',
  actor_user_id: 7,
  actor_label: 'Loranzo Cashier 01',
  actor_role_slugs: ['cashier'],
  actor_role_names: ['Cashier'],
  actor_is_super_admin: false,
  tenant_id: 1,
  branch_id: null,
  brand_id: null,
  action: 'shift.view',
  action_group: 'shifts',
  entity_type: 'shifts',
  entity_id: null,
  entity_label: null,
  summary: null,
  http_method: 'GET',
  route: '/admin/shifts',
  status_code: 200,
  outcome: 'success',
  duration_ms: 12,
  changed_fields: null,
  ip: '139.135.32.248',
  payload_truncated: false,
  diff_expected: false,
  ...over,
});

describe('describeActivity', () => {
  it('names the report rather than saying "view reports" five times', () => {
    expect(
      describeActivity(
        row({ action: 'report.view', route: '/admin/reports/sales-summary' })
      )
    ).toBe('Viewed the Sales summary report');
  });

  it('reads a list and a single record differently', () => {
    expect(describeActivity(row())).toBe('Viewed the shift list');
    expect(
      describeActivity(row({ entity_id: '82', route: '/admin/shifts/82' }))
    ).toBe('Viewed shift #82');
  });

  it('uses the record name when there is one', () => {
    expect(
      describeActivity(
        row({
          action: 'menu-item.update',
          http_method: 'PUT',
          entity_label: 'Pepperoni Pizza',
          entity_id: '12',
        })
      )
    ).toBe('Changed menu item "Pepperoni Pizza"');
  });

  it('never claims a refused or failed action happened', () => {
    expect(
      describeActivity(
        row({
          action: 'report.view',
          route: '/admin/reports/top-items',
          outcome: 'denied',
          status_code: 403,
        })
      )
    ).toBe('Tried to view the Top items report');
    expect(
      describeActivity(
        row({
          action: 'role.delete',
          http_method: 'DELETE',
          entity_id: '4',
          outcome: 'failed',
        })
      )
    ).toBe('Tried to delete role #4');
  });

  it('words sign-ins, including the failed ones', () => {
    expect(
      describeActivity(
        row({ action: 'auth.login', http_method: 'POST', entity_label: 'foodies' })
      )
    ).toBe('Signed in as "foodies"');
    expect(
      describeActivity(
        row({
          action: 'auth.login.failed',
          http_method: 'POST',
          entity_label: 'foodies',
          outcome: 'denied',
        })
      )
    ).toBe('Sign-in failed for "foodies"');
  });

  it('words what the browser reported', () => {
    const client = { action_group: 'client', http_method: null, route: null };
    expect(
      describeActivity(
        row({ ...client, action: 'client.page-view', entity_type: 'shifts' })
      )
    ).toBe('Opened the Shifts screen');
    expect(
      describeActivity(
        row({
          ...client,
          action: 'client.print',
          entity_type: 'invoice',
          entity_id: '5012',
          summary: 'invoice (automatic, no user action)',
        })
      )
    ).toBe('Auto-printed invoice #5012');
    expect(
      describeActivity(
        row({ ...client, action: 'client.export', entity_type: 'inventory-ledger' })
      )
    ).toBe('Exported stock ledger to a file');
  });

  it('tells voiding a cash-out from recording one', () => {
    expect(
      describeActivity(
        row({
          action: 'shift.void',
          http_method: 'POST',
          route: '/admin/shifts/82/cash-outs/2/void',
          entity_id: '2',
        })
      )
    ).toBe('Voided a cash-out');
  });

  it('still reads as something for an action with no wording yet', () => {
    expect(
      describeActivity(
        row({ action: 'order.reprice-items', http_method: 'POST', entity_id: '9' })
      )
    ).toBe('Order #9: reprice items');
  });

  it('uses what the service said happened, led by the record', () => {
    const order = {
      action: 'order.update-status',
      action_group: 'orders',
      http_method: 'PUT',
      route: '/admin/orders/501/status',
      entity_type: 'order',
      entity_id: '501',
      entity_label: '013 · FDS-A7K2M9QX',
    };
    expect(
      describeActivity(
        row({ ...order, summary: 'Status changed from preparing to ready' })
      )
    ).toBe('Order 013: status changed from preparing to ready');
    expect(
      describeActivity(
        row({ ...order, summary: 'Placed as a delivery order from the POS' })
      )
    ).toBe('Order 013: placed as a delivery order from the POS');
  });

  it('still words an order row written before orders were labelled', () => {
    expect(
      describeActivity(
        row({
          action: 'order.update-status',
          action_group: 'orders',
          http_method: 'PUT',
          route: '/admin/orders/501/status',
          entity_type: 'orders',
          entity_id: '501',
        })
      )
    ).toBe('Changed the status of order #501');
  });
});

describe('groupActivity', () => {
  const at = (seconds: number) =>
    new Date(Date.parse('2026-09-28T09:40:00.000Z') + seconds * 1000).toISOString();

  it('folds reads by one person from one address in the same minute', () => {
    const groups = groupActivity([
      row({ id: '3', created_at: at(2), action: 'client.page-view', http_method: null }),
      row({ id: '2', created_at: at(1) }),
      row({ id: '1', created_at: at(0), action: 'branch.view', route: '/admin/branches/4' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(describeGroup(groups[0])).toEqual({
      title: 'Opened the Shifts screen',
      detail: '2 related reads',
    });
  });

  it('keeps different people, addresses and minutes apart', () => {
    expect(
      groupActivity([
        row({ id: '4', created_at: at(200) }),
        row({ id: '3', created_at: at(3) }),
        row({ id: '2', created_at: at(2), ip: '10.0.0.9' }),
        row({ id: '1', created_at: at(1), actor_user_id: 8, ip: '10.0.0.9' }),
      ])
    ).toHaveLength(4);
  });

  it('never folds a change, a refusal or a failure', () => {
    const groups = groupActivity([
      row({ id: '3', created_at: at(2) }),
      row({ id: '2', created_at: at(1), outcome: 'denied' }),
      row({ id: '1', created_at: at(0), action: 'shift.close', http_method: 'POST' }),
    ]);
    expect(groups).toHaveLength(3);
  });

  it('counts a repeat instead of listing it', () => {
    const groups = groupActivity([
      row({ id: '2', created_at: at(1) }),
      row({ id: '1', created_at: at(0) }),
    ]);
    expect(describeGroup(groups[0])).toEqual({
      title: 'Viewed the shift list',
      detail: '2 times',
    });
  });
});

describe('labels', () => {
  it('names areas in plain words', () => {
    expect(areaLabel('access')).toBe('Users & roles');
    expect(areaLabel('auth')).toBe('Sign-ins');
    expect(areaLabel('something-new')).toBe('Something new');
    expect(areaLabel(null)).toBe('—');
  });

  it('reads field names, including namespaced ones', () => {
    expect(fieldLabel('base_price')).toBe('Base price');
    expect(fieldLabel('menu_item#12.base_price')).toBe('Menu item #12 · Base price');
  });

  it('recognises the device behind a browser string', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
      )
    ).toBe('Chrome on Windows');
    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
      )
    ).toBe('Safari on iOS');
    expect(describeDevice('Dart/3.4 (dart:io)')).toBe('Mobile app');
    expect(describeDevice(null)).toBeNull();
  });

  it('takes the calendar day from the local clock, not from UTC', () => {
    expect(isoDay(new Date(2026, 8, 28, 1, 30))).toBe('2026-09-28');
  });
});
