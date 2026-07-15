import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import NoRidersForBrandNotice from './NoRidersForBrandNotice';

const mockUseAuth = vi.fn();
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const renderNotice = (
  allowedBrandIds: number[] | null,
  brandName: string | null = 'Wok & Go',
) => {
  mockUseAuth.mockReturnValue({ user: { allowed_brand_ids: allowedBrandIds } });
  return render(
    <MemoryRouter>
      <NoRidersForBrandNotice brandName={brandName} />
    </MemoryRouter>,
  );
};

describe('NoRidersForBrandNotice', () => {
  it('sends an owner/GM to the pool they manage', () => {
    renderNotice(null);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/admin/rider-hrm/pool-sharing');
    expect(link).toHaveTextContent('Link a rider');
  });

  it('sends a brand-locked admin to request riders, not the pool they cannot manage', () => {
    renderNotice([28]);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/admin/rider-hrm/request-riders');
    expect(link).toHaveTextContent('Request a rider');
  });

  it('names the brand so staff know which one is unstaffed', () => {
    renderNotice(null);
    expect(screen.getByText('Wok & Go')).toBeInTheDocument();
  });

  it('falls back to generic wording when the brand is unknown', () => {
    renderNotice(null, null);
    expect(screen.getByText(/this order's brand/)).toBeInTheDocument();
  });
});
