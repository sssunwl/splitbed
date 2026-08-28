const THEME_KEY = 'splitbed-theme';

type Theme = 'light' | 'dark';

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * Reads the saved theme. Storage access throws in private or storage-blocked
 * contexts, so every read and write is guarded and falls back to the system
 * preference rather than breaking the nav.
 */
function readSavedTheme(): Theme | null {
  try {
    const savedTheme = localStorage.getItem(THEME_KEY);
    return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : null;
  } catch {
    return null;
  }
}

function writeSavedTheme(theme: Theme): void {
  try {
    writeSavedTheme(theme);
  } catch {
    // Storage unavailable: the toggle still works for this page view.
  }
}

function getInitialTheme(): Theme {
  const savedTheme = readSavedTheme();
  if (savedTheme !== null) {
    return savedTheme;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Mounts the shared navigation and its light/dark theme toggle. */
export function mountNav(): void {
  const host = document.querySelector<HTMLElement>('#site-nav');
  if (host === null) {
    return;
  }

  host.innerHTML = `
    <header class="site-header">
      <nav class="site-nav" aria-label="主要導覽">
        <a class="brand" href="./index.html">SplitBed</a>
        <ul class="nav-links">
          <li><a href="./index.html">What-if 模擬器</a></li>
          <li><a href="./allocator.html">排房小工具</a></li>
          <li><a href="./guide.html">使用說明</a></li>
        </ul>
        <button class="theme-toggle" type="button" aria-label="切換深色或淺色模式"></button>
      </nav>
    </header>
  `;

  const button = host.querySelector<HTMLButtonElement>('.theme-toggle');
  if (button === null) {
    return;
  }

  let theme = getInitialTheme();
  const update = (): void => {
    applyTheme(theme);
    button.textContent = theme === 'dark' ? '切換淺色' : '切換深色';
  };

  button.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    writeSavedTheme(theme);
    update();
  });

  update();
}
