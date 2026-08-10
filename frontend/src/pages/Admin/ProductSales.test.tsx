import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiGet = vi.fn();
vi.mock('../../utils/apiClient', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a) },
}));

import ProductSales from './ProductSales';
import { canAccessPath } from '../../lib/pathPermissions';

const report = {
  split_by: 'variant',
  status: 'completed',
  date_from: '2026-08-01',
  date_to: '2026-08-03',
  totals: {
    quantity: 15,
    orders: 6,
    gross_sales: 7225,
    discount: 1740.26,
    // Two kinds in play: a product promotion and a bank-card offer.
    discount_breakdown: { promo: 940.26, order: 0, coupon: 0, card: 800, staff: 0 },
    net_sales: 5484.74,
  },
  rows: [
    {
      menu_item_id: 2515,
      name: 'BBQ Chicken Pizza',
      category_id: 433,
      category_name: 'Pizzas',
      brand_id: 25,
      brand_name: 'Fireaway',
      branch_count: 2,
      branch_name: 'Emporium',
      quantity: 10,
      orders: 4,
      gross_sales: 5000,
      discount: 1200.26,
      discount_breakdown: { promo: 400.26, order: 0, coupon: 0, card: 800, staff: 0 },
      net_sales: 3799.74,
      children: [
        {
          id: 91,
          name: '12"',
          quantity: 7,
          orders: 3,
          gross_sales: 3500,
          discount: 900,
          discount_breakdown: { promo: 100, order: 0, coupon: 0, card: 800, staff: 0 },
          net_sales: 2600,
        },
        {
          id: 90,
          name: '9"',
          quantity: 3,
          orders: 1,
          gross_sales: 1500,
          discount: 300.26,
          discount_breakdown: { promo: 300.26, order: 0, coupon: 0, card: 0, staff: 0 },
          net_sales: 1199.74,
        },
      ],
    },
    {
      menu_item_id: 2533,
      name: 'Krunchy Wrap',
      category_id: 435,
      category_name: 'Wraps',
      brand_id: 23,
      brand_name: 'Peperi Co',
      branch_count: 1,
      branch_name: 'Pine Avenue',
      quantity: 5,
      orders: 2,
      gross_sales: 2225,
      discount: 0,
      discount_breakdown: { promo: 0, order: 0, coupon: 0, card: 0, staff: 0 },
      net_sales: 2225,
      children: [],
    },
  ],
};

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProductSales />
    </QueryClientProvider>
  );

const reportUrls = () =>
  apiGet.mock.calls.map(String).filter((u) => u.includes('/admin/reports/product-sales'));

