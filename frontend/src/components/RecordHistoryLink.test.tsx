import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

const mockUser = vi.fn();
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser() }),
}));

import RecordHistoryLink from './RecordHistoryLink';

const renderLink = (props = {}) =>
  render(
    <MemoryRouter>
      <RecordHistoryLink
      module="menu"
      entityType="menu_item"
      entityId={2421}
      label="Pepperoni"
      {...props}
    />
    </MemoryRouter>
  );

describe('RecordHistoryLink', () => {
  it('renders nothing for a user without activity-log:view', () => {
    // The gate that matters: a menu editor holds menu:edit and must still not
    // be shown a door into the audit trail.
    mockUser.mockReturnValue({ permissions: ['menu:edit', 'menu:manage'] });
    const { container } = renderLink();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when nobody is logged in', () => {
    mockUser.mockReturnValue(null);
    const { container } = renderLink();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders for a narrow grant covering THIS module', () => {
    // A menu manager sees price history without seeing users, roles or money.
    mockUser.mockReturnValue({ permissions: ['activity-log:view:menu'] });
    renderLink();
    expect(screen.getByRole('link', { name: /History/ })).toBeInTheDocument();
  });

  it('does not leak across modules', () => {
    // Holding menu history must not reveal role history.
    mockUser.mockReturnValue({ permissions: ['activity-log:view:menu'] });
    const { container } = renderLink({ module: 'access', entityType: 'role' });
    expect(container).toBeEmptyDOMElement();
  });

  it('is not unlocked by an unrelated permission that merely looks close', () => {
    mockUser.mockReturnValue({
      permissions: ['activity-log:export', 'reports:view', 'roles:manage'],
    });
    const { container } = renderLink();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders for a holder of activity-log:view', () => {
    mockUser.mockReturnValue({ permissions: ['activity-log:view'] });
    renderLink();
    expect(screen.getByRole('link', { name: /History/ })).toBeInTheDocument();
  });

  it('renders for a super admin', () => {
    mockUser.mockReturnValue({ is_super_admin: true, permissions: [] });
    renderLink();
    expect(screen.getByRole('link', { name: /History/ })).toBeInTheDocument();
  });

  it('deep-links into the Activity Log with the record identified', () => {
    mockUser.mockReturnValue({ permissions: ['activity-log:view'] });
    renderLink();
    const href = screen.getByRole('link', { name: /History/ }).getAttribute('href') ?? '';
    expect(href).toContain('/admin/activity-logs?');
    expect(href).toContain('entity_type=menu_item');
    expect(href).toContain('entity_id=2421');
    expect(href).toContain('entity_label=Pepperoni');
  });
});
