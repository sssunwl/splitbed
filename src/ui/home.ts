import { mountNav } from './nav';
import type {
  AdvancedDemand,
  ScenarioId,
  SimulationRequest,
  SimulationResponse,
  SimulationRow,
} from './sim.worker';
import { loadConfig, saveConfig, type RoomSpec, type SiteConfig } from './store';

mountNav();

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`找不到頁面元件：${selector}`);
  }
  return element;
}

const form = requiredElement<HTMLFormElement>('#simulator-form');
const roomList = requiredElement<HTMLDivElement>('#room-list');
const roomSummary = requiredElement<HTMLParagraphElement>('#room-summary');
const addRoomButton = requiredElement<HTMLButtonElement>('#add-room');
const nightlyRateInput = requiredElement<HTMLInputElement>('#nightly-rate');
const seasonNightsInput = requiredElement<HTMLInputElement>('#season-nights');
const hybridStatus = requiredElement<HTMLElement>('#hybrid-status');
const demandInput = requiredElement<HTMLInputElement>('#demand-ratio');
const demandValue = requiredElement<HTMLOutputElement>('#demand-value');
const bookingEstimate = requiredElement<HTMLParagraphElement>('#booking-estimate');
const maleRatioInput = requiredElement<HTMLInputElement>('#male-ratio');
const maleRatioValue = requiredElement<HTMLOutputElement>('#male-ratio-value');
const averageStayInput = requiredElement<HTMLInputElement>('#average-stay');
const averageGroupInput = requiredElement<HTMLInputElement>('#average-group');
const calculateButton = requiredElement<HTMLButtonElement>('#calculate-button');
const formMessage = requiredElement<HTMLParagraphElement>('#form-message');
const progressWrap = requiredElement<HTMLDivElement>('#progress-wrap');
const progressBar = requiredElement<HTMLSpanElement>('#progress-bar');
const progressText = requiredElement<HTMLParagraphElement>('#progress-text');
const results = requiredElement<HTMLElement>('#results');
const staleNotice = requiredElement<HTMLDivElement>('#stale-notice');
const conclusion = requiredElement<HTMLHeadingElement>('#result-conclusion');
const incomeTableBody = requiredElement<HTMLTableSectionElement>('#income-table-body');
const impactTableBody = requiredElement<HTMLTableSectionElement>('#impact-table-body');
const chartBars = requiredElement<SVGGElement>('#chart-bars');
const assumptionList = requiredElement<HTMLDivElement>('#assumption-list');

const scenarioNames: Record<ScenarioId, string> = {
  same_gender: '男女分房',
  hybrid: '部分開放',
  mixed: '全面開放',
};

let siteConfig = loadConfig();
let revision = 0;
let activeWorker: Worker | null = null;

function numericValue(input: HTMLInputElement): number {
  return input.value === '' ? Number.NaN : Number(input.value);
}

function totalBeds(rooms: readonly RoomSpec[]): number {
  return rooms.reduce((sum, room) => sum + (Number.isFinite(room.beds) ? room.beds : 0), 0);
}

