import type {
  Assignment,
  Bed,
  Booking,
  BookingSource,
  Gender,
  Guest,
  Room,
} from '../engine/types';

export type CsvField =
  | 'reference'
  | 'checkIn'
  | 'checkOut'
  | 'guestCount'
  | 'title'
  | 'status'
  | 'ignore';

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export interface CsvBookingDraft {
  reference: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  title: string;
  suggestedGender: Gender;
  /** True for 已取消 / No-show rows: kept as a record in the sheet, not allocated. */
  inactive: boolean;
}

export interface AllocatorGuest extends Guest {
  genderConfirmed: boolean;
}

export interface AllocatorFileData {
  version: 1;
  rooms: Room[];
  beds: Bed[];
  bookings: Booking[];
  guests: AllocatorGuest[];
  currentAssignments: Assignment[];
}

export interface PlacementReasonInput {
  roomCode: string;
  existingGuests: number;
  addedGuests: number;
  capacity: number;
  emptyRoomCode: string | null;
  splitRoomCodes?: readonly string[];
}

const STORAGE_KEY = 'splitbed.allocator.v1';

function isBlankRow(row: readonly string[]): boolean {
  return row.every((field) => field.trim() === '');
}

/** Parses RFC-4180-style CSV including escaped quotes, embedded commas and BOM. */
export function parseCsv(source: string): ParsedCsv {
  const text = source.startsWith('\uFEFF') ? source.slice(1) : source;
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const finishRow = (): void => {
    row.push(field);
    if (!isBlankRow(row)) {
      records.push(row);
    }
    row = [];
    field = '';
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field === '') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      finishRow();
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new Error('CSV 有未關閉的引號。');
  }
  if (field !== '' || row.length > 0) {
    finishRow();
  }
  if (records.length === 0) {
    throw new Error('CSV 內容是空的。');
  }
  const [headers, ...rows] = records;
  return {
    headers: headers.map((header) => header.trim()),
    rows,
  };
}

function mappedValue(
  row: readonly string[],
  mapping: readonly CsvField[],
  field: Exclude<CsvField, 'ignore'>,
): string {
  const index = mapping.indexOf(field);
  return index === -1 ? '' : (row[index] ?? '').trim();
}

function genderFromTitle(title: string): Gender {
  const normalized = title.trim().toLowerCase().replaceAll('.', '');
  if (normalized === 'mr' || normalized === 'mister') {
    return 'male';
  }
  if (normalized === 'ms' || normalized === 'mrs' || normalized === 'miss') {
    return 'female';
  }
  return 'unspecified';
}

