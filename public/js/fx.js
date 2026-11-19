// Shokutaku 食卓 — визуальные эффекты: живой фон с блюдами, 3D‑торт, переходы между страницами.
// Всё на CSS‑трансформациях (GPU), без тяжёлых библиотек. Уважает «уменьшение движения».
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = innerWidth < 700 || (navigator.hardwareConcurrency || 8) <= 4;
  const GATE_KEY = 'shk-gate';

  let gateFlag = false;
  try { gateFlag = sessionStorage.getItem(GATE_KEY) === '1'; sessionStorage.removeItem(GATE_KEY); } catch { /* приватный режим */ }
  if (gateFlag && !reduced) document.documentElement.classList.add('gate-pending');

  /* ---------------- 3D‑торт ---------------- */
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k)));
    return `rgb(${ch.join(',')})`;
  }

  function makeCake(scale = 1) {
    const N = small ? 16 : 22;
    const root = document.createElement('div');
    root.className = 'cake3d';
    const tiers = [
      { r: 112, h: 74, y: 58, body: '#ff7eb6', frost: '#fff4fa', drip: '#ffffff', dots: true },
      { r: 82, h: 62, y: -10, body: '#ffd27a', frost: '#7a3b1e', drip: '#5c2a14' },
      { r: 54, h: 52, y: -67, body: '#b79bff', frost: '#fff4fa', drip: '#ffffff' },
    ];
    const plate = document.createElement('div');
    plate.className = 'plate';
    const pd = document.createElement('div');
    pd.className = 'disk';
    const pr = 150 * scale;
    Object.assign(pd.style, {
      width: pr * 2 + 'px', height: pr * 2 + 'px', left: -pr + 'px', top: -pr + 'px',
      transform: `translateY(${(58 + 37) * scale}px) rotateX(90deg)`,
      background: 'radial-gradient(circle, #fff 0 60%, #e9e2ff 61% 66%, #cfc3ff 67% 70%, transparent 71%)',
    });
    plate.appendChild(pd);
    root.appendChild(plate);

    tiers.forEach((t) => {
      const r = t.r * scale, h = t.h * scale;
      const w = 2 * r * Math.tan(Math.PI / N) + 1;
      const tier = document.createElement('div');
      tier.className = 'tier';
      tier.style.transform = `translateY(${t.y * scale}px)`;
      for (let i = 0; i < N; i++) {
        const a = (360 / N) * i;
        const light = Math.cos(((a - 35) * Math.PI) / 180); // свет слева‑спереди
        const f = document.createElement('div');
        f.className = 'face';
        const body = shade(t.body, light * 0.18 - 0.08);
        const frost = shade(t.frost, light * 0.1 - 0.05);
        const drip = shade(t.drip, light * 0.08 - 0.04);
        const dripH = Math.round(h * (0.22 + ((i * 37) % 7) / 40));
        f.style.cssText = `width:${w}px;height:${h}px;left:${-w / 2}px;top:${-h / 2}px;transform:rotateY(${a}deg) translateZ(${r}px);` +
          `background:${t.dots ? `radial-gradient(circle at 30% 70%, #ffd84d 0 2px, transparent 2.5px) 0 0/${w}px ${h / 2}px,radial-gradient(circle at 70% 40%, #2ee6c5 0 2px, transparent 2.5px) 0 0/${w}px ${h / 2.4}px,` : ''}` +
          `radial-gradient(ellipse at 50% 0, ${drip} 0 60%, transparent 62%) 0 ${dripH - 10 * scale}px/${w}px ${18 * scale}px no-repeat,` +
          `linear-gradient(${drip}, ${drip}) 0 0/${w}px ${dripH}px no-repeat,` +
          `linear-gradient(180deg, ${body}, ${shade(t.body, light * 0.18 - 0.25)})`;
        tier.appendChild(f);
      }
      const top = document.createElement('div');
      top.className = 'disk';
      Object.assign(top.style, {
        width: r * 2 + 'px', height: r * 2 + 'px', left: -r + 'px', top: -r + 'px',
        transform: `translateY(${-h / 2}px) rotateX(90deg)`,
        background: `radial-gradient(circle, ${t.frost} 0 55%, ${shade(t.frost, -0.08)} 75%, ${shade(t.drip, -0.12)} 100%)`,
      });
      tier.appendChild(top);
      root.appendChild(tier);
    });

    // ягоды по краю верхнего яруса и свечка (крест из двух плоскостей — выглядит объёмно с любого угла)
    const sprite = (x, y, z, size, bg, radius = '50%') => {
      const s = document.createElement('div');
      s.className = 'sprite';
      s.style.transform = `translate3d(${x}px, ${y}px, ${z}px)`;
      for (const rot of [0, 90]) {
        const i = document.createElement('i');
        Object.assign(i.style, {
          width: size.w + 'px', height: size.h + 'px', left: -size.w / 2 + 'px', top: -size.h + 'px',
          transform: `rotateY(${rot}deg)`, background: bg, borderRadius: radius,
        });
        s.appendChild(i);
      }
      root.appendChild(s);
    };
    const topY = (-67 - 26) * scale;
    const berries = small ? 6 : 8;
    for (let i = 0; i < berries; i++) {
      const a = (i / berries) * Math.PI * 2;
      const rr = 40 * scale;
      sprite(Math.cos(a) * rr, topY + 2, Math.sin(a) * rr, { w: 16 * scale, h: 18 * scale },
        'radial-gradient(circle at 35% 30%, #ffb3c0, #ff2d55 45%, #b5002b 80%)', '50% 50% 50% 50% / 60% 60% 40% 40%');
    }
    sprite(0, topY, 0, { w: 9 * scale, h: 46 * scale }, 'repeating-linear-gradient(160deg, #fff 0 6px, #2ee6c5 6px 12px)', '4px');
    const flame = document.createElement('div');
    flame.className = 'sprite';
    flame.style.transform = `translate3d(0, ${topY - 46 * scale}px, 0)`;
    for (const rot of [0, 90]) {
      const i = document.createElement('i');
      Object.assign(i.style, {
        width: 14 * scale + 'px', height: 22 * scale + 'px', left: -7 * scale + 'px', top: -22 * scale + 'px', transform: `rotateY(${rot}deg)`,
        background: 'radial-gradient(ellipse at 50% 70%, #fff 0 20%, #ffd84d 40%, #ff9a3c 70%, transparent 72%)',
        borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%', boxShadow: '0 0 18px 6px rgba(255,200,80,.45)',
      });
      flame.appendChild(i);
    }
    root.appendChild(flame);
    return root;
  }

  function mountCakes() {
    document.querySelectorAll('[data-cake]').forEach((el) => {
      if (el.dataset.ready) return;
      el.dataset.ready = '1';
      const scale = (Number(el.dataset.cake) || 1) * (innerWidth < 500 && !el.closest('.gate') ? 0.78 : 1);
      el.classList.add('cake3d-wrap');
      el.style.setProperty('--w', 340 * scale + 'px');
      el.style.setProperty('--h', 340 * scale + 'px');
      const cake = makeCake(scale);
      if (!reduced) cake.classList.add('spin');
      el.appendChild(cake);
      // лёгкий наклон торта за курсором
      if (matchMedia('(pointer: fine)').matches && !reduced) {
        el.addEventListener('pointermove', (e) => {
          const b = el.getBoundingClientRect();
          const x = (e.clientX - b.left) / b.width - 0.5;
          const y = (e.clientY - b.top) / b.height - 0.5;
          el.style.transform = `rotateX(${-y * 14}deg) rotateY(${x * 18}deg)`;
        });
        el.addEventListener('pointerleave', () => { el.style.transform = ''; });
        el.style.transition = 'transform .6s cubic-bezier(.22,1,.36,1)';
      }
    });
  }

  /* ---------------- живой фон ---------------- */
  const DISHES = ['🎂', '🍰', '🧁', '🍩', '🍪', '🥐', '🍫', '🍓', '🍮', '🍦', '🥧', '🍡', '🍬', '🍭', '🥞', '🧇', '🍒', '🍑', '🥛', '🍯', '🍨', '🥮', '🍤', '🦐'];
  function buildBackground() {
    const bg = document.createElement('div');
    bg.className = 'bg';
    bg.setAttribute('aria-hidden', 'true');
    bg.innerHTML = '<div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="blob b4"></div><div class="sprinkles"></div>';
    const count = reduced ? 8 : small ? 9 : 16;
    const cols = small ? 3 : 4;
    const rows = Math.ceil(count / cols);
    const dishes = [];
    for (let i = 0; i < count; i++) {
      const d = document.createElement('div');
      d.className = 'dish';
      const col = i % cols, row = Math.floor(i / cols);
      const x = ((col + 0.15 + Math.random() * 0.7) / cols) * 100;
      const y = ((row + 0.1 + Math.random() * 0.8) / rows) * 100;
      const size = (small ? 30 : 38) + Math.random() * (small ? 26 : 44);
      d.style.cssText = `left:${x}%;top:${y}%;--s:${size}px;--d:${14 + Math.random() * 14}s;--delay:${-Math.random() * 20}s;opacity:${0.55 + Math.random() * 0.4}`;
      const s = document.createElement('span');
      s.textContent = DISHES[(i * 7) % DISHES.length];
      d.appendChild(s);
      bg.appendChild(d);
      dishes.push(d);
    }
    const veil = document.createElement('div');
    veil.className = 'veil';
    bg.appendChild(veil);
    document.body.prepend(bg);
    if (small) document.body.classList.add('lite');

    if (!reduced) {
      // блюда по очереди переворачиваются и меняются на другие
      let k = 0;
      setInterval(() => {
        if (document.hidden) return;
        const d = dishes[Math.floor(Math.random() * dishes.length)];
        d.classList.add('swap');
        setTimeout(() => {
          d.firstChild.textContent = DISHES[(k++ * 5 + 3) % DISHES.length];
          d.classList.remove('swap');
        }, 450);
      }, small ? 2600 : 1600);
      // параллакс фона от прокрутки (одно свойство transform, без перерисовки)
      let ticking = false;
      addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          bg.style.transform = `translate3d(0, ${-scrollY * 0.06}px, 0)`;
          ticking = false;
        });
      }, { passive: true });
    }
  }

  /* ---------------- наклон карточек ---------------- */
  function tilt() {
    if (reduced || !matchMedia('(pointer: fine)').matches) return;
    let raf = 0;
    document.addEventListener('pointermove', (e) => {
      const el = e.target.closest && e.target.closest('a.conf-card, .choice a, .steps .card');
      if (!el) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const b = el.getBoundingClientRect();
        const x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
        el.style.transform = `rotateX(${(0.5 - y) * 8}deg) rotateY(${(x - 0.5) * 10}deg) translateY(-4px)`;
        el.style.setProperty('--mx', x * 100 + '%');
        el.style.setProperty('--my', y * 100 + '%');
      });
    });
    document.addEventListener('pointerout', (e) => {
      const el = e.target.closest && e.target.closest('a.conf-card, .choice a, .steps .card');
      if (el && !el.contains(e.relatedTarget)) el.style.transform = '';
    });
  }

  /* ---------------- переход «торт раскрывается» ---------------- */
  let gate;
  function buildGate() {
    gate = document.createElement('div');
    gate.className = 'gate open';
    gate.setAttribute('aria-hidden', 'true');
    gate.innerHTML = '<div class="door l"></div><div class="door r"></div>';
    const holder = document.createElement('div');
    holder.className = 'gate-cake';
    holder.dataset.cake = small ? '0.7' : '0.9';
    gate.appendChild(holder);
    document.body.appendChild(gate);
    mountCakes();
  }

  function playEntry() {
    gate.classList.add('on', 'instant');
    gate.classList.remove('open');
    void gate.offsetWidth; // зафиксировать закрытое положение без анимации
    gate.classList.remove('instant');
    document.documentElement.classList.remove('gate-pending');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setTimeout(() => gate.classList.add('open'), 120);
      setTimeout(() => gate.classList.remove('on'), 950);
    }));
  }

  function navigate(href) {
    gate.classList.add('on', 'closing');
    gate.classList.add('open');
    requestAnimationFrame(() => requestAnimationFrame(() => gate.classList.remove('open')));
    try { sessionStorage.setItem(GATE_KEY, '1'); } catch { /* ignore */ }
    setTimeout(() => { location.href = href; }, 470);
  }

  function interceptLinks() {
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // якоря и та же страница
      if (a.getAttribute('href') === '#') return;
      e.preventDefault();
      navigate(url.href);
    });
    // предзагрузка страницы при наведении — переход становится мгновенным
    const seen = new Set();
    document.addEventListener('pointerover', (e) => {
      const a = e.target.closest && e.target.closest('a[href^="/"]');
      if (!a || seen.has(a.pathname) || a.pathname.startsWith('/api/')) return;
      seen.add(a.pathname);
      const l = document.createElement('link');
      l.rel = 'prefetch';
      l.href = a.pathname;
      document.head.appendChild(l);
    });
    // возврат кнопкой «назад» из bfcache — убрать занавес
    addEventListener('pageshow', (e) => {
      if (e.persisted && gate) { gate.classList.remove('on', 'closing'); gate.classList.add('open'); }
    });
  }

  window.ShkFx = { mountCakes, makeCake };

  document.addEventListener('DOMContentLoaded', () => {
    buildBackground();
    mountCakes();
    tilt();
    if (!reduced) {
      buildGate();
      interceptLinks();
      if (gateFlag) playEntry();
    }
    document.documentElement.classList.remove('gate-pending');
  });
})();
