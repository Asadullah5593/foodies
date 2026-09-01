import { describe, it, expect } from 'vitest';
import {
  isEntityActive,
  isEntityInactive,
  labelWithStatus,
  withoutInactive,
} from './entityStatus';

/**
 * The API says "active" in three different ways depending on the endpoint, and
 * a missing field must never read as inactive — that would libel a live record
 * on every screen it appears.
 */
describe('isEntityActive', () => {
  it('reads is_active when present', () => {
    expect(isEntityActive({ is_active: true })).toBe(true);
    expect(isEntityActive({ is_active: false })).toBe(false);
  });

  it('reads isActive (entities serialized straight through)', () => {
    expect(isEntityActive({ isActive: false })).toBe(false);
    expect(isEntityActive({ isActive: true })).toBe(true);
  });

  it("reads brands' status string", () => {
    expect(isEntityActive({ status: 'inactive' })).toBe(false);
    expect(isEntityActive({ status: 'INACTIVE' })).toBe(false);
    expect(isEntityActive({ status: 'active' })).toBe(true);
  });

  it('prefers is_active over the other spellings when both are present', () => {
    expect(isEntityActive({ is_active: false, status: 'active' })).toBe(false);
    expect(isEntityActive({ is_active: true, status: 'inactive' })).toBe(true);
  });

  it('treats anything that does not say otherwise as ACTIVE', () => {
    expect(isEntityActive({})).toBe(true);
    expect(isEntityActive(null)).toBe(true);
    expect(isEntityActive(undefined)).toBe(true);
    expect(isEntityActive({ is_active: null })).toBe(true);
    expect(isEntityActive({ status: null })).toBe(true);
  });

  it('isEntityInactive is its inverse', () => {
    expect(isEntityInactive({ is_active: false })).toBe(true);
    expect(isEntityInactive({})).toBe(false);
  });
});

describe('labelWithStatus', () => {
  it('suffixes only an inactive record', () => {
    expect(labelWithStatus('Fireaway', { is_active: false })).toBe('Fireaway (Inactive)');
    expect(labelWithStatus('Fireaway', { is_active: true })).toBe('Fireaway');
    expect(labelWithStatus('Fireaway', {})).toBe('Fireaway');
  });
});

describe('withoutInactive', () => {
  const list = [
    { id: 1, is_active: true },
    { id: 2, is_active: false },
    { id: 3, status: 'inactive' },
    { id: 4 },
  ];

  it('drops inactive records from a selling surface', () => {
    expect(withoutInactive(list).map((x) => x.id)).toEqual([1, 4]);
  });

  it('keeps an inactive record that is currently selected — never change a cart under the cashier', () => {
    expect(withoutInactive(list, (x) => x.id === 2).map((x) => x.id)).toEqual([1, 2, 4]);
  });

  it('handles null and empty input', () => {
    expect(withoutInactive(null)).toEqual([]);
    expect(withoutInactive(undefined)).toEqual([]);
    expect(withoutInactive([])).toEqual([]);
  });
});
