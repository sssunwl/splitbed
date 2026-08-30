import {
  capacity,
  diffDays,
  eachNight,
  solve,
  type AllocationProblem,
  type Assignment,
  type Bed,
  type BlockReason,
  type Booking,
  type BookingSource,
  type Gender,
  type Placement,
  type Property,
  type Room,
  type SolveOptions,
  type SolveResult,
} from '../engine';
import {
  generatePlacementReason,
  loadAllocatorState,
  mapCsvBookings,
  parseCsv,
  saveAllocatorState,
  validateAllocatorJson,
  type AllocatorFileData,
  type AllocatorGuest,
  type CsvBookingDraft,
  type CsvField,
  type ParsedCsv,
} from './allocator-data';
import { mountNav } from './nav';
import { loadConfig, saveConfig, type RoomSpec, type SiteConfig } from './store';

mountNav();

const SOLVE_OPTIONS: SolveOptions = {
  weights: { reject: 1_000, stability: 120, strand: 10, fragment: 3, priority: 50 },
  maxPasses: 20,
  seed: 42,
  allowReject: true,
};

const csvFieldNames: Record<CsvField, string> = {
  reference: '訂單編號',
  checkIn: '入住日',
  checkOut: '退房日',
  guestCount: '人數',
  title: '稱謂',
  status: '狀態',
  maleCount: '男',
  femaleCount: '女',
  unspecifiedCount: '未定',
  ignore: '忽略',
};

const genderNames: Record<Gender, string> = {
  male: '男',
  female: '女',
  unspecified: '未定',
};

const diagnosticNames: Record<BlockReason, string> = {
  capacity: '床位不足',
  gender_conflict: '同房性別衝突',
  female_only: '只限女客',
  male_only: '只限男客',
  private_occupied: '私人房已有其他訂單',
  requires_private: '私人房要求衝突',
  staff_only: '只限職員訂單',
  maintenance: '房間維修中',
  manual_only: '只可人手安排',
  locked_elsewhere: '客人已鎖定在另一間房',
};

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`找不到頁面元件：${selector}`);
  return element;
}

const roomList = requiredElement<HTMLDivElement>('#allocator-room-list');
const roomSummary = requiredElement<HTMLParagraphElement>('#allocator-room-summary');
const addRoomButton = requiredElement<HTMLButtonElement>('#allocator-add-room');
const bedClosureList = requiredElement<HTMLDivElement>('#bed-closure-list');
const manualForm = requiredElement<HTMLFormElement>('#manual-booking-form');
const manualReference = requiredElement<HTMLInputElement>('#manual-reference');
const manualCheckIn = requiredElement<HTMLInputElement>('#manual-check-in');
const manualCheckOut = requiredElement<HTMLInputElement>('#manual-check-out');
const manualGuestCount = requiredElement<HTMLInputElement>('#manual-guest-count');
const manualSource = requiredElement<HTMLSelectElement>('#manual-source');
const manualTogether = requiredElement<HTMLInputElement>('#manual-together');
const manualNotes = requiredElement<HTMLInputElement>('#manual-notes');
const loadSampleButton = requiredElement<HTMLButtonElement>('#load-sample');
const runDemoButton = requiredElement<HTMLButtonElement>('#run-demo');
const csvText = requiredElement<HTMLTextAreaElement>('#csv-text');
const parseCsvButton = requiredElement<HTMLButtonElement>('#parse-csv');
const csvMapping = requiredElement<HTMLDivElement>('#csv-mapping');
const importCsvButton = requiredElement<HTMLButtonElement>('#import-csv');
const inputMessage = requiredElement<HTMLParagraphElement>('#booking-input-message');
const bookingList = requiredElement<HTMLDivElement>('#booking-list');
const genderProgress = requiredElement<HTMLParagraphElement>('#gender-progress');
const solveButton = requiredElement<HTMLButtonElement>('#solve-button');
const suggestionSummary = requiredElement<HTMLParagraphElement>('#suggestion-summary');
const resetSolveButton = requiredElement<HTMLButtonElement>('#reset-solve-button');
const solveMessage = requiredElement<HTMLParagraphElement>('#solve-message');
const results = requiredElement<HTMLElement>('#allocation-results');
const calendarScroll = requiredElement<HTMLDivElement>('#calendar-scroll');
const calendarRange = requiredElement<HTMLParagraphElement>('#calendar-range');
const cellDetail = requiredElement<HTMLElement>('#cell-detail');
const suggestionBody = requiredElement<HTMLTableSectionElement>('#suggestion-body');
const adjustGuest = requiredElement<HTMLSelectElement>('#adjust-guest');
const adjustRoom = requiredElement<HTMLSelectElement>('#adjust-room');
const impactPreview = requiredElement<HTMLDivElement>('#impact-preview');
const confirmAdjustment = requiredElement<HTMLButtonElement>('#confirm-adjustment');
const lockedList = requiredElement<HTMLDivElement>('#locked-list');
const exportJsonButton = requiredElement<HTMLButtonElement>('#export-json');
const exportCsvButton = requiredElement<HTMLButtonElement>('#export-csv');
const importJsonInput = requiredElement<HTMLInputElement>('#import-json');
const transferMessage = requiredElement<HTMLParagraphElement>('#transfer-message');

let siteConfig = loadConfig();
let rooms: Room[] = [];
let beds: Bed[] = [];
let bookings: Booking[] = [];
let guests: AllocatorGuest[] = [];
let currentAssignments: Assignment[] = [];
let lastResult: SolveResult | null = null;
let parsedCsv: ParsedCsv | null = null;
let activeGuestId: string | null = null;
let expandedBookingId: string | null = null;
let pendingAdjustment: { assignment: Assignment; result: SolveResult } | null = null;
let idSequence = 0;

