export type ISODate = string; // 'YYYY-MM-DD'
export type Gender = 'male' | 'female' | 'unspecified';

export type RoomPolicy =
  | 'mixed'
  | 'same_gender'
  | 'female_only'
  | 'male_only'
  | 'private'
  | 'staff'
  | 'maintenance'
  | 'manual_only';

export type PropertyPolicy = 'same_gender' | 'mixed' | 'hybrid';

export interface Property {
  id: string;
  name: string;
  defaultPolicy: PropertyPolicy;
  pendingPolicy: PropertyPolicy | null;
  pendingPolicyFrom: ISODate | null;
}

export interface Room {
  id: string;
  propertyId: string;
  code: string; // 'A' | 'B' | ...
  roomType: RoomPolicy | null; // null = 跟隨 property policy
  sortOrder: number;
}

export interface Bed {
  id: string;
  roomId: string;
  code: string;
  position: 'lower' | 'upper' | 'single';
  outOfServiceFrom: ISODate | null; // null 且 To 也為 null = 從未停用
  outOfServiceTo: ISODate | null;
}

export type BookingSource =
  | 'direct'
  | 'booking_com'
  | 'agoda'
  | 'airbnb'
  | 'expedia'
  | 'agent'
  | 'walk_in'
  | 'phone'
  | 'staff';

export type BookingStatus =
  | 'pending'
  | 'confirmed_unassigned'
  | 'recommended'
  | 'assigned'
  | 'checked_in'
  | 'checked_out';

export interface Booking {
  id: string;
  propertyId: string;
  reference: string;
  source: BookingSource;
  bookedAt: ISODate;
  checkIn: ISODate;
  checkOut: ISODate; // exclusive
  status: BookingStatus;
  cancelled: boolean;
  noShow: boolean;
  totalValue: number;
  currency: string;
  mustStayTogether: boolean; // 預設 true
  requiresPrivateRoom: boolean;
  priority: number; // 0 = 一般，越大越優先
  notes: string;
}

export interface Guest {
  id: string;
  bookingId: string;
  name: string;
  gender: Gender;
  birthYear: number | null;
  accessibilityNeed: boolean;
  checkIn: ISODate; // 可與 booking 不同
  checkOut: ISODate;
}

export type LockLevel = 'none' | 'soft' | 'hard';

export interface Assignment {
  id: string;
  guestId: string;
  roomId: string;
  bedId: string | null; // 只有 check-in 後才填
  dateFrom: ISODate;
  dateTo: ISODate;
  lockLevel: LockLevel;
  isCurrent: boolean;
  createdBy: 'optimizer' | 'staff';
}
