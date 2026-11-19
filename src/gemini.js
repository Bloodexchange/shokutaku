'use strict';
const { CATEGORY_LABELS } = require('./constants');

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
// Модели перебираются по очереди: бесплатные модели Gemini иногда отвечают 503 «high demand».
const DEFAULT_MODELS = 'gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-flash-latest,gemini-3.8-flash';
const TOTAL_BUDGET_MS = 40000; // укладываемся в лимит функции Vercel

function enabled() { return !!process.env.GEMINI_API_KEY; }

async function generateJson(prompt, { timeoutMs = 12000 } = {}) {
  const started = Date.now();
  const models = (process.env.GEMINI_MODELS || DEFAULT_MODELS).split(',').map((s) => s.trim()).filter(Boolean);
  let lastErr;
  for (const model of models) {
    const left = TOTAL_BUDGET_MS - (Date.now() - started);
    if (left < 3000) break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, left));
    try {
      const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${model}: ${json.error ? json.error.message : res.status}`);
      const text = (json.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
      return { model, data: JSON.parse(text.replace(/^```json\s*|```$/g, '')) };
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error(`${model}: таймаут`) : e;
      console.warn('Gemini fallback:', e.message);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('Gemini недоступен');
}

/**
 * Подбор лучших кондитеров под запрос клиента.
 * confectioners: [{id, name, experience, specialties[], dishes, workplace, city, certificate, rating}]
 */
async function matchConfectioners({ query, dish, components }, confectioners) {
  const list = confectioners.map((c) => ({
    id: c.id,
    name: c.name,
    city: c.city,
    experience_years: c.experience,
    specialties: c.specialties.map((s) => CATEGORY_LABELS[s] || s),
    best_dishes: c.dishes,
    workplace: c.workplace,
    has_certificate: c.certificate,
    rating: c.rating,
  }));
  const prompt = `Ты — помощник сервиса Shokutaku 食卓, который связывает заказчиков с кондитерами в Узбекистане.
Задача: выбрать кондитеров, которые лучше всего подходят под заказ клиента.

Заказ клиента:
- Описание: ${JSON.stringify(query || '')}
- Блюдо: ${JSON.stringify(dish || '')}
- Компоненты / ингредиенты: ${JSON.stringify(components || [])}

Кондитеры (JSON):
${JSON.stringify(list)}

Правила:
- Оценивай соответствие направлений и блюд, которые кондитер лучше всего готовит, стаж, наличие сертификата и рейтинг.
- Учитывай особые требования (без сахара, без глютена, морепродукты, свадебный, детский и т. п.).
- Не выдумывай кондитеров: используй только id из списка.
- Верни до 6 лучших, отсортированных по убыванию score (0–100). Слабые совпадения (score < 30) не включай.
- reason — одно короткое предложение на русском, почему кондитер подходит.

Ответь строго JSON:
{"summary": "краткий совет клиенту на русском (1–2 предложения)",
 "detected": {"dish": "...", "categories": ["ключи из списка: ${Object.keys(CATEGORY_LABELS).join(', ')}"]},
 "matches": [{"id": 1, "score": 90, "reason": "..."}]}`;
  const { model, data } = await generateJson(prompt);
  const ids = new Set(confectioners.map((c) => c.id));
  const matches = (Array.isArray(data.matches) ? data.matches : [])
    .filter((m) => ids.has(Number(m.id)))
    .map((m) => ({ id: Number(m.id), score: Math.max(0, Math.min(100, Number(m.score) || 0)), reason: String(m.reason || '') }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  return { model, summary: String(data.summary || ''), detected: data.detected || null, matches };
}

/** Разбор свободного запроса без списка кондитеров (когда каталог ещё пуст). */
async function analyzeRequest(query) {
  const prompt = `Клиент кондитерского сервиса написал: ${JSON.stringify(query)}.
Определи, какое блюдо он хочет и к каким категориям оно относится.
Категории (ключи): ${Object.entries(CATEGORY_LABELS).map(([k, v]) => `${k}=${v}`).join('; ')}.
Ответь строго JSON: {"dish": "...", "categories": ["key"], "tips": "1–2 предложения на русском: что уточнить у кондитера при заказе"}`;
  const { data } = await generateJson(prompt);
  return data;
}

module.exports = { enabled, matchConfectioners, analyzeRequest };