function formatMoney(value: number): string {
  return `¥${Math.round(value).toLocaleString('zh-Hant-TW')}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function markResultsStale(): void {
  revision += 1;
  if (!results.hidden) {
    staleNotice.hidden = false;
  }
}

function readAdvancedDemand(): AdvancedDemand {
  return {
    maleRatio: numericValue(maleRatioInput),
    averageStayNights: numericValue(averageStayInput),
    averageGroupSize: numericValue(averageGroupInput),
  };
}

function estimatedBookings(): number | null {
  const advanced = readAdvancedDemand();
  const beds = totalBeds(siteConfig.rooms);
  const demandPercent = numericValue(demandInput);
  if (
    beds <= 0 ||
    siteConfig.seasonNights <= 0 ||
    !Number.isFinite(demandPercent) ||
    advanced.averageStayNights <= 0 ||
    advanced.averageGroupSize <= 0
  ) {
    return null;
  }
  return Math.round(
    (beds * siteConfig.seasonNights * (demandPercent / 100)) /
      (advanced.averageStayNights * advanced.averageGroupSize),
  );
}

function updateDerivedText(): void {
  const beds = totalBeds(siteConfig.rooms);
  roomSummary.textContent = `總共 ${siteConfig.rooms.length} 間房、${beds} 張床`;
  const mixedRoomCount = siteConfig.rooms.filter((room) => room.mixed).length;
  hybridStatus.textContent =
    mixedRoomCount === 0 ? '未設定' : `已開放 ${mixedRoomCount} 間房`;
  demandValue.value = `${demandInput.value}%`;
  maleRatioValue.value = `${maleRatioInput.value}%`;
  const estimate = estimatedBookings();
  bookingEstimate.textContent =
    estimate === null
      ? '填好房間、季節長度及進階設定後，就會見到訂單估算。'
      : `即係大約 ${estimate.toLocaleString('zh-Hant-TW')} 張訂單想入住。`;
  averageStayInput.max = `${Math.max(1, siteConfig.seasonNights)}`;
}

function renderRooms(): void {
  roomList.replaceChildren();
  siteConfig.rooms.forEach((room, index) => {
    const row = document.createElement('div');
    row.className = 'room-row';
    row.dataset.roomIndex = `${index}`;
    row.innerHTML = `
      <input class="room-code" type="text" maxlength="20" aria-label="第 ${index + 1} 間房的代號" />
      <input class="room-beds" type="number" min="0" step="1" inputmode="numeric" aria-label="第 ${index + 1} 間房的床數" />
      <label class="mixed-toggle"><input class="room-mixed" type="checkbox" /><span>呢間可以男女同房</span></label>
      <button class="icon-button delete-room" type="button" aria-label="刪除第 ${index + 1} 間房">×</button>
    `;
    const codeInput = row.querySelector<HTMLInputElement>('.room-code');
    const bedsInput = row.querySelector<HTMLInputElement>('.room-beds');
    const mixedInput = row.querySelector<HTMLInputElement>('.room-mixed');
    if (codeInput !== null) {
      codeInput.value = room.code;
    }
    if (bedsInput !== null) {
      bedsInput.value = `${room.beds}`;
    }
    if (mixedInput !== null) {
      mixedInput.checked = room.mixed;
    }
    roomList.append(row);
  });
  updateDerivedText();
}

function syncRoomsFromDom(): void {
  siteConfig = {
    ...siteConfig,
    rooms: [...roomList.querySelectorAll<HTMLElement>('.room-row')].map((row) => ({
      code: row.querySelector<HTMLInputElement>('.room-code')?.value ?? '',
      beds: numericValue(row.querySelector<HTMLInputElement>('.room-beds') ?? document.createElement('input')),
      mixed: row.querySelector<HTMLInputElement>('.room-mixed')?.checked ?? false,
    })),
  };
}

function saveVisibleConfig(): void {
  saveConfig(siteConfig);
}

function validationMessages(): string[] {
  const messages: string[] = [];
  if (siteConfig.rooms.length === 0) {
    messages.push('請先加入至少一間房。');
  }
  if (siteConfig.rooms.some((room) => room.code.trim() === '')) {
    messages.push('請為每間房填上房間代號。');
  }
  if (
    siteConfig.rooms.some(
      (room) => !Number.isInteger(room.beds) || !Number.isFinite(room.beds) || room.beds <= 0,
    )
  ) {
    messages.push('每間房的床數都要是大過 0 的整數。');
  }
  if (!Number.isFinite(siteConfig.nightlyRate) || siteConfig.nightlyRate <= 0) {
    messages.push('每床每晚房價要大過 ¥0。');
  }
  if (!Number.isInteger(siteConfig.seasonNights) || siteConfig.seasonNights <= 0) {
    messages.push('一季晚數要是大過 0 的整數。');
  }
  const demandPercent = numericValue(demandInput);
  if (!Number.isFinite(demandPercent) || demandPercent < 50 || demandPercent > 150) {
    messages.push('需求比例要介乎 50% 至 150%。');
  }
  const advanced = readAdvancedDemand();
  if (!Number.isFinite(advanced.maleRatio) || advanced.maleRatio < 0 || advanced.maleRatio > 100) {
    messages.push('男客比例要介乎 0% 至 100%。');
  }
  if (
    !Number.isFinite(advanced.averageStayNights) ||
    advanced.averageStayNights < 1 ||
    advanced.averageStayNights > siteConfig.seasonNights
  ) {
    messages.push('平均住宿晚數要由 1 晚至一季總晚數之間。');
  }
  if (
    !Number.isFinite(advanced.averageGroupSize) ||
    advanced.averageGroupSize < 1 ||
    advanced.averageGroupSize > 10
  ) {
    messages.push('平均每組人數要介乎 1 至 10 人。');
  }
  return messages;
}

function selectedSeedCount(): number {
  return form.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value === '200'
    ? 200
    : 30;
}

function scenarioLabel(
  scenario: ScenarioId,
  rooms: readonly RoomSpec[] = siteConfig.rooms,
): string {
  if (scenario === 'hybrid' && !rooms.some((room) => room.mixed)) {
    return '部分開放（未設定）';
  }
  return scenarioNames[scenario];
}

function rowFor(rows: readonly SimulationRow[], scenario: ScenarioId): SimulationRow {
  const row = rows.find((item) => item.scenario === scenario);
  if (row === undefined) {
    throw new Error('模擬結果不完整，請再試一次。');
  }
  return row;
}

function renderIncomeTable(
  rows: readonly SimulationRow[],
  rooms: readonly RoomSpec[],
): void {
  const baseline = rowFor(rows, 'same_gender');
  incomeTableBody.replaceChildren(
    ...rows.map((row) => {
      const tableRow = document.createElement('tr');
      const difference = row.revenue - baseline.revenue;
      tableRow.innerHTML = `
        <td>${scenarioLabel(row.scenario, rooms)}</td>
        <td>${formatPercent(row.occupancy)}</td>
        <td>${formatMoney(row.revenue)}</td>
        <td class="${difference > 0 ? 'positive-value' : ''}">${row.scenario === 'same_gender' ? '基準' : `${difference >= 0 ? '+' : '−'}${formatMoney(Math.abs(difference))}`}</td>
      `;
      return tableRow;
    }),
  );
}

function renderImpactTable(
  rows: readonly SimulationRow[],
  rooms: readonly RoomSpec[],
): void {
  impactTableBody.replaceChildren(
    ...rows.map((row) => {
      const tableRow = document.createElement('tr');
      tableRow.innerHTML = `
        <td>${scenarioLabel(row.scenario, rooms)}</td>
        <td>${row.strandedBedNights.toFixed(1)}</td>
        <td>${row.forcedSplits.toFixed(1)}</td>
      `;
      return tableRow;
    }),
  );
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [attribute, value] of Object.entries(attributes)) {
    element.setAttribute(attribute, value);
  }
  return element;
}

function renderChart(rows: readonly SimulationRow[], rooms: readonly RoomSpec[]): void {
  chartBars.replaceChildren();
  const maximumRevenue = Math.max(...rows.map((row) => row.revenue), 1);
  rows.forEach((row, index) => {
    const y = 18 + index * 76;
    const width = Math.max(2, (row.revenue / maximumRevenue) * 440);
    const label = svgElement('text', { x: '0', y: `${y + 31}`, class: 'chart-label' });
    label.textContent = scenarioLabel(row.scenario, rooms);
    const track = svgElement('rect', {
      x: '130',
      y: `${y}`,
      width: '440',
      height: '42',
      rx: '7',
      class: 'chart-track',
    });
    const bar = svgElement('rect', {
      x: '130',
      y: `${y}`,
      width: `${width}`,
      height: '42',
      rx: '7',
      class: `chart-bar-${row.scenario}`,
    });
    const value = svgElement('text', { x: '590', y: `${y + 29}`, class: 'chart-value' });
    value.textContent = formatMoney(row.revenue);
    chartBars.append(label, track, bar, value);
  });
}

function renderAssumptions(
  request: SimulationRequest,
  elapsedMs: number,
): void {
  const beds = totalBeds(request.siteConfig.rooms);
  const orders = Math.round(
    (beds * request.siteConfig.seasonNights * (request.demandPercent / 100)) /
      (request.advanced.averageStayNights * request.advanced.averageGroupSize),
  );
  const mixedRooms = request.siteConfig.rooms
    .filter((room) => room.mixed)
    .map((room) => room.code)
    .join('、');
  const items = [
    `房型：${request.siteConfig.rooms.map((room) => `${room.code} ${room.beds} 床${room.mixed ? '（可男女同房）' : ''}`).join('、')}`,
    `總容量：${request.siteConfig.rooms.length} 間房、${beds} 張床、${beds * request.siteConfig.seasonNights} 床晚`,
    `房價：每床每晚 ${formatMoney(request.siteConfig.nightlyRate)}`,
    `季節長度：${request.siteConfig.seasonNights} 晚，由 2026-01-01 起計`,
    `需求：總容量的 ${request.demandPercent}%，約 ${orders} 張訂單`,
    `性別比例：男 ${request.advanced.maleRatio}%、女 ${100 - request.advanced.maleRatio}%`,
    `平均住宿：${request.advanced.averageStayNights} 晚（相鄰整數加權）`,
    `平均組別：${request.advanced.averageGroupSize} 人（相鄰整數加權）`,
    '同一性別組別機率：70%',
    '平均預訂提前期：14 日',
    '入住日：在一季內隨機分佈',
    `部分開放房間：${mixedRooms === '' ? '未設定' : mixedRooms}`,
    `隨機重跑：${request.seedCount} 次`,
    `瀏覽器計算時間：約 ${(elapsedMs / 1_000).toFixed(2)} 秒`,
  ];
  const list = document.createElement('ul');
  list.replaceChildren(
    ...items.map((item) => {
      const listItem = document.createElement('li');
      listItem.textContent = item;
      return listItem;
    }),
  );
  assumptionList.replaceChildren(list);
}

function renderResults(
  rows: readonly SimulationRow[],
  request: SimulationRequest,
  elapsedMs: number,
  calculationRevision: number,
): void {
  const baseline = rowFor(rows, 'same_gender');
  const mixed = rowFor(rows, 'mixed');
  const difference = mixed.revenue - baseline.revenue;
  const percentage = baseline.revenue === 0 ? 0 : (difference / baseline.revenue) * 100;
  conclusion.textContent =
    difference >= 0
      ? `全面開放男女同房，一季多賺約 ${formatMoney(difference)}（+${percentage.toFixed(1)}%）。`
      : `全面開放男女同房，一季少賺約 ${formatMoney(Math.abs(difference))}（${percentage.toFixed(1)}%）。`;
  renderIncomeTable(rows, request.siteConfig.rooms);
  renderImpactTable(rows, request.siteConfig.rooms);
  renderChart(rows, request.siteConfig.rooms);
  renderAssumptions(request, elapsedMs);
  results.hidden = false;
  staleNotice.hidden = calculationRevision === revision;
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function finishCalculation(): void {
  calculateButton.disabled = false;
  calculateButton.textContent = '開始計算';
  progressWrap.hidden = true;
}

function startCalculation(): void {
  const messages = validationMessages();
  if (messages.length > 0) {
    formMessage.textContent = messages.join(' ');
    formMessage.hidden = false;
    return;
  }
  formMessage.hidden = true;
  activeWorker?.terminate();
  const seedCount = selectedSeedCount();
  const request: SimulationRequest = {
    type: 'start',
    siteConfig: {
      ...siteConfig,
      rooms: siteConfig.rooms.map((room) => ({ ...room })),
    },
    demandPercent: numericValue(demandInput),
    seedCount,
    advanced: readAdvancedDemand(),
  };
  const calculationRevision = revision;
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  activeWorker = worker;
  calculateButton.disabled = true;
  calculateButton.textContent = '計算中…';
  progressWrap.hidden = false;
  progressBar.style.width = '0%';
  progressText.textContent = `已完成 0 / ${seedCount} 次`;

  worker.addEventListener('message', (event: MessageEvent<SimulationResponse>) => {
    if (worker !== activeWorker) {
      return;
    }
    if (event.data.type === 'progress') {
      progressBar.style.width = `${(event.data.completed / event.data.total) * 100}%`;
      progressText.textContent = `已完成 ${event.data.completed} / ${event.data.total} 次`;
      return;
    }
    worker.terminate();
    activeWorker = null;
    finishCalculation();
    if (event.data.type === 'error') {
      formMessage.textContent = event.data.message;
      formMessage.hidden = false;
      return;
    }
    renderResults(event.data.rows, request, event.data.elapsedMs, calculationRevision);
  });

  worker.addEventListener('error', () => {
    if (worker !== activeWorker) {
      return;
    }
    worker.terminate();
    activeWorker = null;
    finishCalculation();
    formMessage.textContent = '計算器未能啟動，請重新整理頁面再試。';
    formMessage.hidden = false;
  });

  worker.postMessage(request);
}

nightlyRateInput.value = `${siteConfig.nightlyRate}`;
seasonNightsInput.value = `${siteConfig.seasonNights}`;
renderRooms();

roomList.addEventListener('input', () => {
  syncRoomsFromDom();
  saveVisibleConfig();
  updateDerivedText();
  markResultsStale();
});

roomList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.classList.contains('delete-room')) {
    return;
  }
  const row = target.closest<HTMLElement>('.room-row');
  const index = Number(row?.dataset.roomIndex);
  if (!Number.isInteger(index)) {
    return;
  }
  siteConfig = {
    ...siteConfig,
    rooms: siteConfig.rooms.filter((_, roomIndex) => roomIndex !== index),
  };
  saveVisibleConfig();
  renderRooms();
  markResultsStale();
});

addRoomButton.addEventListener('click', () => {
  siteConfig = {
    ...siteConfig,
    rooms: [
      ...siteConfig.rooms,
      { code: `房 ${siteConfig.rooms.length + 1}`, beds: 1, mixed: false },
    ],
  };
  saveVisibleConfig();
  renderRooms();
  markResultsStale();
});

form.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || roomList.contains(target)) {
    return;
  }
  if (target === nightlyRateInput) {
    siteConfig = { ...siteConfig, nightlyRate: numericValue(nightlyRateInput) };
    saveVisibleConfig();
  } else if (target === seasonNightsInput) {
    siteConfig = { ...siteConfig, seasonNights: numericValue(seasonNightsInput) };
    saveVisibleConfig();
  }
  updateDerivedText();
  markResultsStale();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  startCalculation();
});
