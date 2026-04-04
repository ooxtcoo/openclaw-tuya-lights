import './styles.css';

const app = document.getElementById('app');
const API = 'http://127.0.0.1:4890';

let registry = null;
let catalog = null;
let editId = null;
let discovered = [];
let onboardingDraft = null;
let uiLevels = {};
let lampHealth = {};
let backendInfo = null;
const debounceTimers = new Map();

function esc(s=''){ return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }

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

async function load() {
  const [data, cat, health] = await Promise.all([
    api('/api/lamps'),
    api('/api/catalog').catch(() => ({ templates: {} })),
    api('/api/health').catch(() => null)
  ]);
  registry = data;
  catalog = cat;
  backendInfo = health;
  render();
  syncLevelsFromStatus();
}

function defaultLamp(name = 'Neue Lampe') {
  return { name, device_id: '', ip: '', local_key: '', version: 3.3, type: 'bulb', notes: '', dps: { power: 20 } };
}
function dpsToPct(v) { const n = Number(v); if (!Number.isFinite(n)) return null; if (n <= 100) return Math.max(0, Math.min(100, Math.round(n))); return Math.max(0, Math.min(100, Math.round((n / 1000) * 100))); }
function dps24ToHue(v) { if (typeof v !== 'string' || v.length < 4) return null; const n = Number.parseInt(v.slice(0, 4), 16); if (!Number.isFinite(n)) return null; return Math.max(0, Math.min(360, n)); }
function scheduleDebounced(key, fn, ms = 1000) { const old = debounceTimers.get(key); if (old) clearTimeout(old); const t = setTimeout(async () => { debounceTimers.delete(key); await fn(); }, ms); debounceTimers.set(key, t); }
function setLampHealth(id, online, error = '') { lampHealth[id] = { online: Boolean(online), error: String(error || '') }; }
function applyLampHealthToCard(id) { const card = app.querySelector(`[data-lamp-card="${id}"]`); if (!card) return; const st = lampHealth[id]; if (!st || st.online === undefined || st.online === null) return; const badge = card.querySelector(`[data-health-badge="${id}"]`); const offline = st.online === false; card.classList.toggle('offline', offline); card.querySelectorAll('[data-offline-disable="1"]').forEach((el) => { el.disabled = offline; }); if (badge) { badge.textContent = offline ? 'offline' : 'online'; badge.classList.toggle('is-offline', offline); badge.classList.toggle('is-online', !offline); badge.title = offline ? (st.error || 'Nicht erreichbar') : 'Erreichbar'; } }
function applyLampHealthToAllCards() { Object.keys(registry?.lamps || {}).forEach((id) => applyLampHealthToCard(id)); }

async function syncLevelsFromStatus() {
  const lamps = Object.keys(registry?.lamps || {});
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
      setLampHealth(id, true);
      applyLampHealthToCard(id);
    } catch (e) {
      setLampHealth(id, false, e.message || 'Status failed');
      applyLampHealthToCard(id);
      log(`${id} sync skipped: ${e.message}`);
    }
  }
  render();
}

