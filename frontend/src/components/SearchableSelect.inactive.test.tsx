import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchableSelect from './SearchableSelect';
import SearchableMultiSelect from './SearchableMultiSelect';

/**
 * A deactivated record offered in a dropdown used to look exactly like a live
 * one. It stays selectable — an existing assignment has to remain editable —
 * but it must say so.
 */
describe('SearchableSelect — inactive options', () => {
  const options = [
    { value: '1', label: 'Peperi Co' },
    { value: '2', label: 'Fireaway', inactive: true },
  ];

  const open = () => fireEvent.click(screen.getByRole('button'));

  it('marks only the inactive option in the list', () => {
    render(<SearchableSelect value="" onChange={() => {}} options={options} />);
    open();
    expect(screen.getByText('Fireaway')).toBeTruthy();
    expect(screen.getByText('Peperi Co')).toBeTruthy();
    expect(screen.getAllByText('Inactive')).toHaveLength(1);
  });

  it('shows no badge when every option is active', () => {
    render(
      <SearchableSelect value="" onChange={() => {}} options={[{ value: '1', label: 'Peperi Co' }]} />,
    );
    open();
    expect(screen.queryByText('Inactive')).toBeNull();
  });

  it('marks the closed trigger when the SELECTED record is inactive', () => {
    render(<SearchableSelect value="2" onChange={() => {}} options={options} />);
    // Not opened — the badge must be visible on the collapsed control.
    expect(screen.getByText('Inactive')).toBeTruthy();
  });

  it('keeps an inactive option selectable', () => {
    const onChange = vi.fn();
    render(<SearchableSelect value="" onChange={onChange} options={options} />);
    open();
    fireEvent.mouseDown(screen.getByText('Fireaway'));
    expect(onChange).toHaveBeenCalledWith('2');
  });
});

describe('SearchableMultiSelect — inactive options', () => {
  it('marks only the inactive option', () => {
    render(
      <SearchableMultiSelect
        options={[
          { id: 1, name: 'Johar Town' },
          { id: 2, name: 'Pine Avenue', inactive: true },
        ]}
        selectedIds={[]}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getAllByText('Inactive')).toHaveLength(1);
    expect(screen.getByText('Pine Avenue')).toBeTruthy();
  });
});
