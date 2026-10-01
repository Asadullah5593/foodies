import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ThemeProvider } from '../contexts/ThemeContext';
import { paymentRequiredFrom, usePaymentRequiredPrompt, PaymentRequired } from './PaymentRequiredModal';

const required = (over: Partial<PaymentRequired> = {}): PaymentRequired => ({
  code: 'PAYMENT_REQUIRED',
  message: 'Order #002 is missing payment',
  order_id: 38184,
  order_number: '002',
  total_amount: 2104.92,
  outstanding: 2104.92,
  tax_basis: 'card',
  payment_methods: ['card', 'online_transfer'],
  ...over,
});
const conflict = (data: unknown) => ({ response: { status: 409, data } });

describe('paymentRequiredFrom', () => {
  it('picks out only the payment-required refusal', () => {
    expect(paymentRequiredFrom(conflict(required()))?.order_id).toBe(38184);
    expect(paymentRequiredFrom(conflict({ message: 'Another conflict' }))).toBeNull();
    expect(paymentRequiredFrom({ response: { status: 400, data: required() } })).toBeNull();
    expect(paymentRequiredFrom(new Error('Network Error'))).toBeNull();
  });
});

let ask: (error: unknown) => boolean = () => false;
const Harness: React.FC<{ complete: (id: number, m: string) => Promise<unknown>; onCompleted?: (id: number) => void }> = ({
  complete,
  onCompleted,
}) => {
  const prompt = usePaymentRequiredPrompt({ complete, onCompleted });
  ask = prompt.ask;
  return <>{prompt.modal}</>;
};
const renderHarness = (complete: (id: number, m: string) => Promise<unknown>, onCompleted?: (id: number) => void) =>
  render(
    <ThemeProvider>
      <Harness complete={complete} onCompleted={onCompleted} />
    </ThemeProvider>,
  );

describe('usePaymentRequiredPrompt', () => {
  it('leaves other errors to the page', () => {
    renderHarness(vi.fn());
    let handled = true;
    act(() => {
      handled = ask(new Error('Network Error'));
    });
    expect(handled).toBe(false);
    expect(screen.queryByText('Payment missing')).toBeNull();
  });

  it('asks for a method matching the order tax, then completes with it', async () => {
    const complete = vi.fn().mockResolvedValue({});
    const onCompleted = vi.fn();
    renderHarness(complete, onCompleted);
    act(() => {
      expect(ask(conflict(required()))).toBe(true);
    });

    expect(await screen.findByText('Payment missing')).toBeInTheDocument();
    const select = screen.getByLabelText('Payment method') as HTMLSelectElement;
    const offered = Array.from(select.options).filter((o) => !o.disabled).map((o) => o.value);
    expect(offered).toEqual(['card', 'online_transfer']);

    const save = screen.getByRole('button', { name: /save & complete/i });
    expect(save).toBeDisabled();
    fireEvent.change(select, { target: { value: 'online_transfer' } });
    fireEvent.click(save);

    await waitFor(() => expect(complete).toHaveBeenCalledWith(38184, 'online_transfer'));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(38184));
    await waitFor(() => expect(screen.queryByText('Payment missing')).toBeNull());
  });

  it('preselects the only allowed method for a cash-taxed order', async () => {
    renderHarness(vi.fn());
    act(() => {
      ask(conflict(required({ tax_basis: 'cash', payment_methods: ['cash'] })));
    });
    const select = (await screen.findByLabelText('Payment method')) as HTMLSelectElement;
    expect(select.value).toBe('cash');
  });

  it('walks a bulk complete through each unpaid order in turn', async () => {
    const complete = vi.fn().mockResolvedValue({});
    renderHarness(complete);
    act(() => {
      ask(conflict(required({ order_id: 1, order_number: '011', payment_methods: ['cash'] })));
      ask(conflict(required({ order_id: 2, order_number: '012', payment_methods: ['cash'] })));
      // The same order refused twice is asked about once.
      ask(conflict(required({ order_id: 2, order_number: '012', payment_methods: ['cash'] })));
    });

    expect(await screen.findByText('#011')).toBeInTheDocument();
    expect(screen.getByText(/1 more unpaid order after this one/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(await screen.findByText('#012')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save & complete/i }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(2, 'cash'));
    await waitFor(() => expect(screen.queryByText('Payment missing')).toBeNull());
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('keeps the prompt open when saving fails', async () => {
    const complete = vi.fn().mockRejectedValue({ response: { data: { message: 'Order not found' } } });
    renderHarness(complete);
    act(() => {
      ask(conflict(required({ payment_methods: ['cash'] })));
    });
    fireEvent.click(await screen.findByRole('button', { name: /save & complete/i }));
    await waitFor(() => expect(complete).toHaveBeenCalled());
    expect(screen.getByText('Payment missing')).toBeInTheDocument();
  });
});
