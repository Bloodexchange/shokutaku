// Shokutaku 食卓 — Яндекс Карты: выбор точки, показ адреса и кнопки маршрута.
// Скрипт API грузится только когда карта действительно нужна на странице.
const ShkMap = (() => {
  const TASHKENT = [41.311081, 69.240562];
  let loading = null;

  function load() {
    if (window.ymaps && window.ymaps.Map) return Promise.resolve(window.ymaps);
    if (!loading) {
      loading = Shk.api('/api/meta').then((m) => new Promise((resolve, reject) => {
        if (!m.yandex_maps_key) return reject(new Error('Карта недоступна'));
        const s = document.createElement('script');
        s.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(m.yandex_maps_key)}&lang=${Shk.lang === 'uz' ? 'uz_UZ' : 'ru_RU'}`;
        s.async = true;
        s.onload = () => (window.ymaps ? window.ymaps.ready(() => resolve(window.ymaps)) : reject(new Error('Карта недоступна')));
        s.onerror = () => reject(new Error('Карта недоступна'));
        document.head.appendChild(s);
        setTimeout(() => reject(new Error('Карта недоступна')), 20000);
      })).catch((e) => { loading = null; throw e; });
    }
    return loading;
  }

  const has = (lat, lon) => lat != null && lon != null && lat !== '' && lon !== '';
  const fail = (el) => { el.classList.add('map-off'); el.innerHTML = '<div class="small muted">Карта не загрузилась. Напишите адрес текстом.</div>'; };

  /**
   * Карта для выбора точки: клик, перетаскивание метки, поиск адреса, «моё местоположение».
   * onChange({ lat, lon, address }) вызывается после каждого выбора.
   */
  async function picker(el, { lat, lon, onChange } = {}) {
    let ymaps;
    try { ymaps = await load(); } catch { fail(el); return null; }
    el.innerHTML = '';
    const start = has(lat, lon) ? [Number(lat), Number(lon)] : TASHKENT;
    const map = new ymaps.Map(el, { center: start, zoom: has(lat, lon) ? 16 : 11, controls: ['searchControl', 'geolocationControl', 'zoomControl', 'fullscreenControl'] },
      { searchControlProvider: 'yandex#search', suppressMapOpenBlock: true });
    let mark = null;
    async function place(coords, address) {
      if (!mark) {
        mark = new ymaps.Placemark(coords, {}, { preset: 'islands#redDotIcon', draggable: true });
        mark.events.add('dragend', () => place(mark.geometry.getCoordinates()));
        map.geoObjects.add(mark);
      } else mark.geometry.setCoordinates(coords);
      if (!address) {
        try { const r = await ymaps.geocode(coords, { results: 1 }); const g = r.geoObjects.get(0); address = g ? g.getAddressLine() : ''; } catch { address = ''; }
      }
      const [a, b] = coords.map((v) => Math.round(v * 1e6) / 1e6);
      if (onChange) onChange({ lat: a, lon: b, address: address || `${a}, ${b}` });
    }
    if (has(lat, lon)) {
      mark = new ymaps.Placemark(start, {}, { preset: 'islands#redDotIcon', draggable: true });
      mark.events.add('dragend', () => place(mark.geometry.getCoordinates()));
      map.geoObjects.add(mark);
    }
    map.events.add('click', (e) => place(e.get('coords')));
    const search = map.controls.get('searchControl');
    search.events.add('resultselect', (e) => {
      search.getResult(e.get('index')).then((g) => { place(g.geometry.getCoordinates(), g.getAddressLine ? g.getAddressLine() : g.properties.get('text')); search.clear(); });
    });
    map.controls.get('geolocationControl').events.add('locationchange', (e) => place(e.get('position')));
    return {
      map,
      /** Найти адрес, введённый текстом, и поставить туда метку. */
      async find(text) {
        const r = await ymaps.geocode(text, { results: 1, boundedBy: [[37, 55], [46, 74]] });
        const g = r.geoObjects.get(0);
        if (!g) return false;
        const c = g.geometry.getCoordinates();
        map.setCenter(c, 16);
        await place(c, g.getAddressLine());
        return true;
      },
    };
  }

  /** Карта с одной точкой (только просмотр). */
  async function view(el, { lat, lon, title }) {
    if (!has(lat, lon)) return;
    let ymaps;
    try { ymaps = await load(); } catch { fail(el); return; }
    el.innerHTML = '';
    const c = [Number(lat), Number(lon)];
    const map = new ymaps.Map(el, { center: c, zoom: 16, controls: ['zoomControl', 'fullscreenControl'] }, { suppressMapOpenBlock: true });
    map.geoObjects.add(new ymaps.Placemark(c, { hintContent: title || '', balloonContent: title || '' }, { preset: 'islands#redDotIcon' }));
  }

  /** Кнопки маршрута: приложение такси или карты само построит путь от текущего места. */
  function routeLinks({ lat, lon, address }) {
    const esc = Shk.esc;
    const links = [];
    if (has(lat, lon)) {
      links.push([`https://3.redirect.appmetrica.yandex.com/route?end-lat=${lat}&end-lon=${lon}&appmetrica_tracking_id=1178268795219780156`, '🚕 Yandex Go']);
      links.push([`https://yandex.ru/maps/?rtext=~${lat},${lon}&rtt=auto`, '🗺 Яндекс Карты']);
      links.push([`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`, '📍 Google Maps']);
    } else if (address) {
      links.push([`https://yandex.ru/maps/?text=${encodeURIComponent(address)}`, '🗺 Яндекс Карты']);
      links.push([`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '📍 Google Maps']);
    }
    if (!links.length) return '';
    return `<div class="route-links"><span class="small muted">Маршрут:</span>${links.map(([href, label]) =>
      `<a class="btn btn-ghost btn-sm" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`).join('')}</div>`;
  }

  return { load, picker, view, routeLinks };
})();
