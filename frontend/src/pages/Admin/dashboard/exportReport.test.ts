import { describe, it, expect } from 'vitest';
import { dashboardCsv, dashboardReportHtml } from './exportReport';
import type { DashboardSummary } from './types';

const summary = {
  date_from: '2026-08-23',
  date_to: '2026-08-23',
  branch_id: null,
  brand_id: null,
  sales_by_brand: [
    {
      brand_id: 23,
      brand_name: 'Peperi, "Co"',
      orders: 53,
      cancelled_orders: 2,
      completed_orders: 51,
      revenue: 103632.49,
    },
  ],
  sales_by_branch: [],
  kpis: {
    total_revenue: 224009.05,
    completed_orders: 127,
    total_orders: 129,
    average_order_value: 1763.85,
    completion_rate: 0.9845,
    total_discounts: 10445.25,
    total_tax: 0,
    total_service_charge: 0,
    total_delivery_fee: 0,
    active_riders: 4,
    avg_brand_rating: null,
    avg_rider_rating: null,
  },
  deltas: { revenue_pct: null, orders_pct: null, aov_pct: null },
  orders_by_status: [],
  orders_by_type: [{ type: 'dine_in', count: 60, revenue: 120000 }],
  orders_by_source: [{ source: 'pos', count: 100, revenue: 200000 }],
  payments_by_method: [{ method: 'cod', amount: 810.84, count: 1 }],
  time_series: [],
  top_items: [{ menu_item_id: 1, name: 'Fries <spicy>', quantity: 9, total_revenue: 2241 }],
} as unknown as DashboardSummary;

const labels = { branch: 'All branches', brand: 'All brands' };

describe('dashboardCsv', () => {
  it('contains every section with the cancelled column and escapes cells', () => {
    const csv = dashboardCsv(summary, labels);
    expect(csv).toContain('Foodies dashboard report');
    expect(csv).toContain('Range,2026-08-23 to 2026-08-23');
    expect(csv).toContain('Brand,Orders placed,Cancelled,Completed,Revenue');
    // Comma + quote in the brand name must be quoted and doubled.
    expect(csv).toContain('"Peperi, ""Co""",53,2,51,103632.49');
    expect(csv).toContain('Revenue (completed orders),224009.05');
    expect(csv).toContain('Completion rate,98.5%');
    expect(csv).toContain('cod,1,810.84');
    expect(csv).toContain('Fries <spicy>,9,2241.00');
    // Empty sales_by_branch section is omitted entirely.
    expect(csv).not.toContain('Sales by branch');
  });
});

describe('dashboardReportHtml', () => {
  it('renders sections and escapes HTML', () => {
    const html = dashboardReportHtml(summary, labels);
    expect(html).toContain('<h1>Dashboard report</h1>');
    expect(html).toContain('Sales by brand');
    expect(html).toContain('Cancelled');
    expect(html).toContain('Fries &lt;spicy&gt;');
    expect(html).not.toContain('Fries <spicy>');
    expect(html).toContain('Peperi, &quot;Co&quot;');
    expect(html).not.toContain('Sales by branch');
  });
});
