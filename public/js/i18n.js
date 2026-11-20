// Shokutaku 食卓 — выбор языка: русский (по умолчанию) или узбекский.
// Выбор хранится в браузере. Узбекский словарь (i18n-uz.js) грузится только когда он нужен.
(() => {
  const KEY = 'shk-lang';
  const root = document.documentElement;
  let lang = 'ru';
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'uz' || q === 'ru') localStorage.setItem(KEY, q);
    if (localStorage.getItem(KEY) === 'uz') lang = 'uz';
  } catch {
    if (/(?:^|;\s*)shk_lang=uz/.test(document.cookie)) lang = 'uz';
  }
  root.lang = lang;

  function set(next) {
    if (next !== 'uz') next = 'ru';
    try { localStorage.setItem(KEY, next); } catch { /* приватный режим */ }
    document.cookie = `shk_lang=${next}; path=/; max-age=31536000; samesite=lax`;
    const url = new URL(location.href);
    url.searchParams.delete('lang');
    location.replace(url.href);
  }

  window.ShkI18n = { lang, set, t: (s) => s, missed: new Set() };
  if (lang !== 'uz') return;

  // Пока словарь не загрузился, страница скрыта, чтобы не мелькал русский текст
  root.classList.add('i18n-wait');
  const st = document.createElement('style');
  st.textContent = 'html.i18n-wait body{visibility:hidden}';
  document.head.appendChild(st);
  const show = () => root.classList.remove('i18n-wait');
  setTimeout(show, 3000);
  const s = document.createElement('script');
  s.src = '/js/i18n-uz.js?v=2';
  s.async = false;
  s.onerror = show;
  document.head.appendChild(s);
})();
