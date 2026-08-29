import { mountNav } from './nav';
import { resetConfig, loadConfig, type SiteConfig } from './store';

mountNav();

/** The Sapporo rooms used by the worked example in section six. */
const EXAMPLE_CONFIG: SiteConfig = {
  siteName: '札幌',
  rooms: [
    { code: 'A', beds: 2, mixed: false },
    { code: 'B', beds: 4, mixed: true },
    { code: 'C', beds: 3, mixed: false },
    { code: 'D', beds: 3, mixed: false },
  ],
  nightlyRate: 5_000,
  seasonNights: 90,
};

function sameAsExample(config: SiteConfig): boolean {
  return (
    config.nightlyRate === EXAMPLE_CONFIG.nightlyRate &&
    config.seasonNights === EXAMPLE_CONFIG.seasonNights &&
    config.rooms.length === EXAMPLE_CONFIG.rooms.length &&
    config.rooms.every((room, index) => {
      const expected = EXAMPLE_CONFIG.rooms[index];
      return (
        room.code === expected.code &&
        room.beds === expected.beds &&
        room.mixed === expected.mixed
      );
    })
  );
}

const button = document.querySelector<HTMLButtonElement>('#load-example');
const status = document.querySelector<HTMLParagraphElement>('#load-example-status');

button?.addEventListener('click', () => {
  // Someone may have spent time entering their own rooms on the simulator.
  // Loading the example overwrites that, so ask before discarding it.
  if (!sameAsExample(loadConfig())) {
    const proceed = window.confirm(
      '你喺模擬器度已經有自己嘅房型設定。載入呢個例子會覆蓋咗佢，繼續？',
    );
    if (!proceed) {
      return;
    }
  }

  // The example is the stored default, so clearing is enough and it stays
  // correct even if the defaults ever change.
  resetConfig();
  if (!sameAsExample(loadConfig()) && status !== null) {
    // Storage is blocked; say so instead of silently sending them to a page
    // that will show their own numbers.
    status.textContent = '你嘅瀏覽器封鎖咗本機儲存，請喺模擬器度自己輸入呢組房型。';
    return;
  }
  window.location.href = './index.html';
});
