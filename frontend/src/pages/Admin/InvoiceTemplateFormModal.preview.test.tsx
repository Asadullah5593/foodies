import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import InvoiceTemplateFormModal from './InvoiceTemplateFormModal';
import { DEFAULT_INVOICE_TEMPLATE_CONFIG } from '../../invoices/types';

vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * The preview used to stand on a hard-coded "Bahria Town Branch", so the address
 * printed under the receipt matched no branch in the admin's list and looked
 * like a bug. It has to stand on a real branch.
 */
const baseForm = {
  id: 5,
  name: 'Bordered Logo Receipt',
  layout: 'receipt_bordered_logo' as const,
  brand_id: null,
  is_active: true,
  is_customer_default: true,
  is_kitchen_default: false,
  config: {
    ...DEFAULT_INVOICE_TEMPLATE_CONFIG,
    showBranchAddress: true,
    uanText: '111 333 666',
  },
};

const renderModal = (previewBranch: { id: number; name: string; address: string | null } | null) =>
  render(
    <InvoiceTemplateFormModal
      open
      isEdit
      form={baseForm}
      setForm={() => {}}
      brands={[]}
      previewBranch={previewBranch}
      saving={false}
      onClose={() => {}}
      onSubmit={() => {}}
    />,
  );

describe('template editor preview — branch address', () => {
  it("prints the real branch's address, and names the branch it stands on", () => {
    renderModal({ id: 10, name: 'Pine Avenue', address: 'Pine Avenue, Lahore' });
    expect(screen.getAllByText(/Pine Avenue, Lahore/).length).toBeGreaterThan(0);
    // The label that answers "where is this address coming from?"
    expect(screen.getByText(/sample order at/)).toBeTruthy();
    // The made-up sample branch must be gone.
    expect(screen.queryByText(/Bahria Town/)).toBeNull();
  });

  it('shows the UAN with no extra switch to find', () => {
    renderModal({ id: 10, name: 'Pine Avenue', address: 'Pine Avenue, Lahore' });
    expect(screen.getAllByText(/111 333 666/).length).toBeGreaterThan(0);
  });

  it('falls back to the sample while branches are still loading', () => {
    renderModal(null);
    expect(screen.getAllByText(/Bahria Town/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/sample order at/)).toBeNull();
  });
});