/** Maps arbitrary CSV columns after the user explicitly chooses each field. */
export function mapCsvBookings(
  csv: ParsedCsv,
  mapping: readonly CsvField[],
): CsvBookingDraft[] {
  const required: ReadonlyArray<Exclude<CsvField, 'title' | 'status' | 'ignore'>> = [
    'reference',
    'checkIn',
    'checkOut',
    'guestCount',
  ];
  const missing = required.filter((field) => !mapping.includes(field));
  if (missing.length > 0) {
    const names: Record<(typeof required)[number], string> = {
      reference: '訂單編號',
      checkIn: '入住日',
      checkOut: '退房日',
      guestCount: '人數',
    };
    throw new Error(`欄位對應缺少必填欄位：${missing.map((field) => names[field]).join('、')}。`);
  }

  return csv.rows.map((row, rowIndex) => {
    const reference = mappedValue(row, mapping, 'reference');
    const checkIn = mappedValue(row, mapping, 'checkIn');
    const checkOut = mappedValue(row, mapping, 'checkOut');
    const guestCountText = mappedValue(row, mapping, 'guestCount');
    const title = mappedValue(row, mapping, 'title');
    const status = mappedValue(row, mapping, 'status');
    const guestCount = Number(guestCountText);
    const displayRow = rowIndex + 2;
    if (reference === '') {
      throw new Error(`CSV 第 ${displayRow} 行缺少訂單編號。`);
    }
    if (checkIn === '' || checkOut === '') {
      throw new Error(`CSV 第 ${displayRow} 行缺少入住日或退房日。`);
    }
    if (!Number.isInteger(guestCount) || guestCount <= 0) {
      throw new Error(`CSV 第 ${displayRow} 行的人數必須是大過 0 的整數。`);
    }
    return {
      reference,
      checkIn,
      checkOut,
      guestCount,
      title,
      suggestedGender: genderFromTitle(title),
      inactive: isInactiveStatus(status),
    };
  });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} 必須是物件。`);
  }
  return value as Record<string, unknown>;
}

function requiredArray(
  value: Record<string, unknown>,
  field: string,
): unknown[] {
  if (!(field in value)) {
    throw new Error(`缺少 ${field} 欄位。`);
  }
  if (!Array.isArray(value[field])) {
    throw new Error(`${field} 必須是陣列。`);
  }
  return value[field];
}

function requireString(value: Record<string, unknown>, field: string, path: string): string {
  if (typeof value[field] !== 'string') {
    throw new Error(`${path}.${field} 必須是字串。`);
  }
  return value[field];
}

function requireNumber(value: Record<string, unknown>, field: string, path: string): number {
  if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) {
    throw new Error(`${path}.${field} 必須是數字。`);
  }
  return value[field];
}

function requireBoolean(value: Record<string, unknown>, field: string, path: string): boolean {
  if (typeof value[field] !== 'boolean') {
    throw new Error(`${path}.${field} 必須是 true 或 false。`);
  }
  return value[field];
}

function nullableString(value: Record<string, unknown>, field: string, path: string): string | null {
  if (value[field] !== null && typeof value[field] !== 'string') {
    throw new Error(`${path}.${field} 必須是字串或 null。`);
  }
  return value[field] as string | null;
}

/** Validates and returns an allocator JSON file with explicit path-based errors. */
export function validateAllocatorJson(value: unknown): AllocatorFileData {
  const root = record(value, 'JSON');
  if (!('version' in root)) {
    throw new Error('缺少 version 欄位。');
  }
  if (root.version !== 1) {
    throw new Error('version 必須是 1。');
  }
  const roomValues = requiredArray(root, 'rooms');
  const bedValues = requiredArray(root, 'beds');
  const bookingValues = requiredArray(root, 'bookings');
  const guestValues = requiredArray(root, 'guests');
  const assignmentValues = requiredArray(root, 'currentAssignments');

  const rooms = roomValues.map<Room>((item, index) => {
    const path = `rooms[${index}]`;
    const room = record(item, path);
    return {
      id: requireString(room, 'id', path),
      propertyId: requireString(room, 'propertyId', path),
      code: requireString(room, 'code', path),
      roomType: nullableString(room, 'roomType', path) as Room['roomType'],
      sortOrder: requireNumber(room, 'sortOrder', path),
    };
  });
  const roomIds = new Set(rooms.map((room) => room.id));

  const beds = bedValues.map<Bed>((item, index) => {
    const path = `beds[${index}]`;
    const bed = record(item, path);
    const roomId = requireString(bed, 'roomId', path);
    if (!roomIds.has(roomId)) {
      throw new Error(`${path}.roomId 不是有效房間 id：${roomId}。`);
    }
    const position = requireString(bed, 'position', path);
    if (position !== 'single' && position !== 'lower' && position !== 'upper') {
      throw new Error(`${path}.position 不是有效床位類型。`);
    }
    return {
      id: requireString(bed, 'id', path),
      roomId,
      code: requireString(bed, 'code', path),
      position,
      outOfServiceFrom: nullableString(bed, 'outOfServiceFrom', path),
      outOfServiceTo: nullableString(bed, 'outOfServiceTo', path),
    };
  });

  const bookings = bookingValues.map<Booking>((item, index) => {
    const path = `bookings[${index}]`;
    const booking = record(item, path);
    return {
      id: requireString(booking, 'id', path),
      propertyId: requireString(booking, 'propertyId', path),
      reference: requireString(booking, 'reference', path),
      source: requireString(booking, 'source', path) as BookingSource,
      bookedAt: requireString(booking, 'bookedAt', path),
      checkIn: requireString(booking, 'checkIn', path),
      checkOut: requireString(booking, 'checkOut', path),
      status: requireString(booking, 'status', path) as Booking['status'],
      cancelled: requireBoolean(booking, 'cancelled', path),
      noShow: requireBoolean(booking, 'noShow', path),
      totalValue: requireNumber(booking, 'totalValue', path),
      currency: requireString(booking, 'currency', path),
      mustStayTogether: requireBoolean(booking, 'mustStayTogether', path),
      requiresPrivateRoom: requireBoolean(booking, 'requiresPrivateRoom', path),
      priority: requireNumber(booking, 'priority', path),
      notes: requireString(booking, 'notes', path),
    };
  });
  const bookingIds = new Set(bookings.map((booking) => booking.id));

  const guests = guestValues.map<AllocatorGuest>((item, index) => {
    const path = `guests[${index}]`;
    const guest = record(item, path);
    const bookingId = requireString(guest, 'bookingId', path);
    if (!bookingIds.has(bookingId)) {
      throw new Error(`${path}.bookingId 不是有效訂單 id：${bookingId}。`);
    }
    const gender = requireString(guest, 'gender', path);
    if (gender !== 'male' && gender !== 'female' && gender !== 'unspecified') {
      throw new Error(`${path}.gender 不是有效性別。`);
    }
    const birthYear = guest.birthYear;
    if (birthYear !== null && (typeof birthYear !== 'number' || !Number.isFinite(birthYear))) {
      throw new Error(`${path}.birthYear 必須是數字或 null。`);
    }
    return {
      id: requireString(guest, 'id', path),
      bookingId,
      name: requireString(guest, 'name', path),
      gender,
      birthYear: birthYear as number | null,
      accessibilityNeed: requireBoolean(guest, 'accessibilityNeed', path),
      checkIn: requireString(guest, 'checkIn', path),
      checkOut: requireString(guest, 'checkOut', path),
      genderConfirmed: requireBoolean(guest, 'genderConfirmed', path),
    };
  });
  const guestIds = new Set(guests.map((guest) => guest.id));

  const currentAssignments = assignmentValues.map<Assignment>((item, index) => {
    const path = `currentAssignments[${index}]`;
    const assignment = record(item, path);
    const guestId = requireString(assignment, 'guestId', path);
    const roomId = requireString(assignment, 'roomId', path);
    if (!guestIds.has(guestId)) {
      throw new Error(`${path}.guestId 不是有效客人 id：${guestId}。`);
    }
    if (!roomIds.has(roomId)) {
      throw new Error(`${path}.roomId 不是有效房間 id：${roomId}。`);
    }
    const lockLevel = requireString(assignment, 'lockLevel', path);
    if (lockLevel !== 'none' && lockLevel !== 'soft' && lockLevel !== 'hard') {
      throw new Error(`${path}.lockLevel 不是有效鎖定級別。`);
    }
    return {
      id: requireString(assignment, 'id', path),
      guestId,
      roomId,
      bedId: nullableString(assignment, 'bedId', path),
      dateFrom: requireString(assignment, 'dateFrom', path),
      dateTo: requireString(assignment, 'dateTo', path),
      lockLevel,
      isCurrent: requireBoolean(assignment, 'isCurrent', path),
      createdBy: requireString(assignment, 'createdBy', path) as Assignment['createdBy'],
    };
  });

  return { version: 1, rooms, beds, bookings, guests, currentAssignments };
}

/** Generates deterministic, template-based explanation text. */
export function generatePlacementReason(input: PlacementReasonInput): string {
  const splitRooms = [...(input.splitRoomCodes ?? [])].sort();
  if (splitRooms.length > 1) {
    return `訂單要分配到 ${splitRooms.map((room) => `Room ${room}`).join('、')}，因為單一房間未能容納整組客人。`;
  }
  const finalGuests = input.existingGuests + input.addedGuests;
  const emptyRoomText =
    input.emptyRoomCode === null
      ? ''
      : `，同時保留 Room ${input.emptyRoomCode} 完全空置`;
  if (finalGuests >= input.capacity) {
    if (input.existingGuests === 0) {
      return `Room ${input.roomCode} 本身空置，呢張訂單啱啱好住滿佢，唔會剩低散床${emptyRoomText}。`;
    }
    return `Room ${input.roomCode} 已有 ${input.existingGuests} 位客，安排喺度可以填滿呢間房${emptyRoomText}。`;
  }
  if (input.existingGuests === 0) {
    return `Room ${input.roomCode} 本身空置，安排後會住 ${finalGuests}/${input.capacity} 位客${emptyRoomText}。`;
  }
  return `Room ${input.roomCode} 有足夠床位容納整張訂單，安排後會住 ${finalGuests}/${input.capacity} 位客${emptyRoomText}。`;
}

/**
 * Recognises the 狀態 values that mean a booking needs no room. The sheet keeps
 * cancelled rows on purpose (see docs/07-booking-sheet.md §5); the allocator
 * simply does not schedule them.
 */
export function isInactiveStatus(status: string): boolean {
  const value = status.trim().toLowerCase();
  return (
    value === '已取消' ||
    value === '取消' ||
    value === 'cancelled' ||
    value === 'canceled' ||
    value === 'no-show' ||
    value === 'noshow' ||
    value === 'no show' ||
    value === '未出現'
  );
}

export function loadAllocatorState(): AllocatorFileData | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === null ? null : validateAllocatorJson(JSON.parse(saved) as unknown);
  } catch {
    return null;
  }
}

export function saveAllocatorState(data: AllocatorFileData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // The allocator remains usable for this page view when storage is blocked.
  }
}
