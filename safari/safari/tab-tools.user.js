// ==UserScript==
// @name         Tab Tools (iOS)
// @namespace    tab-tools-ios
// @version      2.3.0
// @description  Rozwiązuje pytanie z zaznaczenia, tekstu strony albo ze zdjęcia. Gemini, OpenRouter albo Groq, kilka kluczy API z automatycznym przełączaniem.
// @match        *://*/*
// @grant        GM.xmlHttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @connect      generativelanguage.googleapis.com
// @connect      openrouter.ai
// @connect      api.groq.com
// @run-at       document-idle
// @inject-into  content
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  /* ---------- ustawienia ---------- */

  const STORE = 'tt_ios_settings';

  /* Jeden provider może mieć kilka kluczy. Kolejność w tablicy to priorytet:
     pierwszy działający wygrywa, a przy limicie albo wyczerpaniu środków
     skrypt sam przechodzi do następnego. */
  const DEFAULTS = {
    provider: 'gemini',
    platform: 'auto',
    keys: { gemini: [], openrouter: [], groq: [] },
    models: { gemini: 'auto', openrouter: 'auto', groq: 'auto' },
    cooldowns: {}
  };

  const MAX_KEYS = 8;

  function keyList(value) {
    const parts = Array.isArray(value)
      ? value
      : String(value == null ? '' : value).split(/[\s,;]+/);
    const out = [];
    parts.forEach((part) => {
      const key = String(part == null ? '' : part).trim();
      if (key && out.indexOf(key) === -1) out.push(key);
    });
    return out.slice(0, MAX_KEYS);
  }

  /* krótki, stabilny identyfikator klucza do zapamiętywania karencji */
  function keyId(key) {
    const text = String(key || '');
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    return Math.abs(hash).toString(36) + '-' + text.length;
  }

  async function storeGet(name) {
    try {
      if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') return await GM.getValue(name, null);
      if (typeof GM_getValue === 'function') return GM_getValue(name, null);
    } catch (err) { /* brak magazynu skryptu — niżej localStorage */ }
    try {
      const raw = localStorage.getItem(name);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }

  async function storeSet(name, value) {
    try {
      if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') { await GM.setValue(name, value); return; }
      if (typeof GM_setValue === 'function') { GM_setValue(name, value); return; }
    } catch (err) { /* niżej localStorage */ }
    try { localStorage.setItem(name, JSON.stringify(value)); } catch (err) { /* tryb prywatny */ }
  }

  let settings = null;

  async function getSettings() {
    if (settings) return settings;
    const saved = await storeGet(STORE);
    const raw = saved && typeof saved === 'object' ? saved : {};
    settings = {
      provider: PROVIDERS.indexOf(raw.provider) !== -1 ? raw.provider : DEFAULTS.provider,
      platform: PLATFORMS.indexOf(raw.platform) !== -1 ? raw.platform : DEFAULTS.platform,
      keys: {
        gemini: keyList(raw.keys && raw.keys.gemini),
        openrouter: keyList(raw.keys && raw.keys.openrouter),
        groq: keyList(raw.keys && raw.keys.groq)
      },
      models: Object.assign({}, DEFAULTS.models, raw.models || {}),
      cooldowns: raw.cooldowns && typeof raw.cooldowns === 'object' ? raw.cooldowns : {}
    };
    return settings;
  }

  async function saveSettings(patch) {
    const now = await getSettings();
    const patchKeys = patch.keys || {};
    const cooldowns = Object.assign({}, now.cooldowns, patch.cooldowns || {});
    if (patch.resetCooldowns) {
      Object.keys(cooldowns).forEach((id) => {
        if (id.indexOf(patch.resetCooldowns + ':') === 0) delete cooldowns[id];
      });
    }
    const next = {
      provider: patch.provider || now.provider,
      platform: PLATFORMS.indexOf(patch.platform) !== -1 ? patch.platform : now.platform,
      keys: {
        gemini: keyList(patchKeys.gemini != null ? patchKeys.gemini : now.keys.gemini),
        openrouter: keyList(patchKeys.openrouter != null ? patchKeys.openrouter : now.keys.openrouter),
        groq: keyList(patchKeys.groq != null ? patchKeys.groq : now.keys.groq)
      },
      models: Object.assign({}, now.models, patch.models || {}),
      cooldowns: cooldowns
    };
    settings = next;
    await storeSet(STORE, next);
  }

  /* motyw i położenie przycisku trzymamy osobno od kluczy API */

  const UI_STORE = 'tt_ios_ui';
  let uiState = { theme: '', fab: null };

  async function loadUiState() {
    const saved = await storeGet(UI_STORE);
    const raw = saved && typeof saved === 'object' ? saved : {};
    const systemDark = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const fab = raw.fab && typeof raw.fab.x === 'number' && typeof raw.fab.y === 'number'
      ? { x: Math.min(1, Math.max(0, raw.fab.x)), y: Math.min(1, Math.max(0, raw.fab.y)) }
      : null;
    uiState = {
      theme: raw.theme === 'dark' || raw.theme === 'light' ? raw.theme : (systemDark ? 'dark' : 'light'),
      fab: fab
    };
    return uiState;
  }

  async function saveUiState(patch) {
    Object.assign(uiState, patch || {});
    await storeSet(UI_STORE, { theme: uiState.theme, fab: uiState.fab });
  }

  /* ---------- stałe ---------- */

  const PROVIDERS = ['gemini', 'openrouter', 'groq'];
  const PROVIDER_LABEL = { gemini: 'Gemini', openrouter: 'OpenRouter', groq: 'Groq' };

  /* Dwa tryby działania: Safari iOS (Userscripts) i Firefox Android
     (Tampermonkey). Różnią się schowkiem, wibracją i obsługą zrzutu ekranu. */
  const PLATFORMS = ['auto', 'ios', 'android'];
  const PLATFORM_LABEL = { auto: 'Automatycznie', ios: 'Safari iOS', android: 'Firefox Android' };

  function detectPlatform() {
    const ua = String((typeof navigator !== 'undefined' && navigator.userAgent) || '');
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document) return 'ios';
    return 'android';
  }

  function activePlatform() {
    return settings && settings.platform && settings.platform !== 'auto' ? settings.platform : detectPlatform();
  }

  const GEMINI_ROOT = 'https://generativelanguage.googleapis.com/v1beta/';
  const OPENROUTER_ROOT = 'https://openrouter.ai/api/v1/';
  const GROQ_ROOT = 'https://api.groq.com/openai/v1/';

  const GEMINI_HINTS = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
  const OPENROUTER_HINTS = ['google/gemini-2.5-flash', 'google/gemma-4-31b-it:free', 'openrouter/free'];
  const GROQ_HINTS = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
  const GROQ_IMAGE_HINTS = ['qwen/qwen3.8-27b', 'qwen/qwen3.6-27b'];
  const GROQ_BUDGET = 4096;

  const PAGE_TEXT_LIMIT = 12000;
  const PROMPT_TEXT_LIMIT = 4000;

  const ITEM = {
    type: 'OBJECT',
    properties: {
      label: { type: 'STRING' },
      text: { type: 'STRING' },
      confidence: { type: 'NUMBER' }
    },
    required: ['text']
  };

  const SCHEMA_ANSWER = {
    type: 'OBJECT',
    properties: {
      taskType: { type: 'STRING', enum: ['single', 'multi', 'truefalse', 'numeric', 'open', 'match', 'gaps', 'order', 'table', 'unknown'] },
      question: { type: 'STRING' },
      options: { type: 'ARRAY', items: ITEM },
      answers: { type: 'ARRAY', items: ITEM },
      pairs: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { left: { type: 'STRING' }, right: { type: 'STRING' } },
          required: ['left', 'right']
        }
      },
      openAnswer: { type: 'STRING' },
      notes: { type: 'STRING' },
      confidence: { type: 'NUMBER' }
    },
    required: ['taskType', 'question', 'answers', 'confidence']
  };

  const RULES = [
    'Odpowiadaj w języku pytania.',
    'question: przepisz pytanie dokładnie tak, jak brzmi w materiale.',
    'options: wszystkie widoczne warianty odpowiedzi (label to litera lub numer, text to pełna treść).',
    'answers: wyłącznie warianty, które są poprawne. Nic więcej.',
    'single: dokładnie jeden element w answers, pozostałe warianty wyłącznie w options.',
    'multi: wszystkie poprawne warianty w answers.',
    'truefalse: taskType "truefalse", openAnswer dokładnie "Prawda" albo "Fałsz", answers puste.',
    'numeric: taskType "numeric", openAnswer tylko wynik z jednostką, bez obliczeń, answers puste.',
    'open: taskType "open", openAnswer jedno krótkie zdanie, proste słowa, bez wyliczeń i myślników, najwyżej 200 znaków, answers puste.',
    'gaps: taskType "gaps", luki w answers jako {label: numer luki, text: wpisywane słowo}, openAnswer "".',
    'order: taskType "order", elementy w answers w poprawnej kolejności, label to numer pozycji.',
    'table: taskType "table", wiersze tabeli w answers jako {label: numer wiersza, text: "Prawda" albo "Fałsz"}.',
    'match: taskType "match", pary w pairs jako {left, right}, answers puste.',
    'Przy open, numeric, truefalse i match answers MUSI być pustą tablicą, a przy gaps, order i table openAnswer MUSI być pusty.',
    'Przed odpowiedzią sprawdź, czy wybrany wariant naprawdę rozwiązuje pytanie. Nie zgaduj: przy niepewności obniż confidence.',
    'notes: najwyżej 200 znaków, tylko uwagi, inaczej "".',
    'Pytanie nieczytelne albo przycięte: taskType "unknown", answers [], openAnswer "", confidence 0.',
    'Bez długiego myślnika i bez półpauzy. Zwykły dywiz tylko przy wyliczeniu.',
    'confidence to szczera pewność 0-100.'
  ].join('\n');

  const SYS_IMAGE = 'Rozwiązujesz zadanie widoczne na zdjęciu. Patrz tylko na treść zadania, pomiń interfejs. Zwróć wyłącznie JSON zgodny ze schematem.\n'
    + 'Rozwiąż tylko pytanie w całości widoczne na zdjęciu. Pytania przycięte pomiń i wypisz ich numery w notes. Jeśli dołączono tekst strony, użyj go do sprawdzenia brzmienia pytania i wariantów.\n'
    + RULES;
  const SYS_TEXT = 'Rozwiązujesz zadanie z tekstu przekazanego przez użytkownika. Zwróć wyłącznie JSON zgodny ze schematem.\n' + RULES;
  const USER_IMAGE = 'Odczytaj pytanie ze zdjęcia i podaj poprawną odpowiedź.';
  const RETRY_EMPTY = '\n\nPoprzednia odpowiedź była pusta. Odczytaj pytanie i wypełnij question oraz answers albo openAnswer.';

  /* ---------- pomocnicze ---------- */

  const msgOf = (err) => (err && err.message ? err.message : String(err || 'Nieznany błąd'));

  function tidy(text) {
    return String(text == null ? '' : text)
      .replace(/\r/g, '')
      .replace(/[ \t]*\n+[ \t]*/g, ' ')
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/,\s*([,.!?;:])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[,\s]+/, '')
      .trim();
  }

  /* odpowiedź otwarta ma być jednym naturalnym zdaniem, bez listy i myślników */
  function plain(text) {
    return tidy(String(text == null ? '' : text)
      .replace(/^[ \t]*(?:[-•*]|\d{1,2}[.)])[ \t]+/gm, ''));
  }

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

  /* ---------- sieć ---------- */

  function pack(status, text) {
    let json = null;
    try { json = JSON.parse(text); } catch (err) { json = null; }
    return { ok: status >= 200 && status < 300, status: status, json: json, text: text };
  }

  function httpJson(url, opt) {
    const o = opt || {};
    const method = o.method || 'GET';
    const body = o.body ? JSON.stringify(o.body) : null;
    const headers = o.headers || {};
    const timeout = o.timeoutMs || 20000;

    const gm = (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function')
      ? GM.xmlHttpRequest
      : (typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null);

    if (gm) {
      return new Promise((resolve, reject) => {
        gm({
          method: method,
          url: url,
          headers: headers,
          data: body || undefined,
          timeout: timeout,
          onload: (res) => resolve(pack(res.status, res.responseText)),
          onerror: () => reject(new Error('Brak połączenia — sprawdź internet')),
          ontimeout: () => reject(new Error('Serwer nie odpowiedział w czasie')),
          onabort: () => reject(new Error('Połączenie przerwane — sprawdź internet'))
        });
      });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    return fetch(url, { method: method, headers: headers, body: body || undefined, signal: ctrl.signal })
      .then(async (res) => pack(res.status, await res.text()))
      .catch((err) => {
        if (err && err.name === 'AbortError') throw new Error('Serwer nie odpowiedział w czasie');
        throw new Error('Brak połączenia — sprawdź internet lub blokadę CORS');
      })
      .finally(() => clearTimeout(timer));
  }

  function httpError(provider, status, detail) {
    const extra = detail ? ' — ' + String(detail).slice(0, 140) : '';
    const name = PROVIDER_LABEL[provider] || provider;
    if (status === 401 || status === 403) return 'Klucz ' + name + ' odrzucony' + extra;
    if (status === 402) return 'Brak środków na koncie ' + name + extra;
    if (status === 404) return 'Model niedostępny w ' + name + ' (404)' + extra;
    if (status === 413) return 'Obraz za duży dla ' + name + extra;
    if (status === 429) return 'Limit zapytań ' + name + ' (429)' + extra;
    if (status >= 500) return 'Błąd serwera ' + name + ' (HTTP ' + status + ')' + extra;
    return name + ': błąd HTTP ' + status + extra;
  }

  function blockedError(reason) {
    const err = new Error('Model odmówił odpowiedzi (' + reason + ')');
    err.kind = 'blocked';
    return err;
  }

  /* ---------- Gemini ---------- */

  const UNSUITABLE_MODEL = /(image|tts|audio|embedding|aqa|live|veo|imagen|robotics|computer-use)/i;

  let geminiCache = { key: '', at: 0, ids: [] };

  function scoreGemini(id) {
    let score = 0;
    if (/flash/i.test(id)) score += 40;
    if (/3\.8|3\.6/.test(id)) score += 24;
    else if (/2\.5/.test(id)) score += 18;
    else if (/2\.0/.test(id)) score += 10;
    if (/lite/i.test(id)) score -= 10;
    if (/preview|experimental/i.test(id)) score -= 8;
    const hint = GEMINI_HINTS.indexOf(id);
    if (hint >= 0) score += 60 - hint * 5;
    return score;
  }

  async function geminiList(key) {
    if (geminiCache.key === key && Date.now() - geminiCache.at < 5 * 60 * 1000) return geminiCache.ids;
    const ids = [];
    try {
      const r = await httpJson(GEMINI_ROOT + 'models?pageSize=200', {
        headers: { 'x-goog-api-key': key },
        timeoutMs: 12000
      });
      if (r.ok) {
        ((r.json && r.json.models) || []).forEach((m) => {
          const name = String(m.name || '').replace(/^models\//, '');
          const methods = m.supportedGenerationMethods || [];
          if (name && methods.indexOf('generateContent') !== -1 && !UNSUITABLE_MODEL.test(name)) ids.push(name);
        });
      }
    } catch (err) { /* zostają znane nazwy */ }
    const ranked = ids.sort((a, b) => scoreGemini(b) - scoreGemini(a));
    geminiCache = { key: key, at: Date.now(), ids: ranked };
    return ranked;
  }

  function geminiQuickModel(model) {
    return /flash/i.test(model) && !/pro/i.test(model);
  }

  function geminiBody(system, userText, img, schema, maxTokens, thinkingOff) {
    const parts = [];
    if (img) parts.push({ inline_data: { mime_type: img.mime, data: img.b64 } });
    parts.push({ text: userText });

    const generationConfig = {
      temperature: 0,
      maxOutputTokens: maxTokens || 4096,
      responseMimeType: 'application/json'
    };
    if (schema) generationConfig.responseSchema = schema;
    if (thinkingOff) generationConfig.thinkingConfig = { thinkingBudget: 0 };

    return {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: parts }],
      generationConfig: generationConfig
    };
  }

  async function geminiOnce(key, model, system, userText, img, schema) {
    let thinkingOff = geminiQuickModel(model);
    let useSchema = Boolean(schema);
    let budget = 4096;
    let lastErr = null;

    for (let round = 0; round < 3; round++) {
      const r = await httpJson(GEMINI_ROOT + 'models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: geminiBody(system, userText, img, useSchema ? schema : null, budget, thinkingOff),
        timeoutMs: img ? 30000 : 20000
      });

      if (!r.ok) {
        const detail = String((r.json && r.json.error && r.json.error.message) || '');
        const err = new Error(httpError('gemini', r.status, detail));
        err.status = r.status;
        if (r.status === 429) err.kind = 'quota';
        else if (r.status === 404) err.kind = 'model';
        else if (r.status === 413) err.kind = 'image';
        else if (r.status >= 500) err.kind = 'server';
        else if (r.status === 401 || r.status === 403) err.kind = 'key';

        if (r.status === 400 && thinkingOff && /think/i.test(detail)) {
          thinkingOff = false;
          lastErr = err;
          continue;
        }
        if (r.status === 400 && useSchema && /schema|response_?mime|response format/i.test(detail)) {
          useSchema = false;
          lastErr = err;
          continue;
        }
        if (r.status >= 500 && round === 0) {
          lastErr = err;
          await new Promise((done) => setTimeout(done, 250));
          continue;
        }
        throw err;
      }

      const candidate = ((r.json && r.json.candidates) || [])[0] || {};
      const finish = String(candidate.finishReason || '');
      const parts = (candidate.content && candidate.content.parts) || [];
      const text = parts
        .filter((p) => p && p.thought !== true && typeof p.text === 'string')
        .map((p) => p.text)
        .join('')
        .trim();
      if (text) return text;

      const blockReason = r.json && r.json.promptFeedback && r.json.promptFeedback.blockReason;
      if (blockReason) throw blockedError(String(blockReason));
      if (/^(SAFETY|RECITATION|PROHIBITED_CONTENT|BLOCKED)$/.test(finish)) throw blockedError(finish);

      if (finish === 'MAX_TOKENS') {
        budget = 8192;
        lastErr = new Error('Odpowiedź ucięta na limicie tokenów');
        continue;
      }

      const empty = new Error(finish ? 'Model nie zwrócił treści (' + finish + ')' : 'Model nie zwrócił odpowiedzi');
      empty.kind = 'empty';
      throw empty;
    }

    throw lastErr || new Error('Gemini nie zwrócił odpowiedzi');
  }

  /* ---------- OpenRouter i Groq ---------- */

  function messageText(message) {
    const raw = message && message.content;
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) {
      return raw.filter((p) => p && typeof p.text === 'string').map((p) => p.text).join('').trim();
    }
    return '';
  }

  async function openrouterOnce(key, model, system, userText, img, withJsonMode) {
    const content = [];
    if (img) content.push({ type: 'image_url', image_url: { url: 'data:' + img.mime + ';base64,' + img.b64 } });
    content.push({ type: 'text', text: userText });

    const body = {
      model: model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: img ? content : userText }
      ],
      temperature: 0,
      max_tokens: 4096
    };
    if (withJsonMode) body.response_format = { type: 'json_object' };

    const r = await httpJson(OPENROUTER_ROOT + 'chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json', 'x-title': 'Tab Tools' },
      body: body,
      timeoutMs: img ? 30000 : 20000
    });

    if (!r.ok) {
      const detail = String((r.json && r.json.error && r.json.error.message) || '');
      const err = new Error(httpError('openrouter', r.status, detail));
      err.status = r.status;
      if (r.status === 401 || r.status === 403 || r.status === 402) err.kind = 'key';
      else if (r.status === 429) err.kind = 'quota';
      else if (r.status === 404) err.kind = 'model';
      else if (r.status === 413) err.kind = 'image';
      else if (r.status >= 500) err.kind = 'server';
      err.retryWithoutJson = r.status === 400 && /response_format|json/i.test(detail);
      throw err;
    }

    const choice = ((r.json && r.json.choices) || [])[0] || {};
    const text = messageText(choice.message);
    if (!text) {
      const finish = String(choice.finish_reason || '');
      if (finish === 'content_filter') throw blockedError('content_filter');
      const err = new Error(finish ? 'Model nie zwrócił treści (' + finish + ')' : 'Model nie zwrócił odpowiedzi');
      err.kind = 'empty';
      throw err;
    }
    return text;
  }

  async function groqOnce(key, model, system, userText, img, opt) {
    const opts = opt || {};
    const content = [];
    if (img) content.push({ type: 'image_url', image_url: { url: 'data:' + img.mime + ';base64,' + img.b64 } });
    content.push({ type: 'text', text: userText });

    const body = {
      model: model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: content }
      ],
      temperature: 0.1,
      max_completion_tokens: opts.budget || GROQ_BUDGET
    };
    if (opts.json) body.response_format = { type: 'json_object' };
    if (opts.effort) body.reasoning_effort = opts.effort;

    const r = await httpJson(GROQ_ROOT + 'chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json', 'x-title': 'Tab Tools' },
      body: body,
      timeoutMs: img ? 30000 : 20000
    });

    if (!r.ok) {
      const detail = String((r.json && r.json.error && r.json.error.message) || '');
      const err = new Error(httpError('groq', r.status, detail));
      err.status = r.status;
      if (r.status === 401 || r.status === 403) err.kind = 'key';
      else if (r.status === 429) err.kind = 'quota';
      else if (r.status === 404) err.kind = 'model';
      else if (r.status === 413) err.kind = 'image';
      else if (r.status >= 500) err.kind = 'server';
      if (r.status === 400 && /reasoning/i.test(detail)) err.badParam = 'effort';
      else if (r.status === 400 && /response_format|json/i.test(detail)) err.badParam = 'json';
      throw err;
    }

    const choice = ((r.json && r.json.choices) || [])[0] || {};
    const text = messageText(choice.message);
    if (!text) {
      const finish = String(choice.finish_reason || '');
      if (finish === 'content_filter') throw blockedError('content_filter');
      const err = new Error(finish ? 'Model nie zwrócił treści (' + finish + ')' : 'Model nie zwrócił odpowiedzi');
      if (finish === 'length' || !finish) err.lengthCut = true;
      throw err;
    }
    return text;
  }

  /* ---------- wywołanie modelu ---------- */

  const remembered = { gemini: '', openrouter: '', groq: '' };

  async function modelsFor(provider, img) {
    const s = await getSettings();
    const chosen = s.models[provider];
    let hints;
    if (provider === 'gemini') {
      const first = (s.keys.gemini || [])[0] || '';
      hints = first ? (await geminiList(first)).concat(GEMINI_HINTS) : GEMINI_HINTS.slice();
    } else if (provider === 'openrouter') {
      hints = OPENROUTER_HINTS;
    } else {
      hints = img ? GROQ_IMAGE_HINTS : GROQ_HINTS;
    }
    const list = [(chosen !== 'auto' ? chosen : ''), remembered[provider]].concat(hints).filter(Boolean);
    return Array.from(new Set(list)).slice(0, 2);
  }

  async function callProvider(provider, key, model, system, userText, img, schema) {
    if (provider === 'openrouter') {
      try {
        return await openrouterOnce(key, model, system, userText, img, true);
      } catch (err) {
        if (err && err.retryWithoutJson) return openrouterOnce(key, model, system, userText, img, false);
        throw err;
      }
    }

    if (provider === 'groq') {
      const opts = { json: true, effort: 'none', budget: GROQ_BUDGET };
      for (let round = 0; round < 3; round++) {
        try {
          return await groqOnce(key, model, system, userText, img, opts);
        } catch (err) {
          if (err && err.badParam === 'effort' && opts.effort) opts.effort = null;
          else if (err && err.badParam === 'json' && opts.json) opts.json = false;
          else if (err && err.lengthCut && opts.budget < 8192) opts.budget = 8192;
          else throw err;
        }
      }
      throw new Error('Groq nie zwrócił odpowiedzi');
    }

    return geminiOnce(key, model, system, userText, img, schema);
  }

  const KEY_COOLDOWN_MS = 10 * 60 * 1000;
  const DEAD_KEY_COOLDOWN_MS = 60 * 60 * 1000;

  /* klucze w kolejności priorytetu; te w karencji idą na koniec */
  function orderedKeys(list, cooldowns, provider) {
    const now = Date.now();
    const ready = [];
    const cooling = [];
    list.forEach((key, index) => {
      const until = Number((cooldowns || {})[provider + ':' + keyId(key)]) || 0;
      if (until > now) cooling.push({ index: index, until: until });
      else ready.push(index);
    });
    cooling.sort((a, b) => a.until - b.until);
    return ready.concat(cooling.map((item) => item.index));
  }

  async function coolKey(provider, key, kind) {
    const cooldowns = Object.assign({}, (settings && settings.cooldowns) || {});
    cooldowns[provider + ':' + keyId(key)] = Date.now()
      + (kind === 'quota' ? KEY_COOLDOWN_MS : DEAD_KEY_COOLDOWN_MS);
    await saveSettings({ cooldowns: cooldowns });
  }

  /* działający klucz wraca na początek listy, więc priorytet idzie za tym,
     co naprawdę działa */
  async function promoteKey(provider, key) {
    const s = await getSettings();
    const list = (s.keys[provider] || []).slice();
    const at = list.indexOf(key);
    if (at === -1) return;
    const id = provider + ':' + keyId(key);
    const cooldowns = Object.assign({}, s.cooldowns);
    const hadCooldown = Boolean(cooldowns[id]);
    if (hadCooldown) delete cooldowns[id];
    if (at === 0 && !hadCooldown) return;
    if (at > 0) {
      list.splice(at, 1);
      list.unshift(key);
    }
    const keys = {};
    keys[provider] = list;
    await saveSettings({ keys: keys, cooldowns: cooldowns });
  }

  async function askModel(system, userText, img, schema) {
    const s = await getSettings();
    const primary = s.provider;
    const keys = s.keys || {};
    if (!(keys[primary] || []).length) throw new Error('Brak klucza ' + PROVIDER_LABEL[primary] + ' — dodaj go w ustawieniach');

    const deadline = Date.now() + 45000;
    const reasons = [];
    const providers = [primary].concat(PROVIDERS.filter((p) => p !== primary && (keys[p] || []).length));

    for (const provider of providers) {
      const list = keys[provider] || [];
      if (!list.length) continue;
      const models = await modelsFor(provider, img);
      let providerDone = false;

      for (const index of orderedKeys(list, s.cooldowns, provider)) {
        if (providerDone || Date.now() > deadline) break;
        const key = list[index];
        for (const model of models) {
          if (Date.now() > deadline) break;
          try {
            const text = await callProvider(provider, key, model, system, userText, img, schema);
            if (text) {
              remembered[provider] = model;
              await promoteKey(provider, key).catch(() => {});
              return text;
            }
          } catch (err) {
            reasons.push(PROVIDER_LABEL[provider] + ': ' + msgOf(err));
            const kind = err && err.kind;
            /* klucz wyczerpany albo w limicie: następny klucz tego providera */
            if (kind === 'key' || kind === 'quota') {
              await coolKey(provider, key, kind).catch(() => {});
              break;
            }
            /* model albo obraz: ten sam klucz, kolejny model; reszta: inny provider */
            if (kind !== 'model' && kind !== 'image' && kind !== 'empty') {
              providerDone = true;
              break;
            }
          }
        }
      }
    }

    throw new Error(reasons.length ? reasons.join(' | ').slice(0, 220) : 'Model nie zwrócił odpowiedzi');
  }

  /* ---------- parsowanie odpowiedzi ---------- */

  function closeJson(chunk) {
    let inString = false;
    let escaped = false;
    const stack = [];

    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') stack.pop();
    }

    let out = chunk;
    if (inString) out += '"';
    out = out.replace(/,\s*"[^"]*"\s*:?\s*$/, '').replace(/,\s*$/, '');
    for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
    return out;
  }

  function parsePayload(chunk) {
    try {
      return JSON.parse(chunk);
    } catch (err) {
      const fixed = closeJson(chunk);
      if (fixed === chunk) return null;
      try { return JSON.parse(fixed); } catch (err2) { return null; }
    }
  }

  function looksLikeAnswer(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    return 'taskType' in o || 'answers' in o || 'openAnswer' in o || 'pairs' in o || 'question' in o;
  }

  function balancedFrom(text, start) {
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return '';
  }

  function extractJson(text) {
    const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let fallback = null;

    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch !== '{' && ch !== '[') continue;
      const slice = balancedFrom(t, i);
      if (!slice) continue;
      const parsed = parsePayload(slice);
      if (!parsed) continue;
      if (looksLikeAnswer(parsed)) return parsed;
      if (Array.isArray(parsed)) {
        const hit = parsed.find(looksLikeAnswer);
        if (hit) return hit;
      }
      if (!fallback && typeof parsed === 'object') fallback = parsed;
      i += slice.length - 1;
    }

    if (fallback && !Array.isArray(fallback)) return fallback;
    if (fallback) {
      const hit = fallback.find(looksLikeAnswer);
      if (hit) return hit;
    }

    const start = t.search(/[{[]/);
    if (start !== -1) {
      const repaired = parsePayload(closeJson(t.slice(start)));
      if (repaired && !Array.isArray(repaired)) return repaired;
    }

    throw new Error('Model nie zwrócił czytelnej odpowiedzi — spróbuj ponownie');
  }

  const TYPES = ['single', 'multi', 'truefalse', 'numeric', 'open', 'match', 'gaps', 'order', 'table', 'unknown'];

  function cleanItem(o) {
    const src = o && typeof o === 'object' ? o : { text: o };
    const text = String(src.text || src.answer || src.value || src.content || '').trim();
    return {
      label: String(src.label || src.letter || '').trim().slice(0, 8),
      text: tidy(text.slice(0, 400)),
      confidence: clamp(src.confidence, 0, 100)
    };
  }

  function normalizeAnswer(raw) {
    const a = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    let type = TYPES.indexOf(a.taskType) !== -1 ? a.taskType : 'unknown';

    const options = Array.isArray(a.options) ? a.options.map(cleanItem).filter((o) => o.text).slice(0, 14) : [];
    const answers = Array.isArray(a.answers) ? a.answers.map(cleanItem).filter((o) => o.text).slice(0, 14) : [];
    const pairs = Array.isArray(a.pairs)
      ? a.pairs
        .map((p) => ({
          left: tidy(String((p && p.left) || '').trim().slice(0, 160)),
          right: tidy(String((p && p.right) || '').trim().slice(0, 160))
        }))
        .filter((p) => p.left && p.right)
        .slice(0, 14)
      : [];

    let openAnswer = plain(String(a.openAnswer || '').trim().slice(0, 2000));
    if (!openAnswer && answers.length && (type === 'open' || type === 'numeric' || type === 'truefalse')) {
      openAnswer = answers[0].text;
    }

    const listTypes = ['single', 'multi', 'gaps', 'order', 'table'];
    if (listTypes.indexOf(type) !== -1 && !answers.length) {
      if (openAnswer) type = 'open';
      else if (pairs.length) type = 'match';
      else type = 'unknown';
    }

    if (type === 'match' && !pairs.length) {
      if (answers.length) type = answers.length > 1 ? 'multi' : 'single';
      else if (openAnswer) type = 'open';
      else type = 'unknown';
    }
    if (type === 'unknown' && pairs.length && !answers.length && !openAnswer) type = 'match';

    const noList = type === 'open' || type === 'numeric' || type === 'truefalse' || type === 'match';

    return {
      taskType: type,
      question: String(a.question || '').trim().slice(0, 1200),
      options: options,
      answers: noList ? [] : answers,
      pairs: type === 'match' ? pairs : [],
      openAnswer: openAnswer,
      notes: tidy(String(a.notes || '').trim().slice(0, 200)),
      confidence: clamp(a.confidence, 0, 100)
    };
  }

  function isEmptyAnswer(a) {
    return !a || (!a.openAnswer && !a.answers.length && !a.pairs.length);
  }

  function finalizeSingle(answer) {
    if (answer.taskType !== 'single' || answer.answers.length <= 1) return answer;
    const best = answer.answers.reduce((pick, item) => (item.confidence > pick.confidence ? item : pick), answer.answers[0]);
    return Object.assign({}, answer, {
      answers: [best],
      options: answer.options.length ? answer.options : answer.answers.filter((item) => item !== best)
    });
  }

  function parseAnswer(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try {
      return normalizeAnswer(extractJson(raw));
    } catch (err) {
      if (/^[[{]/.test(raw)) return null;
      return normalizeAnswer({ taskType: 'open', openAnswer: raw.slice(0, 2000), confidence: 50 });
    }
  }

  /* ---------- strona i obraz ---------- */

  /* Safari na iOS odznacza tekst, gdy dotknie się czegokolwiek poza stroną.
     Dlatego zaznaczenie jest zapamiętywane od razu przy jego powstaniu. */

  const SEL_KEEP_MS = 2 * 60 * 1000;
  let keptSelection = { text: '', at: 0 };

  function liveSelection() {
    let text = '';
    try {
      text = String(window.getSelection ? window.getSelection().toString() : '');
    } catch (err) { text = ''; }
    if (!text.trim()) {
      const field = document.activeElement;
      if (field && typeof field.selectionStart === 'number' && typeof field.selectionEnd === 'number'
        && field.selectionEnd > field.selectionStart) {
        try {
          text = String(field.value || '').slice(field.selectionStart, field.selectionEnd);
        } catch (err) { text = ''; }
      }
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function keepSelection() {
    const text = liveSelection();
    if (text) keptSelection = { text: text, at: Date.now() };
    return keptSelection;
  }

  function keptText() {
    if (!keptSelection.text) return '';
    if (Date.now() - keptSelection.at > SEL_KEEP_MS) { keptSelection = { text: '', at: 0 }; return ''; }
    return keptSelection.text;
  }

  function currentSelection() {
    const live = liveSelection();
    if (live) { keptSelection = { text: live, at: Date.now() }; return { text: live, live: true }; }
    return { text: keptText(), live: false };
  }

  function clearSelection() {
    keptSelection = { text: '', at: 0 };
    try {
      const sel = window.getSelection ? window.getSelection() : null;
      if (sel && sel.rangeCount) sel.removeAllRanges();
    } catch (err) { /* czyścimy tylko pamięć */ }
  }

  function pageText() {
    const body = document.body;
    return body ? String(body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, PAGE_TEXT_LIMIT) : '';
  }

  /* ---------- pierwsze widoczne zadanie (tryb cichy) ---------- */

  const TASK_HINT = /(\?|prawda|fałsz|uzupełnij|wpisz|wybierz|połącz|dopasuj|uporządkuj|oblicz|podaj)/i;
  const TASK_SELECTOR = 'p,li,td,th,label,dd,dt,blockquote,h1,h2,h3,h4,h5';

  function onScreen(node) {
    const rect = node.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 8) return false;
    if (rect.bottom < 8 || rect.top > window.innerHeight - 8) return false;
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function taskBox(node) {
    return node.closest('li,tr,fieldset') || node.parentElement || node;
  }

  function isSolved(node) {
    const box = taskBox(node);
    if (box.querySelector('input[type=radio]:checked,input[type=checkbox]:checked')) return true;
    const blanks = box.querySelectorAll('input[type=text],input:not([type]),textarea');
    for (let i = 0; i < blanks.length; i++) {
      if (String(blanks[i].value || '').trim()) return true;
    }
    return false;
  }

  function firstVisibleTask() {
    const nodes = document.querySelectorAll(TASK_SELECTOR);
    let seen = 0;
    for (let i = 0; i < nodes.length && seen < 4000; i++) {
      const node = nodes[i];
      seen++;
      if (!onScreen(node)) continue;
      const own = String(node.innerText || '').replace(/\s+/g, ' ').trim();
      if (own.length < 12 || own.length > 700) continue;
      if (!TASK_HINT.test(own)) continue;
      if (isSolved(node)) continue;
      const text = String(taskBox(node).innerText || '').replace(/\s+/g, ' ').trim();
      return (text || own).slice(0, 900);
    }
    return '';
  }

  function imageUserText() {
    const text = pageText().slice(0, PROMPT_TEXT_LIMIT);
    if (!text) return USER_IMAGE;
    return USER_IMAGE + '\n\nTekst widoczny na stronie (do sprawdzenia brzmienia pytania i wariantów; może zawierać elementy interfejsu):\n' + text;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        try {
          const maxW = 1600;
          const scale = Math.min(1, maxW / image.naturalWidth);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const data = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
          URL.revokeObjectURL(url);
          resolve({ mime: 'image/jpeg', b64: data });
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(new Error('Nie udało się przetworzyć zdjęcia'));
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Nie udało się odczytać zdjęcia'));
      };
      image.src = url;
    });
  }

  /* Zrzut ekranu. Safari na iOS zawsze pokazuje systemowe okno wyboru ekranu,
     a jego potwierdzenie potrafi trafić do pierwszych klatek strumienia.
     Dlatego czekamy na stabilny obraz (dwie identyczne próbki), odrzucamy
     klatki puste i przycinamy paski systemowe u góry i dołu. Gdy API nie ma,
     strona nie jest HTTPS, użytkownik odmówi albo obraz jest bezużyteczny,
     zwracamy null i tryb cichy korzysta z tekstu strony. */
  const FRAME_SAMPLE_MS = 200;
  const FRAME_MIN_MS = 700;
  const FRAME_MAX_MS = 6000;
  const FRAME_MIN_VARIANCE = 12;

  function frameStats(video, context) {
    try { context.drawImage(video, 0, 0, 64, 64); } catch (err) { return null; }
    let data;
    try { data = context.getImageData(0, 0, 64, 64).data; } catch (err) { return null; }
    let sum = 0;
    let sumSq = 0;
    let hash = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      sum += lum;
      sumSq += lum * lum;
      if (i % 64 === 0) hash = (hash * 33 + lum) | 0;
    }
    const count = data.length / 4;
    const mean = sum / count;
    return { hash: hash, variance: sumSq / count - mean * mean };
  }

  async function grabFrame() {
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!media || typeof media.getDisplayMedia !== 'function') return null;
    let stream = null;
    let video = null;
    try {
      stream = await media.getDisplayMedia({ video: true, audio: false });
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.documentElement.appendChild(video);
      video.srcObject = stream;
      await video.play();

      const probe = document.createElement('canvas');
      probe.width = 64;
      probe.height = 64;
      const context = probe.getContext('2d', { willReadFrequently: true });

      /* pierwsze klatki mogą zawierać okno potwierdzenia, więc bierzemy
         dopiero obraz, który przestał się zmieniać */
      const startedAt = Date.now();
      let prev = null;
      let stable = false;
      while (Date.now() - startedAt < FRAME_MAX_MS) {
        await new Promise((done) => setTimeout(done, FRAME_SAMPLE_MS));
        const stats = context ? frameStats(video, context) : null;
        if (!stats) continue;
        const quiet = prev && prev.hash === stats.hash && stats.variance >= FRAME_MIN_VARIANCE;
        if (quiet && Date.now() - startedAt >= FRAME_MIN_MS) { stable = true; break; }
        prev = stats;
      }
      if (!stable && (!prev || prev.variance < FRAME_MIN_VARIANCE)) return null;

      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return null;

      const padTop = Math.round(height * 0.06);
      const padBottom = Math.round(height * 0.04);
      const srcH = Math.max(1, height - padTop - padBottom);
      const scale = Math.min(1, 1600 / width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(srcH * scale));
      canvas.getContext('2d').drawImage(video, 0, padTop, width, srcH, 0, 0, canvas.width, canvas.height);
      return { mime: 'image/jpeg', b64: canvas.toDataURL('image/jpeg', 0.82).split(',')[1] };
    } catch (err) {
      return null;
    } finally {
      if (video && video.parentNode) video.parentNode.removeChild(video);
      if (stream) {
        try { stream.getTracks().forEach((track) => track.stop()); } catch (err) { /* już zatrzymany */ }
      }
    }
  }

  /* ---------- panel ---------- */

  const HOST_ID = 'tt-ios-host';
  const VERSION = '2.3.0'; // trzymaj zgodne z @version wyżej

  const CSS = [
    ':host{all:initial}',
    '*,*::before,*::after{box-sizing:border-box}',
    '.fab{position:fixed;right:14px;bottom:calc(18px + env(safe-area-inset-bottom));width:40px;height:40px;border-radius:20px;',
    'border:1px solid rgba(20,24,40,.10);background:rgba(255,255,255,.58);color:rgba(28,28,30,.55);',
    '-webkit-backdrop-filter:blur(10px) saturate(1.6);backdrop-filter:blur(10px) saturate(1.6);',
    'font:600 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.4px;',
    '-webkit-text-size-adjust:100%;text-size-adjust:100%;',
    'box-shadow:0 2px 10px rgba(16,20,32,.12);z-index:2147483001;touch-action:none;',
    '-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;',
    'opacity:.4;transition:opacity .25s ease,box-shadow .2s ease,background .2s ease,transform .15s ease}',
    '.fab.live,.fab.armed,.fab:active,.fab:focus-visible{opacity:1}',
    '.fab.armed{box-shadow:0 2px 10px rgba(16,20,32,.12),0 0 0 2px rgba(59,91,219,.28)}',
    '.fab:active{transform:scale(.94);background:rgba(255,255,255,.85)}',
    '.fab[hidden]{display:none}',
    '.fab.dragging{opacity:1;transform:scale(1.06);transition:none;',
    'box-shadow:0 8px 22px rgba(16,20,32,.28),0 0 0 2px rgba(59,91,219,.35)}',
    '.panel{position:fixed;left:50%;bottom:calc(66px + env(safe-area-inset-bottom));transform:translateX(-50%);',
    'width:calc(100% - 16px);max-width:460px;max-height:70vh;overflow:auto;',
    'background:rgba(252,252,253,.84);color:#1c1c1e;border:1px solid rgba(20,24,40,.07);border-radius:16px;',
    'padding:10px 12px 12px;',
    'font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    '-webkit-backdrop-filter:blur(20px) saturate(1.8);backdrop-filter:blur(20px) saturate(1.8);',
    '-webkit-text-size-adjust:100%;text-size-adjust:100%;',
    'box-shadow:0 8px 28px rgba(16,20,32,.16);z-index:2147483000;color-scheme:light}',
    '.panel[hidden]{display:none}',
    '.bar{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
    '.title{font-weight:600;font-size:13px;color:#3a3f4b}',
    '.ver{margin-left:4px;font-weight:400;font-size:11px;color:#a0a5b0}',
    '.status{flex:1;min-width:0;font-size:11px;color:#8a8f9a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.status.bad{color:#c0392b}',
    '.close{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:#8a8f9a;font-size:18px;line-height:1}',
    '.theme{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:#8a8f9a;',
    'font-family:inherit;font-size:15px;line-height:1;padding:0}',
    '.theme:active{background:rgba(20,24,40,.08)}',
    '.sel{display:flex;align-items:center;gap:6px;margin:0 0 8px;padding:6px 8px;border-radius:10px;',
    'background:rgba(59,91,219,.08);color:#45506b;font-size:12px;line-height:1.35}',
    '.sel[hidden]{display:none}',
    '.seltext{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.seldrop{flex:0 0 auto;border:0;border-radius:6px;background:transparent;color:#8a8f9a;',
    'font-family:inherit;font-size:15px;font-weight:400;line-height:1;padding:2px 5px}',
    '.seldrop:active{background:rgba(20,24,40,.08)}',
    '.actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px}',
    '.actions button{min-height:38px;border:1px solid rgba(20,24,40,.08);border-radius:10px;',
    'background:rgba(20,24,40,.035);color:#2b3040;font-family:inherit;font-size:13px;font-weight:500;line-height:1.2;padding:6px}',
    '.actions button:active{background:rgba(20,24,40,.075)}',
    '.actions button:disabled{opacity:.45}',
    '.answer:empty{display:none}',
    '.q{margin:0 0 8px;font-weight:600}',
    '.open{margin:0 0 8px;white-space:pre-wrap}',
    '.row{display:flex;gap:8px;align-items:flex-start;margin-bottom:6px}',
    '.badge{flex:0 0 auto;min-width:22px;height:22px;border-radius:7px;background:rgba(59,91,219,.12);color:#33499c;',
    'font-size:12px;display:flex;align-items:center;justify-content:center;padding:0 4px}',
    '.txt{flex:1;min-width:0}',
    '.pair{display:flex;gap:8px;margin-bottom:6px}',
    '.pair span:first-child{flex:1;min-width:0;color:#5b6270}',
    '.pair span:last-child{flex:1;min-width:0}',
    '.notes{margin:8px 0 0;font-size:12px;color:#8a8f9a}',
    '.conf{margin:8px 0 0;font-size:11px;color:#9aa0ab}',
    '.warn{margin:6px 0 0;font-size:12px;color:#a86b00}',
    '.err{margin:0;color:#c0392b}',
    '.settings{border-top:1px solid rgba(20,24,40,.08);padding-top:10px;margin-top:4px}',
    '.settings[hidden]{display:none}',
    '.settings label{display:block;margin-bottom:8px;font-size:12px;color:#8a8f9a}',
    '.settings input,.settings select,.settings textarea{display:block;width:100%;margin-top:4px;min-height:36px;',
    'border:1px solid rgba(20,24,40,.12);border-radius:9px;background:rgba(255,255,255,.72);color:#1c1c1e;',
    'font:13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:7px 8px}',
    '.settings .row{margin-top:10px;align-items:center}',
    '.save{min-height:36px;padding:0 14px;border:0;border-radius:9px;background:rgba(59,91,219,.9);color:#fff;',
    'font-family:inherit;font-size:13px;font-weight:500;line-height:1}',
    '.hint{font-size:11px;color:#9aa0ab}',
    '.toast{position:fixed;right:12px;bottom:calc(66px + env(safe-area-inset-bottom));max-width:calc(100% - 24px);',
    'padding:7px 10px;border-radius:12px;background:rgba(28,28,30,.9);color:#fff;',
    'font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    '-webkit-text-size-adjust:100%;text-size-adjust:100%;',
    'display:flex;flex-direction:column;gap:5px;align-items:stretch;overflow:hidden;',
    'box-shadow:0 6px 20px rgba(16,20,32,.24);z-index:2147483002;pointer-events:none;',
    'opacity:0;transform:translateY(4px);transition:opacity .15s ease,transform .15s ease}',
    '.toast.show{opacity:1;transform:none}',
    '.toast[hidden]{display:none}',
    '.toast.action{pointer-events:auto}',
    '.toast.small{font-size:12px;line-height:1.3}',
    '.toasttext{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;overflow:hidden;overflow-wrap:anywhere}',
    '.toastbtn{align-self:flex-start;min-height:28px;padding:0 11px;border:0;border-radius:7px;',
    'background:rgba(255,255,255,.22);color:inherit;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    '.toastbtn:active{background:rgba(255,255,255,.36)}',
    ':host(.dark) .fab{background:rgba(30,33,42,.74);border-color:rgba(255,255,255,.14);',
    'color:rgba(232,236,244,.68);box-shadow:0 2px 10px rgba(0,0,0,.45)}',
    ':host(.dark) .fab:active{background:rgba(48,52,64,.92)}',
    ':host(.dark) .fab.armed{box-shadow:0 2px 10px rgba(0,0,0,.45),0 0 0 2px rgba(122,150,255,.4)}',
    ':host(.dark) .fab.dragging{box-shadow:0 8px 22px rgba(0,0,0,.55),0 0 0 2px rgba(122,150,255,.45)}',
    ':host(.dark) .panel{background:rgba(24,26,33,.9);color:#e7eaf2;border-color:rgba(255,255,255,.1);',
    'box-shadow:0 8px 28px rgba(0,0,0,.55);color-scheme:dark}',
    ':host(.dark) .title{color:#d7dce7}',
    ':host(.dark) .ver{color:#78808f}',
    ':host(.dark) .status{color:#9aa2b1}',
    ':host(.dark) .status.bad{color:#ff8a7a}',
    ':host(.dark) .close,:host(.dark) .theme{color:#9aa2b1}',
    ':host(.dark) .theme:active{background:rgba(255,255,255,.12)}',
    ':host(.dark) .sel{background:rgba(110,140,255,.16);color:#bcc7e6}',
    ':host(.dark) .seldrop{color:#9aa2b1}',
    ':host(.dark) .seldrop:active{background:rgba(255,255,255,.12)}',
    ':host(.dark) .actions button{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1);color:#dfe4ef}',
    ':host(.dark) .actions button:active{background:rgba(255,255,255,.12)}',
    ':host(.dark) .badge{background:rgba(120,150,255,.22);color:#b7c6f7}',
    ':host(.dark) .pair span:first-child{color:#a3abb9}',
    ':host(.dark) .notes,:host(.dark) .conf{color:#8d95a3}',
    ':host(.dark) .warn{color:#e0a94a}',
    ':host(.dark) .err{color:#ff8a7a}',
    ':host(.dark) .settings{border-top-color:rgba(255,255,255,.1)}',
    ':host(.dark) .settings label{color:#9aa2b1}',
    ':host(.dark) .settings input,:host(.dark) .settings select,:host(.dark) .settings textarea{background:rgba(255,255,255,.07);',
    'border-color:rgba(255,255,255,.14);color:#e7eaf2}',
    ':host(.dark) .hint{color:#8d95a3}',
    ':host(.dark) .toast{background:rgba(238,241,248,.96);color:#1b1d23;box-shadow:0 6px 20px rgba(0,0,0,.5)}',
    ':host(.dark) .toastbtn{background:rgba(20,24,40,.14)}',
    ':host(.dark) .toastbtn:active{background:rgba(20,24,40,.24)}',
    '.settings textarea{resize:vertical;min-height:76px;line-height:1.35;font-size:12px}',
    ':host(.p-android) .fab{width:44px;height:44px;border-radius:22px}',
    ':host(.p-android) .toastbtn{min-height:32px}',
    ':host(.p-ios) .fab{-webkit-tap-highlight-color:transparent}'
  ].join('');

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  let ui = null;
  let busy = false;

  function mount() {
    if (document.getElementById(HOST_ID)) return;
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000;';

    const shadow = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const fab = el('button', 'fab', 'TT');
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Tab Tools — stuknij: panel, dwa stuknięcia: szybka odpowiedź, przytrzymaj: przesuń');

    const toast = el('div', 'toast');
    toast.hidden = true;

    const panel = el('section', 'panel');
    panel.hidden = true;

    const bar = el('div', 'bar');
    const title = el('span', 'title', 'Tab Tools ');
    const ver = el('span', 'ver', 'v' + VERSION);
    title.appendChild(ver);
    const status = el('span', 'status');
    const themeBtn = el('button', 'theme', '☾');
    themeBtn.type = 'button';
    themeBtn.setAttribute('aria-label', 'Włącz tryb ciemny');
    const close = el('button', 'close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Zamknij panel');
    bar.appendChild(title);
    bar.appendChild(status);
    bar.appendChild(themeBtn);
    bar.appendChild(close);

    const selChip = el('div', 'sel');
    selChip.hidden = true;
    const selText = el('span', 'seltext');
    const selDrop = el('button', 'seldrop', '×');
    selDrop.type = 'button';
    selDrop.setAttribute('aria-label', 'Wyczyść zapamiętane zaznaczenie');
    selChip.appendChild(selText);
    selChip.appendChild(selDrop);

    const actions = el('div', 'actions');
    const buttons = {};
    [['selection', 'Zaznaczenie'], ['page', 'Tekst strony'], ['image', 'Zdjęcie'], ['settings', 'Ustawienia']].forEach((pair) => {
      const button = el('button', null, pair[1]);
      button.type = 'button';
      button.dataset.act = pair[0];
      actions.appendChild(button);
      buttons[pair[0]] = button;
    });

    const answer = el('div', 'answer');

    const panelSettings = el('div', 'settings');
    panelSettings.hidden = true;

    const platformLabel = el('label', null, 'Tryb działania');
    const platform = el('select', 'platform');
    PLATFORMS.forEach((id) => {
      const option = el('option', null, PLATFORM_LABEL[id]);
      option.value = id;
      platform.appendChild(option);
    });
    platformLabel.appendChild(platform);

    const providerLabel = el('label', null, 'Provider');
    const provider = el('select', 'provider');
    PROVIDERS.forEach((id) => {
      const option = el('option', null, PROVIDER_LABEL[id]);
      option.value = id;
      provider.appendChild(option);
    });
    providerLabel.appendChild(provider);

    const keyLabel = el('label', null, 'Klucze API (jeden na wiersz, pierwszy ma priorytet)');
    const key = el('textarea', 'key');
    key.rows = 3;
    key.autocomplete = 'off';
    key.spellcheck = false;
    key.placeholder = 'klucz 1\nklucz 2';
    keyLabel.appendChild(key);

    const modelLabel = el('label', null, 'Model (auto albo nazwa)');
    const model = el('input', 'model');
    model.type = 'text';
    model.autocomplete = 'off';
    model.spellcheck = false;
    model.placeholder = 'auto';
    modelLabel.appendChild(model);

    const saveRow = el('div', 'row');
    const save = el('button', 'save', 'Zapisz');
    save.type = 'button';
    const hint = el('span', 'hint');
    saveRow.appendChild(save);
    saveRow.appendChild(hint);

    panelSettings.appendChild(platformLabel);
    panelSettings.appendChild(providerLabel);
    panelSettings.appendChild(keyLabel);
    panelSettings.appendChild(modelLabel);
    panelSettings.appendChild(saveRow);

    const file = el('input', 'file');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;

    panel.appendChild(bar);
    panel.appendChild(selChip);
    panel.appendChild(actions);
    panel.appendChild(answer);
    panel.appendChild(panelSettings);
    panel.appendChild(file);
    shadow.appendChild(toast);
    shadow.appendChild(fab);
    shadow.appendChild(panel);

    (document.body || document.documentElement).appendChild(host);

    ui = {
      host: host, fab: fab, panel: panel, toast: toast, status: status, answer: answer,
      buttons: buttons, settings: panelSettings, chip: selChip, chipText: selText,
      provider: provider, platform: platform, key: key, model: model, hint: hint, file: file, theme: themeBtn
    };

    fab.addEventListener('click', onFabTap);
    fab.addEventListener('pointerdown', onFabPointerDown);
    fab.addEventListener('pointermove', onFabPointerMove);
    fab.addEventListener('pointerup', onFabPointerUp);
    fab.addEventListener('pointercancel', onFabPointerUp);

    themeBtn.addEventListener('click', toggleTheme);

    close.addEventListener('click', () => closePanel());

    selDrop.addEventListener('click', () => {
      clearSelection();
      refreshSelChip();
      updateArmed();
    });

    provider.addEventListener('change', () => { fillKeyFields(); });

    platform.addEventListener('change', async () => {
      await saveSettings({ platform: platform.value }).catch(() => {});
      applyPlatform();
      hint.textContent = PLATFORM_LABEL[platform.value];
      setTimeout(() => { hint.textContent = ''; }, 2000);
    });

    save.addEventListener('click', async () => {
      const chosen = PROVIDERS.indexOf(provider.value) !== -1 ? provider.value : 'gemini';
      const list = keyList(key.value);
      const patch = { provider: chosen, platform: platform.value, keys: {}, models: {} };
      patch.keys[chosen] = list;
      patch.models[chosen] = model.value.trim() || 'auto';
      /* nowa lista kluczy to świeża próba, stare blokady nie mają sensu */
      patch.resetCooldowns = chosen;
      await saveSettings(patch);
      applyPlatform();
      hint.textContent = list.length ? 'Zapisano kluczy: ' + list.length : 'Zapisano bez klucza';
      setTimeout(() => { hint.textContent = ''; }, 2200);
    });

    buttons.selection.addEventListener('click', () => {
      const picked = currentSelection();
      if (!picked.text) {
        say('Zaznacz tekst na stronie, potem stuknij TT', true);
        return;
      }
      refreshSelChip();
      solveText(picked.text, picked.live ? '' : 'zapamiętane zaznaczenie (' + picked.text.length + ' znaków)');
    });

    buttons.page.addEventListener('click', () => {
      const text = pageText();
      if (!text) {
        say('Nie widzę tekstu na tej stronie', true);
        return;
      }
      solveText(text, 'tekst strony');
    });

    buttons.image.addEventListener('click', () => {
      if (busy) return;
      file.value = '';
      file.click();
    });

    buttons.settings.addEventListener('click', async () => {
      panelSettings.hidden = !panelSettings.hidden;
      if (panelSettings.hidden) return;
      const s = await getSettings();
      provider.value = s.provider;
      fillKeyFields(s);
    });

    file.addEventListener('change', () => {
      const picked = file.files && file.files[0];
      if (picked) solveImage(picked);
    });
  }

  async function fillKeyFields(loaded) {
    if (!ui) return;
    const s = loaded || await getSettings();
    const list = s.keys[ui.provider.value] || [];
    if (document.activeElement !== ui.key) ui.key.value = list.join('\n');
    if (ui.platform) ui.platform.value = s.platform || 'auto';
    const chosen = s.models[ui.provider.value];
    ui.model.value = chosen && chosen !== 'auto' ? chosen : '';
  }

  function say(text, bad) {
    if (!ui) return;
    ui.status.textContent = text || '';
    ui.status.className = bad ? 'status bad' : 'status';
  }

  /* ---------- motyw ---------- */

  function applyTheme(mode) {
    const dark = mode === 'dark';
    if (!ui) return;
    ui.host.classList.toggle('dark', dark);
    ui.theme.textContent = dark ? '☀' : '☾';
    ui.theme.setAttribute('aria-label', dark ? 'Włącz tryb jasny' : 'Włącz tryb ciemny');
  }

  function toggleTheme() {
    const next = uiState.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    saveUiState({ theme: next }).catch(() => {});
  }

  /* kółko i dymki dostają drobne różnice zależne od platformy */
  function applyPlatform() {
    if (!ui) return;
    const mode = activePlatform();
    ui.host.classList.toggle('p-ios', mode === 'ios');
    ui.host.classList.toggle('p-android', mode === 'android');
  }

  function openPanel() {
    if (!ui) return;
    refreshSelChip();
    ui.panel.hidden = false;
    ui.fab.classList.add('live');
  }

  function closePanel() {
    if (!ui) return;
    ui.panel.hidden = true;
    ui.settings.hidden = true;
    ui.fab.classList.remove('live');
  }

  function refreshSelChip() {
    if (!ui) return;
    const picked = currentSelection();
    if (!picked.text) {
      ui.chip.hidden = true;
      ui.chipText.textContent = '';
      return;
    }
    const preview = picked.text.length > 56 ? picked.text.slice(0, 56) + '…' : picked.text;
    ui.chip.hidden = false;
    ui.chipText.textContent = preview + ' · ' + picked.text.length + ' znaków';
  }

  let armTimer = 0;

  function updateArmed() {
    if (!ui) return;
    const has = Boolean(keptText() || liveSelection());
    ui.fab.classList.toggle('armed', has);
    if (armTimer) clearTimeout(armTimer);
    armTimer = has ? setTimeout(updateArmed, SEL_KEEP_MS + 1000) : 0;
  }

  function onSelectionChange() {
    keepSelection();
    if (ui && !ui.panel.hidden) refreshSelChip();
    updateArmed();
  }

  function onDocumentPointerDown(event) {
    if (!ui || ui.panel.hidden) return;
    if (event.target !== ui.host && !ui.host.contains(event.target)) closePanel();
  }

  function setBusy(value) {
    busy = value;
    if (!ui) return;
    ['selection', 'page', 'image'].forEach((key) => { ui.buttons[key].disabled = value; });
  }

  function renderAnswer(answer) {
    if (!ui) return;
    const box = ui.answer;
    box.replaceChildren();
    if (!answer) return;

    if (answer.question) box.appendChild(el('p', 'q', answer.question));

    if (answer.taskType === 'match' && answer.pairs.length) {
      answer.pairs.forEach((pair) => {
        const row = el('div', 'pair');
        row.appendChild(el('span', null, pair.left));
        row.appendChild(el('span', null, pair.right));
        box.appendChild(row);
      });
    } else if (answer.answers.length) {
      const numbered = answer.taskType === 'order' || answer.taskType === 'gaps' || answer.taskType === 'table';
      answer.answers.forEach((item, index) => {
        const row = el('div', 'row');
        const badge = (item.label || '').trim()
          || (numbered ? String(index + 1) : String.fromCharCode(65 + index));
        row.appendChild(el('span', 'badge', badge));
        row.appendChild(el('span', 'txt', item.text));
        box.appendChild(row);
      });
    } else if (answer.openAnswer) {
      box.appendChild(el('p', 'open', answer.openAnswer));
    }

    if (answer.notes) box.appendChild(el('p', 'notes', answer.notes));
    if (answer.confidence > 0) box.appendChild(el('p', 'conf', 'Pewność ' + answer.confidence + '%'));
    if (answer.confidence > 0 && answer.confidence < 40) {
      box.appendChild(el('p', 'warn', 'Niepewne, sprawdź sam.'));
    }
  }

  async function askAnswer(system, userText, img) {
    let answer = parseAnswer(await askModel(system, userText, img, SCHEMA_ANSWER));
    if (isEmptyAnswer(answer)) {
      answer = parseAnswer(await askModel(system, userText + RETRY_EMPTY, img, SCHEMA_ANSWER));
    }
    if (isEmptyAnswer(answer)) throw new Error('Model nie odczytał pytania — spróbuj ponownie');
    return finalizeSingle(answer);
  }

  async function solveText(text, label, opt) {
    if (busy) return { error: 'Trwa już odpowiedź' };
    const silent = Boolean(opt && opt.silent);

    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, PAGE_TEXT_LIMIT);
    if (!clean) {
      if (!silent) say('Brak tekstu do wysłania', true);
      return { error: 'Brak tekstu do wysłania' };
    }

    setBusy(true);
    if (silent) hideToast();
    else {
      say(label ? 'Analizuję ' + label + '…' : 'Analizuję…');
      renderAnswer(null);
    }

    try {
      const final = await askAnswer(SYS_TEXT, clean, null);
      if (silent) return { answer: final };
      renderAnswer(final);
      say('');
      return { answer: final };
    } catch (err) {
      if (!silent) {
        say(msgOf(err), true);
        ui.answer.replaceChildren(el('p', 'err', msgOf(err)));
      }
      return { error: msgOf(err) };
    } finally {
      setBusy(false);
    }
  }

  async function solveImage(file) {
    if (busy) return;
    setBusy(true);
    say('Przygotowuję zdjęcie…');
    renderAnswer(null);

    try {
      const img = await loadImage(file);
      say('Analizuję…');
      renderAnswer(await askAnswer(SYS_IMAGE, imageUserText(), img));
      say('');
    } catch (err) {
      say(msgOf(err), true);
      ui.answer.replaceChildren(el('p', 'err', msgOf(err)));
    } finally {
      setBusy(false);
    }
  }

  /* ---------- szybka odpowiedź (dwa stuknięcia w TT) ---------- */

  const QUICK_TAP_MS = 400;
  const SHORT_TOAST_MS = 4000;
  const DONE_TOAST_MS = 2800;
  const COPY_TOAST_MS = 15000;

  let toastTimer = 0;
  let toastAction = null;

  function hideToast() {
    if (!ui) return;
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = 0; }
    toastAction = null;
    ui.toast.classList.remove('show');
    ui.toast.hidden = true;
  }

  /* dymek trzyma się przy przycisku, także po przeciągnięciu go w inne miejsce */

  function placeToast() {
    if (!ui || ui.toast.hidden) return;
    const fab = ui.fab.getBoundingClientRect();
    const w = ui.toast.offsetWidth;
    const h = ui.toast.offsetHeight;
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = fab.top - h - pad;
    if (top < pad) {
      top = fab.bottom + pad;
      if (top + h > vh - pad) top = Math.max(pad, vh - h - pad);
    }
    let left = fab.left + fab.width / 2 - w / 2;
    left = Math.max(pad, Math.min(vw - w - pad, left));

    ui.toast.style.left = Math.round(left) + 'px';
    ui.toast.style.top = Math.round(top) + 'px';
    ui.toast.style.right = 'auto';
    ui.toast.style.bottom = 'auto';
  }

  function copyLegacy(value) {
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, value.length);
      const done = document.execCommand && document.execCommand('copy');
      document.body.removeChild(area);
      return Boolean(done);
    } catch (err) { return false; }
  }

  function copyText(text) {
    const value = String(text || '');
    if (!value) return Promise.resolve(false);
    const modern = () => (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText)
      ? navigator.clipboard.writeText(value).then(() => true, () => false)
      : Promise.resolve(false);
    /* iOS: execCommand działa w geście użytkownika, writeText bywa odrzucane */
    if (activePlatform() === 'ios') {
      if (copyLegacy(value)) return Promise.resolve(true);
      return modern();
    }
    return modern().then((copied) => (copied ? true : copyLegacy(value)));
  }

  function showToast(text, ms, opt) {
    if (!ui) return;
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!clean) { hideToast(); return; }
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = 0; }
    const options = opt || {};
    ui.toast.replaceChildren(el('span', 'toasttext', clean));
    ui.toast.className = 'toast';
    toastAction = typeof options.run === 'function' ? options.run : null;
    if (options.action) {
      const button = el('button', 'toastbtn', options.action);
      button.type = 'button';
      button.addEventListener('click', onToastButton);
      ui.toast.appendChild(button);
      ui.toast.classList.add('action');
    }
    if (options.small) ui.toast.classList.add('small');
    ui.toast.hidden = false;
    placeToast();
    void ui.toast.offsetWidth;
    ui.toast.classList.add('show');
    if (ms) toastTimer = setTimeout(hideToast, ms);
  }

  function onToastButton() {
    if (!toastAction) return;
    const run = toastAction;
    const button = ui ? ui.toast.querySelector('.toastbtn') : null;
    if (button) button.disabled = true;
    run().then((copied) => {
      if (!ui) return;
      if (!copied) {
        if (button) { button.disabled = false; button.textContent = 'Skopiuj'; }
        return;
      }
      toastAction = null;
      if (button) button.textContent = 'Skopiowano';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(hideToast, 1800);
    });
  }

  function answerLine(answer) {
    if (!answer) return '';
    if (answer.taskType === 'match' && answer.pairs.length) {
      return answer.pairs.map((p) => p.left + ' → ' + p.right).join(' · ');
    }
    if (answer.answers.length) {
      return answer.answers.map((item) => (item.label ? item.label + '. ' : '') + item.text).join(' · ');
    }
    return answer.openAnswer || '';
  }

  function isShortAnswer(answer) {
    if (!answer) return false;
    const line = answerLine(answer);
    if (!line) return false;
    if (answer.openAnswer) return line.length <= 48 && line.split(/\s+/).filter(Boolean).length <= 4;
    return line.length <= 160;
  }

  async function presentAnswer(answer) {
    const line = answerLine(answer);
    if (!line) { showToast('Model nie zwrócił odpowiedzi', 2200); return; }
    if (isShortAnswer(answer)) {
      showToast(line, SHORT_TOAST_MS, { small: true });
      return;
    }
    if (await copyText(line)) {
      showToast('Gotowe', DONE_TOAST_MS);
      return;
    }
    showToast('Gotowe', COPY_TOAST_MS, { action: 'Skopiuj', run: () => copyText(line) });
  }

  async function quickSolve() {
    if (!ui || busy) return;
    const picked = currentSelection();
    if (!picked.text) {
      showToast('Najpierw zaznacz tekst, potem stuknij TT dwa razy', 2000);
      return;
    }
    refreshSelChip();
    showToast('Analizuję…', 0);
    const result = await solveText(picked.text, '');
    if (!result) { hideToast(); return; }
    if (result.error) { showToast(result.error, 2200); return; }
    await presentAnswer(result.answer);
  }

  async function solveImageSilent(img, context) {
    if (busy) return { error: 'Trwa już odpowiedź' };
    setBusy(true);
    try {
      const text = String(context || '').trim();
      const userText = text
        ? 'Rozwiąż pierwsze widoczne nierozwiązane zadanie ze zdjęcia. Pomiń zadania już wypełnione lub zaznaczone. Pomocniczy tekst strony:\n' + text.slice(0, PROMPT_TEXT_LIMIT)
        : 'Rozwiąż pierwsze widoczne nierozwiązane zadanie ze zdjęcia. Pomiń zadania już wypełnione lub zaznaczone.';
      return { answer: await askAnswer(SYS_IMAGE, userText, img) };
    } catch (err) {
      return { error: msgOf(err) };
    } finally {
      setBusy(false);
    }
  }

  /* Tryb cichy: bez panelu i bez dymka „Analizuję…”. Najpierw próbuje zrzutu
     ekranu, a gdy się nie uda, czyta pierwsze widoczne zadanie ze strony. */
  let capturing = false;

  async function silentSolve() {
    if (!ui || busy || capturing) return;
    capturing = true;
    try {
      const picked = firstVisibleTask() || currentSelection().text;
      /* Zrzut ekranu zawsze otwiera systemowe okno udostępniania, więc
         pytamy o niego tylko wtedy, gdy sam tekst nie wystarcza: brak
         zadania albo krótki tekst bez znaku zapytania (np. samo zdjęcie). */
      const needShot = !picked || (picked.length < 80 && !/\?/.test(picked));
      const img = needShot ? await grabFrame() : null;
      if (!img && !picked) {
        showToast('Nie widzę zadania na ekranie', 2200);
        return;
      }
      hideToast();
      const result = img
        ? await solveImageSilent(img, picked)
        : await solveText(picked, '', { silent: true });
      if (!result) return;
      if (result.error) { showToast(result.error, 2400); return; }
      await presentAnswer(result.answer);
    } finally {
      capturing = false;
    }
  }

  let fabTapTimer = 0;
  let fabLastTap = 0;

  function onFabTap() {
    if (Date.now() < suppressClickUntil) { suppressClickUntil = 0; return; }
    if (drag && drag.active) return;
    const now = Date.now();
    if (now - fabLastTap < QUICK_TAP_MS) {
      fabLastTap = 0;
      if (fabTapTimer) { clearTimeout(fabTapTimer); fabTapTimer = 0; }
      quickSolve();
      return;
    }
    fabLastTap = now;
    if (fabTapTimer) return;
    fabTapTimer = setTimeout(() => {
      fabTapTimer = 0;
      fabLastTap = 0;
      if (ui.panel.hidden) openPanel();
      else closePanel();
    }, QUICK_TAP_MS);
  }

  /* ---------- przesuwanie przycisku (przytrzymanie i przeciągnięcie) ---------- */

  const DRAG_HOLD_MS = 380;
  const HOLD_SILENT_MS = 2000;
  const DRAG_SLOP = 8;
  const SILENT_SLOP = 12;
  const FAB_PAD = 6;

  let drag = null;
  let suppressClickUntil = 0;

  function moveFab(x, y) {
    if (!ui) return;
    const w = ui.fab.offsetWidth || 40;
    const h = ui.fab.offsetHeight || 40;
    const maxX = Math.max(FAB_PAD, window.innerWidth - w - FAB_PAD);
    const maxY = Math.max(FAB_PAD, window.innerHeight - h - FAB_PAD);
    ui.fab.style.left = Math.round(Math.min(maxX, Math.max(FAB_PAD, x))) + 'px';
    ui.fab.style.top = Math.round(Math.min(maxY, Math.max(FAB_PAD, y))) + 'px';
    ui.fab.style.right = 'auto';
    ui.fab.style.bottom = 'auto';
  }

  function applyFabPos() {
    if (!ui || !uiState.fab) return;
    const w = ui.fab.offsetWidth || 40;
    const h = ui.fab.offsetHeight || 40;
    moveFab(uiState.fab.x * window.innerWidth - w / 2, uiState.fab.y * window.innerHeight - h / 2);
  }

  function fabFraction() {
    if (!ui) return null;
    const rect = ui.fab.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (rect.left + rect.width / 2) / Math.max(1, window.innerWidth))),
      y: Math.min(1, Math.max(0, (rect.top + rect.height / 2) / Math.max(1, window.innerHeight)))
    };
  }

  function endDrag() {
    if (!drag) return;
    const wasDragging = drag.active;
    const wasSilent = Boolean(drag.silent);
    const id = drag.id;
    if (drag.holdTimer) clearTimeout(drag.holdTimer);
    drag = null;
    if (!ui) return;
    ui.fab.classList.remove('dragging');
    try { ui.fab.releasePointerCapture(id); } catch (err) { /* wskaźnik już zwolniony */ }
    if (!wasDragging) return;
    suppressClickUntil = Date.now() + (wasSilent ? 8000 : 700);
    saveUiState({ fab: fabFraction() }).catch(() => {});
    if (!ui.toast.hidden) placeToast();
  }

  /* 0,4 s przytrzymania uzbraja przesuwanie, ale nic nie pokazuje. Kółko
     powiększa się dopiero przy ruchu palca, więc 2 s bezruchu zostają ciche. */
  function beginDrag() {
    if (!drag || !ui) return;
    drag.holdTimer = 0;
    drag.active = true;
    if (fabTapTimer) { clearTimeout(fabTapTimer); fabTapTimer = 0; }
    fabLastTap = 0;
  }

  function showDrag() {
    if (!drag || !ui || drag.shown) return;
    drag.shown = true;
    ui.fab.classList.add('dragging');
    hideToast();
    /* iOS nie ma wibracji w przeglądarce, Firefox Android ma */
    if (activePlatform() === 'android' && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(8); } catch (err) { /* brak wibracji */ }
    }
  }

  function onFabPointerDown(event) {
    if (!ui) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (drag) endDrag();
    const rect = ui.fab.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: Date.now(),
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      active: false,
      moved: false,
      shown: false,
      silent: false,
      holdTimer: 0
    };
    drag.holdTimer = setTimeout(beginDrag, DRAG_HOLD_MS);
    try { ui.fab.setPointerCapture(event.pointerId); } catch (err) { /* bez przechwytywania */ }
  }

  function onFabPointerMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.active) {
      if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) endDrag();
      return;
    }
    if (Math.abs(dx) > SILENT_SLOP || Math.abs(dy) > SILENT_SLOP) drag.moved = true;
    if (drag.moved) showDrag();
    if (event.cancelable) event.preventDefault();
    moveFab(event.clientX - drag.grabX, event.clientY - drag.grabY);
  }

  function onFabPointerUp(event) {
    if (!drag || event.pointerId !== drag.id) return;
    if (event.type === 'pointercancel') { endDrag(); return; }
    /* wywołanie w obsłudze gestu, żeby Safari pozwoliło na getDisplayMedia */
    const silent = !drag.moved && Date.now() - drag.startedAt >= HOLD_SILENT_MS;
    drag.silent = silent;
    endDrag();
    if (silent) silentSolve();
  }

  function onViewportResize() {
    if (!ui) return;
    if (uiState.fab) applyFabPos();
    if (!ui.toast.hidden) placeToast();
  }

  /* ---------- start ---------- */

  async function start() {
    mount();
    document.addEventListener('selectionchange', onSelectionChange, true);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    window.addEventListener('resize', onViewportResize, true);
    window.addEventListener('orientationchange', onViewportResize, true);
    updateArmed();
    await loadUiState().catch(() => {});
    applyTheme(uiState.theme);
    await getSettings().catch(() => {});
    applyPlatform();
    applyFabPos();
    getSettings().then(() => { if (ui) fillKeyFields(); }).catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
