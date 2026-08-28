const THEME_KEY = 'splitbed-theme';

type Theme = 'light' | 'dark';

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function getInitialTheme(): Theme {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === 'light' || savedTheme === 'dark') {
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
    localStorage.setItem(THEME_KEY, theme);
    update();
  });

  update();
}
