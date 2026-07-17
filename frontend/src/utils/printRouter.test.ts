import { describe, it, expect, vi, beforeEach } from 'vitest';

const printContent = vi.fn();
const printViaAgent = vi.fn();
const isAgentAvailable = vi.fn();
vi.mock('./print', () => ({ printContent: (...a: unknown[]) => printContent(...a) }));
vi.mock('./printAgent', () => ({
  printViaAgent: (...a: unknown[]) => printViaAgent(...a),
  isAgentAvailable: () => isAgentAvailable(),
}));

import { printDocument } from './printRouter';
import { setDevicePrinter } from './printerSettings';

const JOB = { html: '<p>receipt</p>', css: '.x{}', title: 'Customer invoice', widthMm: 80 } as const;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  isAgentAvailable.mockResolvedValue(true);
  printViaAgent.mockResolvedValue(undefined);
});

describe('printDocument routing', () => {
  it('sends a document to the printer mapped for it on this terminal', async () => {
    setDevicePrinter('customer', 'EPSON-80');
    const res = await printDocument({ ...JOB, purpose: 'customer' });
    expect(res).toEqual({ printedVia: 'agent', printer: 'EPSON-80' });
    expect(printViaAgent).toHaveBeenCalledWith({
      html: '<p>receipt</p>',
      css: '.x{}',
      printer: 'EPSON-80',
      title: 'Customer invoice',
      widthMm: 80,
    });
    expect(printContent).not.toHaveBeenCalled(); // no dialog
  });

  it('keeps the two documents on their own printers', async () => {
    setDevicePrinter('customer', 'FRONT-DESK');
    setDevicePrinter('kitchen', 'KITCHEN-80');
    await printDocument({ ...JOB, purpose: 'customer' });
    await printDocument({ ...JOB, purpose: 'kitchen', title: 'KOT 014' });
    expect(printViaAgent.mock.calls.map((c) => (c[0] as { printer: string }).printer)).toEqual([
      'FRONT-DESK',
      'KITCHEN-80',
    ]);
  });

  it('falls back to the dialog when no printer is mapped', async () => {
    const res = await printDocument({ ...JOB, purpose: 'customer' });
    expect(res.printedVia).toBe('dialog');
    expect(printContent).toHaveBeenCalledWith('<p>receipt</p>', 'Customer invoice', '.x{}');
    expect(printViaAgent).not.toHaveBeenCalled();
  });

  it('falls back to the dialog when the agent is not installed', async () => {
    setDevicePrinter('customer', 'EPSON-80');
    isAgentAvailable.mockResolvedValue(false);
    const res = await printDocument({ ...JOB, purpose: 'customer' });
    expect(res.printedVia).toBe('dialog');
    expect(printContent).toHaveBeenCalled();
  });

  it('still gets paper out when the agent errors mid-job', async () => {
    setDevicePrinter('customer', 'EPSON-80');
    printViaAgent.mockRejectedValue(new Error('Unknown printer "EPSON-80"'));
    const res = await printDocument({ ...JOB, purpose: 'customer' });
    expect(res.printedVia).toBe('dialog');
    expect(printContent).toHaveBeenCalled();
  });

  it('routes only the mapped document, leaving the other on the dialog', async () => {
    setDevicePrinter('kitchen', 'KITCHEN-80');
    const customer = await printDocument({ ...JOB, purpose: 'customer' });
    const kot = await printDocument({ ...JOB, purpose: 'kitchen' });
    expect(customer.printedVia).toBe('dialog');
    expect(kot.printedVia).toBe('agent');
  });
});
