import type { ISODate, Property, PropertyPolicy, Room, RoomPolicy } from './types';

function propertyPolicyToRoomPolicy(policy: PropertyPolicy): RoomPolicy {
  if (policy === 'hybrid') {
    return 'same_gender';
  }
  return policy;
}

/**
 * Resolves the room policy effective on a date.
 *
 * A room-level policy always wins. Under a hybrid property policy, a room with
 * no room-level override defaults to same_gender; mixed rooms are identified by
 * setting their roomType explicitly.
 */
export function resolvePolicy(room: Room, property: Property, on: ISODate): RoomPolicy {
  if (room.roomType !== null) {
    return room.roomType;
  }

  if (
    property.pendingPolicy !== null &&
    property.pendingPolicyFrom !== null &&
    on >= property.pendingPolicyFrom
  ) {
    return propertyPolicyToRoomPolicy(property.pendingPolicy);
  }

  return propertyPolicyToRoomPolicy(property.defaultPolicy);
}
