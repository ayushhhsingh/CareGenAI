/* CareGen AI frontend.
 *
 * The Flask API is the authoritative engine. When the page is opened directly
 * from disk (file://) there is no API, so an equivalent client-side engine —
 * a direct mirror of backend/core.py — takes over and the status pill switches
 * to "offline dataset" so nothing is silently presented as live data.
 */
'use strict';

const DATA = Array.isArray(window.MEDICINE_DATA) ? window.MEDICINE_DATA : [];
const META = window.MEDICINE_META || {};

const TYPE_LABEL = {
  'jan-aushadhi': 'Jan Aushadhi (PMBJP)',
  'generic': 'Unbranded generic',
  'branded-generic': 'Branded generic',
  'branded': 'Branded',
};
const TYPE_TAG = {
  'jan-aushadhi': 'tag-jan',
  'generic': 'tag-generic',
  'branded-generic': 'tag-bgeneric',
  'branded': 'tag-branded',
};
const TYPE_ORDER = { 'jan-aushadhi': 0, 'generic': 1, 'branded-generic': 2, 'branded': 3 };

const state = { mode: 'local', current: null, units: 30, sort: 'unit_price',
                onlyGeneric: false, onlyCheaper: false, data: null };

/* ------------------------------------------------------------- utilities */

const $ = (sel) => document.querySelector(sel);
const rupee = (n) => '₹' + Number(n).toFixed(2);
const rupee0 = (n) => '₹' + Math.round(Number(n)).toLocaleString('en-IN');

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

/* ------------------------------------------- local engine (mirrors core.py) */