function nextId(prefix: string): string {
  const usedIds = new Set([
    ...bookings.map((booking) => booking.id),
    ...guests.map((guest) => guest.id),
    ...currentAssignments.map((assignment) => assignment.id),
  ]);
  let candidate = '';
  do {
    idSequence += 1;
    candidate = `${prefix}-${idSequence}`;
  } while (usedIds.has(candidate));
  return candidate;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function makeRooms(config: SiteConfig): Room[] {
  return config.rooms.map((room, index) => ({
    id: `room-${index}`,
    propertyId: 'property-1',
    code: room.code,
    roomType: room.mixed ? 'mixed' : 'same_gender',
    sortOrder: index,
  }));
}

function makeBeds(config: SiteConfig, previous: readonly Bed[] = []): Bed[] {
  const previousById = new Map(previous.map((bed) => [bed.id, bed]));
  return config.rooms.flatMap((room, roomIndex) =>
    Array.from({ length: Math.max(0, Math.floor(room.beds)) }, (_, bedIndex) => {
      const id = `room-${roomIndex}-bed-${bedIndex}`;
      const saved = previousById.get(id);
      return {
        id,
        roomId: `room-${roomIndex}`,
        code: `${bedIndex + 1}`,
        position: 'single' as const,
        outOfServiceFrom: saved?.outOfServiceFrom ?? null,
        outOfServiceTo: saved?.outOfServiceTo ?? null,
      };
    }),
  );
}

function exportData(): AllocatorFileData {
  return {
    version: 1,
    rooms: rooms.map((room) => ({ ...room })),
    beds: beds.map((bed) => ({ ...bed })),
    bookings: bookings.map((booking) => ({ ...booking })),
    guests: guests.map((guest) => ({ ...guest })),
    currentAssignments: currentAssignments.map((assignment) => ({ ...assignment })),
  };
}

function persist(): void {
  saveAllocatorState(exportData());
}

function property(): Property {
  return {
    id: 'property-1',
    name: siteConfig.siteName,
    defaultPolicy: siteConfig.rooms.some((room) => room.mixed) ? 'hybrid' : 'same_gender',
    pendingPolicy: null,
    pendingPolicyFrom: null,
  };
}

function horizon(): readonly [string, string] | null {
  if (bookings.length === 0) return null;
  let from = bookings[0].checkIn;
  let to = bookings[0].checkOut;
  for (const booking of bookings) {
    if (booking.checkIn < from) from = booking.checkIn;
    if (booking.checkOut > to) to = booking.checkOut;
  }
  return [from, to];
}

function allocationProblem(assignments: readonly Assignment[]): AllocationProblem | null {
  const dates = horizon();
  if (dates === null) return null;
  return {
    property: property(),
    rooms,
    beds,
    bookings,
    guests,
    currentAssignments: assignments,
    horizonFrom: dates[0],
    horizonTo: dates[1],
  };
}

function showMessage(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.hidden = false;
}

function clearMessage(element: HTMLElement): void {
  element.hidden = true;
  element.textContent = '';
}

function invalidateResults(): void {
  lastResult = null;
  pendingAdjustment = null;
  results.hidden = true;
}

function syncRoomConfigFromDom(): void {
  siteConfig = {
    ...siteConfig,
    rooms: [...roomList.querySelectorAll<HTMLElement>('.allocator-room-row')].map((row) => {
      const bedInput = row.querySelector<HTMLInputElement>('.allocator-room-beds');
      return {
        code: row.querySelector<HTMLInputElement>('.allocator-room-code')?.value ?? '',
        beds: bedInput?.value === '' ? Number.NaN : Number(bedInput?.value),
        mixed: row.querySelector<HTMLInputElement>('.allocator-room-mixed')?.checked ?? false,
      };
    }),
  };
  const previousBeds = beds;
  rooms = makeRooms(siteConfig);
  beds = makeBeds(siteConfig, previousBeds);
  const roomIds = new Set(rooms.map((room) => room.id));
  currentAssignments = currentAssignments.filter((assignment) => roomIds.has(assignment.roomId));
  if (
    siteConfig.rooms.every(
      (room) => Number.isFinite(room.beds) && room.beds >= 0,
    )
  ) {
    saveConfig(siteConfig);
  }
  renderBedClosures();
  updateRoomSummary();
  invalidateResults();
  persist();
}

function updateRoomSummary(): void {
  const total = siteConfig.rooms.reduce(
    (sum, room) => sum + (Number.isFinite(room.beds) ? room.beds : 0),
    0,
  );
  roomSummary.textContent = `${siteConfig.rooms.length} 間房、${total} 張床`;
}

function renderRooms(): void {
  const fragment = document.createDocumentFragment();
  siteConfig.rooms.forEach((room, index) => {
    const row = document.createElement('div');
    row.className = 'allocator-room-row';
    row.dataset.roomIndex = `${index}`;
    row.innerHTML = `
      <input class="allocator-room-code" type="text" aria-label="第 ${index + 1} 間房代號" />
      <input class="allocator-room-beds" type="number" min="0" step="1" aria-label="第 ${index + 1} 間房床數" />
      <label class="allocator-mixed-check"><input class="allocator-room-mixed" type="checkbox" /> 呢間可以男女同房</label>
      <button class="allocator-icon-button allocator-delete-room" type="button" aria-label="刪除第 ${index + 1} 間房">×</button>`;
    const code = row.querySelector<HTMLInputElement>('.allocator-room-code');
    const bedCount = row.querySelector<HTMLInputElement>('.allocator-room-beds');
    const mixed = row.querySelector<HTMLInputElement>('.allocator-room-mixed');
    if (code !== null) code.value = room.code;
    if (bedCount !== null) bedCount.value = `${room.beds}`;
    if (mixed !== null) mixed.checked = room.mixed;
    fragment.append(row);
  });
  roomList.replaceChildren(fragment);
  updateRoomSummary();
}

function renderBedClosures(): void {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const fragment = document.createDocumentFragment();
  for (const bed of beds) {
    const row = document.createElement('div');
    row.className = 'bed-closure-row';
    row.dataset.bedId = bed.id;
    const roomCode = roomById.get(bed.roomId)?.code ?? bed.roomId;
    row.innerHTML = `<strong>Room ${escapeHtml(roomCode)} · 床 ${escapeHtml(bed.code)}</strong>
      <label>停用開始<input class="bed-stop-from" type="date" /></label>
      <label>停用結束<input class="bed-stop-to" type="date" /></label>`;
    const from = row.querySelector<HTMLInputElement>('.bed-stop-from');
    const to = row.querySelector<HTMLInputElement>('.bed-stop-to');
    if (from !== null) from.value = bed.outOfServiceFrom ?? '';
    if (to !== null) to.value = bed.outOfServiceTo ?? '';
    fragment.append(row);
  }
  bedClosureList.replaceChildren(fragment);
}

function createBooking(
  reference: string,
  checkIn: string,
  checkOut: string,
  guestCount: number,
  source: BookingSource,
  mustStayTogether: boolean,
  notes: string,
  suggestedGender: Gender = 'unspecified',
  genders: readonly Gender[] = [],
  requiresPrivateRoom = false,
): string {
  const bookingId = nextId('booking');
  bookings.push({
    id: bookingId,
    propertyId: 'property-1',
    reference,
    source,
    bookedAt: checkIn,
    checkIn,
    checkOut,
    status: 'confirmed_unassigned',
    cancelled: false,
    noShow: false,
    totalValue: guestCount * diffDays(checkIn, checkOut) * siteConfig.nightlyRate,
    currency: 'JPY',
    mustStayTogether,
    requiresPrivateRoom,
    priority: 0,
    notes,
  });
  // 表上有男／女／未定就照跟，唔使再撳一次；冇就淨係用稱謂做第一位嘅預填。
  const fromSheet = genders.length === guestCount;
  for (let index = 0; index < guestCount; index += 1) {
    guests.push({
      id: nextId('guest'),
      bookingId,
      name: '',
      gender: fromSheet ? genders[index] : index === 0 ? suggestedGender : 'unspecified',
      // 表上明明寫咗「未定」＝職員已經決定咗「唔知」，唔使再撳多次。
      // 只有完全冇填性別欄嗰啲（例如 OTA 訂單）先算未確認。
      genderConfirmed: fromSheet,
      birthYear: null,
      accessibilityNeed: false,
      checkIn,
      checkOut,
    });
  }
  expandedBookingId = bookingId;
  invalidateResults();
  persist();
  return bookingId;
}

function validateBookingInput(
  reference: string,
  checkIn: string,
  checkOut: string,
  guestCount: number,
): void {
  if (reference.trim() === '') throw new Error('請填寫訂單編號。');
  if (checkIn === '' || checkOut === '' || checkIn >= checkOut) {
    throw new Error('退房日必須遲過入住日。');
  }
  if (!Number.isInteger(guestCount) || guestCount <= 0) {
    throw new Error('人數必須是大過 0 的整數。');
  }
}

function updateGenderProgress(): void {
  const confirmed = guests.filter((guest) => guest.genderConfirmed).length;
  genderProgress.textContent = `${confirmed}/${guests.length} 位已確認`;
}

function renderBookings(): void {
  const fragment = document.createDocumentFragment();
  for (const booking of bookings) {
    const bookingGuests = guests.filter((guest) => guest.bookingId === booking.id);
    const details = document.createElement('details');
    details.className = 'booking-card';
    details.dataset.bookingId = booking.id;
    details.open = booking.id === expandedBookingId || bookingGuests.some((guest) => !guest.genderConfirmed);
    const summary = document.createElement('summary');
    summary.innerHTML = `<span>${escapeHtml(booking.reference)} · ${booking.checkIn} → ${booking.checkOut}</span><small>${bookingGuests.length} 人 · ${booking.mustStayTogether ? '盡量同房' : '可以拆房'}</small>`;
    const list = document.createElement('div');
    list.className = 'guest-list';
    for (const [index, guest] of bookingGuests.entries()) {
      const row = document.createElement('div');
      row.className = `guest-row${guest.genderConfirmed ? '' : ' needs-confirmation'}`;
      row.dataset.guestId = guest.id;
      row.innerHTML = `<label class="guest-name-wrap">客人 ${index + 1}<input class="guest-name" type="text" placeholder="姓名可留空" /><small>${guest.genderConfirmed ? '已確認' : guest.gender === 'unspecified' ? '性別未填' : `稱謂建議：${genderNames[guest.gender]}，請確認`}</small></label>
        <div class="gender-buttons" role="group" aria-label="客人 ${index + 1} 性別">
          <button class="gender-button" type="button" data-gender="male" aria-pressed="${guest.gender === 'male'}">男 <kbd>M</kbd></button>
          <button class="gender-button" type="button" data-gender="female" aria-pressed="${guest.gender === 'female'}">女 <kbd>F</kbd></button>
          <button class="gender-button" type="button" data-gender="unspecified" aria-pressed="${guest.gender === 'unspecified'}">未定 <kbd>U</kbd></button>
        </div>`;
      const name = row.querySelector<HTMLInputElement>('.guest-name');
      if (name !== null) name.value = guest.name;
      list.append(row);
    }
    details.append(summary, list);
    fragment.append(details);
  }
  if (bookings.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = '未有訂單。可以手動加入、貼 CSV，或者載入範例。';
    fragment.append(empty);
  }
  bookingList.replaceChildren(fragment);
  updateGenderProgress();
}

function focusGuest(guestId: string): void {
  activeGuestId = guestId;
  const row = bookingList.querySelector<HTMLElement>(`.guest-row[data-guest-id="${CSS.escape(guestId)}"]`);
  const guest = guests.find((item) => item.id === guestId);
  row?.closest<HTMLDetailsElement>('details')?.setAttribute('open', '');
  row?.querySelector<HTMLButtonElement>(
    `.gender-button[data-gender="${guest?.gender ?? 'unspecified'}"]`,
  )?.focus();
  row?.scrollIntoView({ block: 'nearest' });
}

function focusNextUnconfirmed(afterGuestId: string): void {
  const start = guests.findIndex((guest) => guest.id === afterGuestId);
  const ordered = [...guests.slice(start + 1), ...guests.slice(0, Math.max(0, start))];
  const next = ordered.find((guest) => !guest.genderConfirmed);
  if (next !== undefined) focusGuest(next.id);
}

function moveGenderFocus(direction: -1 | 1): void {
  if (guests.length === 0) return;
  const current = guests.findIndex((guest) => guest.id === activeGuestId);
  const index = current === -1 ? 0 : (current + direction + guests.length) % guests.length;
  focusGuest(guests[index].id);
}

function applyGender(guestId: string, gender: Gender): void {
  const guest = guests.find((item) => item.id === guestId);
  if (guest === undefined) return;
  guest.gender = gender;
  guest.genderConfirmed = true;
  const row = bookingList.querySelector<HTMLElement>(`.guest-row[data-guest-id="${CSS.escape(guestId)}"]`);
  row?.classList.remove('needs-confirmation');
  row?.querySelectorAll<HTMLButtonElement>('.gender-button').forEach((button) => {
    button.setAttribute('aria-pressed', `${button.dataset.gender === gender}`);
  });
  const hint = row?.querySelector<HTMLElement>('small');
  if (hint !== null && hint !== undefined) hint.textContent = '已確認';
  updateGenderProgress();
  invalidateResults();
  persist();
  focusNextUnconfirmed(guestId);
}

function addCsvDrafts(drafts: readonly CsvBookingDraft[]): number {
  let skipped = 0;
  for (const draft of drafts) {
    if (draft.inactive) {
      // 已取消 / No-show：留喺 Sheet 做紀錄，但唔使排房。
      skipped += 1;
      continue;
    }
    validateBookingInput(draft.reference, draft.checkIn, draft.checkOut, draft.guestCount);
    createBooking(
      draft.reference,
      draft.checkIn,
      draft.checkOut,
      draft.guestCount,
      'direct',
      true,
      '',
      draft.suggestedGender,
      draft.genders,
    );
  }
  renderBookings();
  return skipped;
}

/**
 * Matches a CSV header against SplitBed's own recommended column names so the
 * suggested booking sheet imports without 15 manual dropdowns. Anything else
 * stays on 「忽略」 and is mapped by hand — no PMS format is hard-coded.
 */
function autoMatchField(header: string): CsvField {
  const trimmed = header.trim();
  for (const field of Object.keys(csvFieldNames) as CsvField[]) {
    if (field !== 'ignore' && csvFieldNames[field] === trimmed) {
      return field;
    }
  }
  return 'ignore';
}

function renderCsvMapping(csv: ParsedCsv): void {
  const fragment = document.createDocumentFragment();
  for (const [index, header] of csv.headers.entries()) {
    const row = document.createElement('label');
    row.className = 'csv-map-row';
    const name = document.createElement('strong');
    name.textContent = header === '' ? `第 ${index + 1} 欄（無名稱）` : header;
    const select = document.createElement('select');
    select.className = 'csv-field-select';
    select.dataset.columnIndex = `${index}`;
    // 只認 SplitBed 自己建議嘅欄名（見 docs/07-booking-sheet.md）。
    // 唔會估其他 PMS 嘅格式 —— 對唔上就照樣留返「忽略」等人手揀。
    const autoField = autoMatchField(header);
    for (const field of Object.keys(csvFieldNames) as CsvField[]) {
      const option = document.createElement('option');
      option.value = field;
      option.textContent = csvFieldNames[field];
      if (field === autoField) option.selected = true;
      select.append(option);
    }
    row.append(name, select);
    fragment.append(row);
  }
  csvMapping.replaceChildren(fragment);
  csvMapping.hidden = false;
  importCsvButton.hidden = false;
}

function validationForSolve(): string | null {
  if (rooms.length === 0 || beds.length === 0) return '請先設定至少一間有床位的房間。';
  if (bookings.length === 0) return '請先加入至少一張訂單。';
  if (siteConfig.rooms.some((room) => room.code.trim() === '' || !Number.isInteger(room.beds) || room.beds <= 0)) {
    return '每間房都要有代號，而且床數要是大過 0 的整數。';
  }
  const unconfirmed = guests.filter((guest) => !guest.genderConfirmed).length;
  return unconfirmed > 0
    ? `仲有 ${unconfirmed} 位客人未確認性別；可以按 M、F 或 U 快速完成。`
    : null;
}

function assignmentFor(placement: Placement, previous: readonly Assignment[]): Assignment {
  const guest = guests.find((item) => item.id === placement.guestId);
  const old = previous.find((assignment) => assignment.guestId === placement.guestId);
  return {
    id: old?.id ?? nextId('assignment'),
    guestId: placement.guestId,
    roomId: placement.roomId,
    bedId: null,
    dateFrom: guest?.checkIn ?? '',
    dateTo: guest?.checkOut ?? '',
    lockLevel: old?.lockLevel === 'hard' ? 'hard' : 'none',
    isCurrent: true,
    createdBy: old?.lockLevel === 'hard' ? 'staff' : 'optimizer',
  };
}

function runSolve(assignments: readonly Assignment[] = currentAssignments): SolveResult | null {
  const problem = allocationProblem(assignments);
  return problem === null ? null : solve(problem, SOLVE_OPTIONS);
}

function occupancyIndex(placements: readonly Placement[]): Map<string, AllocatorGuest[]> {
  const guestById = new Map(guests.map((guest) => [guest.id, guest]));
  const index = new Map<string, AllocatorGuest[]>();
  for (const placement of placements) {
    const guest = guestById.get(placement.guestId);
    if (guest === undefined) continue;
    for (const date of eachNight(guest.checkIn, guest.checkOut)) {
      const key = `${placement.roomId}|${date}`;
      const occupants = index.get(key) ?? [];
      occupants.push(guest);
      index.set(key, occupants);
    }
  }
  return index;
}

function cellState(occupants: readonly AllocatorGuest[], roomCapacity: number): { className: string; text: string } {
  if (roomCapacity === 0) return { className: 'cell-maintenance', text: '維修' };
  if (occupants.length === 0) return { className: 'cell-empty', text: '空' };
  const hasMale = occupants.some((guest) => guest.gender === 'male');
  const hasFemale = occupants.some((guest) => guest.gender === 'female');
  const genderText = hasMale && hasFemale ? '混' : hasMale ? '男' : hasFemale ? '女' : '未定';
  if (occupants.length >= roomCapacity) return { className: 'cell-full', text: `滿 · ${genderText}` };
  if (hasMale && hasFemale) return { className: 'cell-mixed', text: '混' };
  if (hasMale) return { className: 'cell-male', text: '男' };
  if (hasFemale) return { className: 'cell-female', text: '女' };
  return { className: 'cell-empty', text: '未定' };
}

function renderCalendar(result: SolveResult): void {
  const dates = horizon();
  if (dates === null) return;
  const startedAt = performance.now();
  const nights = eachNight(dates[0], dates[1]);
  const occupants = occupancyIndex(result.placements);
  const table = document.createElement('table');
  table.className = 'calendar-table';
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const roomHeading = document.createElement('th');
  roomHeading.textContent = '房間';
  headerRow.append(roomHeading);
  for (const date of nights) {
    const heading = document.createElement('th');
    heading.textContent = date.slice(5).replace('-', '/');
    heading.title = date;
    headerRow.append(heading);
  }
  head.append(headerRow);
  const body = document.createElement('tbody');
  for (const room of rooms) {
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.className = 'calendar-room-name';
    name.scope = 'row';
    name.textContent = `Room ${room.code}`;
    row.append(name);
    for (const date of nights) {
      const roomCapacity = capacity(room.id, beds, date);
      const cellOccupants = occupants.get(`${room.id}|${date}`) ?? [];
      const state = cellState(cellOccupants, roomCapacity);
      const cell = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `calendar-cell ${state.className}`;
      button.dataset.roomId = room.id;
      button.dataset.date = date;
      button.innerHTML = `<strong>${cellOccupants.length}/${roomCapacity}</strong><span>${state.text}</span>`;
      button.setAttribute('aria-label', `Room ${room.code}，${date}，${cellOccupants.length}/${roomCapacity}，${state.text}`);
      cell.append(button);
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  const fragment = document.createDocumentFragment();
  fragment.append(table);
  calendarScroll.replaceChildren(fragment);
  calendarRange.textContent = `${dates[0]} 至 ${dates[1]} · ${nights.length} 晚`;
  calendarScroll.dataset.renderMs = `${performance.now() - startedAt}`;
}

function roomCodesForBooking(bookingId: string, result: SolveResult): string[] {
  const bookingGuestIds = new Set(
    guests.filter((guest) => guest.bookingId === bookingId).map((guest) => guest.id),
  );
  const roomById = new Map(rooms.map((room) => [room.id, room.code]));
  return [...new Set(
    result.placements
      .filter((placement) => bookingGuestIds.has(placement.guestId))
      .map((placement) => roomById.get(placement.roomId) ?? placement.roomId),
  )].sort();
}

function renderSuggestions(result: SolveResult): void {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const placementRoomByGuest = new Map(result.placements.map((placement) => [placement.guestId, placement.roomId]));
  const diagnostics = new Map(result.diagnostics.map((diagnostic) => [diagnostic.bookingId, diagnostic]));
  const usedRooms = new Set(result.placements.map((placement) => placement.roomId));
  const occupantsByRoomNight = occupancyIndex(result.placements);
  const emptyRoom = rooms.find((room) => !usedRooms.has(room.id));
  // 用生意講法做總結，唔係「成功／失敗」。
  const cannotTake = bookings.filter((booking) =>
    result.rejectedBookingIds.includes(booking.id),
  ).length;
  const canTake = bookings.length - cannotTake;
  suggestionSummary.textContent =
    cannotTake === 0
      ? `${bookings.length} 張單全部收得到`
      : `${bookings.length} 張單：收得到 ${canTake} 張、收唔到 ${cannotTake} 張`;
  suggestionSummary.classList.toggle('has-rejects', cannotTake > 0);

  const fragment = document.createDocumentFragment();
  for (const booking of bookings) {
    const row = document.createElement('tr');
    const roomCodes = roomCodesForBooking(booking.id, result);
    const bookingGuests = guests.filter((guest) => guest.bookingId === booking.id);
    const reference = document.createElement('td');
    reference.textContent = booking.reference;
    const roomCell = document.createElement('td');
    // 「未能安排」係系統角度。對經營者嚟講只有兩個意思：仲未確認就係收唔到，
    // 已經確認就係超收咗要處理。所以直接講「收唔到」。
    if (roomCodes.length === 0) {
      roomCell.classList.add('cannot-take');
      roomCell.textContent = '收唔到';
    } else {
      roomCell.textContent = roomCodes.map((code) => `Room ${code}`).join('、');
    }
    const reason = document.createElement('td');
    if (result.rejectedBookingIds.includes(booking.id)) {
      const list = document.createElement('ul');
      list.className = 'diagnostic-list';
      const perRoom = new Map(
        (diagnostics.get(booking.id)?.perRoom ?? []).map((item) => [item.roomId, item.reason]),
      );
      let genderBlocked = false;
      for (const room of rooms) {
        const item = document.createElement('li');
        const blockReason = perRoom.get(room.id);
        if (blockReason === 'gender_conflict') {
          genderBlocked = true;
        }
        item.textContent = `Room ${room.code}：${blockReason === undefined ? '未能在保持整張訂單規則下完成安排' : diagnosticNames[blockReason]}`;
        list.append(item);
      }
      reason.append(list);
      const advice = document.createElement('p');
      advice.className = 'cannot-take-advice';
      advice.textContent = genderBlocked
        ? '呢張單仲未確認就唔好收；已經確認咗就即係超收咗，要退款或者另作安排。想收返呢類單，可以開放多一間房男女同房。'
        : '呢張單仲未確認就唔好收；已經確認咗就即係超收咗，要退款或者另作安排。';
      reason.append(advice);
    } else if (roomCodes.length > 1) {
      reason.textContent = generatePlacementReason({
        roomCode: roomCodes[0], existingGuests: 0, addedGuests: bookingGuests.length,
        capacity: 0, emptyRoomCode: emptyRoom?.code ?? null, splitRoomCodes: roomCodes,
        splitByGender:
          new Set(
            bookingGuests
              .map((guest) => guest.gender)
              .filter((gender) => gender !== 'unspecified'),
          ).size > 1,
      });
    } else {
      const roomId = placementRoomByGuest.get(bookingGuests[0]?.id ?? '');
      const room = roomId === undefined ? undefined : roomById.get(roomId);
      const existingGuests = (
        occupantsByRoomNight.get(`${roomId ?? ''}|${booking.checkIn}`) ?? []
      ).filter((guest) => guest.bookingId !== booking.id).length;
      reason.textContent = generatePlacementReason({
        roomCode: room?.code ?? roomCodes[0] ?? '', existingGuests,
        addedGuests: bookingGuests.length,
        capacity: roomId === undefined ? 0 : capacity(roomId, beds, booking.checkIn),
        emptyRoomCode: emptyRoom?.code ?? null,
      });
    }
    row.append(reference, roomCell, reason);
    fragment.append(row);
  }
  suggestionBody.replaceChildren(fragment);
}

function countEmptyRooms(result: SolveResult): number {
  const used = new Set(result.placements.map((placement) => placement.roomId));
  return rooms.filter((room) => !used.has(room.id)).length;
}

function signed(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`;
}

function updateAdjustmentPreview(): void {
  pendingAdjustment = null;
  confirmAdjustment.disabled = true;
  if (lastResult === null || adjustGuest.value === '' || adjustRoom.value === '') {
    impactPreview.innerHTML = '<p>被鎖住賣不出的床晚 <strong>—</strong></p><p>完全空置的房間 <strong>—</strong></p>';
    return;
  }
  const guest = guests.find((item) => item.id === adjustGuest.value);
  if (guest === undefined) return;
  const assignment: Assignment = {
    id: currentAssignments.find((item) => item.guestId === guest.id)?.id ?? nextId('assignment'),
    guestId: guest.id, roomId: adjustRoom.value, bedId: null,
    dateFrom: guest.checkIn, dateTo: guest.checkOut, lockLevel: 'hard', isCurrent: true, createdBy: 'staff',
  };
  const previewAssignments = [...currentAssignments.filter((item) => item.guestId !== guest.id), assignment];
  const previewResult = runSolve(previewAssignments);
  if (previewResult === null) return;
  const strandDelta = Math.round(
    previewResult.breakdown.strand / SOLVE_OPTIONS.weights.strand -
      lastResult.breakdown.strand / SOLVE_OPTIONS.weights.strand,
  );
  const emptyDelta = countEmptyRooms(previewResult) - countEmptyRooms(lastResult);
  impactPreview.innerHTML = `<p>被鎖住賣不出的床晚 <strong>${signed(strandDelta)}</strong></p><p>完全空置的房間 <strong>${signed(emptyDelta)}</strong></p>`;
  pendingAdjustment = { assignment, result: previewResult };
  confirmAdjustment.disabled = false;
}

function renderAdjustment(result: SolveResult): void {
  const roomById = new Map(rooms.map((room) => [room.id, room.code]));
  const guestOptions = document.createDocumentFragment();
  const emptyGuest = document.createElement('option');
  emptyGuest.value = '';
  emptyGuest.textContent = '請揀客人';
  guestOptions.append(emptyGuest);
  for (const guest of guests) {
    if (!result.placements.some((placement) => placement.guestId === guest.id)) continue;
    const booking = bookings.find((item) => item.id === guest.bookingId);
    const option = document.createElement('option');
    option.value = guest.id;
    option.textContent = `${guest.name || '未填名'} · ${booking?.reference ?? guest.bookingId}`;
    guestOptions.append(option);
  }
  adjustGuest.replaceChildren(guestOptions);
  const roomOptions = document.createDocumentFragment();
  const emptyRoom = document.createElement('option');
  emptyRoom.value = '';
  emptyRoom.textContent = '請揀房間';
  roomOptions.append(emptyRoom);
  for (const room of rooms) {
    const option = document.createElement('option');
    option.value = room.id;
    option.textContent = `Room ${room.code}`;
    roomOptions.append(option);
  }
  adjustRoom.replaceChildren(roomOptions);
  impactPreview.innerHTML = '<p>被鎖住賣不出的床晚 <strong>—</strong></p><p>完全空置的房間 <strong>—</strong></p>';
  confirmAdjustment.disabled = true;
  const fragment = document.createDocumentFragment();
  for (const assignment of currentAssignments.filter((item) => item.lockLevel === 'hard')) {
    const guest = guests.find((item) => item.id === assignment.guestId);
    const item = document.createElement('div');
    item.className = 'locked-item';
    item.innerHTML = `<span>${escapeHtml(guest?.name || '未填名')} → Room ${escapeHtml(roomById.get(assignment.roomId) ?? assignment.roomId)}</span><button class="allocator-secondary unlock-guest" type="button" data-guest-id="${escapeHtml(assignment.guestId)}">解除鎖定</button>`;
    fragment.append(item);
  }
  lockedList.replaceChildren(fragment);
}

function renderAllResults(result: SolveResult): void {
  renderCalendar(result);
  renderSuggestions(result);
  renderAdjustment(result);
  results.hidden = false;
}

function commitSolve(result: SolveResult, previous: readonly Assignment[]): void {
  lastResult = result;
  currentAssignments = result.placements.map((placement) => assignmentFor(placement, previous));
  persist();
  renderAllResults(result);
  clearMessage(solveMessage);
}

function solveAndRender(assignments: readonly Assignment[] = currentAssignments): void {
  const problemMessage = validationForSolve();
  if (problemMessage !== null) {
    showMessage(solveMessage, problemMessage);
    return;
  }
  const result = runSolve(assignments);
  if (result === null) {
    showMessage(solveMessage, '未有足夠資料進行排房。');
    return;
  }
  commitSolve(result, assignments);
}

function showCellDetail(roomId: string, date: string): void {
  if (lastResult === null) return;
  const room = rooms.find((item) => item.id === roomId);
  const occupants = occupancyIndex(lastResult.placements).get(`${roomId}|${date}`) ?? [];
  const heading = document.createElement('h3');
  heading.textContent = `Room ${room?.code ?? roomId} · ${date}`;
  cellDetail.replaceChildren(heading);
  if (occupants.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = capacity(roomId, beds, date) === 0 ? '當晚床位全部停用。' : '當晚無人入住。';
    cellDetail.append(empty);
  } else {
    const list = document.createElement('ul');
    for (const guest of occupants) {
      const booking = bookings.find((item) => item.id === guest.bookingId);
      const item = document.createElement('li');
      item.textContent = `${guest.name || '未填名'}（${genderNames[guest.gender]}，訂單 ${booking?.reference ?? guest.bookingId}）`;
      list.append(item);
    }
    cellDetail.append(list);
  }
  cellDetail.hidden = false;
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function download(name: string, type: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function normalizeImported(data: AllocatorFileData): void {
  const sortedRooms = [...data.rooms].sort((left, right) => left.sortOrder - right.sortOrder);
  const roomIdMap = new Map(sortedRooms.map((room, index) => [room.id, `room-${index}`]));
  siteConfig = {
    ...siteConfig,
    rooms: sortedRooms.map<RoomSpec>((room) => ({
      code: room.code,
      beds: data.beds.filter((bed) => bed.roomId === room.id).length,
      mixed: room.roomType === 'mixed',
    })),
  };
  saveConfig(siteConfig);
  rooms = makeRooms(siteConfig);
  beds = sortedRooms.flatMap((room, roomIndex) =>
    data.beds.filter((bed) => bed.roomId === room.id).map((bed, bedIndex) => ({
      ...bed, id: `room-${roomIndex}-bed-${bedIndex}`, roomId: `room-${roomIndex}`, code: `${bedIndex + 1}`,
    })),
  );
  bookings = data.bookings.map((booking) => ({ ...booking }));
  guests = data.guests.map((guest) => ({ ...guest }));
  currentAssignments = data.currentAssignments.map((assignment) => ({
    ...assignment, roomId: roomIdMap.get(assignment.roomId) ?? assignment.roomId, bedId: null,
  })).filter((assignment) => rooms.some((room) => room.id === assignment.roomId));
  lastResult = null;
  renderRooms();
  renderBedClosures();
  renderBookings();
  results.hidden = true;
  persist();
}

roomList.addEventListener('input', syncRoomConfigFromDom);
roomList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.classList.contains('allocator-delete-room')) return;
  const index = Number(target.closest<HTMLElement>('.allocator-room-row')?.dataset.roomIndex);
  if (!Number.isInteger(index)) return;
  siteConfig = { ...siteConfig, rooms: siteConfig.rooms.filter((_, itemIndex) => itemIndex !== index) };
  rooms = makeRooms(siteConfig);
  beds = makeBeds(siteConfig, beds);
  currentAssignments = [];
  saveConfig(siteConfig);
  renderRooms();
  renderBedClosures();
  invalidateResults();
  persist();
});

addRoomButton.addEventListener('click', () => {
  siteConfig = { ...siteConfig, rooms: [...siteConfig.rooms, { code: `房 ${siteConfig.rooms.length + 1}`, beds: 1, mixed: false }] };
  rooms = makeRooms(siteConfig);
  beds = makeBeds(siteConfig, beds);
  saveConfig(siteConfig);
  renderRooms();
  renderBedClosures();
  invalidateResults();
  persist();
});

bedClosureList.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const bed = beds.find((item) => item.id === target.closest<HTMLElement>('.bed-closure-row')?.dataset.bedId);
  if (bed === undefined) return;
  if (target.classList.contains('bed-stop-from')) bed.outOfServiceFrom = target.value || null;
  if (target.classList.contains('bed-stop-to')) bed.outOfServiceTo = target.value || null;
  invalidateResults();
  persist();
});

manualForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const count = Number(manualGuestCount.value);
    validateBookingInput(manualReference.value, manualCheckIn.value, manualCheckOut.value, count);
    const bookingId = createBooking(
      manualReference.value.trim(), manualCheckIn.value, manualCheckOut.value, count,
      manualSource.value as BookingSource, manualTogether.checked, manualNotes.value,
    );
    manualForm.reset();
    manualGuestCount.value = '1';
    manualTogether.checked = true;
    renderBookings();
    clearMessage(inputMessage);
    const first = guests.find((guest) => guest.bookingId === bookingId);
    if (first !== undefined) focusGuest(first.id);
  } catch (error) {
    showMessage(inputMessage, error instanceof Error ? error.message : '未能加入訂單。');
  }
});

/**
 * 示範資料 ＝ 可下載嗰份訂單記錄表（public/examples/splitbed-orders-example.csv）
 * 入面 12 張有效訂單。兩張已取消／No-show 唔會出現，同匯入行為一致。
 * 性別已經填好，所以撳完可以即刻排房。
 */
const DEMO_BOOKINGS: ReadonlyArray<{
  readonly ref: string;
  readonly from: string;
  readonly to: string;
  readonly genders: readonly Gender[];
  readonly together: boolean;
  readonly privateRoom?: boolean;
}> = [
  { ref: 'DIR-2027-0001', from: '2027-02-01', to: '2027-02-05', genders: ['male', 'male'], together: true },
  { ref: 'BKG-4471932', from: '2027-02-01', to: '2027-02-04', genders: ['female'], together: true },
  { ref: 'DIR-2027-0002', from: '2027-02-02', to: '2027-02-08', genders: ['male', 'male', 'male'], together: true },
  { ref: 'DIR-2027-0003', from: '2027-02-04', to: '2027-02-07', genders: ['male', 'female'], together: true },
  { ref: 'AGD-88120455', from: '2027-02-05', to: '2027-02-06', genders: ['female'], together: true },
  { ref: 'DIR-2027-0004', from: '2027-02-05', to: '2027-02-19', genders: ['male'], together: true },
  { ref: 'BKG-4478821', from: '2027-02-06', to: '2027-02-09', genders: ['female', 'female', 'female', 'female'], together: true },
  { ref: 'WLK-2027-0001', from: '2027-02-06', to: '2027-02-07', genders: ['unspecified'], together: true },
  { ref: 'AGD-88134902', from: '2027-02-07', to: '2027-02-10', genders: ['female', 'female'], together: true },
  { ref: 'DIR-2027-0005', from: '2027-02-08', to: '2027-02-22', genders: ['female'], together: true },
  { ref: 'EXP-77401238', from: '2027-02-09', to: '2027-02-11', genders: ['male', 'male', 'unspecified'], together: false },
  { ref: 'DIR-2027-0006', from: '2027-02-10', to: '2027-02-13', genders: ['male', 'female'], together: true, privateRoom: true },
];

function loadDemoBookings(): void {
  const batch = bookings.length + 1;
  for (const demo of DEMO_BOOKINGS) {
    createBooking(
      batch === 1 ? demo.ref : `${demo.ref}-${batch}`,
      demo.from,
      demo.to,
      demo.genders.length,
      'direct',
      demo.together,
      '',
      'unspecified',
      demo.genders,
      demo.privateRoom === true,
    );
  }
  renderBookings();
  clearMessage(inputMessage);
}

loadSampleButton.addEventListener('click', loadDemoBookings);

// 一撳就見到成件事：載入示範、排房、捲到結果。
// 冇人會為咗試效果而逐張單自己入。
runDemoButton.addEventListener('click', () => {
  // 展開工作區，等人見到示範啲單去咗邊，可以即刻改。
  document.getElementById('work-panel')?.setAttribute('open', '');
  loadDemoBookings();
  solveAndRender();
  document.getElementById('allocation-results')?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
});

parseCsvButton.addEventListener('click', () => {
  try {
    parsedCsv = parseCsv(csvText.value);
    renderCsvMapping(parsedCsv);
    clearMessage(inputMessage);
  } catch (error) {
    showMessage(inputMessage, error instanceof Error ? error.message : '未能讀取 CSV。');
  }
});

importCsvButton.addEventListener('click', () => {
  if (parsedCsv === null) return;
  try {
    const mapping = [...csvMapping.querySelectorAll<HTMLSelectElement>('.csv-field-select')]
      .sort((left, right) => Number(left.dataset.columnIndex) - Number(right.dataset.columnIndex))
      .map((select) => select.value as CsvField);
    const skipped = addCsvDrafts(mapCsvBookings(parsedCsv, mapping));
    if (skipped > 0) {
      showMessage(
        inputMessage,
        `已匯入。當中 ${skipped} 張已取消／No-show 訂單唔會排房。`,
      );
    } else {
      clearMessage(inputMessage);
    }
  } catch (error) {
    showMessage(inputMessage, error instanceof Error ? error.message : '未能匯入 CSV。');
  }
});

bookingList.addEventListener('focusin', (event) => {
  const target = event.target;
  if (target instanceof HTMLButtonElement && target.classList.contains('gender-button')) {
    activeGuestId = target.closest<HTMLElement>('.guest-row')?.dataset.guestId ?? null;
  }
});

bookingList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.classList.contains('gender-button')) return;
  const guestId = target.closest<HTMLElement>('.guest-row')?.dataset.guestId;
  const gender = target.dataset.gender as Gender | undefined;
  if (guestId !== undefined && gender !== undefined) applyGender(guestId, gender);
});

bookingList.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.classList.contains('guest-name')) return;
  const guest = guests.find((item) => item.id === target.closest<HTMLElement>('.guest-row')?.dataset.guestId);
  if (guest !== undefined) {
    guest.name = target.value;
    persist();
  }
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
  const key = event.key.toLowerCase();
  const gender = key === 'm' ? 'male' : key === 'f' ? 'female' : key === 'u' ? 'unspecified' : null;
  if (gender !== null) {
    event.preventDefault();
    const guestId = activeGuestId ?? guests.find((guest) => !guest.genderConfirmed)?.id;
    if (guestId !== undefined) applyGender(guestId, gender);
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    moveGenderFocus(1);
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveGenderFocus(-1);
  }
});

solveButton.addEventListener('click', () => solveAndRender());
resetSolveButton.addEventListener('click', () => {
  currentAssignments = [];
  solveAndRender([]);
});

calendarScroll.addEventListener('click', (event) => {
  const target = event.target;
  const button = target instanceof Element ? target.closest<HTMLButtonElement>('.calendar-cell') : null;
  if (button?.dataset.roomId !== undefined && button.dataset.date !== undefined) {
    showCellDetail(button.dataset.roomId, button.dataset.date);
  }
});

adjustGuest.addEventListener('change', updateAdjustmentPreview);
adjustRoom.addEventListener('change', updateAdjustmentPreview);
confirmAdjustment.addEventListener('click', () => {
  if (pendingAdjustment === null) return;
  const previous = [
    ...currentAssignments.filter((item) => item.guestId !== pendingAdjustment?.assignment.guestId),
    pendingAdjustment.assignment,
  ];
  commitSolve(pendingAdjustment.result, previous);
  pendingAdjustment = null;
});

lockedList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.classList.contains('unlock-guest')) return;
  currentAssignments = currentAssignments.filter((assignment) => assignment.guestId !== target.dataset.guestId);
  solveAndRender(currentAssignments);
});

exportJsonButton.addEventListener('click', () => {
  download('splitbed-allocation.json', 'application/json', JSON.stringify(exportData(), null, 2));
  showMessage(transferMessage, 'JSON 已匯出。');
});

exportCsvButton.addEventListener('click', () => {
  const lines = ['訂單編號,建議房間'];
  for (const booking of bookings) {
    const assigned = lastResult === null ? [] : roomCodesForBooking(booking.id, lastResult);
    lines.push(`${csvEscape(booking.reference)},${csvEscape(assigned.map((code) => `Room ${code}`).join(' / '))}`);
  }
  download('splitbed-recommendations.csv', 'text/csv;charset=utf-8', `\uFEFF${lines.join('\r\n')}`);
  showMessage(transferMessage, '建議 CSV 已匯出。');
});

importJsonInput.addEventListener('change', async () => {
  const file = importJsonInput.files?.[0];
  if (file === undefined) return;
  try {
    normalizeImported(validateAllocatorJson(JSON.parse(await file.text()) as unknown));
    showMessage(transferMessage, 'JSON 已成功匯入。');
  } catch (error) {
    showMessage(transferMessage, error instanceof Error ? `匯入失敗：${error.message}` : '匯入失敗：格式不正確。');
  } finally {
    importJsonInput.value = '';
  }
});

rooms = makeRooms(siteConfig);
const saved = loadAllocatorState();
beds = makeBeds(siteConfig, saved?.beds ?? []);
if (saved !== null) {
  bookings = saved.bookings.map((booking) => ({ ...booking }));
  guests = saved.guests.map((guest) => ({ ...guest }));
  const roomIds = new Set(rooms.map((room) => room.id));
  currentAssignments = saved.currentAssignments
    .filter((assignment) => roomIds.has(assignment.roomId))
    .map((assignment) => ({ ...assignment }));
}
renderRooms();
renderBedClosures();
renderBookings();
