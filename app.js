// Selma — a slow work journal.
// Open the day with an intention, note the sittings, catch the insights, close the book.
// Everything is stored in this browser (localStorage); there is no server.

const STORE_KEY = 'selma-work.v1';
const BACKUP_KEY = 'selma-work.backup'; // the day the last backup was saved
const TRAIL_WEEKS = 5;
const NUDGE_AT = '21:00'; // from here on, Today suggests closing the book

// Where notes from a sitting can live. "Other" is always offered as well.
const PLACES = ['Marginalia', 'Lochby', 'Travelers', 'Simplenote'];

// The kinds of memo. One can be chosen, or none.
const MEMO_TAGS = ['Analytic', 'Theoretical', 'Methodological', 'Reflexive', 'Decision'];

// The kinds of work. A sitting can be several at once.
const MODES = [
  { id: 'reading', name: 'Reading' },
  { id: 'writing', name: 'Writing' },
  { id: 'freewriting', name: 'Freewriting' }, // thinking on paper: journaling, brainstorming, jotting
  { id: 'literature', name: 'Desk research' }, // finding and gathering sources, as distinct from reading them
  { id: 'fieldwork', name: 'Fieldwork' },
  { id: 'analysis', name: 'Analysis' },
  { id: 'clauding', name: 'Clauding' }, // brainstorming and building with Claude
];

const state = loadState();
// What the notebook is showing: kind is '', 'insights', 'memos' or a mode id; home is a sitting's
// home; tag is a kind of memo.
const notebookFilter = { kind: '', home: '', tag: '' };
let trailDay = null;     // the day opened on the trail
let editingIntention = false;

const $ = (sel) => document.querySelector(sel);
const sittingDialog = $('#sitting-dialog');
const sittingForm = $('#sitting-form');
const noteDialog = $('#note-dialog');
const noteForm = $('#note-form');

function blankState() {
  return { days: {}, sittings: [], insights: [], noteDrafts: {}, weeks: {} };
}

