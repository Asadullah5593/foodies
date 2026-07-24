import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import PaymentPanel, { PaymentPanelProps } from './PaymentPanel';

const baseProps = (over: Partial<PaymentPanelProps> = {}): PaymentPanelProps => ({
  subtotal: 789,
  quote: { total_amount: 789 },
  paymentMode: 'cash',
  onPaymentModeChange: vi.fn(),
  paymentCashAmount: '',
  paymentCardAmount: '',
  onPaymentCashAmountChange: vi.fn(),
  onPaymentCardAmountChange: vi.fn(),
  onCreateOrder: vi.fn(),
  isSubmitting: false,
  itemCount: 1,
  ...over,
});

const renderPanel = (over?: Partial<PaymentPanelProps>) =>
  render(
    <ThemeProvider>
      <PaymentPanel {...baseProps(over)} />
    </ThemeProvider>,
  );

describe('PaymentPanel — cash tendered / change due', () => {
  it('shows the change to return when cash received exceeds the total', () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText('Amount handed over'), {
      target: { value: '1000' },
    });
    expect(screen.getByText('Change due')).toBeInTheDocument();
    expect(screen.getByText('Rs. 211.00')).toBeInTheDocument();
  });

  it('flags a short payment when cash received is below the total', () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText('Amount handed over'), {
      target: { value: '500' },
    });
    expect(screen.getByText('Short by')).toBeInTheDocument();
    expect(screen.getByText('Rs. 289.00')).toBeInTheDocument();
  });

  it('shows no change line until an amount is entered', () => {
    renderPanel();
    expect(screen.queryByText('Change due')).toBeNull();
    expect(screen.queryByText('Short by')).toBeNull();
  });

  it('hides the cash field entirely when paying by card', () => {
    renderPanel({ paymentMode: 'card' });
    expect(screen.queryByPlaceholderText('Amount handed over')).toBeNull();
  });
});
