import type { DashboardSummary } from './types';

/** Filter labels the caller resolves from its own state (ids alone are opaque). */
export interface ExportLabels {
  branch: string;
  brand: string;
}

const csvCell = (v: unknown): string => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const csvRows = (rows: unknown[][]): string =>
  rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

const money = (n: number): string => (Number(n) || 0).toFixed(2);

/**
 * The dashboard as one CSV: a metadata header, then each on-screen table as its
 * own titled section. One file, sections separated by blank lines — imports
 * cleanly into a spreadsheet without any custom tooling.
 */
export function dashboardCsv(summary: DashboardSummary, labels: ExportLabels): string {
  const k = summary.kpis;
  const sections: unknown[][][] = [];
  sections.push([
    ['Foodies dashboard report'],
    ['Range', `${summary.date_from} to ${summary.date_to}`],
    ['Branch', labels.branch],
    ['Brand', labels.brand],
  ]);
  sections.push([
    ['KPIs'],
    ['Metric', 'Value'],
    ['Revenue (completed orders)', money(k.total_revenue)],
    ['Orders placed', k.total_orders],
    ['Orders completed', k.completed_orders],
    ['Average order value', money(k.average_order_value)],
    ['Completion rate', `${((k.completion_rate ?? 0) * 100).toFixed(1)}%`],
    ['Discounts', money(k.total_discounts)],
    ['Tax', money(k.total_tax)],
    ['Delivery fees', money(k.total_delivery_fee)],
  ]);
  if (summary.sales_by_brand.length) {
    sections.push([
      ['Sales by brand'],
      ['Brand', 'Orders placed', 'Cancelled', 'Completed', 'Revenue'],
      ...summary.sales_by_brand.map((r) => [
        r.brand_name,
        r.orders,
        r.cancelled_orders,
        r.completed_orders,
        money(r.revenue),
      ]),
    ]);
  }
  if (summary.sales_by_branch.length) {
    sections.push([
      ['Sales by branch'],
      ['Branch', 'Orders placed', 'Cancelled', 'Completed', 'Revenue'],
      ...summary.sales_by_branch.map((r) => [
        r.branch_name,
        r.orders,
        r.cancelled_orders,
        r.completed_orders,
        money(r.revenue),
      ]),
    ]);
  }
  sections.push([
    ['Payments by method'],
    ['Method', 'Tenders', 'Amount'],
    ...summary.payments_by_method.map((r) => [r.method, r.count, money(r.amount)]),
  ]);
  sections.push([
    ['Orders by type'],
    ['Type', 'Orders', 'Revenue'],
    ...summary.orders_by_type.map((r) => [r.type, r.count, money(r.revenue)]),
  ]);
  sections.push([
    ['Orders by source'],
    ['Source', 'Orders', 'Revenue'],
    ...summary.orders_by_source.map((r) => [r.source, r.count, money(r.revenue)]),
  ]);
  if (summary.top_items.length) {
    sections.push([
      ['Top items'],
      ['Item', 'Quantity', 'Revenue'],
      ...summary.top_items.map((r) => [r.name, r.quantity, money(r.total_revenue)]),
    ]);
  }
  return sections.map(csvRows).join('\r\n\r\n') + '\r\n';
}

const esc = (x: unknown) =>
  String(x ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const tableHtml = (title: string, head: string[], rows: unknown[][]): string => `
  <div class="section">
    <h2>${esc(title)}</h2>
    <table>
      <thead><tr>${head
        .map((h, i) => `<th${i > 0 ? ' class="text-right"' : ''}>${esc(h)}</th>`)
        .join('')}</tr></thead>
      <tbody>${rows
        .map(
          (r) =>
            `<tr>${r
              .map((c, i) => `<td${i > 0 ? ' class="text-right"' : ''}>${esc(c)}</td>`)
              .join('')}</tr>`,
        )
        .join('')}</tbody>
    </table>
  </div>`;

/** Print-ready HTML body for the dashboard report (rendered via printContent). */
export function dashboardReportHtml(summary: DashboardSummary, labels: ExportLabels): string {
  const k = summary.kpis;
  const parts: string[] = [];
  parts.push(`<h1>Dashboard report</h1>
    <p class="meta">${esc(summary.date_from)} → ${esc(summary.date_to)} · Branch: ${esc(labels.branch)} · Brand: ${esc(labels.brand)}</p>`);
  parts.push(
    tableHtml(
      'KPIs',
      ['Metric', 'Value'],
      [
        ['Revenue (completed orders)', money(k.total_revenue)],
        ['Orders placed', k.total_orders],
        ['Orders completed', k.completed_orders],
        ['Average order value', money(k.average_order_value)],
        ['Completion rate', `${((k.completion_rate ?? 0) * 100).toFixed(1)}%`],
        ['Discounts', money(k.total_discounts)],
        ['Tax', money(k.total_tax)],
        ['Delivery fees', money(k.total_delivery_fee)],
      ],
    ),
  );
  if (summary.sales_by_brand.length)
    parts.push(
      tableHtml(
        'Sales by brand',
        ['Brand', 'Orders placed', 'Cancelled', 'Completed', 'Revenue'],
        summary.sales_by_brand.map((r) => [
          r.brand_name,
          r.orders,
          r.cancelled_orders,
          r.completed_orders,
          money(r.revenue),
        ]),
      ),
    );
  if (summary.sales_by_branch.length)
    parts.push(
      tableHtml(
        'Sales by branch',
        ['Branch', 'Orders placed', 'Cancelled', 'Completed', 'Revenue'],
        summary.sales_by_branch.map((r) => [
          r.branch_name,
          r.orders,
          r.cancelled_orders,
          r.completed_orders,
          money(r.revenue),
        ]),
      ),
    );
  parts.push(
    tableHtml(
      'Payments by method',
      ['Method', 'Tenders', 'Amount'],
      summary.payments_by_method.map((r) => [r.method, r.count, money(r.amount)]),
    ),
  );
  parts.push(
    tableHtml(
      'Orders by type',
      ['Type', 'Orders', 'Revenue'],
      summary.orders_by_type.map((r) => [r.type, r.count, money(r.revenue)]),
    ),
  );
  parts.push(
    tableHtml(
      'Orders by source',
      ['Source', 'Orders', 'Revenue'],
      summary.orders_by_source.map((r) => [r.source, r.count, money(r.revenue)]),
    ),
  );
  if (summary.top_items.length)
    parts.push(
      tableHtml(
        'Top items',
        ['Item', 'Quantity', 'Revenue'],
        summary.top_items.map((r) => [r.name, r.quantity, money(r.total_revenue)]),
      ),
    );
  return parts.join('\n');
}

/** Trigger a browser download of `content` as `filename`. */
export function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
