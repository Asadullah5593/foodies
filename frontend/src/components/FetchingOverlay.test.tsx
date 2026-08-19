import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import FetchingOverlay from './FetchingOverlay';

describe('FetchingOverlay', () => {
  it('renders children with no veil while inactive', () => {
    render(
      <FetchingOverlay active={false}>
        <p>result rows</p>
      </FetchingOverlay>
    );
    expect(screen.getByText('result rows')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps children mounted and fades a veil over them while active', () => {
    render(
      <FetchingOverlay active label="Updating orders…">
        <p>result rows</p>
      </FetchingOverlay>
    );
    // Previous results stay visible under the veil — that's the whole point.
    expect(screen.getByText('result rows')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAccessibleName('Updating orders…');
  });

  it('removes the veil when the fetch settles', async () => {
    const { rerender } = render(
      <FetchingOverlay active>
        <p>result rows</p>
      </FetchingOverlay>
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(
      <FetchingOverlay active={false}>
        <p>result rows</p>
      </FetchingOverlay>
    );
    // AnimatePresence keeps the veil mounted for the exit fade, then unmounts it.
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('result rows')).toBeInTheDocument();
  });
});
