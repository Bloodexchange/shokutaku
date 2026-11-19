// Общие функции для всех страниц Shokutaku 食卓
const Shk = (() => {
  async function api(path, { method = 'GET', body, form } = {}) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (form) opts.body = form;
    else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch {
      throw new Error('Нет соединения с сервером. Проверьте интернет.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Что‑то пошло не так');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let mePromise;
  function me() {
    if (!mePromise) mePromise = api('/api/me').catch(() => ({ user: null }));
    return mePromise;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, ms = 3200) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }

  function years(n) {
    n = Number(n) || 0;
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return `${n} год`;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} года`;
    return `${n} лет`;
  }

  function stars(r) {
    const full = Math.round(Number(r) || 0);
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  }

  /** Маска ввода телефона: +998 90 123 45 67 */
  function phoneMask(input) {
    input.addEventListener('focus', () => { if (!input.value) input.value = '+998 '; });
    input.addEventListener('input', () => {
      let d = input.value.replace(/\D/g, '');
      if (d.startsWith('998998')) d = d.slice(3); // вставили полный номер поверх «+998 »
      if (!d.startsWith('998')) return; // иностранный номер — не форматируем
      d = d.slice(0, 12);
      const p = [d.slice(0, 3), d.slice(3, 5), d.slice(5, 8), d.slice(8, 10), d.slice(10, 12)].filter(Boolean);
      input.value = '+' + p.join(' ');
    });
  }

  function setBusy(btn, busy, text) {
    if (busy) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span>${text || ''}`;
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  }

  function showError(el, msg) {
    el.className = 'alert';
    el.textContent = msg;
    el.classList.remove('hidden');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function renderHeader() {
    const header = document.querySelector('.site-header');
    if (!header) return;
    header.innerHTML = `
      <div class="container">
        <a class="brand" href="/"><img src="/img/logo.svg" alt="" width="40" height="40"><b>Shokutaku</b><span class="jp">食卓</span></a>
        <button class="menu-toggle" aria-label="Меню">☰</button>
        <nav class="nav">
          <a href="/catalog">Кондитеры</a>
          <a href="/terms">Условия</a>
          <span class="auth-slot"></span>
        </nav>
      </div>`;
    const nav = header.querySelector('.nav');
    header.querySelector('.menu-toggle').addEventListener('click', () => nav.classList.toggle('open'));
    const { user } = await me();
    const slot = header.querySelector('.auth-slot');
    if (user) {
      slot.outerHTML = `<a href="/cabinet">Кабинет</a><a href="#" class="logout">Выйти</a>`;
      header.querySelector('.logout').addEventListener('click', async (e) => {
        e.preventDefault();
        await api('/api/auth/logout', { method: 'POST' });
        location.href = '/';
      });
    } else {
      slot.outerHTML = `<a href="/client#login">Войти</a><a class="btn btn-gold" href="/">Регистрация</a>`;
    }
  }

  function renderFooter() {
    const f = document.querySelector('.site-footer');
    if (!f) return;
    f.innerHTML = `<div class="container">
      <span><b class="jp" style="color:var(--red)">食卓</b> Shokutaku © ${new Date().getFullYear()}</span>
      <span class="spacer"></span>
      <a href="/catalog">Кондитеры</a><a href="/confectioner">Стать кондитером</a><a href="/terms">Условия пользования</a>
    </div>`;
  }

  /** Карточка кондитера (или пустая заготовка, если item=null). */
  function confCard(c, { ai } = {}) {
    if (!c) {
      return `<div class="card conf-card empty">
        <div class="conf-head"><div class="avatar">🧁</div><div style="flex:1"><div class="skel" style="width:70%"></div><div class="skel" style="width:40%;margin-top:8px"></div></div></div>
        <dl class="conf-meta"><dt>Стаж</dt><dd>—</dd><dt>Блюда</dt><dd>—</dd><dt>Сертификат</dt><dd>—</dd></dl>
        <div class="small">Скоро здесь появится кондитер</div>
      </div>`;
    }
    return `<a class="card conf-card" href="/chef?id=${c.id}">
      <div class="conf-head">
        <div class="avatar">${esc(initials(c.name))}</div>
        <div><h3 style="margin:0">${esc(c.name)}</h3>
          <div class="small muted">${esc(c.city || 'Узбекистан')} · ${c.reviews ? `<span class="stars">${stars(c.rating)}</span> ${c.rating}` : 'новый кондитер'}</div></div>
      </div>
      <dl class="conf-meta">
        <dt>Стаж</dt><dd>${years(c.experience)}</dd>
        <dt>Блюда</dt><dd>${esc(c.dishes || '—')}</dd>
        <dt>Сертификат</dt><dd>${c.certificate ? '<span class="badge green">✓ есть</span>' : '<span class="muted">нет</span>'}</dd>
      </dl>
      <div class="chips">${(c.specialty_labels || []).slice(0, 4).map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>
      ${ai && c.ai_reason ? `<div class="ai-reason">✨ ${esc(c.ai_reason)} ${c.ai_score ? `<span class="score">${c.ai_score}%</span>` : ''}</div>` : ''}
    </a>`;
  }

  document.addEventListener('DOMContentLoaded', () => { renderHeader(); renderFooter(); });

  return { api, me, esc, toast, initials, years, stars, phoneMask, setBusy, showError, confCard };
})();
