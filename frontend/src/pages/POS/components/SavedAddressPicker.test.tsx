import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SavedAddressPicker, {
  SavedAddress,
  placeFromSavedAddress,
} from './SavedAddressPicker';

const addr = (over: Partial<SavedAddress> = {}): SavedAddress => ({
  id: 1,
  label: null,
  address: 'House 5, Street 2, DHA Phase 5',
  latitude: 31.47,
  longitude: 74.39,
  notes: null,
  times_used: 3,
  last_used_at: new Date().toISOString(),
  ...over,
});

describe('placeFromSavedAddress — the coordinates are the point', () => {
  it('carries the point through, so the order is priced and the rider routed', () => {
    // A delivery order is refused without coordinates, the fee is priced by
    // distance from them, and the rider navigates to them. Returning the text
    // alone would look like it worked and misprice the order.
    expect(placeFromSavedAddress(addr())).toEqual({
      placeId: 'saved:1',
      address: 'House 5, Street 2, DHA Phase 5',
      latitude: 31.47,
      longitude: 74.39,
    });
  });

  it('refuses an address with no point rather than handing back a half-place', () => {
    expect(placeFromSavedAddress(addr({ latitude: null }))).toBeNull();
    expect(placeFromSavedAddress(addr({ longitude: null }))).toBeNull();
  });
});

describe('SavedAddressPicker', () => {
  const setup = (addresses: SavedAddress[], selectedId: number | null = null) => {
    const onPick = vi.fn();
    const onUseNew = vi.fn();
    render(
      <SavedAddressPicker
        addresses={addresses}
        selectedId={selectedId}
        onPick={onPick}
        onUseNew={onUseNew}
      />,
    );
    return { onPick, onUseNew };
  };

  it('renders nothing when this number has no history', () => {
    const { container } = render(
      <SavedAddressPicker addresses={[]} selectedId={null} onPick={() => {}} onUseNew={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers each address with its full text, and hands back the whole record', () => {
    const { onPick } = setup([addr(), addr({ id: 2, address: 'Jinnah Avenue, Lahore' })]);
    expect(screen.getByText(/Delivered here before \(2\)/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Jinnah Avenue/));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it('says when it was last used, so the taker can ask if they still live there', () => {
    setup([addr({ last_used_at: new Date(Date.now() - 3 * 86_400_000).toISOString() })]);
    expect(screen.getByText(/Last used 3 days ago/)).toBeTruthy();
  });

  it('shows a label and standing delivery notes when there are any', () => {
    setup([addr({ label: 'Office', notes: 'Gate code 4417' })]);
    expect(screen.getByText(/Office ·/)).toBeTruthy();
    expect(screen.getByText('Gate code 4417')).toBeTruthy();
  });

  it('marks which one is in use', () => {
    setup([addr(), addr({ id: 2, address: 'Jinnah Avenue, Lahore' })], 2);
    const chosen = screen.getByText(/Jinnah Avenue/).closest('button')!;
    expect(chosen.getAttribute('aria-pressed')).toBe('true');
  });

  it('offers a way back to typing a new address once one is picked', () => {
    const { onUseNew } = setup([addr()], 1);
    fireEvent.click(screen.getByText('Use a different address'));
    expect(onUseNew).toHaveBeenCalled();
  });

  it('does not offer that escape hatch before anything is picked', () => {
    setup([addr()]);
    expect(screen.queryByText('Use a different address')).toBeNull();
  });
});