/** Open a SearchableSelect by its aria-label and commit one of its options. */
const pick = async (control: string, option: string) => {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${control}:`) }));
  // The dropdown commits on mousedown, before the trigger loses focus.
  fireEvent.mouseDown(await screen.findByRole('option', { name: option }));
};

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/admin/branches'))
      return Promise.resolve({
        data: [
          { id: 10, name: 'Emporium', code: 'EMP' },
          { id: 11, name: 'Pine Avenue', code: 'PIN' },
        ],
      });
    if (url.startsWith('/admin/brands'))
      return Promise.resolve({ data: [{ id: 25, name: 'Fireaway' }, { id: 23, name: 'Peperi Co' }] });
    if (url.startsWith('/admin/categories'))
      return Promise.resolve({ data: [{ id: 433, name: 'Pizzas' }, { id: 435, name: 'Wraps' }] });
    return Promise.resolve({ data: report });
  });
});

describe('ProductSales page', () => {
  it('renders the header, filter bar and KPI strip', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Product-wise Sales' })).toBeInTheDocument();
    expect(await screen.findByText('BBQ Chicken Pizza')).toBeInTheDocument();
    expect(screen.getByText('Items sold')).toBeInTheDocument();
    expect(screen.getByText('Gross sales')).toBeInTheDocument();
    expect(screen.getByText('Net sales')).toBeInTheDocument();
    // Net total, rendered with thousands separators (KPI tile + totals strip)
    expect(screen.getAllByText('Rs. 6,024.74').length).toBe(2);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print report' })).toBeInTheDocument();
  });

  it('shows a brand column and a branch column per product', async () => {
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    const table = screen.getByText('Products').closest('div')?.parentElement
      ?.parentElement as HTMLElement;
    expect(within(table).getByText('Fireaway')).toBeInTheDocument();
    expect(within(table).getByText('Peperi Co')).toBeInTheDocument();
    // Sold across more than one branch ⇒ a count, not a single name
    expect(within(table).getByText('2 branches')).toBeInTheDocument();
    expect(within(table).getByText('Pine Avenue')).toBeInTheDocument();
  });

  it('does not show a share percentage for products', async () => {
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    // No per-product percentage cell and no "Share" column
    expect(screen.queryByText(/^\d+(\.\d+)?%$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /share/i })).not.toBeInTheDocument();
    const head = screen.getByText('Category').closest('div') as HTMLElement;
    expect(within(head).queryByText(/share/i)).not.toBeInTheDocument();
  });

  it('flags discounted products and renders discounts as deductions', async () => {
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    // The badge names the biggest contributing kind, not a generic "Discounted":
    // card offer 800 leads, product promotion 400.26 is the "+1".
    expect(screen.getAllByText('Card +1').length).toBeGreaterThan(0);
    // Product row + totals strip both show the deduction
    expect(screen.getAllByText('−Rs. 1,200.26').length).toBe(2);
  });

  it('names which kinds of discount were given, on the row and in the summary', async () => {
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');

    // Per-row: the stages that actually contributed, biggest first.
    expect(screen.getAllByText('Card · Promo').length).toBeGreaterThan(0);

    // Summary strip: every kind with its own total, so the reader can see
    // whether the money came off the menu price or off the bank's offer.
    expect(screen.getAllByText('Bank card offer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Product promotion').length).toBeGreaterThan(0);
    expect(screen.getAllByText('−Rs. 800.00').length).toBeGreaterThan(0);
    // Recomputed over the visible rows, like every other figure in the strip.
    expect(screen.getAllByText('−Rs. 400.26').length).toBeGreaterThan(0);
    // Kinds that gave nothing away are not listed at all.
    expect(screen.queryByText('Staff discount')).not.toBeInTheDocument();
    expect(screen.queryByText('Coupon')).not.toBeInTheDocument();
  });

  it('passes branch, brand, category, status and split filters to the API', async () => {
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    const today = new Date().toISOString().split('T')[0];
    const url = reportUrls()[0];
    expect(url).toContain(`date_from=${today}`);
    expect(url).toContain('status=completed');
    expect(url).toContain('split_by=variant');

    await pick('Branch', 'Emporium');
    await pick('Brand', 'Fireaway');
    await pick('Orders', 'All orders');
    await waitFor(() => {
      const latest = reportUrls().slice(-1)[0];
      expect(latest).toContain('branch_id=10');
      expect(latest).toContain('brand_id=25');
      expect(latest).toContain('status=all');
    });

    // Categories are re-fetched scoped to the chosen brand
    await waitFor(() =>
      expect(apiGet.mock.calls.map(String).find((u) => u.includes('/admin/categories?'))).toContain(
        'brand_id=25'
      )
    );
  });

  it('gives every filter dropdown its own search box', async () => {
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    for (const [control, placeholder] of [
      ['Branch', 'Search branches…'],
      ['Brand', 'Search brands…'],
      ['Category', 'Search categories…'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${control}:`) }));
      const box = await screen.findByPlaceholderText(placeholder);
      expect(box).toBeInTheDocument();
      // ...and typing in it narrows the option list
      fireEvent.change(box, { target: { value: 'zzz-no-such-option' } });
      await waitFor(() => expect(screen.getByText('No matches')).toBeInTheDocument());
      fireEvent.keyDown(document, { key: 'Escape' });
    }
  });

  it('offers only variant and no-breakdown split options', async () => {
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    expect(screen.getByRole('button', { name: 'Variant / size' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No breakdown' })).toBeInTheDocument();
    const bar = screen.getByText('Break down by').parentElement as HTMLElement;
    expect(within(bar).queryByRole('button', { name: 'Branch' })).not.toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Brand' })).not.toBeInTheDocument();
  });

  it('switches the breakdown with the pill buttons', async () => {
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    fireEvent.click(screen.getByRole('button', { name: 'No breakdown' }));
    await waitFor(() => expect(reportUrls().slice(-1)[0]).toContain('split_by=none'));
  });

  it('expands a product to show its breakdown, and expand-all opens every row', async () => {
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    expect(screen.queryByText('12"')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle BBQ Chicken Pizza' }));
    expect(await screen.findByText('12"')).toBeInTheDocument();
    expect(screen.getByText('9"')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(await screen.findByText('12"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    await waitFor(() => expect(screen.queryByText('12"')).not.toBeInTheDocument());
  });

  it('filters the visible rows and totals by the search box', async () => {
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    fireEvent.change(screen.getByPlaceholderText('Search product, category or brand…'), {
      target: { value: 'krunchy' },
    });
    await waitFor(() => expect(screen.queryByText('BBQ Chicken Pizza')).not.toBeInTheDocument());
    expect(screen.getByText('Krunchy Wrap')).toBeInTheDocument();
    expect(screen.getByText('1 product')).toBeInTheDocument();
    // Totals follow the visible rows
    expect(screen.getAllByText('Rs. 2,225.00').length).toBeGreaterThan(0);
  });

  it('re-queries with the new sort when a sortable header is clicked', async () => {
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    fireEvent.click(screen.getByRole('button', { name: /^Qty/ }));
    await waitFor(() => {
      const latest = reportUrls().slice(-1)[0];
      expect(latest).toContain('sort_by=quantity');
      expect(latest).toContain('sort_dir=desc');
    });
  });

  it('clears every filter back to today', async () => {
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    await pick('Branch', 'Emporium');
    await waitFor(() => expect(reportUrls().slice(-1)[0]).toContain('branch_id=10'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(reportUrls().slice(-1)[0]).not.toContain('branch_id'));
  });

  it('exports rows, brand/branch and the breakdown as CSV', async () => {
    const created: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = vi.fn();
        created.push(el as HTMLAnchorElement);
      }
      return el;
    });
    let csv = '';
    vi.stubGlobal(
      'Blob',
      class {
        constructor(parts: string[]) {
          csv = parts.join('');
        }
      }
    );
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });

    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(csv).toContain(
      'Product,Category,Brand,Branch,Variant / size,Qty sold,Orders,Gross sales,Discount,Product promotion,Order discount,Coupon,Bank card offer,Staff discount,Net sales'
    );
    expect(csv).toContain('BBQ Chicken Pizza,Pizzas,Fireaway,2 branches,,10,4,5000,1200.26,400.26,0,0,800,0,3799.74');
    // Child rows are exported under their parent
    expect(csv).toContain('BBQ Chicken Pizza,Pizzas,Fireaway,2 branches,"12""",7,3,3500,900,100,0,0,800,0,2600');
    expect(created[0].download).toMatch(/^product-sales_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.csv$/);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows an empty state when nothing sold', async () => {
    apiGet.mockImplementation((url: string) =>
      url.startsWith('/admin/reports')
        ? Promise.resolve({
            data: {
              ...report,
              rows: [],
              totals: { quantity: 0, orders: 0, gross_sales: 0, discount: 0, net_sales: 0 },
            },
          })
        : Promise.resolve({ data: [] })
    );
    renderPage();
    expect(await screen.findByText('No products match these filters.')).toBeInTheDocument();
  });

  it('reports a failed fetch instead of an empty table', async () => {
    apiGet.mockImplementation((url: string) =>
      url.startsWith('/admin/reports')
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ data: [] })
    );
    renderPage();
    expect(await screen.findByText('Could not load product sales.')).toBeInTheDocument();
  });
});