function inferDeviceTemplate(lamp = {}) {
  const dps = lamp?.dps || {}; const sample = lamp?.last_status_sample || {}; const type = String(lamp?.type || '').toLowerCase();
  if (type === 'bulb') return 'bulb'; if (type === 'plug' || type === 'socket' || type === 'outlet') return 'plug'; if (type === 'switch') return 'switch';
  if (dps.power || dps.switch_led) return 'device'; if (dps.colour_data || dps.color_data || dps.light_param_24 || sample['24']) return 'bulb'; if (dps.brightness || dps.bright_value || sample['22']) return 'bulb'; if (dps.temp || dps.temp_value || sample['23']) return 'bulb'; if (dps.mode || dps.work_mode || sample['21']) return 'bulb'; return 'device';
}
function inferCapabilities(lamp = {}, meta = {}) {
  const dps = lamp?.dps || {}; const sample = lamp?.last_status_sample || {}; const catalogCaps = meta?.capabilities || {};
  return { power: Boolean(catalogCaps.power || dps.power || dps.switch_led || sample['20'] !== undefined || sample['1'] !== undefined), brightness: Boolean(catalogCaps.brightness || dps.brightness || dps.bright_value || sample['22'] !== undefined), white_temp: Boolean(catalogCaps.white_temp || dps.temp || dps.temp_value || sample['23'] !== undefined), color: Boolean(catalogCaps.color || dps.colour_data || dps.color_data || dps.light_param_24 || sample['24']), hue: Boolean(catalogCaps.hue || dps.colour_data || dps.color_data || dps.light_param_24 || sample['24']) };
}
function getTemplateMeta(lamp = {}) { const templateKey = inferDeviceTemplate(lamp); const meta = catalog?.templates?.[templateKey] || catalog?.templates?.device || { label: 'Gerät', icon: '📦', capabilities: { power: true } }; return { templateKey, meta }; }
function lampHasColor(lamp = {}) { const dps = lamp?.dps || {}; const sample = lamp?.last_status_sample || {}; return Boolean(dps.colour_data || dps.color_data || dps.light_param_24 || sample['24'] || sample[24]); }
function displayTempPctForLamp(lamp, rawPct) { if (rawPct === null || rawPct === undefined) return null; const n = Number(rawPct); if (!Number.isFinite(n)) return null; return lampHasColor(lamp) ? n : (100 - n); }
function requestTempPctForLamp(lamp, displayPct) { const n = Number(displayPct); if (!Number.isFinite(n)) return displayPct; return lampHasColor(lamp) ? n : (100 - n); }
function lampGroups(id) { return Object.keys(registry?.groups || {}).filter((g) => (registry.groups[g] || []).includes(id)); }

function backendBadgeHtml() {
  if (!backendInfo) return '<div class="backend-badge">Backend: unknown</div>';
  const mode = backendInfo.backendMode || (backendInfo.useLampctl ? 'lampctl' : 'python');
  return `<button id="backendBadge" class="backend-badge ${esc(mode)}">Backend: ${esc(mode)}</button>`;
}

function backendModalHtml() {
  if (!backendInfo) return '';
  const mode = backendInfo.backendMode || (backendInfo.useLampctl ? 'lampctl' : 'python');
  const options = [];
  if (backendInfo.hasLampctl) options.push(`<button id="modeLampctl">Go / lampctl</button>`);
  if (backendInfo.hasPythonBackend) options.push(`<button id="modePython">Python</button>`);
  return `<div class="modal-backdrop hidden" id="backendModalBackdrop"><div class="modal backend-modal"><h3>Backend wählen</h3><p class="muted">Aktiv: <strong>${esc(mode)}</strong></p><div class="backend-options">${options.join('')}</div><div class="muted" style="margin-top:10px">Platform: ${esc(backendInfo.platform || '-')}<br>Preferred: ${esc(backendInfo.preferredBackend || '-')}<br>lampctl: ${esc(backendInfo.lampctlPath || '-')}</div><div class="actions" style="margin-top:12px"><button id="backendModalClose">Close</button></div></div></div>`;
}

function groupControlsHtml(id) {
  const groups = Object.keys(registry?.groups || {});
  if (!groups.length) return '<div class="lamp-groups muted">No groups defined yet.</div>';
  return `<div class="lamp-groups"><div class="lamp-groups-title">Groups</div><div class="group-checks">${groups.map((g) => `<label><input type="checkbox" data-group-member="${esc(id)}" data-group-name="${esc(g)}" ${lampGroups(id).includes(g) ? 'checked' : ''}> ${esc(g)}</label>`).join('')}</div></div>`;
}

