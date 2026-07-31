import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DealConfigModal from './DealConfigModal';
import type { DealDefinition } from '../../../services/api/menuService';
import { MenuItem } from '../../../types';

/** Minimal 12" pizza the BOGO slots can offer. */
const pizza = (id: number, name: string, price: number): MenuItem =>
  ({
    id,
    name,
    price,
    base_price: price,
    category_id: 7,
    category: 'Classic and Signature Pizza Or Calzone',
    label: 'Classic',
    variants: [
      { id: id * 10, name: 'Large 12"', size_key: '12', price_modifier: 0 },
    ],
    modifier_groups: [],
    addons: [],
  }) as unknown as MenuItem;

const HAWAIIAN = pizza(1, 'Twisted Hawaiian Pizza', 1749);
const BBQ = pizza(2, 'BBQ Chicken Pizza', 1749);

/** Fireaway "Buy One Get One Half Price": slot 1 free choice, slot 2 mirrors it. */
const BOGO_DEAL: DealDefinition = {
  deal_menu_item_id: 99,
  name: 'Buy One Get One Half Price',
  price: 0,
  pricing_mode: 'bogo',
  bogo_get_percent: 50,
  slots: [
    {
      slot_index: 0,
      type: 'choice_category',
      quantity: 1,
      allow_customization: true,
      allowed_size_keys: ['12'],
      choice_items: [HAWAIIAN, BBQ],
    },
    {
      slot_index: 1,
      type: 'choice_category',
      quantity: 1,
      allow_customization: true,
      mirror_slot_index: 0,
      mirror_match_size: true,
      mirror_match_category: true,
      choice_items: [HAWAIIAN, BBQ],
    },
  ],
};

const renderModal = () =>
  render(
    <DealConfigModal isOpen deal={BOGO_DEAL} onClose={vi.fn()} onConfirm={vi.fn()} />,
  );

describe('DealConfigModal — no pre-selection, price builds from picks', () => {
  it('opens with nothing selected and a Rs. 0.00 total', () => {
    renderModal();
    // No pick yet → the side rail is empty and the total is zero.
    expect(screen.getByText('Items you pick will appear here.')).toBeInTheDocument();
    expect(screen.getByText('Rs. 0.00')).toBeInTheDocument();
    // The step is flagged as required, and Next is disabled until a pick is made.
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next →' })).toBeDisabled();
  });

  it('prices the deal only as slot 1 and then slot 2 are chosen', () => {
    renderModal();
    // Slot 1: pick the first pizza → total = its full price.
    fireEvent.click(screen.getByText('Twisted Hawaiian Pizza'));
    expect(screen.getByText('Rs. 1749.00')).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Next →' });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    // Slot 2 (mirror): nothing pre-selected here either.
    expect(screen.getByText('Required')).toBeInTheDocument();
    // Pick the matching pizza → full + half of the cheaper = 1749 + 874.50.
    fireEvent.click(screen.getByText('BBQ Chicken Pizza'));
    expect(screen.getByText('Rs. 2623.50')).toBeInTheDocument();
  });
});
