// ==UserScript==
// @name         Tab Tools (iOS)
// @namespace    tab-tools-ios
// @version      2.0.0
// @description  Rozwiązuje pytanie z zaznaczenia, tekstu strony albo ze zdjęcia. Gemini, OpenRouter albo Groq.
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
  const DEFAULTS = {
    provider: 'gemini',
    keys: { gemini: '', openrouter: '', groq: '' },
    models: { gemini: 'auto', openrouter: 'auto', groq: 'auto' }
  };

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
      keys: Object.assign({}, DEFAULTS.keys, raw.keys || {}),
      models: Object.assign({}, DEFAULTS.models, raw.models || {})
    };
    return settings;
  }

  async function saveSettings(patch) {
    const now = await getSettings();
    const next = {
      provider: patch.provider || now.provider,
      keys: Object.assign({}, now.keys, patch.keys || {}),
      models: Object.assign({}, now.models, patch.models || {})
    };
    settings = next;
    await storeSet(STORE, next);
  }

  /* ---------- stałe ---------- */

  const PROVIDERS = ['gemini', 'openrouter', 'groq'];
  const PROVIDER_LABEL = { gemini: 'Gemini', openrouter: 'OpenRouter', groq: 'Groq' };

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
      taskType: { type: 'STRING', enum: ['single', 'multi', 'truefalse', 'numeric', 'open', 'match', 'unknown'] },
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
    'open: taskType "open", openAnswer 1-2 zdania, bez liter opcji, answers puste.',
    'match: taskType "match", pary w pairs jako {left, right}, answers puste.',
    'Przy open, numeric, truefalse i match answers MUSI być pustą tablicą.',
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
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/,\s*([,.!?;:])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
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
      const listed = s.keys.gemini ? await geminiList(s.keys.gemini) : [];
      hints = listed.concat(GEMINI_HINTS);
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

  async function askModel(system, userText, img, schema) {
    const s = await getSettings();
    const primary = s.provider;
    const keys = s.keys || {};
    if (!keys[primary]) throw new Error('Brak klucza ' + PROVIDER_LABEL[primary] + ' — dodaj go w ustawieniach');

    const deadline = Date.now() + 45000;
    const reasons = [];

    for (const provider of [primary].concat(PROVIDERS.filter((p) => p !== primary && keys[p]))) {
      for (const model of await modelsFor(provider, img)) {
        if (Date.now() > deadline) break;
        try {
          const text = await callProvider(provider, keys[provider], model, system, userText, img, schema);
          if (text) {
            remembered[provider] = model;
            return text;
          }
        } catch (err) {
          reasons.push(PROVIDER_LABEL[provider] + ': ' + msgOf(err));
          const kind = err && err.kind;
          if (kind !== 'model' && kind !== 'image' && kind !== 'empty') break;
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

  const TYPES = ['single', 'multi', 'truefalse', 'numeric', 'open', 'match', 'unknown'];

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

    let openAnswer = tidy(String(a.openAnswer || '').trim().slice(0, 2000));
    if (!openAnswer && answers.length && (type === 'open' || type === 'numeric' || type === 'truefalse')) {
      openAnswer = answers[0].text;
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

  /* ---------- panel ---------- */

  const HOST_ID = 'tt-ios-host';

  const CSS = [
    ':host{all:initial}',
    '*,*::before,*::after{box-sizing:border-box}',
    '.fab{position:fixed;right:14px;bottom:calc(18px + env(safe-area-inset-bottom));width:40px;height:40px;border-radius:20px;',
    'border:1px solid rgba(20,24,40,.10);background:rgba(255,255,255,.58);color:rgba(28,28,30,.55);',
    '-webkit-backdrop-filter:blur(10px) saturate(1.6);backdrop-filter:blur(10px) saturate(1.6);',
    'font:600 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.4px;',
    '-webkit-text-size-adjust:100%;text-size-adjust:100%;',
    'box-shadow:0 2px 10px rgba(16,20,32,.12);z-index:2147483001;touch-action:manipulation;',
    'opacity:.4;transition:opacity .25s ease,box-shadow .2s ease,background .2s ease,transform .15s ease}',
    '.fab.live,.fab.armed,.fab:active,.fab:focus-visible{opacity:1}',
    '.fab.armed{box-shadow:0 2px 10px rgba(16,20,32,.12),0 0 0 2px rgba(59,91,219,.28)}',
    '.fab:active{transform:scale(.94);background:rgba(255,255,255,.85)}',
    '.fab[hidden]{display:none}',
    '.panel{position:fixed;left:50%;bottom:calc(66px + env(safe-area-inset-bottom));transform:translateX(-50%);',
    'width:calc(100% - 16px);max-width:460px;max-height:70vh;overflow:auto;',
    'background:rgba(252,252,253,.84);color:#1c1c1e;border:1px solid rgba(20,24,40,.07);border-radius:16px;',
    'padding:10px 12px 12px;',
    'font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    '-webkit-backdrop-filter:blur(20px) saturate(1.8);backdrop-filter:blur(20px) saturate(1.8);',
    '-webkit-text-size-adjust:100%;text-size-adjust:100%;',
    'box-shadow:0 8px 28px rgba(16,20,32,.16);z-index:2147483000}',
    '.panel[hidden]{display:none}',
    '.bar{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
    '.title{font-weight:600;font-size:13px;color:#3a3f4b}',
    '.status{flex:1;min-width:0;font-size:11px;color:#8a8f9a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.status.bad{color:#c0392b}',
    '.close{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:#8a8f9a;font-size:18px;line-height:1}',
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
    '.settings input,.settings select{display:block;width:100%;margin-top:4px;min-height:36px;',
    'border:1px solid rgba(20,24,40,.12);border-radius:9px;background:rgba(255,255,255,.72);color:#1c1c1e;',
    'font:13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:7px 8px}',
    '.settings .row{margin-top:10px;align-items:center}',
    '.save{min-height:36px;padding:0 14px;border:0;border-radius:9px;background:rgba(59,91,219,.9);color:#fff;',
    'font-family:inherit;font-size:13px;font-weight:500;line-height:1}',
    '.hint{font-size:11px;color:#9aa0ab}'
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
    fab.setAttribute('aria-label', 'Tab Tools — otwórz panel');

    const panel = el('section', 'panel');
    panel.hidden = true;

    const bar = el('div', 'bar');
    const title = el('span', 'title', 'Tab Tools');
    const status = el('span', 'status');
    const close = el('button', 'close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Zamknij panel');
    bar.appendChild(title);
    bar.appendChild(status);
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

    const providerLabel = el('label', null, 'Provider');
    const provider = el('select', 'provider');
    PROVIDERS.forEach((id) => {
      const option = el('option', null, PROVIDER_LABEL[id]);
      option.value = id;
      provider.appendChild(option);
    });
    providerLabel.appendChild(provider);

    const keyLabel = el('label', null, 'Klucz API');
    const key = el('input', 'key');
    key.type = 'password';
    key.autocomplete = 'off';
    key.spellcheck = false;
    key.placeholder = 'wklej klucz';
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
    shadow.appendChild(fab);
    shadow.appendChild(panel);

    (document.body || document.documentElement).appendChild(host);

    ui = {
      host: host, fab: fab, panel: panel, status: status, answer: answer,
      buttons: buttons, settings: panelSettings, chip: selChip, chipText: selText,
      provider: provider, key: key, model: model, hint: hint, file: file
    };

    fab.addEventListener('click', () => {
      if (panel.hidden) openPanel();
      else closePanel();
    });

    close.addEventListener('click', () => closePanel());

    selDrop.addEventListener('click', () => {
      clearSelection();
      refreshSelChip();
      updateArmed();
    });

    provider.addEventListener('change', fillKeyFields);

    save.addEventListener('click', async () => {
      const chosen = PROVIDERS.indexOf(provider.value) !== -1 ? provider.value : 'gemini';
      const patch = { provider: chosen, keys: {}, models: {} };
      patch.keys[chosen] = key.value.trim();
      patch.models[chosen] = model.value.trim() || 'auto';
      await saveSettings(patch);
      hint.textContent = key.value.trim() ? 'Zapisano' : 'Zapisano bez klucza';
      setTimeout(() => { hint.textContent = ''; }, 2000);
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
    ui.key.value = s.keys[ui.provider.value] || '';
    const chosen = s.models[ui.provider.value];
    ui.model.value = chosen && chosen !== 'auto' ? chosen : '';
  }

  function say(text, bad) {
    if (!ui) return;
    ui.status.textContent = text || '';
    ui.status.className = bad ? 'status bad' : 'status';
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
      answer.answers.forEach((item, index) => {
        const row = el('div', 'row');
        row.appendChild(el('span', 'badge', (item.label || '').trim() || String.fromCharCode(65 + index)));
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

  async function solveText(text, label) {
    if (busy) return;
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, PAGE_TEXT_LIMIT);
    if (!clean) {
      say('Brak tekstu do wysłania', true);
      return;
    }

    setBusy(true);
    say(label ? 'Analizuję ' + label + '…' : 'Analizuję…');
    renderAnswer(null);

    try {
      let answer = parseAnswer(await askModel(SYS_TEXT, clean, null, SCHEMA_ANSWER));
      if (isEmptyAnswer(answer)) {
        answer = parseAnswer(await askModel(SYS_TEXT, clean + RETRY_EMPTY, null, SCHEMA_ANSWER));
      }
      if (isEmptyAnswer(answer)) throw new Error('Model nie odczytał pytania — spróbuj ponownie');
      renderAnswer(finalizeSingle(answer));
      say('');
    } catch (err) {
      say(msgOf(err), true);
      ui.answer.replaceChildren(el('p', 'err', msgOf(err)));
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
      const userText = imageUserText();
      let answer = parseAnswer(await askModel(SYS_IMAGE, userText, img, SCHEMA_ANSWER));
      if (isEmptyAnswer(answer)) {
        answer = parseAnswer(await askModel(SYS_IMAGE, userText + RETRY_EMPTY, img, SCHEMA_ANSWER));
      }
      if (isEmptyAnswer(answer)) throw new Error('Model nie odczytał pytania — spróbuj ponownie');
      renderAnswer(finalizeSingle(answer));
      say('');
    } catch (err) {
      say(msgOf(err), true);
      ui.answer.replaceChildren(el('p', 'err', msgOf(err)));
    } finally {
      setBusy(false);
    }
  }

  /* ---------- start ---------- */

  function start() {
    mount();
    document.addEventListener('selectionchange', onSelectionChange, true);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    updateArmed();
    getSettings().then(() => { if (ui) fillKeyFields(); }).catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