function loadState() {
  try {
    return { ...blankState(), ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch {
    return blankState();
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    toast('This browser would not save that.');
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Days are keyed by the local date, e.g. 2026-10-12.
function dayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
function keyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const longDate = (key) => keyDate(key).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
const nowHHMM = () => new Date().toTimeString().slice(0, 5);
// Late runs from the nudge until early morning, so work past midnight still counts as late.
const isLate = () => nowHHMM() >= NUDGE_AT || nowHHMM() < '05:00';
const daysBetween = (a, b) => Math.round((keyDate(b) - keyDate(a)) / 864e5);
const isWeekend = (key = dayKey()) => [0, 6].includes(keyDate(key).getDay());
const today = () => (state.days[dayKey()] ||= {});

// Weeks run Monday to Sunday and are keyed by their Monday.
function mondayOf(key) {
  const d = keyDate(key);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d);
}
function addDays(key, n) {
  const d = keyDate(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
const inWeek = (day, monday) => day >= monday && day <= addDays(monday, 6);

// When an entry was made. Ids begin with the time, so the earliest entries without `at` still sort.
const madeAt = (entry) => entry.at || parseInt(entry.id.slice(0, -4), 36) || 0;

// The most recent "pick up next" note from before today.
function leftOff() {
  const key = Object.keys(state.days).filter((k) => k < dayKey() && state.days[k].closing).sort().pop();
  return key ? state.days[key].closing : '';
}

// A planned rest: set aside on purpose, and only while no work is noted for it.
const isRest = (key) => !!state.days[key]?.rest && !state.sittings.some((s) => s.day === key);

// A day has "touched the dissertation" when any sitting was for it, or had no home yet.
const touches = (s) => s.thread === 'dissertation' || s.thread === 'none';

/* ---------- Entries ---------- */

function modeDots(ids) {
  return ids.map((id) => {
    const m = MODES.find((x) => x.id === id);
    return m ? `<span class="dot" style="--c: var(--${m.id})">${m.name}</span>` : '';
  }).join('');
}

function threadLabel(s) {
  if (s.thread === 'none') return 'no home yet';
  if (s.thread === 'tud') return 'TUD';
  if (s.thread === 'other') return s.threadName || 'something else';
  return 'dissertation';
}

function sittingHTML(s) {
  return `<li class="entry">
    <div class="body">
      <span class="modes">${modeDots(s.modes)}</span><span class="thread">${esc(threadLabel(s))}</span>
      ${s.note ? `<p>${esc(s.note)}</p>` : ''}
      ${notesIn(s) ? `<p class="paper">Notes: ${esc(notesIn(s))}</p>` : ''}
    </div>
    <span class="tools">
      <button class="btn danger" data-action="edit-sitting" data-id="${s.id}">Edit</button>
      <button class="btn danger" data-action="remove-sitting" data-id="${s.id}">Remove</button>
    </span>
  </li>`;
}

const notesIn = (s) => [...(s.places || []), s.paper].filter(Boolean).join(', ');

// An insight is a quick thought; a memo is a longer one, folded under its title.
function insightHTML(i) {
  const memo = i.kind === 'memo';
  const text = `<p>${esc(i.text)}</p>`;
  return `<li class="entry insight">
    <div class="body">
      <span class="kind">${memo ? `Memo${i.tag ? ` · ${esc(i.tag)}` : ''}` : 'Insight'}${i.flag ? '<span class="flagged"> · to revisit</span>' : ''}</span>
      ${memo ? `<details><summary>${esc(i.title || 'Untitled')}</summary>${text}</details>` : text}
      ${i.source ? `<span class="source">From: ${esc(i.source)}</span>` : ''}
    </div>
    <span class="tools">
      <button class="btn danger" data-action="flag-note" data-id="${i.id}">${i.flag ? 'Done' : 'Revisit'}</button>
      <button class="btn danger" data-action="edit-note" data-id="${i.id}">Edit</button>
      <button class="btn danger" data-action="remove-insight" data-id="${i.id}">Remove</button>
    </span>
  </li>`;
}

function entriesHTML(key, { kind = '', home = '', tag = '' } = {}) {
  const notesOnly = kind === 'insights' || kind === 'memos' || kind === 'flagged';
  const sittings = notesOnly ? [] : state.sittings.filter((s) => s.day === key
    && (!kind || s.modes.includes(kind)) && (!home || s.thread === home));
  // Insights and memos have no home, so a home filter shows sittings only.
  const insights = (kind && !notesOnly) || home ? [] : state.insights.filter((i) => i.day === key
    && (kind === 'flagged' ? i.flag : !kind || (i.kind === 'memo') === (kind === 'memos')) && (!tag || i.tag === tag));
  if (!sittings.length && !insights.length) return '';
  // Sittings and insights sit together in the order they happened.
  const all = [...sittings.map((s) => [s, sittingHTML]), ...insights.map((i) => [i, insightHTML])];
  all.sort((a, b) => madeAt(a[0]) - madeAt(b[0]));
  return `<ul class="entries">${all.map(([entry, html]) => html(entry)).join('')}</ul>`;
}

/* ---------- Today ---------- */

function renderGreeting() {
  const h = new Date().getHours();
  const closed = today().closed;
  const resting = isRest(dayKey());
  if (isWeekend()) {
    const sunday = new Date().getDay() === 0;
    $('#greeting').textContent = sunday ? 'Happy Sunday.' : 'Happy Saturday.';
    $('#today-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    $('#greeting-sub').textContent = sunday ? 'A look back, a word for Monday, and then the day is yours.' : 'Let the week settle. Nothing is asked of today.';
    return;
  }
  $('#greeting').textContent = resting ? 'Rest well.' : closed ? 'Well done.' : h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.';
  $('#today-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  $('#greeting-sub').textContent = resting ? 'Nothing is asked of today.' : closed ? 'The rest of the day is yours.' : 'One small touch is enough.';
}

function renderToday() {
  renderGreeting();
  const day = today();
  const key = dayKey();

  if (isWeekend()) {
    $('#today').innerHTML = weekendHTML();
    return;
  }

  if (day.closed) {
    $('#today').innerHTML = `<div class="closed">
      <img src="selma-work.svg" alt="" width="96" height="96">
      <h3>The book is closed.</h3>
      ${day.closing ? `<p class="said"><b>Next</b> <em>${esc(day.closing)}</em></p>` : ''}
      <p>Work will keep until tomorrow. Selma has other journals for the evening.</p>
      <div class="actions">
        <a class="link" href="../selma-time/">Slow time journal</a>
        <a class="link" href="../selma-mail/">Mail journal</a>
        <button class="link" data-action="reopen">Reopen the book</button>
      </div>
    </div>${weekHTML()}`;
    return;
  }

  if (isRest(key)) {
    $('#today').innerHTML = `<div class="closed">
      <img src="selma-work.svg" alt="" width="96" height="96">
      <h3>A day of rest.</h3>
      <p>The book stays shut today, on purpose. Selma has other journals for a day like this.</p>
      <div class="actions">
        <a class="link" href="../selma-time/">Slow time journal</a>
        <a class="link" href="../selma-mail/">Mail journal</a>
        <button class="link" data-action="toggle-rest" data-day="${key}">Work today after all</button>
      </div>
    </div>${weekHTML()}`;
    return;
  }

  const late = isLate();
  const entries = entriesHTML(key);
  const pickUp = leftOff();

  $('#today').innerHTML = `
    ${backupDue() ? `<p class="nudge quiet">${localStorage.getItem(BACKUP_KEY) ? 'It has been a while since the last backup.' : 'This journal has not been backed up yet.'}
      <button class="link" data-action="export">Save a backup</button><button class="link" data-action="backup-later">Later</button></p>` : ''}
    ${late ? `<p class="nudge">It is past ${NUDGE_AT}. The rest can wait until tomorrow.</p>` : ''}

    <div class="card">
      <p class="eyebrow">Opening</p>
      ${pickUp ? `<p class="left-off"><b>Where you left off:</b> ${esc(pickUp)}</p>` : ''}
      ${revisitHTML()}
      ${day.intention && !editingIntention
        ? `<p class="said">${esc(day.intention)}</p>
           <p class="aside"><button class="link" data-action="edit-intention">Change</button></p>`
        : `<form class="stack" id="intention-form">
             <label>What is today's work for?
               <input type="text" name="intention" autocomplete="off" maxlength="200" value="${esc(day.intention || day.draft || '')}">
             </label>
             <button class="btn primary">Open the book</button>
           </form>
           ${day.intention ? '' : `<p class="aside"><button class="link" data-action="toggle-rest" data-day="${key}">Make today a day of rest</button></p>`}`}
    </div>

    ${weekHTML()}

    ${!day.intention ? '' : `
    <div class="card">
      <p class="eyebrow">Sittings</p>
      ${entries || '<p class="quiet-note">Nothing noted yet. Fifteen minutes of reading counts.</p>'}
      <div class="actions">
        <button class="btn" data-action="note-sitting">Note a sitting</button>
        <button class="btn" data-action="write-memo">Write a memo</button>
      </div>
    </div>

    <div class="card">
      <p class="eyebrow">Closing</p>
      <form class="stack" id="closing-form">
        <label>Where can you pick up next?
          <textarea name="closing" rows="2" maxlength="600">${esc(day.closing || '')}</textarea>
        </label>
        <button class="btn primary">Close the book</button>
      </form>
    </div>`}`;
}

// Insights and memos flagged to revisit wait at the top of the Opening card until marked done.
// At the weekend they have a card of their own.
function revisitHTML(card = false) {
  const flagged = state.insights.filter((i) => i.flag).sort((a, b) => madeAt(a) - madeAt(b));
  if (!flagged.length) return '';
  const label = (i) => (i.kind === 'memo' && i.title ? i.title : i.text.length > 90 ? i.text.slice(0, 88).trimEnd() + '…' : i.text);
  return `<div class="${card ? 'card ' : ''}come-back">
    ${card ? '<p class="eyebrow">To revisit</p>' : '<p class="left-off"><b>To revisit</b></p>'}
    <ul>${flagged.map((i) => `<li>
      <button class="link" data-action="edit-note" data-id="${i.id}">${esc(label(i))}</button>
      <button class="link quiet" data-action="flag-note" data-id="${i.id}">Done</button>
    </li>`).join('')}</ul>
  </div>`;
}

// At the weekend, a look back over the week: the kinds of work, its insights and memos, and one question.
// On Monday, last week's look-back stays open if it was missed and there was something in it.
function lookBackWeek() {
  const key = dayKey();
  const weekday = keyDate(key).getDay();
  if (isWeekend(key)) return mondayOf(key);
  if (weekday === 1) {
    const last = addDays(key, -7);
    const had = [...state.sittings, ...state.insights].some((e) => inWeek(e.day, last));
    if (had && !state.weeks[last]?.text) return last;
  }
  return '';
}

function weekHTML() {
  const monday = lookBackWeek();
  if (!monday) return '';
  const sittings = state.sittings.filter((s) => inWeek(s.day, monday));
  const notes = state.insights.filter((i) => inWeek(i.day, monday)).sort((a, b) => a.day.localeCompare(b.day) || madeAt(a) - madeAt(b));
  const modes = MODES.filter((m) => sittings.some((s) => s.modes.includes(m.id))).map((m) => m.id);
  // Sunday's word for Monday is kept as the day's "pick up next", so Monday opens with it.
  const sunday = keyDate(dayKey()).getDay() === 0;
  return `<div class="card week">
    <p class="eyebrow">${monday === mondayOf(dayKey()) ? 'This week' : 'Last week'}</p>
    ${modes.length ? `<p class="week-modes">${modeDots(modes)}</p>` : ''}
    ${notes.length ? `<ul class="entries">${notes.map(insightHTML).join('')}</ul>` : '<p class="quiet-note">No insights or memos this week. That is alright too.</p>'}
    <form class="stack" id="week-form">
      <label>What's taking shape?
        <textarea name="week" data-week="${monday}" rows="3" maxlength="2000">${esc(state.weeks[monday]?.text || '')}</textarea>
      </label>
      ${sunday ? `<label>Where will Monday begin?
        <textarea name="closing" rows="2" maxlength="600">${esc(today().closing || '')}</textarea>
      </label>` : ''}
    </form>
  </div>`;
}

// Saturdays and Sundays are not for working the way weekdays are. There is no book to open:
// the week comes first, then whatever is waiting to be revisited, and a quiet place at the
// end for anything that comes along anyway.
function weekendHTML() {
  const key = dayKey();
  const entries = entriesHTML(key);
  const worked = state.sittings.some((s) => s.day === key);
  return `
    ${backupDue() ? `<p class="nudge quiet">${localStorage.getItem(BACKUP_KEY) ? 'It has been a while since the last backup.' : 'This journal has not been backed up yet.'}
      <button class="link" data-action="export">Save a backup</button><button class="link" data-action="backup-later">Later</button></p>` : ''}
    ${weekHTML()}
    ${revisitHTML(true)}
    ${mailHTML()}
    ${keyDate(key).getDay() === 0 ? craftHTML() : ''}
    <div class="card">
      <p class="eyebrow">If something comes to you</p>
      ${entries || '<p class="quiet-note">Nothing is needed here.</p>'}
      <div class="actions">
        <button class="btn" data-action="note-sitting">Note a sitting</button>
        <button class="btn" data-action="write-memo">Write a memo</button>
      </div>
      ${worked ? '' : `<p class="aside">${isRest(key) ? 'Set aside for rest. ' : ''}<button class="link" data-action="toggle-rest" data-day="${key}">${state.days[key]?.rest ? 'Not a rest day after all' : 'Make today a day of rest'}</button></p>`}
    </div>
    <div class="elsewhere">
      <p>Selma has other journals for the weekend.</p>
      <div class="actions">
        <a class="link" href="../selma-time/">Slow time journal</a>
        <a class="link" href="../selma-read/">Reading journal</a>
        <a class="link" href="../selma-mail/">Mail journal</a>
      </div>
    </div>`;
}

// One letter a week. The mail journal shares this browser's storage, so its write-next list
// and mailings are read from there (never changed): logging a letter in the mail journal is
// what closes the loop here.
function mailHTML() {
  let mail = {};
  try { mail = JSON.parse(localStorage.getItem('selma-mail.v1')) || {}; } catch {}
  const monday = mondayOf(dayKey());
  const sent = (mail.mailings || []).filter((m) => m.sentDate && inWeek(m.sentDate, monday));
  const list = [...(mail.writeNext || [])].sort((a, b) => (a.addedDate || '').localeCompare(b.addedDate || ''));
  const names = (items) => items.map((x) => esc(x.toName || x.name)).filter(Boolean);
  let body;
  if (sent.length) {
    const to = [...new Set(names(sent))];
    body = `<p class="said">This week's ${sent.length > 1 ? 'mail is' : sent[0].type === 'postcard' ? 'postcard is' : 'letter is'} on its way${to.length ? ` to ${to.join(' and ')}` : ''}.</p>`;
  } else {
    body = `<p class="said">Who's getting a letter this weekend?</p>
      ${list.length
        ? `<p class="quiet-note">On your write-next list: ${names(list.slice(0, 5)).join(', ')}${list.length > 5 ? ', and more' : ''}.</p>`
        : '<p class="quiet-note">Your write-next list is empty. Who comes to mind?</p>'}`;
  }
  return `<div class="card mail">
    <p class="eyebrow">Snail mail</p>
    ${body}
    <p class="aside"><a class="link" href="../selma-mail/">${sent.length ? 'Mail journal' : 'Open the mail journal'}</a></p>
  </div>`;
}

// On Sundays, a word on anything made by hand. It sits with the week, not with the work.
function craftHTML() {
  const monday = mondayOf(dayKey());
  return `<div class="card">
    <p class="eyebrow">Made by hand</p>
    <form class="stack" id="craft-form">
      <label>Did you make anything this week? <span class="optional">optional</span>
        <textarea name="craft" data-week="${monday}" rows="2" maxlength="1000">${esc(state.weeks[monday]?.craft || '')}</textarea>
      </label>
    </form>
  </div>`;
}

/* ---------- Notebook ---------- */

function chips(name, legend, options, current) {
  return `<fieldset class="segmented"><legend>${legend}</legend>${options.map(([value, label]) => {
    const dot = MODES.some((m) => m.id === value) ? ` class="dot" style="--c: var(--${value})"` : '';
    return `<label><input type="radio" name="${name}" value="${value}"${value === current ? ' checked' : ''}><span${dot}>${label}</span></label>`;
  }).join('')}</fieldset>`;
}

function renderFilter() {
  const { kind, home, tag } = notebookFilter;
  const kinds = [['', 'Everything'], ['insights', 'Insights'], ['memos', 'Memos'], ['flagged', 'To revisit'], ...MODES.map((m) => [m.id, m.name])];
  const homes = [['', 'Anywhere'], ['dissertation', 'Dissertation'], ['none', 'No home yet'], ['tud', 'TUD'], ['other', 'Something else']];
  const tags = [['', 'Any kind'], ...MEMO_TAGS.map((t) => [t, t])];
  $('#notebook-filter').innerHTML = chips('filter', 'Leaf through', kinds, kind)
    + (kind === 'insights' || kind === 'memos' || kind === 'flagged' ? '' : chips('home', 'Belonging to', homes, home))
    + (kind === 'memos' ? chips('tag', 'Kind of memo', tags, tag) : '');
}

function dayHTML(key, filter = {}) {
  const day = state.days[key] || {};
  const entries = entriesHTML(key, filter);
  filter = filter.kind || filter.home; // the bookends only show when nothing is filtered
  const sunday = keyDate(key).getDay() === 0 ? state.weeks[mondayOf(key)] || {} : {};
  const week = sunday.text, craft = sunday.craft;
  const bookends = !filter && (day.intention || day.closing || week || craft);
  if (!entries && !bookends) return '';
  return `<article class="day">
    <h3>${longDate(key)}</h3>
    ${!filter && day.intention ? `<p class="bookend"><b>For</b>${esc(day.intention)}</p>` : ''}
    ${entries}
    ${!filter && day.closing ? `<p class="bookend"><b>Pick up next</b>${esc(day.closing)}</p>` : ''}
    ${!filter && week ? `<p class="bookend"><b>This week, taking shape</b>${esc(week)}</p>` : ''}
    ${!filter && craft ? `<p class="bookend"><b>Made by hand</b>${esc(craft)}</p>` : ''}
  </article>`;
}

function allDays() {
  const keys = new Set([...Object.keys(state.days), ...state.sittings.map((s) => s.day), ...state.insights.map((i) => i.day),
    ...Object.keys(state.weeks).filter((m) => state.weeks[m].text || state.weeks[m].craft).map((m) => addDays(m, 6))]);
  return [...keys].sort().reverse();
}

function renderNotebook() {
  renderFilter();
  const html = allDays().map((key) => dayHTML(key, notebookFilter)).join('');
  $('#notebook').innerHTML = html || '<p class="quiet-note">Nothing on these pages yet.</p>';
}

/* ---------- Trail ---------- */

// One mark per day, in the colours of all the day's work: a full circle when the dissertation
// was touched, a ring when the work was all for something else, a crescent for a planned rest,
// a small dot otherwise.
function markHTML(key, todayKey) {
  const sittings = state.sittings.filter((s) => s.day === key);
  const touched = sittings.filter(touches);
  let cls = 'rest', fill = '', what = 'nothing noted';
  if (key > todayKey) {
    cls = isRest(key) ? 'planned' : 'ahead';
    what = isRest(key) ? 'a planned rest' : 'still ahead';
  } else if (sittings.length) {
    const modes = MODES.filter((m) => sittings.some((s) => s.modes.includes(m.id)));
    const step = 100 / modes.length;
    fill = modes.length > 1
      ? `conic-gradient(${modes.map((m, i) => `var(--${m.id}) ${i * step}% ${(i + 1) * step}%`).join(', ')})`
      : `var(--${modes[0].id})`;
    cls = touched.length ? 'touched' : 'other';
    what = modes.map((m) => m.name.toLowerCase()).join(', ') + (touched.length ? '; the dissertation was touched' : '; other work');
  } else if (isRest(key)) {
    cls = 'planned';
    what = 'a planned rest';
  }
  return `<button class="mark ${cls}${key === todayKey ? ' today' : ''}" data-action="open-day" data-day="${key}" aria-pressed="${key === trailDay}" aria-label="${longDate(key)}: ${what}" title="${longDate(key)}"><i${fill ? ` style="background: ${fill}"` : ''}></i></button>`;
}

// The day opened on the trail: what was noted, and ways to add to it or set it aside for rest.
function dayPanel(key, todayKey) {
  const ahead = key > todayKey;
  const worked = state.sittings.some((s) => s.day === key);
  const empty = isRest(key) ? 'A planned day of rest.' : ahead ? 'Still ahead.' : 'Nothing noted this day.';
  return `${dayHTML(key) || `<article class="day"><h3>${longDate(key)}</h3><p class="quiet-note">${empty}</p></article>`}
    <div class="day-actions">
      ${ahead ? '' : `
        <button class="btn" data-action="note-sitting" data-day="${key}">Note a sitting</button>
        <button class="btn" data-action="catch-insight" data-day="${key}">Add an insight</button>
        <button class="btn" data-action="write-memo" data-day="${key}">Write a memo</button>`}
      ${worked ? '' : `<button class="link" data-action="toggle-rest" data-day="${key}">${state.days[key]?.rest ? 'Not a rest day after all' : 'Mark as a planned rest'}</button>`}
    </div>`;
}

function renderTrail() {
  const todayKey = dayKey();
  const start = new Date();
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7 * (TRAIL_WEEKS - 1)); // Monday, some weeks back
  let marks = '';
  for (let i = 0; i < TRAIL_WEEKS * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    marks += markHTML(dayKey(d), todayKey);
  }
  const opened = trailDay ? dayPanel(trailDay, todayKey) : '';
  $('#trail').innerHTML = `
    <div class="weeks">
      ${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span class="wd">${d}</span>`).join('')}
      ${marks}
    </div>
    <div class="legend">${modeDots(MODES.map((m) => m.id))}</div>
    <p class="trail-key">Each mark holds the colours of all the day's work. A full circle is a day the dissertation was touched; a ring is a day of other work only. A crescent is a planned rest, and the small dot underneath marks today. Choose a day to read it, add to it, or set it aside for rest.</p>
    ${opened}`;
}

/* ---------- Navigation ---------- */

const RENDER = { today: renderToday, notebook: renderNotebook, trail: renderTrail };
let view = 'today';

function show(next) {
  view = next;
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  for (const name of Object.keys(RENDER)) $(`#view-${name}`).hidden = name !== view;
  RENDER[view]();
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ---------- Actions ---------- */

// The line under a dialog's heading, when the entry is for a day other than today.
const forDay = (day) => (day && day !== dayKey() ? `For ${longDate(day)}` : '');

function openSittingDialog(existing, day = '') {
  const s = existing || { modes: [], places: [], thread: 'dissertation' };
  const places = [...(s.places || []), ...(s.paper ? ['Other'] : [])];
  sittingForm.reset();
  sittingForm.elements.id.value = existing ? existing.id : '';
  sittingForm.elements.day.value = day;
  $('#sitting-day').textContent = forDay(existing ? existing.day : day);
  $('#sitting-heading').textContent = existing ? 'Edit sitting' : 'Note a sitting';
  $('#sitting-submit').textContent = existing ? 'Save' : 'Note it';
  $('#sitting-modes').innerHTML = '<legend>What kind of work was it? <span class="optional">as many as apply</span></legend>'
    + MODES.map((m) => `<label><input type="checkbox" name="modes" value="${m.id}"${s.modes.includes(m.id) ? ' checked' : ''}><span class="dot" style="--c: var(--${m.id})">${m.name}</span></label>`).join('');
  const names = [...new Set(state.sittings.map((s) => s.threadName).filter(Boolean))];
  $('#thread-names').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
  sittingForm.elements.thread.value = s.thread;
  sittingForm.elements.threadName.value = s.threadName || '';
  sittingForm.elements.note.value = s.note || '';
  sittingForm.elements.paper.value = s.paper || '';
  $('#thread-name-label').hidden = s.thread !== 'other';
  $('#sitting-places').innerHTML = '<legend>Where are the notes? <span class="optional">optional, as many as apply</span></legend>'
    + [...PLACES, 'Other'].map((p) => `<label><input type="checkbox" name="places" value="${p}"${places.includes(p) ? ' checked' : ''}><span>${p}</span></label>`).join('');
  $('#paper-label').hidden = !s.paper;
  sittingDialog.showModal();
}

// One dialog serves both: a quick insight, or a longer memo with a title.
// A new one that is closed half-written is kept as a draft and offered back next time.
function openNoteDialog(kind, existing, day = '') {
  const memo = kind === 'memo';
  const from = existing || state.noteDrafts[kind] || {};
  noteForm.reset();
  noteForm.elements.id.value = existing ? existing.id : '';
  noteForm.elements.day.value = day;
  $('#note-day').textContent = forDay(existing ? existing.day : day);
  noteForm.elements.kind.value = kind;
  noteForm.elements.title.value = from.title || '';
  noteForm.elements.text.value = from.text || '';
  noteForm.elements.source.value = from.source || '';
  noteForm.elements.text.rows = memo ? 14 : 5;
  noteForm.elements.text.placeholder = memo ? '' : 'A sentence or two is plenty.';
  $('#note-heading').textContent = existing ? (memo ? 'Edit memo' : 'Edit insight') : (memo ? 'Write a memo' : 'Catch an insight');
  $('#note-text-label').textContent = memo ? 'The memo' : '';
  noteForm.elements.text.setAttribute('aria-label', memo ? 'The memo' : 'The insight');
  $('#note-title-label').hidden = !memo;
  $('#note-tags').hidden = !memo;
  $('#note-tags').innerHTML = '<legend>What kind of memo? <span class="optional">optional</span></legend>'
    + ['', ...MEMO_TAGS].map((t) => `<label><input type="radio" name="tag" value="${t}"${t === (from.tag || '') ? ' checked' : ''}><span>${t || 'Untagged'}</span></label>`).join('');
  noteDialog.classList.toggle('wide', memo);
  noteDialog.showModal();
  noteForm.elements[memo && !from.title ? 'title' : 'text'].focus();
}

document.addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (tab) return show(tab.dataset.view);

  const el = event.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;

  if (action === 'note-sitting') openSittingDialog(null, el.dataset.day);
  else if (action === 'catch-insight') openNoteDialog('insight', null, el.dataset.day);
  else if (action === 'write-memo') openNoteDialog('memo', null, el.dataset.day);
  else if (action === 'toggle-rest') {
    const day = (state.days[el.dataset.day] ||= {});
    day.rest = !day.rest;
    save();
    RENDER[view]();
  } else if (action === 'export') exportBackup();
  else if (action === 'import') $('#import-file').click();
  else if (action === 'backup-later') {
    const later = new Date();
    later.setDate(later.getDate() + 3);
    localStorage.setItem(BACKUP_KEY + '-later', dayKey(later));
    renderToday();
  }
  else if (action === 'edit-sitting') openSittingDialog(state.sittings.find((x) => x.id === id));
  else if (action === 'flag-note') {
    const note = state.insights.find((x) => x.id === id);
    if (note) note.flag = !note.flag;
    save();
    RENDER[view]();
    if (note?.flag) toast(isWeekend() ? 'It will wait for you here.' : 'It will wait for you in the Opening card.');
  } else if (action === 'edit-note') {
    const note = state.insights.find((x) => x.id === id);
    if (note) openNoteDialog(note.kind === 'memo' ? 'memo' : 'insight', note);
  }
  else if (action === 'close-dialog') el.closest('dialog').close();
  else if (action === 'edit-intention') {
    editingIntention = true;
    renderToday();
    $('#intention-form input').focus();
  } else if (action === 'reopen') {
    today().closed = false;
    save();
    renderToday();
  } else if (action === 'remove-sitting' || action === 'remove-insight') {
    const list = action === 'remove-sitting' ? 'sittings' : 'insights';
    const memo = list === 'insights' && state.insights.find((x) => x.id === id)?.kind === 'memo';
    if (memo && !confirm('Remove this memo? It cannot be brought back.')) return;
    state[list] = state[list].filter((x) => x.id !== id);
    save();
    RENDER[view]();
  } else if (action === 'open-day') {
    trailDay = trailDay === el.dataset.day ? null : el.dataset.day;
    renderTrail();
  }
});

document.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const text = (name) => (data.get(name) || '').trim();

  if (form.id === 'intention-form') {
    const day = today();
    if (!text('intention')) return;
    day.intention = text('intention');
    delete day.draft;
    editingIntention = false;
    save();
    renderToday();
  } else if (form.id === 'closing-form') {
    const day = today();
    day.closing = text('closing');
    day.closed = true;
    save();
    renderToday();
  } else if (form === sittingForm) {
    const modes = data.getAll('modes');
    if (!modes.length) return toast('Choose at least one kind of work.');
    const thread = data.get('thread');
    const fields = {
      modes, thread,
      threadName: thread === 'other' ? text('threadName') : '',
      note: text('note'),
      places: data.getAll('places').filter((p) => p !== 'Other'),
      paper: data.getAll('places').includes('Other') ? text('paper') : '',
    };
    const existing = state.sittings.find((x) => x.id === text('id'));
    if (existing) Object.assign(existing, fields);
    else state.sittings.push({ id: newId(), at: Date.now(), day: text('day') || dayKey(), ...fields });
    save();
    sittingDialog.close();
    RENDER[view]();
    toast(existing ? 'Saved.' : 'Noted.');
  } else if (form === noteForm) {
    if (!text('text')) return;
    const kind = text('kind');
    const fields = { kind, title: kind === 'memo' ? text('title') : '', tag: kind === 'memo' ? text('tag') : '', text: text('text'), source: text('source') };
    const existing = state.insights.find((x) => x.id === text('id'));
    if (existing) Object.assign(existing, fields);
    else {
      state.insights.push({ id: newId(), at: Date.now(), day: text('day') || dayKey(), ...fields });
      delete state.noteDrafts[kind];
    }
    save();
    noteDialog.close();
    RENDER[view]();
    toast(view === 'today' && (!today().intention || today().closed) ? 'Kept. It is in the notebook.' : 'Kept.');
  }
});

// Half-written words are saved as they are typed, so a stray key or a closed tab loses nothing.
document.addEventListener('input', (event) => {
  const el = event.target;
  if (el.form?.id === 'week-form' && el.name === 'closing') {
    today().closing = el.value;
    save();
  } else if (el.form?.id === 'craft-form') {
    (state.weeks[el.dataset.week] ||= {}).craft = el.value;
    save();
  } else if (el.form?.id === 'week-form') {
    (state.weeks[el.dataset.week] ||= {}).text = el.value;
    save();
  } else if (el.form?.id === 'closing-form') {
    today()[el.name] = el.value;
    save();
  } else if (el.form === noteForm && !noteForm.elements.id.value) {
    const { kind, title, tag, text, source } = noteForm.elements;
    state.noteDrafts[kind.value] = { title: title.value, tag: tag.value, text: text.value, source: source.value };
    save();
  }
});

document.addEventListener('change', (event) => {
  const el = event.target;
  if (el.name === 'filter' || el.name === 'home' || el.name === 'tag') {
    notebookFilter[el.name === 'filter' ? 'kind' : el.name] = el.value;
    if (el.name === 'filter') {
      if (el.value === 'insights' || el.value === 'memos') notebookFilter.home = '';
      if (el.value !== 'memos') notebookFilter.tag = '';
    }
    renderNotebook();
  } else if (el.name === 'thread') {
    $('#thread-name-label').hidden = el.value !== 'other';
  } else if (el.name === 'places' && el.value === 'Other') {
    $('#paper-label').hidden = !el.checked;
  }
});

/* ---------- Backup ---------- */

function renderBackup() {
  const last = localStorage.getItem(BACKUP_KEY);
  $('#backup-status').textContent = last ? `Last backup saved ${longDate(last)}.` : 'No backup saved yet.';
}

function exportBackup() {
  const file = new Blob([JSON.stringify({ app: 'selma-work', version: 1, data: state }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = `selma-work-backup-${dayKey()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  localStorage.setItem(BACKUP_KEY, dayKey());
  renderBackup();
  RENDER[view]();
}

// A gentle reminder on Today: a week after the first entry if there has never been a backup,
// or two weeks after the last one. "Later" puts it off for three days.
function backupDue() {
  const days = [...state.sittings, ...state.insights].map((e) => e.day).sort();
  if (!days.length) return false;
  const later = localStorage.getItem(BACKUP_KEY + '-later');
  if (later && later > dayKey()) return false;
  const last = localStorage.getItem(BACKUP_KEY);
  return last ? daysBetween(last, dayKey()) >= 14 : daysBetween(days[0], dayKey()) >= 7;
}

// Restoring replaces everything on this device with what the backup holds.
$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  let data;
  try {
    const parsed = JSON.parse(await file.text());
    data = parsed.app === 'selma-work' ? parsed.data : parsed;
    if (!Array.isArray(data.sittings) || !Array.isArray(data.insights) || typeof data.days !== 'object') throw new Error();
  } catch {
    return toast('That file is not a Selma work journal backup.');
  }
  if (!confirm(`Replace everything on this device with this backup? It holds ${Object.keys(data.days).length} days. What is here now will be gone.`)) return;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, blankState(), data);
  save();
  show(view);
  toast('Restored.');
});

renderBackup();
show('today');

// Night mode follows the clock. Today is redrawn when it turns, unless something is being typed.
function applyEvening() {
  const late = isLate();
  if (document.documentElement.classList.contains('night') === late) return;
  document.documentElement.classList.toggle('night', late);
  document.querySelector('meta[name="theme-color"]').content = late ? '#1E2426' : '#F6F3EE';
  const typing = document.activeElement?.matches('input, textarea');
  if (view === 'today' && !typing) renderToday();
}
applyEvening();
setInterval(applyEvening, 60 * 1000);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
