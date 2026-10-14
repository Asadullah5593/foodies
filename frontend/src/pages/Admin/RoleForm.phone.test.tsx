import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThemeProvider } from '../../contexts/ThemeContext';

/**
 * The roles form below lg folds each permission group behind its title — 257 permissions one
 * per line is some 60 phone screens — with the group's selected count on the title and one
 * control to open or close them all. Desktop renders every group open, as it always has.
 */

const PERMISSIONS = [
  { id: 1, name: 'orders:view', resource: 'orders', action: 'view', description: 'View orders' },
  { id: 2, name: 'orders:update-status', resource: 'orders', action: 'update-status', description: 'Update an order’s status' },
  { id: 3, name: 'menu:view', resource: 'menu', action: 'view', description: 'View the menu' },
];
vi.mock('../../utils/apiClient', () => ({
  default: {
    get: vi.fn(async (url: string) => (url.includes('/permissions') ? { data: PERMISSIONS } : { data: null })),
    post: vi.fn(),
    put: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import RoleForm from './RoleForm';

const renderPage = () =>
  render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/admin/roles/new']}>
          <Routes>
            <Route path="/admin/roles/new" element={<RoleForm />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
const groups = () => screen.getAllByTestId('permission-group');

afterEach(() => setWidth(1024));

describe('RoleForm permission groups on a phone', () => {
  beforeEach(() => setWidth(390));

  it('starts with every group folded, opens one from its title and all from the control', async () => {
    renderPage();
    const heads = await screen.findAllByRole('button', { expanded: false });
    expect(heads.map((b) => b.textContent)).toEqual(['Menu', 'Orders']);
    expect(screen.queryByRole('checkbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Orders/ }));
    expect(screen.getByRole('button', { name: /^Orders/ })).toHaveAttribute('aria-expanded', 'true');
    expect(within(groups()[1]).getAllByRole('checkbox')).toHaveLength(3); // Select all + 2 permissions
    expect(within(groups()[0]).queryByRole('checkbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByRole('checkbox').length).toBe(4); // menu's one (no Select all for a single permission) + orders' three
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('shows how many of a group’s permissions are on, even while it is folded', async () => {
    renderPage();
    await screen.findAllByTestId('permission-group');
    fireEvent.click(screen.getByRole('button', { name: /^Orders/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'View orders' }));
    expect(screen.getByRole('button', { name: /^Orders/ })).toHaveTextContent('1/2');
    fireEvent.click(screen.getByRole('button', { name: /^Orders/ }));
    expect(screen.getByRole('button', { name: /^Orders/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /^Orders/ })).toHaveTextContent('1/2');
  });
});

describe('RoleForm permission groups on desktop', () => {
  it('renders every group open with no fold controls', async () => {
    renderPage();
    await screen.findAllByTestId('permission-group');
    expect(screen.getAllByRole('checkbox').length).toBe(4);
    expect(screen.queryByRole('button', { name: 'Expand all' })).toBeNull();
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
  });
});
