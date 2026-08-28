import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SortOrderField, { formatTakenRanges } from './SortOrderField';

const renderField = (props: Partial<React.ComponentProps<typeof SortOrderField>> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  const fetchMap = props.fetchMap ?? vi.fn().mockResolvedValue({ taken: [1, 2, 3, 5], suggested: 6 });
  const utils = render(
    <QueryClientProvider client={client}>
      <SortOrderField
        value={props.value ?? ''}
        onChange={props.onChange ?? onChange}
        scopeKey={props.scopeKey === undefined ? 'b1-c4' : props.scopeKey}
        fetchMap={fetchMap}
        ownSortOrder={props.ownSortOrder}
        error={props.error}
      />
    </QueryClientProvider>
  );
  return { ...utils, onChange: props.onChange ?? onChange, fetchMap };
};

describe('formatTakenRanges', () => {
  it('collapses runs so a long menu stays readable', () => {
    expect(formatTakenRanges([1, 2, 3, 5, 8, 9])).toBe('1-3, 5, 8-9');
  });

  it('handles a single number and an empty list', () => {
    expect(formatTakenRanges([4])).toBe('4');
    expect(formatTakenRanges([])).toBe('');
  });

  it('sorts and dedupes before collapsing', () => {
    expect(formatTakenRanges([3, 1, 2, 2])).toBe('1-3');
  });
});

describe('SortOrderField', () => {
  it('shows which numbers are taken and what to use next', async () => {
    renderField();
    expect(await screen.findByText(/1-3, 5 taken · suggested: 6/)).toBeInTheDocument();
  });

  it('waits for a scope before offering a hint', () => {
    renderField({ scopeKey: null });
    expect(screen.getByText(/Pick a brand and category/)).toBeInTheDocument();
  });

  it('flags a duplicate the user typed, naming the next free number', async () => {
    renderField({ value: '5' });
    expect(await screen.findByText(/5 is already taken\. Next available: 6\./)).toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-invalid', 'true');
  });

  it('lets the row being edited keep its own number', async () => {
    renderField({ value: '5', ownSortOrder: 5 });
    await waitFor(() => expect(screen.queryByText(/already taken/)).not.toBeInTheDocument());
    expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-invalid', 'false');
  });

  it('treats an empty box as unsorted rather than an error', async () => {
    renderField({ value: '' });
    await waitFor(() => expect(screen.queryByText(/already taken/)).not.toBeInTheDocument());
  });

  it('fills the suggested number when the shortcut is clicked', async () => {
    const { onChange } = renderField();
    fireEvent.click(await screen.findByRole('button', { name: 'Use 6' }));
    expect(onChange).toHaveBeenCalledWith('6');
  });

  it('passes digits straight through', () => {
    const { onChange } = renderField();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12' } });
    expect(onChange).toHaveBeenCalledWith('12');
  });

  it('blocks decimal and exponent keys the number input would otherwise allow', () => {
    renderField();
    for (const key of ['e', '.', '-', '+', ',']) {
      const ev = fireEvent.keyDown(screen.getByRole('spinbutton'), { key });
      // fireEvent returns false when a handler called preventDefault().
      expect(ev).toBe(false);
    }
  });

  it('shows a server 409 in place of the hint', async () => {
    renderField({ error: 'Sort order 5 is already used by another menu item. Next available: 6.' });
    expect(await screen.findByText(/already used by another menu item/)).toBeInTheDocument();
  });

  it('says so when nothing has been numbered yet', async () => {
    renderField({ fetchMap: vi.fn().mockResolvedValue({ taken: [], suggested: 1 }) });
    expect(await screen.findByText(/Nothing numbered yet · suggested: 1/)).toBeInTheDocument();
  });
});
