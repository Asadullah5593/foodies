import { describe, it, expect } from 'vitest';
import { getStatusOptions } from './riderStatusOptions';

const values = (status: string | null | undefined) => getStatusOptions(status).map((o) => o.value);

describe('rider delivery status steps', () => {
  it('offers only Picked Up at the first step', () => {
    expect(values('accepted')).toEqual(['picked_up']);
    expect(values('assigned')).toEqual(['picked_up']);
    expect(values(null)).toEqual(['picked_up']);
  });

  it('offers Delivered or Delivery Failed once the order is picked up', () => {
    expect(values('picked_up')).toEqual(['delivered', 'delivery_failed']);
  });
});
