import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery, keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';
import { useResultsRefreshing } from './useResultsRefreshing';

let resolvers: Array<(v: unknown) => void> = [];

function Harness() {
  const [filter, setFilter] = useState('a');
  const key = ['admin-orders', filter];
  const { data, isFetching } = useQuery({
    queryKey: key,
    queryFn: () => new Promise((res) => resolvers.push(res as (v: unknown) => void)),
    placeholderData: keepPreviousData,
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
  });
  const refreshing = useResultsRefreshing(key, isFetching);
  return (
    <div>
      <button onClick={() => setFilter('b')}>to-b</button>
      <button onClick={() => setFilter('a')}>to-a</button>
      <span data-testid="rows">{String(data ?? 'none')}</span>
      <span data-testid="signal">{refreshing ? 'OVERLAY' : 'no-overlay'}</span>
    </div>
  );
}

const signal = () => screen.getByTestId('signal').textContent;
const settle = async (v: string) => { await act(async () => { resolvers.shift()?.(v); }); };

describe('useResultsRefreshing', () => {
  let qc: QueryClient;
  beforeEach(() => { resolvers = []; qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
  const mount = () => render(<QueryClientProvider client={qc}><Harness /></QueryClientProvider>);

  it('shows the overlay for a filter value never seen before', async () => {
    const { getByText } = mount();
    await settle('rows-a');
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('rows-a'));
    await act(async () => { getByText('to-b').click(); });
    expect(signal()).toBe('OVERLAY');
    await settle('rows-b');
    await waitFor(() => expect(signal()).toBe('no-overlay'));
  });

  it('REGRESSION: shows the overlay going back to a CACHED filter, while its refetch is in flight', async () => {
    const { getByText } = mount();
    await settle('rows-a');
    await act(async () => { getByText('to-b').click(); });
    await settle('rows-b');
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('rows-b'));

    await act(async () => { getByText('to-a').click(); });
    expect(signal()).toBe('OVERLAY');          // isPlaceholderData reported no-overlay here

    await settle('rows-a2');
    await waitFor(() => expect(signal()).toBe('no-overlay'));
    expect(screen.getByTestId('rows')).toHaveTextContent('rows-a2');
  });

  it('stays silent for the 4s background poll — nobody asked for it', async () => {
    vi.useFakeTimers();
    try {
      mount();
      await act(async () => { resolvers.shift()?.('rows-a'); });
      expect(signal()).toBe('no-overlay');
      await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
      expect(signal()).toBe('no-overlay');
      await act(async () => { resolvers.shift()?.('rows-a-polled'); });
      expect(signal()).toBe('no-overlay');
    } finally { vi.useRealTimers(); }
  });

  it('does not latch on when a key change needs no fetch', async () => {
    const { getByText } = mount();
    await settle('rows-a');
    await act(async () => { getByText('to-a').click(); });   // same key, no change
    expect(signal()).toBe('no-overlay');
  });
});
