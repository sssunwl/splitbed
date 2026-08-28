import { describe, expect, it } from 'vitest';

import { resolvePolicy } from '../src/engine/policy';
import type { Property, Room, RoomPolicy } from '../src/engine/types';

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: 'property-1',
    name: 'SplitBed Test',
    defaultPolicy: 'same_gender',
    pendingPolicy: null,
    pendingPolicyFrom: null,
    ...overrides,
  };
}

function room(roomType: RoomPolicy | null = null): Room {
  return {
    id: 'room-a',
    propertyId: 'property-1',
    code: 'A',
    roomType,
    sortOrder: 1,
  };
}

describe('resolvePolicy', () => {
  it('uses a room override even after a pending policy becomes effective', () => {
    expect(
      resolvePolicy(
        room('female_only'),
        property({ pendingPolicy: 'mixed', pendingPolicyFrom: '2026-02-01' }),
        '2026-02-10',
      ),
    ).toBe('female_only');
  });

  it('uses another room-level policy without consulting the property default', () => {
    expect(resolvePolicy(room('maintenance'), property({ defaultPolicy: 'mixed' }), '2026-01-01')).toBe(
      'maintenance',
    );
  });

  it('uses the pending policy on its effective date', () => {
    expect(
      resolvePolicy(
        room(),
        property({ pendingPolicy: 'mixed', pendingPolicyFrom: '2026-02-01' }),
        '2026-02-01',
      ),
    ).toBe('mixed');
  });

  it('uses the default policy one day before the pending policy', () => {
    expect(
      resolvePolicy(
        room(),
        property({ pendingPolicy: 'mixed', pendingPolicyFrom: '2026-02-01' }),
        '2026-01-31',
      ),
    ).toBe('same_gender');
  });

  it('uses the pending policy after its effective date', () => {
    expect(
      resolvePolicy(
        room(),
        property({ pendingPolicy: 'mixed', pendingPolicyFrom: '2026-02-01' }),
        '2026-02-02',
      ),
    ).toBe('mixed');
  });

  it('ignores a pending policy when pendingPolicyFrom is null', () => {
    expect(
      resolvePolicy(room(), property({ pendingPolicy: 'mixed', pendingPolicyFrom: null }), '2026-02-02'),
    ).toBe('same_gender');
  });

  it('uses the mixed default policy', () => {
    expect(resolvePolicy(room(), property({ defaultPolicy: 'mixed' }), '2026-01-01')).toBe('mixed');
  });

  it('maps hybrid with no room override to same_gender', () => {
    expect(resolvePolicy(room(), property({ defaultPolicy: 'hybrid' }), '2026-01-01')).toBe(
      'same_gender',
    );
  });

  it('maps an effective pending hybrid policy to same_gender', () => {
    expect(
      resolvePolicy(
        room(),
        property({
          defaultPolicy: 'mixed',
          pendingPolicy: 'hybrid',
          pendingPolicyFrom: '2026-02-01',
        }),
        '2026-02-01',
      ),
    ).toBe('same_gender');
  });
});