describe('ProductSales pagination', () => {
  /** 30 products so the default page size of 25 actually splits them. */
  const many = {
    ...report,
    rows: Array.from({ length: 30 }, (_, i) => ({
      ...report.rows[1],
      menu_item_id: 9000 + i,
      name: `Product ${String(i + 1).padStart(2, '0')}`,
      net_sales: 1000 - i,
      gross_sales: 1000 - i,
      discount: 0,
      quantity: 1,
      orders: 1,
      children: [],
    })),
  };

  beforeEach(() => {
    apiGet.mockImplementation((url: string) =>
      url.startsWith('/admin/reports') ? Promise.resolve({ data: many }) : Promise.resolve({ data: [] })
    );
  });

  it('pages the table and reports the visible window', async () => {
    renderPage();
    expect(await screen.findByText('Product 01')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–25 of 30')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.queryByText('Product 26')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Product 26')).toBeInTheDocument();
    expect(screen.queryByText('Product 01')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 26–30 of 30')).toBeInTheDocument();
    // Rank keeps counting across pages: the last row is numbered 30, not 5
    const lastRow = screen.getByText('Product 30').closest('div')?.parentElement
      ?.parentElement as HTMLElement;
    expect(within(lastRow).getByText('30')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    expect(await screen.findByText('Product 01')).toBeInTheDocument();
  });

  it('lets the reader configure how many entries a page holds', async () => {
    renderPage();
    await screen.findByText('Product 01');

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '10' } });
    await waitFor(() => expect(screen.getByText('Showing 1–10 of 30')).toBeInTheDocument());
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.queryByText('Product 11')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '»' }));
    await waitFor(() => expect(screen.getByText('Page 3 of 3')).toBeInTheDocument());
    expect(screen.getByText('Product 30')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '0' } });
    await waitFor(() => expect(screen.getByText('Showing 1–30 of 30')).toBeInTheDocument());
    expect(screen.getByText('Product 01')).toBeInTheDocument();
    expect(screen.getByText('Product 30')).toBeInTheDocument();
  });

  it('returns to the first page when the search narrows the list', async () => {
    renderPage();
    await screen.findByText('Product 01');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Product 26');

    fireEvent.change(screen.getByPlaceholderText('Search product, category or brand…'), {
      target: { value: 'Product 0' },
    });
    await waitFor(() => expect(screen.getByText('Showing 1–9 of 9')).toBeInTheDocument());
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
  });

  it('keeps the totals strip across every page, not just the visible one', async () => {
    renderPage();
    await screen.findByText('Product 01');
    // 30 rows × qty 1, whatever the page size
    expect(screen.getByText('Showing 1–25 of 30')).toBeInTheDocument();
    const totalsQty = screen.getAllByText('30');
    expect(totalsQty.length).toBeGreaterThan(0);
  });
});

