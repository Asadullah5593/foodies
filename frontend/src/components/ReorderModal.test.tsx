import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ThemeProvider } from '../contexts/ThemeContext';
import ReorderModal, { ReorderRow } from './ReorderModal';

const rows: ReorderRow[] = [
  { id: 11, name: 'Zinger Burger' },
  { id: 22, name: 'Beef Burger' },
  { id: 33, name: 'Chicken Burger' },
];

const renderModal = (props: Partial<React.ComponentProps<typeof ReorderModal>> = {}) => {
  const onSave = props.onSave ?? vi.fn();
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <ThemeProvider>
      <ReorderModal
        isOpen={props.isOpen ?? true}
        onClose={onClose}
        title={props.title ?? 'Reorder items'}
        rows={props.rows ?? rows}
        onSave={onSave}
        isSaving={props.isSaving}
      />
    </ThemeProvider>
  );
  return { ...utils, onSave, onClose };
};

describe('ReorderModal', () => {
  it('lists every row in the given order with its would-be position', () => {
    renderModal();
    const names = screen.getAllByText(/Burger$/).map((n) => n.textContent);
    expect(names).toEqual(['Zinger Burger', 'Beef Burger', 'Chicken Burger']);
    // Positions are 1-based: 0 means "unset" everywhere else in the feature.
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('saves the ids in their displayed order', () => {
    const { onSave } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
    expect(onSave).toHaveBeenCalledWith([11, 22, 33]);
  });

  it('gives every row a drag handle', () => {
    renderModal();
    expect(screen.getAllByTitle('Drag to reorder')).toHaveLength(3);
  });

  it('cannot save an empty scope', () => {
    renderModal({ rows: [] });
    expect(screen.getByText('Nothing here to reorder.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save order' })).toBeDisabled();
  });

  it('closes without saving on cancel', () => {
    const { onSave, onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('re-seeds when the scope changes, so a stale order is never saved', () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <ThemeProvider>
        <ReorderModal isOpen onClose={vi.fn()} title="t" rows={rows} onSave={onSave} />
      </ThemeProvider>
    );
    const nextScope: ReorderRow[] = [
      { id: 44, name: 'Pepsi' },
      { id: 55, name: 'Fanta' },
    ];
    rerender(
      <ThemeProvider>
        <ReorderModal isOpen onClose={vi.fn()} title="t" rows={nextScope} onSave={onSave} />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
    expect(onSave).toHaveBeenCalledWith([44, 55]);
  });
});
