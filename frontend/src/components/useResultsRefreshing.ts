import { useEffect, useState } from 'react';

/**
 * True while a fetch the user *asked for* — by changing a filter, a page, a page
 * size — is still in flight.
 *
 * `isPlaceholderData` is not that signal. React Query only reports placeholder
 * data when the incoming query key has nothing cached, so going back to a filter
 * or page size you already visited swaps stale rows in instantly with no
 * indicator, then quietly rewrites them when the refetch lands. Meanwhile a
 * background poll must stay silent: nobody asked for it, and veiling the table
 * every few seconds would be worse than saying nothing.
 *
 * So: arm on a key change, disarm when fetching stops. A key change that needs
 * no fetch (still fresh) disarms on the same commit and never paints, which is
 * what the overlay's own fade-in delay is there to absorb.
 */
export function useResultsRefreshing(queryKey: unknown, isFetching: boolean): boolean {
  const serialized = JSON.stringify(queryKey ?? null);
  const [settledKey, setSettledKey] = useState(serialized);
  const [awaiting, setAwaiting] = useState(false);

  // Render-phase derive: catches the change in the same commit React Query
  // starts the fetch in, so there is no frame where the rows are stale and the
  // overlay is still down.
  if (settledKey !== serialized) {
    setSettledKey(serialized);
    setAwaiting(true);
  }

  useEffect(() => {
    if (awaiting && !isFetching) setAwaiting(false);
  }, [awaiting, isFetching]);

  return awaiting;
}

export default useResultsRefreshing;