describe('ProductSales print view', () => {
  const many = {
    ...report,
    rows: Array.from({ length: 30 }, (_, i) => ({
      ...report.rows[1],
      menu_item_id: 8000 + i,
      name: `Printed ${String(i + 1).padStart(2, '0')}`,
      children: [],
    })),
  };
  const printRoot = () => document.getElementById('ps-print-root') as HTMLElement;

  it('carries no hidden copy of the report until a print is asked for', async () => {
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    expect(printRoot()).toBeNull();
  });

  it('prints the whole selection, not just the page on screen', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    apiGet.mockImplementation((url: string) =>
      url.startsWith('/admin/reports') ? Promise.resolve({ data: many }) : Promise.resolve({ data: [] })
    );

    renderPage();
    await screen.findByText('Printed 01');
    // Page 1 of 2 on screen
    expect(screen.queryByText('Printed 30')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Print report' }));
    await waitFor(() => expect(printRoot()).not.toBeNull());

    const paper = within(printRoot());
    expect(paper.getByText('Printed 01')).toBeInTheDocument();
    expect(paper.getByText('Printed 30')).toBeInTheDocument();
    // The print root is display:none off-paper, so the a11y tree needs hidden:true
    expect(paper.getAllByRole('row', { hidden: true })).toHaveLength(32); // head + 30 + totals
    expect(paper.getByRole('heading', { name: 'Product-wise Sales', hidden: true })).toBeInTheDocument();
    expect(paper.getByText('Totals')).toBeInTheDocument();

    // None of the controls make it onto the paper
    expect(paper.queryByRole('button', { hidden: true })).toBeNull();
    expect(paper.queryByText('Break down by')).toBeNull();
    expect(paper.queryByText('Rows per page')).toBeNull();

    await waitFor(() => expect(print).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });

  it('takes the report back out of the DOM once printing ends', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    fireEvent.click(screen.getByRole('button', { name: 'Print report' }));
    await waitFor(() => expect(printRoot()).not.toBeNull());

    fireEvent(window, new Event('afterprint'));
    await waitFor(() => expect(printRoot()).toBeNull());
    vi.unstubAllGlobals();
  });

  it('states the filters the figures were produced under', async () => {
    vi.stubGlobal('print', vi.fn());
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    await pick('Brand', 'Fireaway');
    await waitFor(() => expect(reportUrls().slice(-1)[0]).toContain('brand_id=25'));

    fireEvent.click(screen.getByRole('button', { name: 'Print report' }));
    await waitFor(() => expect(printRoot()).not.toBeNull());
    const meta = printRoot().querySelector('.psp-meta')?.textContent ?? '';
    expect(meta).toContain('Completed only');
    expect(meta).toContain('Breakdown: Variant / size');
    expect(meta).toContain('Generated');
    expect(printRoot().querySelector('.psp-sub')?.textContent).toContain('Fireaway');
    vi.unstubAllGlobals();
  });
});

describe('Reports sub-page access', () => {
  const user = (permissions: string[]) => ({ permissions, tenant_id: 1 });

  it('inherits reports:view for the product-sales sub-path', () => {
    expect(canAccessPath(user(['reports:view']), '/admin/reports/product-sales')).toBe(true);
    expect(canAccessPath(user(['orders:view']), '/admin/reports/product-sales')).toBe(false);
  });
});

describe('ProductSales table head', () => {
  it('lists every column including brand and branch', async () => {
    renderPage();
    await screen.findByText('BBQ Chicken Pizza');
    const head = screen.getByText('Category').closest('div') as HTMLElement;
    for (const col of ['#', 'Category', 'Brand', 'Branch', 'Discount']) {
      expect(within(head).getByText(col)).toBeInTheDocument();
    }
    expect(within(head).getByRole('button', { name: /^Product/ })).toBeInTheDocument();
    expect(within(head).getByRole('button', { name: /^Net/ })).toBeInTheDocument();
  });
});