function normalize(text) {
  return String(text == null ? '' : text)
    .normalize('NFKD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase().replace(/[^a-z0-9./+% ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const FORM_ALIASES = { tab: 'tablet', tabs: 'tablet', cap: 'capsule', caps: 'capsule',
                       susp: 'syrup', suspension: 'syrup' };

function normalizeForm(form) {
  const f = normalize(form);
  return FORM_ALIASES[f] || f;
}

function strengthOf(salt) {
  if (salt.s == null) return '';
  return `${salt.s}${salt.u || ''}`;
}

function compositionKey(med, withStrength = true, withForm = true) {
  const tokens = (med.salts || []).map((s) => (
    withStrength ? `${normalize(s.n)}@${normalize(strengthOf(s))}` : normalize(s.n)
  )).sort();
  const key = tokens.join('+');
  return withForm ? `${normalizeForm(med.form)}|${key}` : key;
}

function compositionLabel(med) {
  return (med.salts || []).map((s) => `${s.n} ${strengthOf(s)}`.trim()).join(' + ');
}

function unitPrice(med) {
  const pack = Number(med.pack) || 0;
  if (!pack) return Number(med.mrp) || 0;
  return Math.round((Number(med.mrp) / pack) * 10000) / 10000;
}

function courseCost(med, units) {
  const pack = Number(med.pack) || 1;
  const need = Math.max(Number(units) || 0, 0);
  const packs = need ? Math.ceil(need / pack) : 0;
  return { units_needed: need, packs_needed: packs, pack_cost: Number(med.mrp),
           total_cost: +(packs * Number(med.mrp)).toFixed(2),
           exact_cost: +(need * unitPrice(med)).toFixed(2) };
}

function savingsVs(reference, candidate, units) {
  const refUnit = unitPrice(reference);
  const candUnit = unitPrice(candidate);
  const perUnit = Math.round((refUnit - candUnit) * 10000) / 10000;
  const refCourse = courseCost(reference, units).exact_cost;
  const candCourse = courseCost(candidate, units).exact_cost;
  return {
    reference_unit_price: refUnit,
    unit_price: candUnit,
    saving_per_unit: perUnit,
    saving_percent: refUnit ? Math.round((perUnit / refUnit) * 1000) / 10 : 0,
    reference_course_cost: refCourse,
    course_cost: candCourse,
    course_saving: +(refCourse - candCourse).toFixed(2),
    cheaper: perUnit > 0,
  };
}

function affordabilityBand(price, cheapest) {
  if (!cheapest) return 'unknown';
  const ratio = price / cheapest;
  if (ratio <= 1.15) return 'most-affordable';
  if (ratio <= 2.0) return 'affordable';
  if (ratio <= 4.0) return 'moderate';
  return 'expensive';
}

function findAlternatives(reference, strict) {
  if (strict) {
    const target = compositionKey(reference, true, true);
    return DATA.filter((m) => m.id !== reference.id && compositionKey(m, true, true) === target);
  }
  const loose = compositionKey(reference, false, false);
  const exact = compositionKey(reference, true, true);
  return DATA.filter((m) => m.id !== reference.id
    && compositionKey(m, false, false) === loose
    && compositionKey(m, true, true) !== exact);
}

function decorate(med, units) {
  return Object.assign({}, med, {
    manufacturer: med.mfr,
    unit_price: unitPrice(med),
    type_label: TYPE_LABEL[med.type] || med.type,
    composition: compositionLabel(med),
    course: courseCost(med, units),
    rx_required: !!med.rx,
    pack_label: `${med.pack} ${med.packUnit || ''}`.trim(),
  });
}

function rankAlternatives(reference, alternatives, units, sortBy) {
  const pool = [reference].concat(alternatives);
  const cheapest = pool.length ? Math.min.apply(null, pool.map(unitPrice)) : 0;

  const rows = alternatives.map((med) => Object.assign(decorate(med, units), {
    savings: savingsVs(reference, med, units),
    affordability: affordabilityBand(unitPrice(med), cheapest),
    best_value: false,
  }));

  const sorters = {
    unit_price: (a, b) => a.unit_price - b.unit_price
      || (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9),
    savings: (a, b) => b.savings.saving_per_unit - a.savings.saving_per_unit
      || a.unit_price - b.unit_price,
    mrp: (a, b) => a.mrp - b.mrp || a.unit_price - b.unit_price,
    name: (a, b) => normalize(a.brand).localeCompare(normalize(b.brand)),
  };
  rows.sort(sorters[sortBy] || sorters.unit_price);

  const best = rows.find((r) => r.unit_price === cheapest);
  if (best) best.best_value = true;
  return rows;
}

function searchLocal(query, limit) {
  const q = normalize(query);
  if (!q) return [];
  const scored = [];
  DATA.forEach((med) => {
    const brand = normalize(med.brand);
    const salts = normalize((med.salts || []).map((s) => s.n).join(' '));
    const mfr = normalize(med.mfr);
    let score = 0;
    if (brand === q) score = 100;
    else if (brand.startsWith(q)) score = 85;
    else if (brand.includes(q)) score = 70;
    else if (salts.startsWith(q)) score = 60;
    else if (salts.includes(q)) score = 50;
    else if (mfr.includes(q)) score = 25;
    if (score) scored.push({ score, price: unitPrice(med), med });
  });
  scored.sort((a, b) => b.score - a.score || a.price - b.price);
  return scored.slice(0, limit || 25).map((s) => decorate(s.med, state.units));
}

function analyzeLocal(id, units, sortBy) {
  const reference = DATA.find((m) => m.id === id);
  if (!reference) return null;
  const substitutable = rankAlternatives(reference, findAlternatives(reference, true), units, sortBy);
  // Headline saving must not depend on the chosen sort order.
  const cheapest = substitutable
    .filter((r) => r.savings.cheaper)
    .sort((a, b) => b.savings.saving_per_unit - a.savings.saving_per_unit)[0] || null;
  return {
    reference: decorate(reference, units),
    units_considered: units,
    sort: sortBy,
    substitutable,
    substitutable_count: substitutable.length,
    related: rankAlternatives(reference, findAlternatives(reference, false), units, sortBy),
    best_saving: cheapest ? {
      id: cheapest.id, brand: cheapest.brand,
      saving_percent: cheapest.savings.saving_percent,
      course_saving: cheapest.savings.course_saving,
    } : null,
  };
}

function statsLocal() {
  const groups = new Map();
  DATA.forEach((med) => {
    const key = compositionKey(med, true, true);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(med);
  });
  const gaps = [];
  groups.forEach((members) => {
    if (members.length < 2) return;
    const sorted = members.slice().sort((a, b) => unitPrice(a) - unitPrice(b));
    const cheap = sorted[0];
    const pricey = sorted[sorted.length - 1];
    const pu = unitPrice(pricey);
    if (pu <= 0) return;
    gaps.push({
      composition: compositionLabel(pricey), form: pricey.form,
      costliest: { brand: pricey.brand, unit_price: pu },
      cheapest: { brand: cheap.brand, unit_price: unitPrice(cheap),
                  type_label: TYPE_LABEL[cheap.type] || cheap.type },
      saving_percent: Math.round(((pu - unitPrice(cheap)) / pu) * 1000) / 10,
    });
  });
  gaps.sort((a, b) => b.saving_percent - a.saving_percent);
  let comparable = 0;
  groups.forEach((m) => { if (m.length > 1) comparable += 1; });
  return {
    total_medicines: DATA.length,
    total_compositions: groups.size,
    comparable_compositions: comparable,
    jan_aushadhi_products: DATA.filter((m) => m.type === 'jan-aushadhi').length,
    biggest_price_gaps: gaps.slice(0, 10),
  };
}

/* ------------------------------------------------------------- API client */

async function apiGet(path, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const body = await res.json();
    if (!res.ok || !body.success) {
      throw new Error(body && body.error ? body.error.message : `HTTP ${res.status}`);
    }
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}

async function detectMode() {
  const pill = $('#status-pill');
  if (location.protocol === 'file:') {
    state.mode = 'local';
    pill.className = 'pill pill-offline';
    pill.textContent = 'offline dataset';
    pill.title = 'Opened from disk — computed in the browser from data/medicines.js';
    return;
  }
  try {
    const health = await apiGet('/api/health', 3000);
    state.mode = health.database === 'healthy' ? 'api' : 'local';
  } catch (err) {
    state.mode = 'local';
  }
  if (state.mode === 'api') {
    pill.className = 'pill pill-live';
    pill.textContent = 'API connected';
    pill.title = 'Served by the CareGen AI Flask API';
  } else {
    pill.className = 'pill pill-offline';
    pill.textContent = 'offline dataset';
    pill.title = 'API unreachable — falling back to the bundled dataset';
  }
}

async function fetchSuggestions(query) {
  if (state.mode === 'api') {
    try {
      const data = await apiGet(`/api/medicines?q=${encodeURIComponent(query)}&limit=8`);
      return data.results;
    } catch (err) { /* fall through to local */ }
  }
  return searchLocal(query, 8);
}

async function fetchAnalysis(id) {
  if (state.mode === 'api') {
    try {
      return await apiGet(`/api/medicines/${encodeURIComponent(id)}/alternatives`
        + `?units=${state.units}&sort=${state.sort}`);
    } catch (err) {
      toast('API request failed — using the bundled dataset instead.');
    }
  }
  return analyzeLocal(id, state.units, state.sort);
}

async function fetchStats() {
  if (state.mode === 'api') {
    try { return await apiGet('/api/stats'); } catch (err) { /* fall through */ }
  }
  return statsLocal();
}

/* --------------------------------------------------------------- rendering */

function packLabel(row) {
  const size = row.pack != null ? row.pack : '';
  return `${size} ${row.packUnit || row.pack_unit || ''}`.trim() || (row.pack_label || '');
}

function typeTag(row) {
  const cls = TYPE_TAG[row.type] || 'tag-bgeneric';
  const label = row.type_label || TYPE_LABEL[row.type] || row.type;
  return `<span class="tag ${cls}">${esc(label)}</span>`;
}

function renderStats(stats) {
  const gap = stats.biggest_price_gaps && stats.biggest_price_gaps[0];
  const cards = [
    [stats.total_medicines, 'products in the catalogue'],
    [stats.comparable_compositions, 'compositions with a cheaper option'],
    [stats.jan_aushadhi_products, 'Jan Aushadhi (PMBJP) products'],
    [gap ? gap.saving_percent + '%' : '—', 'largest price gap for one composition'],
  ];
  $('#stats').innerHTML = cards.map(([value, label]) => `
    <div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('');
}

function renderReference(ref) {
  const rx = (ref.rx_required || ref.rx)
    ? '<span class="tag tag-rx">Prescription only</span>' : '';
  $('#ref-card').innerHTML = `
    <div class="ref">
      <div class="ref-block" style="flex:1 1 260px">
        <h2>${esc(ref.brand)} ${typeTag(ref)} ${rx}</h2>
        <p class="ref-sub">${esc(ref.mfr || ref.manufacturer || 'Manufacturer not recorded')}
           · ${esc(ref.class || 'Class not recorded')}</p>
        <p class="ref-sub">${esc(ref.uses || '')}</p>
      </div>
      <dl>
        <div class="ref-block">
          <dt>Salt composition</dt><dd>${esc(ref.composition)}</dd>
          <dt>Dosage form</dt><dd>${esc(ref.form)}</dd>
        </div>
        <div class="ref-block">
          <dt>Pack</dt><dd>${esc(packLabel(ref))} · ${rupee(ref.mrp)}</dd>
          <dt>Cost per unit</dt><dd>${rupee(ref.unit_price)}</dd>
        </div>
      </dl>
    </div>`;
}

function altRow(row, referenceBrand) {
  const s = row.savings;
  const saveClass = s.cheaper ? 'a-save' : 'a-save is-costlier';
  const saveText = s.cheaper
    ? `${s.saving_percent}% cheaper`
    : (s.saving_per_unit === 0 ? 'same price' : `${Math.abs(s.saving_percent)}% costlier`);
  const courseText = s.cheaper
    ? `saves ${rupee0(s.course_saving)} per ${row.course.units_needed} units`
    : `${rupee0(Math.abs(s.course_saving))} more per ${row.course.units_needed} units`;
  const bestTag = row.best_value ? '<span class="tag tag-best">Best value</span>' : '';
  const rx = (row.rx_required || row.rx) ? '<span class="tag tag-rx">Rx</span>' : '';
  return `
    <article class="alt ${row.best_value ? 'is-best' : ''}" data-band="${esc(row.affordability || 'unknown')}">
      <div class="a-main">
        <div class="a-brand">${esc(row.brand)} ${typeTag(row)} ${bestTag} ${rx}</div>
        <div class="a-meta">${esc(row.mfr || row.manufacturer || 'Manufacturer not recorded')}
          · ${esc(row.composition)} · ${esc(row.form)}</div>
      </div>
      <div>
        <div class="a-col-label">Pack MRP</div>
        <div class="a-num">${rupee(row.mrp)}<span class="a-sub"> / ${esc(packLabel(row))}</span></div>
      </div>
      <div>
        <div class="a-col-label">Per unit</div>
        <div class="a-num">${rupee(row.unit_price)}</div>
      </div>
      <div>
        <div class="a-col-label">Vs ${esc(referenceBrand)}</div>
        <div class="${saveClass}">${esc(saveText)}</div>
        <div class="a-sub">${esc(courseText)}</div>
      </div>
    </article>`;
}

function applyFilters(rows) {
  return rows.filter((row) => {
    if (state.onlyGeneric && !['generic', 'jan-aushadhi'].includes(row.type)) return false;
    if (state.onlyCheaper && !row.savings.cheaper) return false;
    return true;
  });
}

const TABLE_HEAD = `<div class="table-head">
  <div>Product</div><div>Pack MRP</div><div>Per unit</div><div>Compared with yours</div></div>`;

function renderResults(data) {
  state.data = data;
  const ref = data.reference;
  renderReference(ref);

  const rows = applyFilters(data.substitutable);
  const banner = $('#savings-banner');

  if (!data.substitutable.length) {
    banner.innerHTML = `<div class="banner banner-warn">
      No other product in this catalogue has the identical salt, strength and form as
      <b>${esc(ref.brand)}</b>. That does not mean none exists — ask your pharmacist to check the
      current substitute list.</div>`;
  } else if (data.best_saving) {
    const b = data.best_saving;
    banner.innerHTML = `<div class="banner banner-good">
      Cheapest identical option: <b>${esc(b.brand)}</b> — about <b>${esc(b.saving_percent)}%</b>
      less per unit, roughly <b>${rupee0(b.course_saving)}</b> saved over
      ${esc(ref.course.units_needed)} units. Estimated from indicative prices; confirm at the pharmacy.
      </div>`;
  } else {
    banner.innerHTML = `<div class="banner banner-warn">
      ${data.substitutable.length} product(s) share this exact composition, but none is cheaper than
      <b>${esc(ref.brand)}</b> in this catalogue.</div>`;
  }

  $('#alt-list').innerHTML = rows.length
    ? TABLE_HEAD + rows.map((row) => altRow(row, ref.brand)).join('')
    : `<div class="empty">No product matches the filters you selected.</div>`;

  const related = data.related || [];
  $('#related-wrap').innerHTML = !related.length ? '' : `
    <h3 style="margin-top:1.75rem;font-size:1.05rem">Same ingredient, different strength or form</h3>
    <p class="note">Listed for reference only. These are <strong>not</strong> substitutes for
      ${esc(ref.brand)} — only a prescriber can change a strength or dosage form.</p>
    ${related.map((row) => altRow(row, ref.brand)).join('')}`;

  $('#results').hidden = false;
}

/* ---------------------------------------------------------------- actions */

async function selectMedicine(id, { scroll = true } = {}) {
  const data = await fetchAnalysis(id);
  if (!data) { toast('That medicine is not in the catalogue.'); return; }
  state.current = id;
  renderResults(data);
  if (scroll) $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideSuggestions() {
  const box = $('#suggestions');
  box.hidden = true;
  box.innerHTML = '';
}

function renderSuggestions(items) {
  const box = $('#suggestions');
  if (!items.length) {
    box.innerHTML = '<li aria-disabled="true">No match in the catalogue.</li>';
    box.hidden = false;
    return;
  }
  box.innerHTML = items.map((item) => `
    <li role="option" data-id="${esc(item.id)}">
      <span class="s-brand">${esc(item.brand)}</span>
      <span class="s-meta">${esc(item.composition)} · ${esc(item.form)}
        · ${rupee(item.unit_price)}/unit</span>
    </li>`).join('');
  box.hidden = false;
}

let suggestTimer = null;
function onQueryInput(event) {
  const query = event.target.value.trim();
  clearTimeout(suggestTimer);
  if (query.length < 2) { hideSuggestions(); return; }
  suggestTimer = setTimeout(async () => {
    try {
      renderSuggestions(await fetchSuggestions(query));
    } catch (err) {
      hideSuggestions();
    }
  }, 160);
}

async function onSubmit(event) {
  event.preventDefault();
  const query = $('#q').value.trim();
  if (!query) { toast('Type a brand or salt name first.'); return; }
  hideSuggestions();
  const results = await fetchSuggestions(query);
  if (!results.length) {
    toast(`"${query}" is not in this catalogue. Try a salt name such as paracetamol.`);
    return;
  }
  selectMedicine(results[0].id);
}

function renderQuickChips() {
  const picks = ['Dolo 650', 'Augmentin 625 Duo', 'Pan 40', 'Telma 40', 'Montek LC',
                 'Thyronorm 50', 'Glycomet SR 500', 'Azithral 500'];
  const available = picks.filter((name) => DATA.some((m) => m.brand === name));
  $('#quick-chips').innerHTML = available
    .map((name) => `<button type="button" class="chip" data-q="${esc(name)}">${esc(name)}</button>`)
    .join('');
}

function renderSaltChips() {
  const counts = new Map();
  DATA.forEach((med) => (med.salts || []).forEach((salt) => {
    counts.set(salt.n, (counts.get(salt.n) || 0) + 1);
  }));
  const salts = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  $('#salt-chips').innerHTML = salts.map(([name, count]) =>
    `<button type="button" class="chip" data-salt="${esc(name)}">${esc(name)}
       <span style="color:var(--ink-faint)">· ${count}</span></button>`).join('');
}

function openSalt(saltName) {
  const matches = DATA.filter((m) => (m.salts || []).some((s) => s.n === saltName));
  if (!matches.length) return;
  // Use the costliest product as the reference so savings are shown against the
  // most expensive option a patient might be handed.
  const reference = matches.slice().sort((a, b) => unitPrice(b) - unitPrice(a))[0];
  $('#q').value = reference.brand;
  selectMedicine(reference.id);
}

function renderFooterMeta() {
  const parts = [];
  if (META.dataset) parts.push(esc(META.dataset));
  if (META.priceAsOf) parts.push(`prices as recorded on ${esc(META.priceAsOf)}`);
  parts.push(`${DATA.length} products`);
  $('#footer-meta').innerHTML = `${parts.join(' · ')}<br />${esc(META.note || '')}`;
}

/* ------------------------------------------------------------------- wiring */

function wireEvents() {
  $('#search-form').addEventListener('submit', onSubmit);
  $('#q').addEventListener('input', onQueryInput);
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Escape') hideSuggestions(); });

  $('#suggestions').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    hideSuggestions();
    selectMedicine(li.dataset.id);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchbar')) hideSuggestions();

    const chip = e.target.closest('[data-q]');
    if (chip) {
      $('#q').value = chip.dataset.q;
      onSubmit(new Event('submit'));
      return;
    }
    const saltChip = e.target.closest('[data-salt]');
    if (saltChip) openSalt(saltChip.dataset.salt);
  });

  $('#units').addEventListener('change', (e) => {
    const value = parseInt(e.target.value, 10);
    state.units = Number.isFinite(value) ? Math.min(Math.max(value, 1), 365) : 30;
    e.target.value = state.units;
    if (state.current) selectMedicine(state.current, { scroll: false });
  });

  $('#sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    if (state.current) selectMedicine(state.current, { scroll: false });
  });

  $('#f-generic').addEventListener('change', (e) => {
    state.onlyGeneric = e.target.checked;
    if (state.data) renderResults(state.data);
  });

  $('#f-cheaper').addEventListener('change', (e) => {
    state.onlyCheaper = e.target.checked;
    if (state.data) renderResults(state.data);
  });
}

async function init() {
  if (!DATA.length) {
    $('#stats').innerHTML = '<div class="empty">Dataset failed to load '
      + '(data/medicines.js). Serve the app with the Flask backend or keep the '
      + 'folder structure intact.</div>';
    return;
  }
  renderQuickChips();
  renderSaltChips();
  renderFooterMeta();
  wireEvents();
  await detectMode();
  renderStats(await fetchStats());
}

document.addEventListener('DOMContentLoaded', init);
