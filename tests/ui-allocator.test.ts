import { describe, expect, it } from 'vitest';

import {
  generatePlacementReason,
  mapCsvBookings,
  parseCsv,
  validateAllocatorJson,
  type AllocatorFileData,
  type CsvField,
} from '../src/ui/allocator-data';

function validFile(): AllocatorFileData {
  return {
    version: 1,
    rooms: [
      {
        id: 'room-a',
        propertyId: 'property-1',
        code: 'A',
        roomType: 'same_gender',
        sortOrder: 0,
      },
    ],
    beds: [
      {
        id: 'bed-a-1',
        roomId: 'room-a',
        code: '1',
        position: 'single',
        outOfServiceFrom: null,
        outOfServiceTo: null,
      },
    ],
    bookings: [
      {
        id: 'booking-a',
        propertyId: 'property-1',
        reference: 'A001',
        source: 'direct',
        bookedAt: '2026-01-01',
        checkIn: '2026-02-01',
        checkOut: '2026-02-03',
        status: 'confirmed_unassigned',
        cancelled: false,
        noShow: false,
        totalValue: 10_000,
        currency: 'JPY',
        mustStayTogether: true,
        requiresPrivateRoom: false,
        priority: 0,
        notes: '',
      },
    ],
    guests: [
      {
        id: 'guest-a',
        bookingId: 'booking-a',
        name: '',
        gender: 'female',
        genderConfirmed: true,
        birthYear: null,
        accessibilityNeed: false,
        checkIn: '2026-02-01',
        checkOut: '2026-02-03',
      },
    ],
    currentAssignments: [],
  };
}

describe('allocator CSV helpers', () => {
  it('parses BOM, quoted fields, embedded commas, escaped quotes and blank lines', () => {
    const csv = parseCsv(
      '\uFEFF編號,備註,人數\r\nA001,"兩位, 同行",2\r\n\r\nA002,"房客說 ""晚到""",1\r\n',
    );
    expect(csv).toEqual({
      headers: ['編號', '備註', '人數'],
      rows: [
        ['A001', '兩位, 同行', '2'],
        ['A002', '房客說 "晚到"', '1'],
      ],
    });
  });

  it('reports every missing required field mapping', () => {
    const csv = parseCsv('Ref,Arrival\nA001,2026-02-01');
    const mapping: CsvField[] = ['reference', 'checkIn'];
    expect(() => mapCsvBookings(csv, mapping)).toThrow(
      '欄位對應缺少必填欄位：退房日、人數。',
    );
  });
});

describe('allocator JSON validation', () => {
  it('reports a missing top-level field', () => {
    const data = validFile() as unknown as Record<string, unknown>;
    delete data.guests;
    expect(() => validateAllocatorJson(data)).toThrow('缺少 guests 欄位。');
  });

  it('reports an incorrect field type with its path', () => {
    const data = validFile() as unknown as { bookings: Array<Record<string, unknown>> };
    data.bookings[0].checkIn = 20260201;
    expect(() => validateAllocatorJson(data)).toThrow(
      'bookings[0].checkIn 必須是字串。',
    );
  });

  it('reports a bed that points to an unknown room id', () => {
    const data = validFile();
    data.beds[0].roomId = 'missing-room';
    expect(() => validateAllocatorJson(data)).toThrow(
      'beds[0].roomId 不是有效房間 id：missing-room。',
    );
  });
});

describe('allocator explanation text', () => {
  it('returns the same sentence for the same placement facts', () => {
    const input = {
      roomCode: 'C',
      existingGuests: 2,
      addedGuests: 1,
      capacity: 3,
      emptyRoomCode: 'D',
    };
    expect(generatePlacementReason(input)).toBe(
      'Room C 已有 2 位客，安排喺度可以填滿呢間房，同時保留 Room D 完全空置。',
    );
    expect(generatePlacementReason(input)).toBe(generatePlacementReason(input));
  });
});
