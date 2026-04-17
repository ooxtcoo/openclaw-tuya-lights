import './styles.css';

const app = document.getElementById('app');
const API = 'http://127.0.0.1:4890';
const LANG_KEY = 'tuya-gui.lang';

let registry = null;
let catalog = null;
let editId = null;
let discovered = [];
let onboardingDraft = null;
let uiLevels = {};
let lampHealth = {};
let draggedLampId = null;
let dialogState = null;
let logLines = [];
let currentLang = localStorage.getItem(LANG_KEY) || 'de';
let uiPanels = {
  advancedOpen: false,
  diagnosticsOpen: false,
  rawOpen: false,
};
const debounceTimers = new Map();

function L(de, en) { return currentLang === 'de' ? de : en; }
function esc(s = '') { return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function slugify(value = '') { return String(value || '').toLowerCase().trim().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function setLanguage(lang) { currentLang = (lang === 'en') ? 'en' : 'de'; localStorage.setItem(LANG_KEY, currentLang); render(); }

async function api(path, opts = {}) {
  const r = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch { throw new Error(`Non-JSON response: ${txt.slice(0, 140)}`); }
  if (!r.ok) {
    const err = new Error(j.error || 'API error');
    err.payload = j;
    throw err;
  }
  return j;
}

function normalizeRegistryLocal(raw) {
  const next = (raw && typeof raw === 'object') ? structuredClone(raw) : {};
  next.lamps = (next.lamps && typeof next.lamps === 'object') ? next.lamps : {};
  next.groups = (next.groups && typeof next.groups === 'object') ? next.groups : {};
  let order = 1;
  for (const [id, lamp] of Object.entries(next.lamps)) {
    if (!lamp || typeof lamp !== 'object') {
      delete next.lamps[id];
      continue;
    }
    lamp.name = String(lamp.name || id || '').trim();
    lamp.device_id = String(lamp.device_id || '').trim();
    lamp.ip = String(lamp.ip || '').trim();
    lamp.local_key = String(lamp.local_key || '').trim();
    lamp.notes = String(lamp.notes || '').trim();
    lamp.version = Number(lamp.version || 3.3) || 3.3;
    lamp.type = String(lamp.type || 'bulb').trim() || 'bulb';
    lamp.dps = (lamp.dps && typeof lamp.dps === 'object') ? lamp.dps : { power: 20 };
    lamp.sort_order = Number.isFinite(Number(lamp.sort_order)) ? Number(lamp.sort_order) : order;
    order += 1;
  }
  const lampIds = new Set(Object.keys(next.lamps));
  const groups = {};
  for (const [groupName, members] of Object.entries(next.groups)) {
    const cleanName = String(groupName || '').trim();
    if (!cleanName) continue;
    const seen = new Set();
    const cleanMembers = [];
    for (const member of Array.isArray(members) ? members : []) {
      const cleanId = String(member || '').trim();
      if (!cleanId || !lampIds.has(cleanId) || seen.has(cleanId)) continue;
      seen.add(cleanId);
      cleanMembers.push(cleanId);
    }
    groups[cleanName] = cleanMembers;
  }
  next.groups = groups;
  return next;
}

function lampEntriesSorted() {
  return Object.entries(registry?.lamps || {}).sort((a, b) => {
    const ao = Number(a[1]?.sort_order || 0);
    const bo = Number(b[1]?.sort_order || 0);
    if (ao !== bo) return ao - bo;
    return a[0].localeCompare(b[0]);
  });
}
function groupEntriesSorted() { return Object.entries(registry?.groups || {}).sort((a, b) => a[0].localeCompare(b[0], currentLang === 'de' ? 'de' : 'en')); }
function resequenceLampSortOrders() { lampEntriesSorted().forEach(([id, lamp], index) => { lamp.sort_order = index + 1; }); }

function moveLamp(id, direction) {
  const entries = lampEntriesSorted();
  const index = entries.findIndex(([lampId]) => lampId === id);
  if (index < 0) return false;
  const swapIndex = index + direction;
  if (swapIndex < 0 || swapIndex >= entries.length) return false;
  const current = entries[index][1];
  const other = entries[swapIndex][1];
  const temp = current.sort_order;
  current.sort_order = other.sort_order;
  other.sort_order = temp;
  resequenceLampSortOrders();
  return true;
}

function moveLampBefore(dragId, targetId) {
  if (!dragId || !targetId || dragId === targetId) return false;
  const ids = lampEntriesSorted().map(([id]) => id);
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return false;
  ids.splice(from, 1);
  ids.splice(to, 0, dragId);
  ids.forEach((id, index) => { registry.lamps[id].sort_order = index + 1; });
  return true;
}

function dpsToPct(v) { const n = Number(v); if (!Number.isFinite(n)) return null; if (n <= 100) return Math.max(0, Math.min(100, Math.round(n))); return Math.max(0, Math.min(100, Math.round((n / 1000) * 100))); }
function dps24ToHue(v) { if (typeof v !== 'string' || v.length < 4) return null; const n = Number.parseInt(v.slice(0, 4), 16); if (!Number.isFinite(n)) return null; return Math.max(0, Math.min(360, n)); }
function scheduleDebounced(key, fn, ms = 1000) { const old = debounceTimers.get(key); if (old) clearTimeout(old); const t = setTimeout(async () => { debounceTimers.delete(key); await fn(); }, ms); debounceTimers.set(key, t); }
function setLampHealth(id, online, error = '') { lampHealth[id] = { online: Boolean(online), error: String(error || '') }; }
function statusPayloadOnline(result) { if (!result || typeof result !== 'object') return false; if (typeof result.online === 'boolean') return result.online; if (result.error) return false; const dps = result?.result?.dps; return Boolean(dps && typeof dps === 'object' && Object.keys(dps).length > 0); }
function statusPayloadError(result) { if (!result || typeof result !== 'object') return ''; if (result.error) return String(result.error); return ''; }
function formatExec(exec) { if (!exec) return ''; return [exec.command ? `cmd: ${exec.command}` : '', exec.code !== undefined ? `code: ${exec.code}` : '', exec.stdout ? `stdout: ${exec.stdout}` : '', exec.stderr ? `stderr: ${exec.stderr}` : ''].filter(Boolean).join(' | '); }

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  logLines.unshift(`[${ts}] ${msg}`);
  logLines = logLines.slice(0, 200);
  const el = document.getElementById('log');
  if (el) el.textContent = logLines.join('\n');
}

function defaultLamp(name = L('Neue Lampe', 'New lamp')) {
  const nextOrder = lampEntriesSorted().length + 1;
  return { name, device_id: '', ip: '', local_key: '', version: 3.3, type: 'bulb', notes: '', dps: { power: 20 }, sort_order: nextOrder };
}

function lampHasColor(lamp = {}) { const dps = lamp?.dps || {}; const sample = lamp?.last_status_sample || {}; return Boolean(dps.colour_data || dps.color_data || dps.light_param_24 || sample['24'] || sample[24]); }
function displayTempPctForLamp(lamp, rawPct) { if (rawPct === null || rawPct === undefined) return null; const n = Number(rawPct); if (!Number.isFinite(n)) return null; return lampHasColor(lamp) ? n : (100 - n); }
function requestTempPctForLamp(lamp, displayPct) { const n = Number(displayPct); if (!Number.isFinite(n)) return displayPct; return lampHasColor(lamp) ? n : (100 - n); }
function lampGroups(id) { return groupEntriesSorted().map(([groupName]) => groupName).filter((g) => (registry.groups[g] || []).includes(id)); }
function updateGroupsJsonEditor() { const el = document.getElementById('groupsJson'); if (el) el.value = JSON.stringify(registry.groups || {}, null, 2); }

function inferDeviceTemplate(lamp = {}) {
  const dps = lamp?.dps || {};
  const sample = lamp?.last_status_sample || {};
  const type = String(lamp?.type || '').toLowerCase();
  if (type === 'bulb') return 'bulb';
  if (type === 'plug' || type === 'socket' || type === 'outlet') return 'plug';
  if (type === 'switch') return 'switch';
  if (dps.power || dps.switch_led) return 'device';
  if (dps.colour_data || dps.color_data || dps.light_param_24 || sample['24']) return 'bulb';
  if (dps.brightness || dps.bright_value || sample['22']) return 'bulb';
  if (dps.temp || dps.temp_value || sample['23']) return 'bulb';
  if (dps.mode || dps.work_mode || sample['21']) return 'bulb';
  return 'device';
}
function inferCapabilities(lamp = {}, meta = {}) {
  const dps = lamp?.dps || {};
  const sample = lamp?.last_status_sample || {};
  const catalogCaps = meta?.capabilities || {};
  return {
    power: Boolean(catalogCaps.power || dps.power || dps.switch_led || sample['20'] !== undefined || sample['1'] !== undefined),
    brightness: Boolean(catalogCaps.brightness || dps.brightness || dps.bright_value || sample['22'] !== undefined),
    white_temp: Boolean(catalogCaps.white_temp || dps.temp || dps.temp_value || sample['23'] !== undefined),
    color: Boolean(catalogCaps.color || dps.colour_data || dps.color_data || dps.light_param_24 || sample['24']),
    hue: Boolean(catalogCaps.hue || dps.colour_data || dps.color_data || dps.light_param_24 || sample['24'])
  };
}
function getTemplateMeta(lamp = {}) { const templateKey = inferDeviceTemplate(lamp); const meta = catalog?.templates?.[templateKey] || catalog?.templates?.device || { label: L('Gerät', 'Device'), icon: '📦', capabilities: { power: true } }; return { templateKey, meta }; }

function getDiagnostics() {
  const issues = [];
  const warnings = [];
  const lamps = registry?.lamps || {};
  const groups = registry?.groups || {};
  const lampIds = new Set(Object.keys(lamps));
  const normalizedGroups = new Map();

  if (!Object.keys(lamps).length) issues.push(L('Keine Lampen in der Registry vorhanden.', 'No lamps found in the registry.'));

  for (const [lampId, lamp] of Object.entries(lamps)) {
    if (!lamp.device_id) warnings.push(L(`Lampe ${lampId} hat keine device_id.`, `Lamp ${lampId} has no device_id.`));
    if (!lamp.ip) warnings.push(L(`Lampe ${lampId} hat keine IP.`, `Lamp ${lampId} has no IP.`));
    if (!lamp.local_key) warnings.push(L(`Lampe ${lampId} hat keinen local_key.`, `Lamp ${lampId} has no local_key.`));
    if (!slugify(lampId)) warnings.push(L(`Lampe ${lampId} hat eine problematische ID.`, `Lamp ${lampId} has a problematic ID.`));
  }

  for (const [groupName, members] of Object.entries(groups)) {
    const key = slugify(groupName);
    if (normalizedGroups.has(key)) issues.push(L(`Gruppennamen kollidieren: ${normalizedGroups.get(key)} / ${groupName}`, `Group names collide: ${normalizedGroups.get(key)} / ${groupName}`));
    else normalizedGroups.set(key, groupName);

    if (!Array.isArray(members)) issues.push(L(`Gruppe ${groupName} hat kein gültiges Array als Mitgliederliste.`, `Group ${groupName} has no valid member array.`));
    if (Array.isArray(members) && members.length === 0) warnings.push(L(`Gruppe ${groupName} ist leer.`, `Group ${groupName} is empty.`));
    const seen = new Set();
    for (const member of Array.isArray(members) ? members : []) {
      if (!lampIds.has(member)) issues.push(L(`Gruppe ${groupName} referenziert unbekannte Lampe ${member}.`, `Group ${groupName} references unknown lamp ${member}.`));
      if (seen.has(member)) warnings.push(L(`Gruppe ${groupName} enthält ${member} doppelt.`, `Group ${groupName} contains ${member} twice.`));
      seen.add(member);
    }
  }
  return { issues, warnings };
}

function groupSummaryHtml(members = []) {
  if (!members.length) return `<span class="muted">${esc(L('leer', 'empty'))}</span>`;
  return `<div class="chip-list">${members.map((id) => `<span class="chip">${esc(registry?.lamps?.[id]?.name || id)}</span>`).join('')}</div>`;
}

function renderDialog() {
  if (!dialogState) return '';
  const closed = dialogState.closing ? 'closing' : '';
  if (dialogState.type === 'group-create') {
    return `<div class="modal-backdrop modal-anim ${closed}" id="dialogBackdrop"><div class="modal fancy-modal"><div class="modal-glow"></div><h3>${esc(L('Neue Gruppe anlegen', 'Create new group'))}</h3><p class="muted">${esc(L('Wähle einen klaren Namen. Leere Gruppen sind erlaubt und bleiben gespeichert.', 'Choose a clear name. Empty groups are allowed and will be saved.'))}</p><div class="form-grid single-column"><input id="dialogGroupName" placeholder="${esc(L('z. B. wohnzimmer', 'e.g. living_room'))}" value="${esc(dialogState.value || '')}" /></div><div class="actions modal-actions"><button class="primary" id="dialogConfirm">${esc(L('Gruppe anlegen', 'Create group'))}</button><button id="dialogCancel">${esc(L('Abbrechen', 'Cancel'))}</button></div></div></div>`;
  }
  if (dialogState.type === 'group-rename') {
    return `<div class="modal-backdrop modal-anim ${closed}" id="dialogBackdrop"><div class="modal fancy-modal"><div class="modal-glow"></div><h3>${esc(L('Gruppe umbenennen', 'Rename group'))}</h3><p class="muted">${esc(L('Alter Name', 'Current name'))}: <strong>${esc(dialogState.groupName)}</strong></p><div class="form-grid single-column"><input id="dialogGroupName" placeholder="${esc(L('Neuer Gruppenname', 'New group name'))}" value="${esc(dialogState.groupName || '')}" /></div><div class="actions modal-actions"><button class="primary" id="dialogConfirm">${esc(L('Umbenennen', 'Rename'))}</button><button id="dialogCancel">${esc(L('Abbrechen', 'Cancel'))}</button></div></div></div>`;
  }
  if (dialogState.type === 'group-delete') {
    return `<div class="modal-backdrop modal-anim ${closed}" id="dialogBackdrop"><div class="modal fancy-modal"><div class="modal-glow"></div><h3>${esc(L('Gruppe löschen?', 'Delete group?'))}</h3><p class="muted">${esc(L('Die Gruppe wird entfernt, die Lampen bleiben erhalten.', 'The group will be removed, but the lamps will stay.'))}</p><div class="actions modal-actions"><button class="danger" id="dialogConfirm">${esc(L('Löschen', 'Delete'))}</button><button id="dialogCancel">${esc(L('Abbrechen', 'Cancel'))}</button></div></div></div>`;
  }
  if (dialogState.type === 'lamp-delete') {
    return `<div class="modal-backdrop modal-anim ${closed}" id="dialogBackdrop"><div class="modal fancy-modal"><div class="modal-glow"></div><h3>${esc(L('Lampe löschen?', 'Delete lamp?'))}</h3><p class="muted">${esc(L('Die Lampe wird aus der Registry entfernt. Gruppen werden automatisch bereinigt.', 'The lamp will be removed from the registry. Groups will be cleaned automatically.'))}</p><div class="actions modal-actions"><button class="danger" id="dialogConfirm">${esc(L('Löschen', 'Delete'))}</button><button id="dialogCancel">${esc(L('Abbrechen', 'Cancel'))}</button></div></div></div>`;
  }
  if (dialogState.type === 'add-discovered') {
    const item = discovered[dialogState.index];
    if (!item) return '';
    return `<div class="modal-backdrop modal-anim ${closed}" id="dialogBackdrop"><div class="modal fancy-modal"><div class="modal-glow"></div><h3>${esc(L('Discovery-Gerät übernehmen', 'Add discovered device'))}</h3><p class="muted">Name: <strong>${esc(item.name || 'Unknown')}</strong><br>IP: ${esc(item.ip || '-')}<br>gwId: ${esc(item.gwId || '-')}</p><div class="form-grid single-column"><input id="dialogLampId" placeholder="Lamp ID" value="${esc(dialogState.suggestedId || '')}" /></div><div class="actions modal-actions"><button class="primary" id="dialogConfirm">${esc(L('In Registry anlegen', 'Add to registry'))}</button><button id="dialogCancel">${esc(L('Abbrechen', 'Cancel'))}</button></div></div></div>`;
  }
  return '';
}

function groupControlsHtml(id) {
  const groups = groupEntriesSorted().map(([groupName]) => groupName);
  if (!groups.length) return `<div class="lamp-groups muted">${esc(L('Noch keine Gruppen vorhanden.', 'No groups yet.'))}</div>`;
  return `<div class="lamp-groups"><div class="lamp-groups-title">${esc(L('Gruppen', 'Groups'))}</div><div class="group-checks">${groups.map((g) => `<label><input type="checkbox" data-group-member="${esc(id)}" data-group-name="${esc(g)}" ${lampGroups(id).includes(g) ? 'checked' : ''}> ${esc(g)}</label>`).join('')}</div></div>`;
}

function lampCard(id, lamp) {
  const b = uiLevels[id]?.brightness ?? 50;
  const t = uiLevels[id]?.temp ?? 50;
  const h = uiLevels[id]?.hue ?? 0;
  const { templateKey, meta } = getTemplateMeta(lamp);
  const capabilities = inferCapabilities(lamp, meta);
  const tempLabel = lampHasColor(lamp) ? L('Farbton Weiß (kalt → warm)', 'White temperature (cool → warm)') : L('Farbton Weiß (warm → kalt)', 'White temperature (warm → cool)');
  return `<div class="card lamp-card-draggable" data-lamp-card="${esc(id)}" data-lamp-id="${esc(id)}" draggable="true"><div class="row"><h3>${esc(meta?.icon || '📦')} ${esc(lamp.name || id)}</h3><span class="id">${esc(id)}</span></div><div class="meta">${esc(meta?.label || templateKey)} • IP ${esc(lamp.ip || '-')} • v${esc(lamp.version || '-')} • ${esc(L('Position', 'Position'))} ${Number(lamp.sort_order || 0)} • <span class="health-badge" data-health-badge="${esc(id)}">unknown</span></div><div class="actions"><button data-act="on" data-target="${esc(id)}" data-offline-disable="1">${esc(L('Ein', 'On'))}</button><button data-act="off" data-target="${esc(id)}" data-offline-disable="1">${esc(L('Aus', 'Off'))}</button><button data-act="status" data-target="${esc(id)}">${esc(L('Status', 'Status'))}</button><button data-edit="${esc(id)}">${esc(L('Bearbeiten', 'Edit'))}</button><button data-del="${esc(id)}">${esc(L('Löschen', 'Delete'))}</button><button data-move-up="${esc(id)}">↑</button><button data-move-down="${esc(id)}">↓</button></div><div class="muted drag-hint">${esc(L('Drag and drop oder ↑↓ zum Umordnen', 'Drag and drop or ↑↓ to reorder'))}</div>${capabilities.brightness ? `<div class="slider-wrap"><label>${esc(L('Helligkeit', 'Brightness'))} <span id="bval-${esc(id)}">${b}%</span></label><input type="range" min="1" max="100" value="${b}" data-brightness="${esc(id)}" data-offline-disable="1" /></div>` : ''}${capabilities.white_temp ? `<div class="slider-wrap"><label>${esc(tempLabel)} <span id="tval-${esc(id)}">${t}%</span></label><input type="range" min="0" max="100" value="${t}" data-temp="${esc(id)}" data-offline-disable="1" /></div>` : ''}${capabilities.hue ? `<div class="slider-wrap"><label>${esc(L('Farbe', 'Color'))} <span id="hval-${esc(id)}">${h}°</span></label><input class="hue-slider" type="range" min="0" max="360" value="${h}" data-hue="${esc(id)}" data-offline-disable="1" /></div>` : ''}${capabilities.color || capabilities.white_temp ? `<div class="color-row">${capabilities.color ? `<button data-color="${esc(id)}" data-value="rot" data-offline-disable="1">${esc(L('Rot', 'Red'))}</button><button data-color="${esc(id)}" data-value="blau" data-offline-disable="1">${esc(L('Blau', 'Blue'))}</button><button data-color="${esc(id)}" data-value="grün" data-offline-disable="1">${esc(L('Grün', 'Green'))}</button>` : ''}${capabilities.white_temp ? `<button data-color="${esc(id)}" data-value="warmweiß" data-offline-disable="1">${esc(L('Warmweiß', 'Warm white'))}</button><button data-color="${esc(id)}" data-value="kaltweiß" data-offline-disable="1">${esc(L('Kaltweiß', 'Cold white'))}</button>` : ''}</div>` : ''}${groupControlsHtml(id)}</div>`;
}

function quickGroupsHtml() {
  const groups = groupEntriesSorted();
  if (!groups.length) return `<p class="muted">${esc(L('Noch keine Gruppen definiert.', 'No groups defined yet.'))}</p>`;
  return groups.map(([groupName, members]) => `<div class="group-row"><div class="group-row-main"><strong>${esc(groupName)}</strong><div class="muted">${members.length} ${esc(L('Lampen', 'lamps'))}</div>${groupSummaryHtml(members)}</div><div class="actions"><button data-group-act="on" data-group-name="${esc(groupName)}">${esc(L('EIN', 'ON'))}</button><button data-group-act="off" data-group-name="${esc(groupName)}">${esc(L('AUS', 'OFF'))}</button><button data-group-rename="${esc(groupName)}">${esc(L('Umbenennen', 'Rename'))}</button><button data-group-delete="${esc(groupName)}">${esc(L('Löschen', 'Delete'))}</button></div></div>`).join('');
}

function diagnosticsHtml() {
  const { issues, warnings } = getDiagnostics();
  const all = [...issues.map((text) => ({ kind: 'issue', text })), ...warnings.map((text) => ({ kind: 'warning', text }))];
  if (!all.length) return `<div class="status-ok">${esc(L('Registry sieht sauber aus.', 'Registry looks clean.'))}</div>`;
  return `<div class="diagnostics-list">${all.map((item) => `<div class="diagnostic-item ${item.kind}"><strong>${item.kind === 'issue' ? esc(L('Problem', 'Issue')) : esc(L('Hinweis', 'Warning'))}</strong><span>${esc(item.text)}</span></div>`).join('')}</div>`;
}

function discoveryHtml() {
  if (!discovered.length) return `<p class="muted">${esc(L('Noch keine Discovery-Ergebnisse.', 'No discovery results yet.'))}</p>`;
  return discovered.map((d, i) => {
    const suggestedId = slugify(d.name || `tuya_${i + 1}`) || `tuya_${i + 1}`;
    return `<div class="discover-item"><div><strong>${esc(d.name || 'Unknown')}</strong> • ${esc(d.ip || '-')} • v${esc(d.version || '-')}</div><div class="muted">gwId: ${esc(d.gwId || '-')} | productKey: ${esc(d.productKey || '-')} | category: ${esc(d.category || d.categoryCode || '-')}</div><div class="actions" style="margin-top:6px"><button data-onboard-discovered="${i}" data-suggested-id="${esc(suggestedId)}">${esc(L('Für Onboarding verwenden', 'Use for onboarding'))}</button><button data-add-discovered="${i}" data-suggested-id="${esc(suggestedId)}">${esc(L('Zur Registry hinzufügen', 'Add to registry'))}</button></div></div>`;
  }).join('');
}

function renderLampEditModal() {
  if (!editId) return '';
  const lamp = registry.lamps[editId];
  if (!lamp) return '';
  return `<div class="modal-backdrop modal-anim" id="modalClose"><div class="modal fancy-modal"><div class="modal-glow"></div><h3>${esc(L('Lampe bearbeiten', 'Edit lamp'))}: ${esc(editId)}</h3><div class="form-grid"><input id="m_name" placeholder="name" value="${esc(lamp.name || '')}" /><input id="m_ip" placeholder="ip" value="${esc(lamp.ip || '')}" /><input id="m_device" placeholder="device_id" value="${esc(lamp.device_id || '')}" /><input id="m_key" placeholder="local_key" value="${esc(lamp.local_key || '')}" /><input id="m_version" placeholder="version" value="${esc(lamp.version || 3.3)}" /><input id="m_notes" placeholder="notes" value="${esc(lamp.notes || '')}" /></div><div class="actions modal-actions" style="margin-top:10px"><button class="primary" id="m_save">${esc(L('Speichern', 'Save'))}</button><button id="m_test">${esc(L('Status testen', 'Test status'))}</button><button id="m_cancel">${esc(L('Abbrechen', 'Cancel'))}</button></div></div></div>`;
}

function onboardingValue(key, fallback = '') { return onboardingDraft?.[key] ?? fallback; }

function render() {
  if (!registry) { app.innerHTML = `<main class="wrap">${esc(L('Lädt…', 'Loading…'))}</main>`; return; }
  registry = normalizeRegistryLocal(registry);
  const lamps = lampEntriesSorted();
  const groups = registry.groups || {};
  app.innerHTML = `<main class="wrap"><header><div><h1>Tuya Lights v1.4</h1></div><div class="header-actions"><select id="langSelect" class="lang-select" aria-label="Language"><option value="de" ${currentLang === 'de' ? 'selected' : ''}>Deutsch</option><option value="en" ${currentLang === 'en' ? 'selected' : ''}>English</option></select><button id="refresh">${esc(L('Neu laden', 'Refresh'))}</button><button id="syncNow">${esc(L('Werte syncen', 'Sync values'))}</button></div></header><section class="panel"><div class="row section-head"><div><h2>${esc(L('Gruppen', 'Groups'))}</h2><div class="muted">${esc(L('Direkt steuerbar, ohne Browser-Prompts.', 'Directly manageable, without browser prompts.'))}</div></div><div class="actions"><button class="primary" id="createGroupBtn">${esc(L('Neue Gruppe', 'New group'))}</button></div></div><div class="group-list">${quickGroupsHtml()}</div></section><section class="panel"><h2>${esc(L('Lampen', 'Lamps'))}</h2><div class="grid">${lamps.map(([id, l]) => lampCard(id, l)).join('')}</div></section><section class="panel collapsible ${uiPanels.advancedOpen ? 'open' : ''}"><button class="collapse-toggle" id="toggleAdvancedPanel"><span><strong>${esc(L('Erweiterte Einstellungen', 'Advanced settings'))}</strong><span class="muted collapse-sub">${esc(L('Onboarding, Discovery und Wartung', 'Onboarding, discovery and maintenance'))}</span></span><span class="collapse-chevron">${uiPanels.advancedOpen ? '−' : '+'}</span></button><div class="collapse-content ${uiPanels.advancedOpen ? 'open' : ''}"><section class="nested-panel"><div class="row section-head"><div><h2>${esc(L('Registry Check', 'Registry check'))}</h2><div class="muted">${esc(L('Zeigt Probleme und Hinweise, plus automatische Bereinigung.', 'Shows issues and warnings, plus automatic cleanup.'))}</div></div><div class="actions"><button id="repairRegistryBtn">${esc(L('Repair / Normalize', 'Repair / Normalize'))}</button><button id="toggleDiagnosticsBtn">${esc(uiPanels.diagnosticsOpen ? L('Details ausblenden', 'Hide details') : L('Details anzeigen', 'Show details'))}</button></div></div>${uiPanels.diagnosticsOpen ? diagnosticsHtml() : `<div class="muted">${esc(L('Diagnose ist eingeklappt. Bei Bedarf anzeigen.', 'Diagnostics are collapsed. Expand when needed.'))}</div>`}</section><section class="nested-panel"><h2>${esc(L('Onboarding (neue Lampe)', 'Onboarding (new lamp)'))}</h2><div class="muted" style="margin-bottom:10px">${esc(L('Discovery kann das Formular vorbefüllen. Für einen echten lokalen Test brauchst du weiterhin den korrekten', 'Discovery can prefill the form. For a real local test you still need the correct'))} <code>local_key</code>.</div><div class="form-grid"><input id="addId" placeholder="lamp id (e.g. bedroom_main)" value="${esc(onboardingValue('id'))}" /><input id="addName" placeholder="name" value="${esc(onboardingValue('name'))}" /><input id="addIp" placeholder="ip" value="${esc(onboardingValue('ip'))}" /><input id="addDev" placeholder="device_id / gwId" value="${esc(onboardingValue('device_id'))}" /><input id="addKey" placeholder="local_key" value="${esc(onboardingValue('local_key'))}" /><input id="addVer" placeholder="version" value="${esc(onboardingValue('version', '3.3'))}" /><input id="addProductKey" placeholder="productKey" value="${esc(onboardingValue('productKey'))}" /><input id="addCategory" placeholder="category" value="${esc(onboardingValue('category'))}" /></div><div class="actions" style="margin-top:8px"><button id="addLampBtn">${esc(L('Lampe hinzufügen', 'Add lamp'))}</button><button id="testOnboardingBtn">${esc(L('Status testen', 'Test status'))}</button><button id="clearOnboardingBtn">${esc(L('Zurücksetzen', 'Clear'))}</button></div></section><section class="nested-panel"><h2>${esc(L('Discovery', 'Discovery'))}</h2><div class="actions"><button id="discoverBtn">${esc(L('Netzwerk nach Tuya-Geräten scannen', 'Scan network for Tuya devices'))}</button></div><div id="discoverList" class="discover-list">${discoveryHtml()}</div></section></div></section><section class="panel collapsible ${uiPanels.rawOpen ? 'open' : ''}"><button class="collapse-toggle" id="toggleRawPanel"><span><strong>${esc(L('Raw Tools', 'Raw tools'))}</strong><span class="muted collapse-sub">${esc(L('JSON-Editoren und Log für Debugging', 'JSON editors and log for debugging'))}</span></span><span class="collapse-chevron">${uiPanels.rawOpen ? '−' : '+'}</span></button><div class="collapse-content ${uiPanels.rawOpen ? 'open' : ''}"><section class="nested-panel"><h2>${esc(L('Groups JSON Fallback', 'Groups JSON fallback'))}</h2><div class="muted" style="margin-bottom:8px">${esc(L('Der visuelle Editor ist jetzt der Standard. Das rohe JSON bleibt als Fallback.', 'The visual editor is now the default. Raw JSON stays available as a fallback.'))}</div><textarea id="groupsJson">${esc(JSON.stringify(groups, null, 2))}</textarea><div class="actions" style="margin-top:8px"><button id="saveGroups">${esc(L('Groups JSON speichern', 'Save groups JSON'))}</button></div></section><section class="nested-panel"><h2>${esc(L('Registry Editor', 'Registry editor'))}</h2><textarea id="json">${esc(JSON.stringify(registry, null, 2))}</textarea><div class="actions" style="margin-top:8px"><button id="save">${esc(L('Registry speichern', 'Save registry'))}</button></div></section><section class="nested-panel" id="logPanel"><h2>${esc(L('Log', 'Log'))}</h2><pre id="log">${esc(logLines.join('\n'))}</pre></section></div></section></main>${renderLampEditModal()}${renderDialog()}`;
  wireEvents();
  applyLampHealthToAllCards();
}

function applyLampHealthToCard(id) {
  const card = app.querySelector(`[data-lamp-card="${id}"]`);
  if (!card) return;
  const st = lampHealth[id];
  if (!st || st.online === undefined || st.online === null) return;
  const badge = card.querySelector(`[data-health-badge="${id}"]`);
  const offline = st.online === false;
  card.classList.toggle('offline', offline);
  card.querySelectorAll('[data-offline-disable="1"]').forEach((el) => { el.disabled = offline; });
  if (badge) {
    badge.textContent = offline ? 'offline' : 'online';
    badge.classList.toggle('is-offline', offline);
    badge.classList.toggle('is-online', !offline);
    badge.title = offline ? (st.error || L('Nicht erreichbar', 'Unavailable')) : L('Erreichbar', 'Reachable');
  }
}
function applyLampHealthToAllCards() { Object.keys(registry?.lamps || {}).forEach((id) => applyLampHealthToCard(id)); }

async function persist() {
  registry = normalizeRegistryLocal(registry);
  const response = await api('/api/lamps', { method: 'PUT', body: JSON.stringify(registry) });
  registry = normalizeRegistryLocal(response?.registry || registry);
  updateGroupsJsonEditor();
}
async function runAction(target, action, value) { if (action === 'status') return api('/api/status', { method: 'POST', body: JSON.stringify({ target }) }); return api('/api/action', { method: 'POST', body: JSON.stringify({ target, action, value }) }); }

async function load() {
  const [data, cat] = await Promise.all([
    api('/api/lamps'),
    api('/api/catalog').catch(() => ({ templates: {} }))
  ]);
  registry = normalizeRegistryLocal(data);
  catalog = cat;
  render();
  syncLevelsFromStatus();
}

function openDialog(type, payload = {}) { dialogState = { type, closing: false, ...payload }; render(); const input = document.getElementById('dialogGroupName') || document.getElementById('dialogLampId'); if (input) setTimeout(() => input.focus(), 30); }
function closeDialog() { if (!dialogState) return; dialogState = { ...dialogState, closing: true }; render(); setTimeout(() => { dialogState = null; render(); }, 160); }

function updateLampGroupMembership(id, groupName, checked) {
  registry.groups ||= {};
  registry.groups[groupName] ||= [];
  const set = new Set(registry.groups[groupName]);
  if (checked) set.add(id); else set.delete(id);
  registry.groups[groupName] = Array.from(set);
  updateGroupsJsonEditor();
}

async function createGroup(name) {
  const groupName = String(name || '').trim();
  if (!groupName) throw new Error(L('Gruppenname fehlt', 'Group name is required'));
  if (registry.groups[groupName]) throw new Error(L('Gruppe existiert bereits', 'Group already exists'));
  registry.groups[groupName] = [];
  await persist();
}
async function renameGroup(oldName, nextName) {
  const cleanNext = String(nextName || '').trim();
  if (!cleanNext) throw new Error(L('Neuer Gruppenname fehlt', 'New group name is required'));
  if (cleanNext === oldName) return;
  if (registry.groups[cleanNext]) throw new Error(L('Gruppe existiert bereits', 'Group already exists'));
  registry.groups[cleanNext] = [...(registry.groups[oldName] || [])];
  delete registry.groups[oldName];
  await persist();
}
async function deleteGroup(groupName) { delete registry.groups[groupName]; await persist(); }
async function deleteLamp(lampId) { delete registry.lamps[lampId]; registry = normalizeRegistryLocal(registry); await persist(); }
async function repairRegistry() { registry = normalizeRegistryLocal(registry); resequenceLampSortOrders(); await persist(); }

async function confirmDialogAction() {
  if (!dialogState) return;
  try {
    if (dialogState.type === 'group-create') {
      await createGroup(document.getElementById('dialogGroupName')?.value || dialogState.value || '');
      log(L('Gruppe erstellt', 'Group created'));
    } else if (dialogState.type === 'group-rename') {
      await renameGroup(dialogState.groupName, document.getElementById('dialogGroupName')?.value || dialogState.groupName);
      log(L('Gruppe umbenannt', 'Group renamed'));
    } else if (dialogState.type === 'group-delete') {
      await deleteGroup(dialogState.groupName);
      log(L(`Gruppe ${dialogState.groupName} gelöscht`, `Deleted group ${dialogState.groupName}`));
    } else if (dialogState.type === 'lamp-delete') {
      await deleteLamp(dialogState.lampId);
      log(L(`Lampe ${dialogState.lampId} gelöscht`, `Deleted lamp ${dialogState.lampId}`));
    } else if (dialogState.type === 'add-discovered') {
      const i = dialogState.index;
      const d = discovered[i];
      if (!d) throw new Error(L('Discovery-Eintrag nicht gefunden', 'Discovery item not found'));
      const id = slugify(document.getElementById('dialogLampId')?.value || dialogState.suggestedId || '');
      if (!id) throw new Error(L('Lamp ID fehlt', 'Lamp ID is required'));
      if (registry.lamps[id]) throw new Error(L('Lamp ID existiert bereits', 'Lamp ID already exists'));
      registry.lamps[id] = { ...defaultLamp(d.name || id), ip: d.ip || '', device_id: d.gwId || '', version: Number(d.version || 3.3) || 3.3, notes: `Added from network discovery. local_key still required.${d.productKey ? ` productKey=${d.productKey}.` : ''}${(d.category || d.categoryCode) ? ` category=${d.category || d.categoryCode}.` : ''}` };
      resequenceLampSortOrders();
      await persist();
      log(L(`Discovery-Gerät als ${id} angelegt. local_key bitte noch ergänzen.`, `Added discovered device as ${id}. Please add local_key.`));
    }
    closeDialog();
    await load();
  } catch (e) {
    log(`${L('Dialog-Aktion fehlgeschlagen', 'Dialog action failed')}: ${e.message}`);
  }
}

async function syncLevelsFromStatus() {
  const lamps = lampEntriesSorted().map(([id]) => id);
  for (const id of lamps) {
    try {
      const r = await runAction(id, 'status');
      const dps = r?.result?.result?.dps || {};
      const lamp = registry?.lamps?.[id] || {};
      lamp.last_status_sample = dps;
      const b = dpsToPct(dps['22']);
      const tRaw = dpsToPct(dps['23']);
      const t = displayTempPctForLamp(lamp, tRaw);
      const h = dps24ToHue(dps['24']);
      if (!uiLevels[id]) uiLevels[id] = { brightness: 50, temp: 50, hue: 0 };
      if (b !== null) uiLevels[id].brightness = b;
      if (t !== null) uiLevels[id].temp = t;
      if (h !== null) uiLevels[id].hue = h;
      setLampHealth(id, statusPayloadOnline(r?.result), statusPayloadError(r?.result));
      applyLampHealthToCard(id);
    } catch (e) {
      setLampHealth(id, false, e.message || 'Status failed');
      applyLampHealthToCard(id);
      log(`${id} ${L('Sync übersprungen', 'sync skipped')}: ${e.message}`);
    }
  }
  render();
}

function wireEvents() {
  document.getElementById('langSelect').onchange = (e) => setLanguage(e.target.value);
  document.getElementById('refresh').onclick = () => load();
  document.getElementById('syncNow').onclick = async () => { log(L('Werte-Sync gestartet…', 'Value sync started...')); await syncLevelsFromStatus(); log(L('Werte-Sync fertig.', 'Value sync finished.')); };
  document.getElementById('toggleAdvancedPanel').onclick = () => { uiPanels.advancedOpen = !uiPanels.advancedOpen; render(); };
  document.getElementById('toggleRawPanel').onclick = () => { uiPanels.rawOpen = !uiPanels.rawOpen; render(); };
  document.getElementById('toggleDiagnosticsBtn')?.addEventListener('click', () => { uiPanels.diagnosticsOpen = !uiPanels.diagnosticsOpen; render(); });
  document.getElementById('save')?.addEventListener('click', async () => { try { registry = normalizeRegistryLocal(JSON.parse(document.getElementById('json').value)); await persist(); log(L('Registry gespeichert', 'Registry saved')); await load(); } catch (e) { log(`${L('Speichern fehlgeschlagen', 'Save failed')}: ${e.message}`); } });
  document.getElementById('saveGroups').onclick = async () => { try { registry.groups = JSON.parse(document.getElementById('groupsJson').value); registry = normalizeRegistryLocal(registry); await persist(); log(L('Gruppen gespeichert', 'Groups saved')); await load(); } catch (e) { log(`${L('Gruppen speichern fehlgeschlagen', 'Saving groups failed')}: ${e.message}`); } };
  document.getElementById('createGroupBtn').onclick = () => openDialog('group-create');
  document.getElementById('repairRegistryBtn').onclick = async () => { try { await repairRegistry(); log(L('Registry bereinigt', 'Registry normalized')); await load(); } catch (e) { log(`${L('Repair fehlgeschlagen', 'Repair failed')}: ${e.message}`); } };

  document.getElementById('addLampBtn').onclick = async () => {
    try {
      const id = slugify(document.getElementById('addId').value || '');
      if (!id) throw new Error(L('Lamp ID fehlt', 'Lamp ID is required'));
      if (registry.lamps[id]) throw new Error(L('Lamp ID existiert bereits', 'Lamp ID already exists'));
      const lamp = defaultLamp(document.getElementById('addName').value || id);
      lamp.ip = (document.getElementById('addIp').value || '').trim();
      lamp.device_id = (document.getElementById('addDev').value || '').trim();
      lamp.local_key = (document.getElementById('addKey').value || '').trim();
      lamp.version = Number(document.getElementById('addVer').value || 3.3) || 3.3;
      const productKey = (document.getElementById('addProductKey').value || '').trim();
      const category = (document.getElementById('addCategory').value || '').trim();
      lamp.notes = [productKey ? `productKey=${productKey}` : '', category ? `category=${category}` : ''].filter(Boolean).join(' | ');
      registry.lamps[id] = lamp;
      resequenceLampSortOrders();
      onboardingDraft = null;
      await persist();
      log(L(`Lampe ${id} hinzugefügt`, `Added lamp ${id}`));
      await load();
    } catch (e) { log(`${L('Hinzufügen fehlgeschlagen', 'Add failed')}: ${e.message}`); }
  };

  document.getElementById('testOnboardingBtn').onclick = async () => {
    try {
      const tempId = '__onboarding_test__';
      const lamp = defaultLamp(document.getElementById('addName').value || tempId);
      lamp.ip = (document.getElementById('addIp').value || '').trim();
      lamp.device_id = (document.getElementById('addDev').value || '').trim();
      lamp.local_key = (document.getElementById('addKey').value || '').trim();
      lamp.version = Number(document.getElementById('addVer').value || 3.3) || 3.3;
      if (!lamp.device_id || !lamp.ip || !lamp.local_key) throw new Error(L('Für den lokalen Test brauchst du device_id, ip und local_key.', 'For a local test you still need device_id, ip and local_key.'));
      registry.lamps[tempId] = lamp;
      try {
        await persist();
        const r = await runAction(tempId, 'status');
        log(`${L('Onboarding-Test ok', 'Onboarding test ok')}: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`);
      } finally {
        delete registry.lamps[tempId];
        await persist();
      }
    } catch (e) { log(`${L('Onboarding-Test fehlgeschlagen', 'Onboarding test failed')}: ${e.message} | ${formatExec(e?.payload?.exec)}`); }
  };

  document.getElementById('clearOnboardingBtn').onclick = () => { onboardingDraft = null; render(); };
  document.getElementById('discoverBtn').onclick = async () => { try { log(L('Discovery gestartet…', 'Discovery started...')); const r = await api('/api/discover', { method: 'POST', body: '{}' }); discovered = r?.result?.devices || []; log(`${L('Discovery fertig', 'Discovery finished')}: ${discovered.length} ${L('Geräte gefunden', 'devices found')} | ${formatExec(r.exec)}`); render(); } catch (e) { log(`${L('Discovery fehlgeschlagen', 'Discovery failed')}: ${e.message} | ${formatExec(e?.payload?.exec)}`); } };

  document.getElementById('dialogBackdrop')?.addEventListener('click', (e) => { if (e.target.id === 'dialogBackdrop') closeDialog(); });
  document.getElementById('dialogCancel')?.addEventListener('click', () => closeDialog());
  document.getElementById('dialogConfirm')?.addEventListener('click', () => confirmDialogAction());
  document.getElementById('dialogGroupName')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmDialogAction(); if (e.key === 'Escape') closeDialog(); });
  document.getElementById('dialogLampId')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmDialogAction(); if (e.key === 'Escape') closeDialog(); });

  app.querySelectorAll('[data-group-member]').forEach((input) => { input.onchange = async () => { const id = input.getAttribute('data-group-member'); const groupName = input.getAttribute('data-group-name'); updateLampGroupMembership(id, groupName, input.checked); try { await persist(); log(L(`Gruppen für ${id} aktualisiert`, `Updated groups for ${id}`)); await load(); } catch (e) { log(`${L('Gruppen-Update fehlgeschlagen', 'Group update failed')}: ${e.message}`); } }; });
  app.querySelectorAll('[data-group-act]').forEach((btn) => { btn.onclick = async () => { const target = btn.getAttribute('data-group-name'); const action = btn.getAttribute('data-group-act'); try { const r = await runAction(target, action); log(`${target} ${action}: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } catch (e) { log(`${target} ${action} ${L('fehlgeschlagen', 'failed')}: ${e.message} | ${formatExec(e?.payload?.exec)}`); } }; });
  app.querySelectorAll('[data-group-rename]').forEach((btn) => { btn.onclick = () => openDialog('group-rename', { groupName: btn.getAttribute('data-group-rename') }); });
  app.querySelectorAll('[data-group-delete]').forEach((btn) => { btn.onclick = () => openDialog('group-delete', { groupName: btn.getAttribute('data-group-delete') }); });

  app.querySelectorAll('[data-act]').forEach((btn) => { btn.onclick = async () => { const target = btn.getAttribute('data-target'); const action = btn.getAttribute('data-act'); try { const r = await runAction(target, action); if (action === 'status') { const online = statusPayloadOnline(r?.result); setLampHealth(target, online, statusPayloadError(r?.result)); const dps = r?.result?.result?.dps || {}; const lamp = registry?.lamps?.[target] || {}; lamp.last_status_sample = dps; const b = dpsToPct(dps['22']); const tRaw = dpsToPct(dps['23']); const t = displayTempPctForLamp(lamp, tRaw); const h = dps24ToHue(dps['24']); if (!uiLevels[target]) uiLevels[target] = { brightness: 50, temp: 50, hue: 0 }; if (b !== null) uiLevels[target].brightness = b; if (t !== null) uiLevels[target].temp = t; if (h !== null) uiLevels[target].hue = h; render(); log(`${target} ${action}: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); return; } log(`${target} ${action}: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } catch (e) { if (action === 'status') { setLampHealth(target, false, e.message || 'Status failed'); applyLampHealthToCard(target); } log(`${target} ${action} ${L('fehlgeschlagen', 'failed')}: ${e.message} | ${formatExec(e?.payload?.exec)}`); } }; });

  app.querySelectorAll('[data-del]').forEach((btn) => { btn.onclick = () => openDialog('lamp-delete', { lampId: btn.getAttribute('data-del') }); });
  app.querySelectorAll('[data-move-up]').forEach((btn) => { btn.onclick = async () => { const id = btn.getAttribute('data-move-up'); if (!moveLamp(id, -1)) return; try { await persist(); log(L(`${id} nach oben verschoben`, `Moved ${id} up`)); await load(); } catch (e) { log(`${L('Verschieben fehlgeschlagen', 'Move failed')}: ${e.message}`); } }; });
  app.querySelectorAll('[data-move-down]').forEach((btn) => { btn.onclick = async () => { const id = btn.getAttribute('data-move-down'); if (!moveLamp(id, 1)) return; try { await persist(); log(L(`${id} nach unten verschoben`, `Moved ${id} down`)); await load(); } catch (e) { log(`${L('Verschieben fehlgeschlagen', 'Move failed')}: ${e.message}`); } }; });

  app.querySelectorAll('[data-lamp-id]').forEach((card) => {
    const id = card.getAttribute('data-lamp-id');
    card.addEventListener('dragstart', () => { draggedLampId = id; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { draggedLampId = null; card.classList.remove('dragging'); app.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over')); });
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (!moveLampBefore(draggedLampId, id)) return;
      try {
        await persist();
        log(L(`${draggedLampId} vor ${id} einsortiert`, `Reordered ${draggedLampId} before ${id}`));
        await load();
      } catch (err) {
        log(`${L('Neu sortieren fehlgeschlagen', 'Reorder failed')}: ${err.message}`);
      }
    });
  });

  app.querySelectorAll('[data-onboard-discovered]').forEach((btn) => { btn.onclick = () => { const i = Number(btn.getAttribute('data-onboard-discovered')); const d = discovered[i]; if (!d) return; const suggested = (btn.getAttribute('data-suggested-id') || '').toLowerCase(); onboardingDraft = { id: suggested, name: d.name || suggested, ip: d.ip || '', device_id: d.gwId || '', local_key: '', version: String(Number(d.version || 3.3) || 3.3), productKey: d.productKey || '', category: d.category || d.categoryCode || '' }; render(); log(L(`Discovery-Eintrag in Onboarding geladen: ${suggested}`, `Loaded discovery item into onboarding: ${suggested}`)); document.getElementById('addId')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }; });
  app.querySelectorAll('[data-add-discovered]').forEach((btn) => { btn.onclick = () => openDialog('add-discovered', { index: Number(btn.getAttribute('data-add-discovered')), suggestedId: btn.getAttribute('data-suggested-id') || '' }); });
  app.querySelectorAll('[data-edit]').forEach((btn) => { btn.onclick = () => { editId = btn.getAttribute('data-edit'); render(); }; });

  app.querySelectorAll('[data-brightness]').forEach((input) => { input.oninput = () => { const id = input.getAttribute('data-brightness'); const val = input.value; const label = document.getElementById(`bval-${id}`); if (label) label.textContent = `${val}%`; if (!uiLevels[id]) uiLevels[id] = { brightness: 50, temp: 50, hue: 0 }; uiLevels[id].brightness = Number(val); scheduleDebounced(`brightness:${id}`, async () => { try { const r = await runAction(id, 'brightness', val); log(`${id} brightness ${val}%: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } catch (e) { log(`${id} brightness ${L('fehlgeschlagen', 'failed')}: ${e.message} | ${formatExec(e?.payload?.exec)}`); } }, 1000); }; });
  app.querySelectorAll('[data-temp]').forEach((input) => { input.oninput = () => { const id = input.getAttribute('data-temp'); const val = input.value; const label = document.getElementById(`tval-${id}`); if (label) label.textContent = `${val}%`; if (!uiLevels[id]) uiLevels[id] = { brightness: 50, temp: 50, hue: 0 }; uiLevels[id].temp = Number(val); scheduleDebounced(`temp:${id}`, async () => { try { const lamp = registry?.lamps?.[id] || {}; const sendVal = requestTempPctForLamp(lamp, val); const r = await runAction(id, 'temp', String(sendVal)); log(`${id} temp ${val}% (raw ${sendVal}%): ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } catch (e) { log(`${id} temp ${L('fehlgeschlagen', 'failed')}: ${e.message} | ${formatExec(e?.payload?.exec)}`); } }, 1000); }; });
  app.querySelectorAll('[data-hue]').forEach((input) => { input.oninput = () => { const id = input.getAttribute('data-hue'); const val = input.value; const label = document.getElementById(`hval-${id}`); if (label) label.textContent = `${val}°`; if (!uiLevels[id]) uiLevels[id] = { brightness: 50, temp: 50, hue: 0 }; uiLevels[id].hue = Number(val); scheduleDebounced(`hue:${id}`, async () => { try { const r = await runAction(id, 'hue', val); log(`${id} hue ${val}°: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } catch (e) { log(`${id} hue ${L('fehlgeschlagen', 'failed')}: ${e.message} | ${formatExec(e?.payload?.exec)}`); } }, 1000); }; });
  app.querySelectorAll('[data-color]').forEach((btn) => { btn.onclick = async () => { const id = btn.getAttribute('data-color'); const val = btn.getAttribute('data-value'); const action = (val === 'warmweiß') ? 'warmwhite' : (val === 'kaltweiß' ? 'coldwhite' : 'color'); const value = action === 'color' ? val : undefined; try { const r = await runAction(id, action, value); log(`${id} ${action}${value ? ` ${value}` : ''}: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } catch (e) { log(`${id} ${action} ${L('fehlgeschlagen', 'failed')}: ${e.message} | ${formatExec(e?.payload?.exec)}`); } }; });

  const modalClose = document.getElementById('modalClose');
  if (modalClose) {
    modalClose.onclick = (e) => { if (e.target === modalClose) { editId = null; render(); } };
    document.getElementById('m_cancel').onclick = () => { editId = null; render(); };
    document.getElementById('m_save').onclick = async () => { try { const lamp = registry.lamps[editId]; lamp.name = document.getElementById('m_name').value.trim(); lamp.ip = document.getElementById('m_ip').value.trim(); lamp.device_id = document.getElementById('m_device').value.trim(); lamp.local_key = document.getElementById('m_key').value.trim(); lamp.version = Number(document.getElementById('m_version').value || 3.3) || 3.3; lamp.notes = document.getElementById('m_notes').value.trim(); await persist(); log(L(`Lampe ${editId} aktualisiert`, `Updated lamp ${editId}`)); editId = null; await load(); } catch (e) { log(`${L('Update fehlgeschlagen', 'Update failed')}: ${e.message}`); } };
    document.getElementById('m_test').onclick = async () => { try { const r = await runAction(editId, 'status'); log(`${L('Test', 'Test')} ${editId}: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } catch (e) { log(`${L('Test fehlgeschlagen', 'Test failed')}: ${e.message} | ${formatExec(e?.payload?.exec)}`); } };
  }
}

load().catch((e) => { app.innerHTML = `<main class="wrap"><h1>Tuya Lights v1.4</h1><p>${esc(L('API konnte nicht geladen werden', 'Failed to load API'))}: ${esc(e.message)}</p></main>`; });