function lampCard(id, lamp) {
  const b = uiLevels[id]?.brightness ?? 50; const t = uiLevels[id]?.temp ?? 50; const h = uiLevels[id]?.hue ?? 0; const { templateKey, meta } = getTemplateMeta(lamp); const capabilities = inferCapabilities(lamp, meta); const tempLabel = lampHasColor(lamp) ? 'Farbton Weiß (kalt → warm)' : 'Farbton Weiß (warm → kalt)';
  return `<div class="card" data-lamp-card="${esc(id)}"><div class="row"><h3>${esc(meta?.icon || '📦')} ${esc(lamp.name || id)}</h3><span class="id">${esc(id)}</span></div><div class="meta">${esc(meta?.label || templateKey)} • IP ${esc(lamp.ip || '-')} • v${esc(lamp.version || '-')} • <span class="health-badge" data-health-badge="${esc(id)}">unknown</span></div><div class="actions"><button data-act="on" data-target="${esc(id)}" data-offline-disable="1">On</button><button data-act="off" data-target="${esc(id)}" data-offline-disable="1">Off</button><button data-act="status" data-target="${esc(id)}">Status</button><button data-edit="${esc(id)}">Edit</button><button data-del="${esc(id)}">Delete</button></div>${capabilities.brightness ? `<div class="slider-wrap"><label>Brightness <span id="bval-${esc(id)}">${b}%</span></label><input type="range" min="1" max="100" value="${b}" data-brightness="${esc(id)}" data-offline-disable="1" /></div>` : ''}${capabilities.white_temp ? `<div class="slider-wrap"><label>${tempLabel} <span id="tval-${esc(id)}">${t}%</span></label><input type="range" min="0" max="100" value="${t}" data-temp="${esc(id)}" data-offline-disable="1" /></div>` : ''}${capabilities.hue ? `<div class="slider-wrap"><label>Farbe (stufenlos) <span id="hval-${esc(id)}">${h}°</span></label><input class="hue-slider" type="range" min="0" max="360" value="${h}" data-hue="${esc(id)}" data-offline-disable="1" /></div>` : ''}${capabilities.color || capabilities.white_temp ? `<div class="color-row">${capabilities.color ? `<button data-color="${esc(id)}" data-value="rot" data-offline-disable="1">Rot</button><button data-color="${esc(id)}" data-value="blau" data-offline-disable="1">Blau</button><button data-color="${esc(id)}" data-value="grün" data-offline-disable="1">Grün</button>` : ''}${capabilities.white_temp ? `<button data-color="${esc(id)}" data-value="warmweiß" data-offline-disable="1">Warmweiß</button><button data-color="${esc(id)}" data-value="kaltweiß" data-offline-disable="1">Kaltweiß</button>` : ''}</div>` : ''}${groupControlsHtml(id)}</div>`;
}

function groupChips(groups) { return Object.keys(groups).map(g => `<button class="chip" data-group="${esc(g)}">${esc(g)} OFF</button>`).join(''); }
function discoveryHtml() { if (!discovered.length) return '<p class="muted">No discovery results yet.</p>'; return discovered.map((d, i) => { const suggestedId = (d.name || `tuya_${i+1}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `tuya_${i+1}`; return `<div class="discover-item"><div><strong>${esc(d.name || 'Unknown')}</strong> • ${esc(d.ip || '-')} • v${esc(d.version || '-')}</div><div class="muted">gwId: ${esc(d.gwId || '-')} | productKey: ${esc(d.productKey || '-')} | category: ${esc(d.category || d.categoryCode || '-')}</div><div class="actions" style="margin-top:6px"><button data-onboard-discovered="${i}" data-suggested-id="${esc(suggestedId)}">Use for onboarding</button><button data-add-discovered="${i}" data-suggested-id="${esc(suggestedId)}">Add to registry</button></div></div>`; }).join(''); }
function renderModal() { if (!editId) return ''; const lamp = registry.lamps[editId]; if (!lamp) return ''; return `<div class="modal-backdrop" id="modalClose"><div class="modal" id="modalBody"><h3>Edit Lamp: ${esc(editId)}</h3><div class="form-grid"><input id="m_name" placeholder="name" value="${esc(lamp.name || '')}" /><input id="m_ip" placeholder="ip" value="${esc(lamp.ip || '')}" /><input id="m_device" placeholder="device_id" value="${esc(lamp.device_id || '')}" /><input id="m_key" placeholder="local_key" value="${esc(lamp.local_key || '')}" /><input id="m_version" placeholder="version" value="${esc(lamp.version || 3.3)}" /><input id="m_notes" placeholder="notes" value="${esc(lamp.notes || '')}" /></div><div class="actions" style="margin-top:10px"><button id="m_save">Save</button><button id="m_test">Test Status</button><button id="m_cancel">Cancel</button></div></div></div>`; }
function onboardingValue(key, fallback = '') { return onboardingDraft?.[key] ?? fallback; }

function render() {
  if (!registry) { app.innerHTML = '<main class="wrap">Loading…</main>'; return; }
  const lamps = registry.lamps || {}; const groups = registry.groups || {};
  app.innerHTML = `<main class="wrap"><header><div><h1>Tuya Lights v1.1</h1>${backendBadgeHtml()}</div><div class="header-actions"><button id="refresh">Refresh</button><button id="syncNow">Sync values</button><button id="save">Save JSON</button></div></header><section class="panel"><h2>Quick Groups</h2><div class="chips">${groupChips(groups)}</div></section><section class="panel"><h2>Onboarding (add new lamp)</h2><div class="muted" style="margin-bottom:10px">Discovery can prefill this form. A real local status test still needs the correct <code>local_key</code>.</div><div class="form-grid"><input id="addId" placeholder="lamp id (e.g. bedroom_main)" value="${esc(onboardingValue('id'))}" /><input id="addName" placeholder="name" value="${esc(onboardingValue('name'))}" /><input id="addIp" placeholder="ip" value="${esc(onboardingValue('ip'))}" /><input id="addDev" placeholder="device_id / gwId" value="${esc(onboardingValue('device_id'))}" /><input id="addKey" placeholder="local_key" value="${esc(onboardingValue('local_key'))}" /><input id="addVer" placeholder="version" value="${esc(onboardingValue('version', '3.3'))}" /><input id="addProductKey" placeholder="productKey" value="${esc(onboardingValue('productKey'))}" /><input id="addCategory" placeholder="category" value="${esc(onboardingValue('category'))}" /></div><div class="actions" style="margin-top:8px"><button id="addLampBtn">Add Lamp</button><button id="testOnboardingBtn">Test Status</button><button id="clearOnboardingBtn">Clear</button></div></section><section class="panel"><h2>Discovery</h2><div class="actions"><button id="discoverBtn">Scan network for Tuya devices</button></div><div id="discoverList" class="discover-list">${discoveryHtml()}</div></section><section class="panel"><h2>Lamps</h2><div class="grid">${Object.entries(lamps).map(([id,l]) => lampCard(id,l)).join('')}</div></section><section class="panel"><h2>Groups Editor</h2><textarea id="groupsJson">${esc(JSON.stringify(groups, null, 2))}</textarea><div class="actions" style="margin-top:8px"><button id="saveGroups">Save Groups</button></div></section><section class="panel"><h2>Registry Editor</h2><textarea id="json">${esc(JSON.stringify(registry, null, 2))}</textarea></section><section class="panel" id="logPanel"><h2>Log</h2><pre id="log"></pre></section></main>${renderModal()}${backendModalHtml()}`;
  wireEvents(); applyLampHealthToAllCards();
}

async function persist() { await api('/api/lamps', { method: 'PUT', body: JSON.stringify(registry) }); }
async function runAction(target, action, value) { if (action === 'status') return api('/api/status', { method: 'POST', body: JSON.stringify({ target }) }); return api('/api/action', { method: 'POST', body: JSON.stringify({ target, action, value }) }); }
async function setBackendMode(mode) { backendInfo = await api('/api/backend-mode', { method: 'POST', body: JSON.stringify({ mode }) }); const health = await api('/api/health'); backendInfo = { ...backendInfo, ...health }; render(); log(`Backend switched to ${backendInfo.backendMode}`); }

function updateLampGroupMembership(id, groupName, checked) {
  registry.groups ||= {};
  registry.groups[groupName] ||= [];
  const set = new Set(registry.groups[groupName]);
  if (checked) set.add(id); else set.delete(id);
  registry.groups[groupName] = Array.from(set).sort();
}

function wireEvents() {
  document.getElementById('refresh').onclick = () => load();
  document.getElementById('syncNow').onclick = async () => { log('Sync values started...'); await syncLevelsFromStatus(); log('Sync values done.'); };
  document.getElementById('save').onclick = async () => { try { registry = JSON.parse(document.getElementById('json').value); await persist(); log('Saved registry'); await load(); } catch (e) { log(`Save failed: ${e.message}`); } };
  document.getElementById('saveGroups').onclick = async () => { try { registry.groups = JSON.parse(document.getElementById('groupsJson').value); await persist(); log('Saved groups'); await load(); } catch (e) { log(`Save groups failed: ${e.message}`); } };
  document.getElementById('addLampBtn').onclick = async () => { try { const id = (document.getElementById('addId').value || '').trim().toLowerCase(); if (!id) throw new Error('Lamp id required'); if (registry.lamps[id]) throw new Error('Lamp id already exists'); const lamp = defaultLamp(document.getElementById('addName').value || id); lamp.ip = (document.getElementById('addIp').value || '').trim(); lamp.device_id = (document.getElementById('addDev').value || '').trim(); lamp.local_key = (document.getElementById('addKey').value || '').trim(); lamp.version = Number(document.getElementById('addVer').value || 3.3) || 3.3; const productKey = (document.getElementById('addProductKey').value || '').trim(); const category = (document.getElementById('addCategory').value || '').trim(); lamp.notes = [productKey ? `productKey=${productKey}` : '', category ? `category=${category}` : ''].filter(Boolean).join(' | '); registry.lamps[id] = lamp; onboardingDraft = null; await persist(); log(`Added lamp ${id}`); await load(); } catch (e) { log(`Add failed: ${e.message}`); } };
  document.getElementById('testOnboardingBtn').onclick = async () => { try { const tempId = '__onboarding_test__'; const lamp = defaultLamp(document.getElementById('addName').value || tempId); lamp.ip = (document.getElementById('addIp').value || '').trim(); lamp.device_id = (document.getElementById('addDev').value || '').trim(); lamp.local_key = (document.getElementById('addKey').value || '').trim(); lamp.version = Number(document.getElementById('addVer').value || 3.3) || 3.3; if (!lamp.device_id || !lamp.ip || !lamp.local_key) throw new Error('For local test you still need device_id, ip and local_key. Discovery only prefills part of that.'); registry.lamps[tempId] = lamp; try { await persist(); const r = await runAction(tempId, 'status'); log(`Onboarding test ok: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } finally { delete registry.lamps[tempId]; await persist(); } } catch (e) { log(`Onboarding test failed: ${e.message} | ${formatExec(e?.payload?.exec)}`); } };
  document.getElementById('clearOnboardingBtn').onclick = () => { onboardingDraft = null; render(); };
  document.getElementById('discoverBtn').onclick = async () => { try { log('Discovery started...'); const r = await api('/api/discover', { method: 'POST', body: '{}' }); discovered = r?.result?.devices || []; log(`Discovery finished: ${discovered.length} devices found | ${formatExec(r.exec)}`); render(); } catch (e) { log(`Discovery failed: ${e.message} | ${formatExec(e?.payload?.exec)}`); } };
  const backendBadge = document.getElementById('backendBadge'); if (backendBadge) backendBadge.onclick = () => document.getElementById('backendModalBackdrop')?.classList.remove('hidden');
  document.getElementById('backendModalClose')?.addEventListener('click', () => document.getElementById('backendModalBackdrop')?.classList.add('hidden'));
  document.getElementById('backendModalBackdrop')?.addEventListener('click', (e) => { if (e.target.id === 'backendModalBackdrop') e.target.classList.add('hidden'); });
  document.getElementById('modeLampctl')?.addEventListener('click', async () => { try { await setBackendMode('lampctl'); document.getElementById('backendModalBackdrop')?.classList.add('hidden'); } catch (e) { log(`Switch backend failed: ${e.message}`); } });
  document.getElementById('modePython')?.addEventListener('click', async () => { try { await setBackendMode('python'); document.getElementById('backendModalBackdrop')?.classList.add('hidden'); } catch (e) { log(`Switch backend failed: ${e.message}`); } });
  app.querySelectorAll('[data-group-member]').forEach((input) => { input.onchange = async () => { const id = input.getAttribute('data-group-member'); const groupName = input.getAttribute('data-group-name'); updateLampGroupMembership(id, groupName, input.checked); document.getElementById('groupsJson').value = JSON.stringify(registry.groups, null, 2); try { await persist(); log(`Updated groups for ${id}`); } catch (e) { log(`Group update failed: ${e.message}`); } }; });
  app.querySelectorAll('[data-act]').forEach((btn) => { btn.onclick = async () => { const target = btn.getAttribute('data-target'); const action = btn.getAttribute('data-act'); try { const r = await runAction(target, action); if (action === 'status') { setLampHealth(target, true); const dps = r?.result?.result?.dps || {}; const lamp = registry?.lamps?.[target] || {}; lamp.last_status_sample = dps; const b = dpsToPct(dps['22']); const tRaw = dpsToPct(dps['23']); const t = displayTempPctForLamp(lamp, tRaw); const h = dps24ToHue(dps['24']); if (!uiLevels[target]) uiLevels[target] = { brightness: 50, temp: 50, hue: 0 }; if (b !== null) uiLevels[target].brightness = b; if (t !== null) uiLevels[target].temp = t; if (h !== null) uiLevels[target].hue = h; render(); log(`${target} ${action}: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); return; } log(`${target} ${action}: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } catch (e) { if (action === 'status') { setLampHealth(target, false, e.message || 'Status failed'); applyLampHealthToCard(target); } log(`${target} ${action} failed: ${e.message} | ${formatExec(e?.payload?.exec)}`); } }; });
  app.querySelectorAll('[data-group]').forEach((btn) => { btn.onclick = async () => { const target = btn.getAttribute('data-group'); try { const r = await runAction(target, 'off'); log(`${target} off: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } catch (e) { log(`${target} off failed: ${e.message} | ${formatExec(e?.payload?.exec)}`); } }; });
  app.querySelectorAll('[data-del]').forEach((btn) => { btn.onclick = async () => { const id = btn.getAttribute('data-del'); if (!confirm(`Delete lamp ${id}?`)) return; delete registry.lamps[id]; for (const g of Object.keys(registry.groups || {})) registry.groups[g] = (registry.groups[g] || []).filter(x => x !== id); try { await persist(); log(`Deleted lamp ${id}`); await load(); } catch (e) { log(`Delete failed: ${e.message}`); } }; });
  app.querySelectorAll('[data-onboard-discovered]').forEach((btn) => { btn.onclick = () => { const i = Number(btn.getAttribute('data-onboard-discovered')); const d = discovered[i]; if (!d) return; const suggested = (btn.getAttribute('data-suggested-id') || '').toLowerCase(); onboardingDraft = { id: suggested, name: d.name || suggested, ip: d.ip || '', device_id: d.gwId || '', local_key: '', version: String(Number(d.version || 3.3) || 3.3), productKey: d.productKey || '', category: d.category || d.categoryCode || '' }; render(); log(`Loaded discovery item into onboarding: ${suggested}. Add local_key to test/save.`); document.getElementById('addId')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }; });
  app.querySelectorAll('[data-add-discovered]').forEach((btn) => { btn.onclick = async () => { try { const i = Number(btn.getAttribute('data-add-discovered')); const d = discovered[i]; if (!d) throw new Error('Discovery item not found'); const suggested = (btn.getAttribute('data-suggested-id') || '').toLowerCase(); const id = (prompt('Lamp id for registry', suggested) || '').trim().toLowerCase(); if (!id) return; if (registry.lamps[id]) throw new Error('Lamp id already exists'); registry.lamps[id] = { ...defaultLamp(d.name || id), ip: d.ip || '', device_id: d.gwId || '', version: Number(d.version || 3.3) || 3.3, notes: `Added from network discovery. local_key still required.${d.productKey ? ` productKey=${d.productKey}.` : ''}${(d.category || d.categoryCode) ? ` category=${d.category || d.categoryCode}.` : ''}` }; await persist(); log(`Discovered device added as ${id}. Please fill local_key.`); await load(); } catch (e) { log(`Add discovered failed: ${e.message}`); } }; });
  app.querySelectorAll('[data-edit]').forEach((btn) => { btn.onclick = () => { editId = btn.getAttribute('data-edit'); render(); }; });
  app.querySelectorAll('[data-brightness]').forEach((input) => { input.oninput = () => { const id = input.getAttribute('data-brightness'); const val = input.value; const label = document.getElementById(`bval-${id}`); if (label) label.textContent = `${val}%`; if (!uiLevels[id]) uiLevels[id] = { brightness: 50, temp: 50, hue: 0 }; uiLevels[id].brightness = Number(val); scheduleDebounced(`brightness:${id}`, async () => { try { const r = await runAction(id, 'brightness', val); log(`${id} brightness ${val}%: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } catch (e) { log(`${id} brightness failed: ${e.message} | ${formatExec(e?.payload?.exec)}`); } }, 1000); }; });
  app.querySelectorAll('[data-temp]').forEach((input) => { input.oninput = () => { const id = input.getAttribute('data-temp'); const val = input.value; const label = document.getElementById(`tval-${id}`); if (label) label.textContent = `${val}%`; if (!uiLevels[id]) uiLevels[id] = { brightness: 50, temp: 50, hue: 0 }; uiLevels[id].temp = Number(val); scheduleDebounced(`temp:${id}`, async () => { try { const lamp = registry?.lamps?.[id] || {}; const sendVal = requestTempPctForLamp(lamp, val); const r = await runAction(id, 'temp', String(sendVal)); log(`${id} temp ${val}% (raw ${sendVal}%): ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } catch (e) { log(`${id} temp failed: ${e.message} | ${formatExec(e?.payload?.exec)}`); } }, 1000); }; });
  app.querySelectorAll('[data-hue]').forEach((input) => { input.oninput = () => { const id = input.getAttribute('data-hue'); const val = input.value; const label = document.getElementById(`hval-${id}`); if (label) label.textContent = `${val}°`; if (!uiLevels[id]) uiLevels[id] = { brightness: 50, temp: 50, hue: 0 }; uiLevels[id].hue = Number(val); scheduleDebounced(`hue:${id}`, async () => { try { const r = await runAction(id, 'hue', val); log(`${id} hue ${val}°: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } catch (e) { log(`${id} hue failed: ${e.message} | ${formatExec(e?.payload?.exec)}`); } }, 1000); }; });
  app.querySelectorAll('[data-color]').forEach((btn) => { btn.onclick = async () => { const id = btn.getAttribute('data-color'); const val = btn.getAttribute('data-value'); const action = (val === 'warmweiß') ? 'warmwhite' : (val === 'kaltweiß' ? 'coldwhite' : 'color'); const value = action === 'color' ? val : undefined; try { const r = await runAction(id, action, value); log(`${id} ${action}${value ? ` ${value}` : ''}: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } catch (e) { log(`${id} ${action} failed: ${e.message} | ${formatExec(e?.payload?.exec)}`); } }; });
  const modalClose = document.getElementById('modalClose'); const modalBody = document.getElementById('modalBody'); if (modalClose && modalBody) { modalClose.onclick = (e) => { if (e.target === modalClose) { editId = null; render(); } }; document.getElementById('m_cancel').onclick = () => { editId = null; render(); }; document.getElementById('m_save').onclick = async () => { try { const lamp = registry.lamps[editId]; lamp.name = document.getElementById('m_name').value.trim(); lamp.ip = document.getElementById('m_ip').value.trim(); lamp.device_id = document.getElementById('m_device').value.trim(); lamp.local_key = document.getElementById('m_key').value.trim(); lamp.version = Number(document.getElementById('m_version').value || 3.3) || 3.3; lamp.notes = document.getElementById('m_notes').value.trim(); await persist(); log(`Updated lamp ${editId}`); editId = null; await load(); } catch (e) { log(`Update failed: ${e.message}`); } }; document.getElementById('m_test').onclick = async () => { try { const r = await runAction(editId, 'status'); log(`Test ${editId}: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`); } catch (e) { log(`Test failed: ${e.message} | ${formatExec(e?.payload?.exec)}`); } }; }
}

function formatExec(exec) { if (!exec) return ''; return [exec.command ? `cmd: ${exec.command}` : '', exec.code !== undefined ? `code: ${exec.code}` : '', exec.stdout ? `stdout: ${exec.stdout}` : '', exec.stderr ? `stderr: ${exec.stderr}` : ''].filter(Boolean).join(' | '); }
function log(msg) { const el = document.getElementById('log'); if (!el) return; const ts = new Date().toLocaleTimeString(); el.textContent = `[${ts}] ${msg}\n` + el.textContent; }
load().catch((e) => { app.innerHTML = `<main class="wrap"><h1>Tuya Lights v1.1</h1><p>Failed to load API: ${esc(e.message)}</p></main>`; });
