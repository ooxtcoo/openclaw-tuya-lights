import './styles.css';

const app = document.getElementById('app');
const API = 'http://127.0.0.1:4890';

let registry = null;
let catalog = null;
let editId = null;
let discovered = [];
let uiLevels = {}; // per lamp: { brightness, temp, hue }
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
  const [data, cat] = await Promise.all([
    api('/api/lamps'),
    api('/api/catalog').catch(() => ({ templates: {} }))
  ]);
  registry = data;
  catalog = cat;
  render();
  syncLevelsFromStatus();
}

function defaultLamp(name = 'Neue Lampe') {
  return {
    name,
    device_id: '',
    ip: '',
    local_key: '',
    version: 3.3,
    type: 'bulb',
    notes: '',
    dps: { power: 20 }
  };
}

function dpsToPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n <= 100) return Math.max(0, Math.min(100, Math.round(n)));
  return Math.max(0, Math.min(100, Math.round((n / 1000) * 100)));
}

function dps24ToHue(v) {
  if (typeof v !== 'string' || v.length < 4) return null;
  const n = Number.parseInt(v.slice(0, 4), 16);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(360, n));
}

function scheduleDebounced(key, fn, ms = 1000) {
  const old = debounceTimers.get(key);
  if (old) clearTimeout(old);
  const t = setTimeout(async () => {
    debounceTimers.delete(key);
    await fn();
  }, ms);
  debounceTimers.set(key, t);
}

async function syncLevelsFromStatus() {
  const lamps = Object.keys(registry?.lamps || {});
  for (const id of lamps) {
    try {
      const r = await runAction(id, 'status');
      const dps = r?.result?.result?.dps || {};
      const b = dpsToPct(dps['22']);
      const t = dpsToPct(dps['23']);
      const h = dps24ToHue(dps['24']);
      if (!uiLevels[id]) uiLevels[id] = { brightness: 50, temp: 50, hue: 0 };
      if (b !== null) uiLevels[id].brightness = b;
      if (t !== null) uiLevels[id].temp = t;
      if (h !== null) uiLevels[id].hue = h;

      const bInput = app.querySelector(`[data-brightness="${id}"]`);
      const bLbl = document.getElementById(`bval-${id}`);
      if (bInput && b !== null) bInput.value = String(b);
      if (bLbl && b !== null) bLbl.textContent = `${b}%`;

      const tInput = app.querySelector(`[data-temp="${id}"]`);
      const tLbl = document.getElementById(`tval-${id}`);
      if (tInput && t !== null) tInput.value = String(t);
      if (tLbl && t !== null) tLbl.textContent = `${t}%`;

      const hInput = app.querySelector(`[data-hue="${id}"]`);
      const hLbl = document.getElementById(`hval-${id}`);
      if (hInput && h !== null) hInput.value = String(h);
      if (hLbl && h !== null) hLbl.textContent = `${h}°`;
    } catch (e) {
      log(`${id} sync skipped: ${e.message}`);
    }
  }
}

function inferDeviceTemplate(lamp = {}) {
  const dps = lamp?.dps || {};
  const type = String(lamp?.type || '').toLowerCase();
  if (type === 'bulb') return 'bulb';
  if (type === 'plug' || type === 'socket' || type === 'outlet') return 'plug';
  if (type === 'switch') return 'switch';
  if (dps.color_data || dps.light_param_24 || dps.mode || dps.brightness || dps.temp) return 'bulb';
  return 'device';
}

function getTemplateMeta(lamp = {}) {
  const templateKey = inferDeviceTemplate(lamp);
  const meta = catalog?.templates?.[templateKey] || catalog?.templates?.device || {
    label: 'Gerät',
    icon: '📦',
    capabilities: { power: true }
  };
  return { templateKey, meta };
}

function lampCard(id, lamp) {
  const b = uiLevels[id]?.brightness ?? 50;
  const t = uiLevels[id]?.temp ?? 50;
  const h = uiLevels[id]?.hue ?? 0;
  const { templateKey, meta } = getTemplateMeta(lamp);
  const capabilities = meta?.capabilities || {};
  return `<div class="card">
    <div class="row"><h3>${esc(meta?.icon || '📦')} ${esc(lamp.name || id)}</h3><span class="id">${esc(id)}</span></div>
    <div class="meta">${esc(meta?.label || templateKey)} • IP ${esc(lamp.ip || '-')} • v${esc(lamp.version || '-')}</div>
    <div class="actions">
      <button data-act="on" data-target="${esc(id)}">On</button>
      <button data-act="off" data-target="${esc(id)}">Off</button>
      <button data-act="status" data-target="${esc(id)}">Status</button>
      <button data-edit="${esc(id)}">Edit</button>
      <button data-del="${esc(id)}">Delete</button>
    </div>
    ${capabilities.brightness ? `<div class="slider-wrap">
      <label>Brightness <span id="bval-${esc(id)}">${b}%</span></label>
      <input type="range" min="1" max="100" value="${b}" data-brightness="${esc(id)}" />
    </div>` : ''}
    ${capabilities.white_temp ? `<div class="slider-wrap">
      <label>Farbton Weiß (kalt → warm) <span id="tval-${esc(id)}">${t}%</span></label>
      <input type="range" min="0" max="100" value="${t}" data-temp="${esc(id)}" />
    </div>` : ''}
    ${capabilities.hue ? `<div class="slider-wrap">
      <label>Farbe (stufenlos) <span id="hval-${esc(id)}">${h}°</span></label>
      <input class="hue-slider" type="range" min="0" max="360" value="${h}" data-hue="${esc(id)}" />
    </div>` : ''}
    ${capabilities.color || capabilities.white_temp ? `<div class="color-row">
      ${capabilities.color ? `<button data-color="${esc(id)}" data-value="rot">Rot</button>
      <button data-color="${esc(id)}" data-value="blau">Blau</button>
      <button data-color="${esc(id)}" data-value="grün">Grün</button>` : ''}
      ${capabilities.white_temp ? `<button data-color="${esc(id)}" data-value="warmweiß">Warmweiß</button>
      <button data-color="${esc(id)}" data-value="kaltweiß">Kaltweiß</button>` : ''}
    </div>` : ''}
  </div>`;
}

function groupChips(groups) {
  return Object.keys(groups).map(g => `<button class="chip" data-group="${esc(g)}">${esc(g)} OFF</button>`).join('');
}

function discoveryHtml() {
  if (!discovered.length) return '<p class="muted">No discovery results yet.</p>';
  return discovered.map((d, i) => {
    const suggestedId = (d.name || `tuya_${i+1}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `tuya_${i+1}`;
    return `<div class="discover-item">
      <div><strong>${esc(d.name || 'Unknown')}</strong> • ${esc(d.ip || '-')} • v${esc(d.version || '-')}</div>
      <div class="muted">gwId: ${esc(d.gwId || '-')} | productKey: ${esc(d.productKey || '-')} | category: ${esc(d.category || d.categoryCode || '-')}</div>
      <div class="actions" style="margin-top:6px">
        <button data-add-discovered="${i}" data-suggested-id="${esc(suggestedId)}">Add to registry</button>
      </div>
    </div>`;
  }).join('');
}

function renderModal() {
  if (!editId) return '';
  const lamp = registry.lamps[editId];
  if (!lamp) return '';
  return `<div class="modal-backdrop" id="modalClose"><div class="modal" id="modalBody">
    <h3>Edit Lamp: ${esc(editId)}</h3>
    <div class="form-grid">
      <input id="m_name" placeholder="name" value="${esc(lamp.name || '')}" />
      <input id="m_ip" placeholder="ip" value="${esc(lamp.ip || '')}" />
      <input id="m_device" placeholder="device_id" value="${esc(lamp.device_id || '')}" />
      <input id="m_key" placeholder="local_key" value="${esc(lamp.local_key || '')}" />
      <input id="m_version" placeholder="version" value="${esc(lamp.version || 3.3)}" />
      <input id="m_notes" placeholder="notes" value="${esc(lamp.notes || '')}" />
    </div>
    <div class="actions" style="margin-top:10px">
      <button id="m_save">Save</button>
      <button id="m_test">Test Status</button>
      <button id="m_cancel">Cancel</button>
    </div>
  </div></div>`;
}

function render() {
  if (!registry) {
    app.innerHTML = '<main class="wrap">Loading…</main>';
    return;
  }

  const lamps = registry.lamps || {};
  const groups = registry.groups || {};

  app.innerHTML = `<main class="wrap">
    <header>
      <h1>Tuya Lights v1.1</h1>
      <div class="header-actions">
        <button id="refresh">Refresh</button>
        <button id="syncNow">Sync values</button>
        <button id="save">Save JSON</button>
      </div>
    </header>

    <section class="panel">
      <h2>Quick Groups</h2>
      <div class="chips">${groupChips(groups)}</div>
    </section>

    <section class="panel">
      <h2>Onboarding (add new lamp)</h2>
      <div class="form-grid">
        <input id="addId" placeholder="lamp id (e.g. bedroom_main)" />
        <input id="addName" placeholder="name" />
        <input id="addIp" placeholder="ip" />
        <input id="addDev" placeholder="device_id" />
        <input id="addKey" placeholder="local_key" />
        <input id="addVer" placeholder="version" value="3.3" />
      </div>
      <div class="actions" style="margin-top:8px">
        <button id="addLampBtn">Add Lamp</button>
      </div>
    </section>

    <section class="panel">
      <h2>Discovery</h2>
      <div class="actions">
        <button id="discoverBtn">Scan network for Tuya devices</button>
      </div>
      <div id="discoverList" class="discover-list">${discoveryHtml()}</div>
    </section>

    <section class="panel">
      <h2>Lamps</h2>
      <div class="grid">${Object.entries(lamps).map(([id,l]) => lampCard(id,l)).join('')}</div>
    </section>

    <section class="panel">
      <h2>Groups Editor</h2>
      <textarea id="groupsJson">${esc(JSON.stringify(groups, null, 2))}</textarea>
      <div class="actions" style="margin-top:8px"><button id="saveGroups">Save Groups</button></div>
    </section>

    <section class="panel">
      <h2>Registry Editor</h2>
      <textarea id="json">${esc(JSON.stringify(registry, null, 2))}</textarea>
    </section>

    <section class="panel" id="logPanel">
      <h2>Log</h2>
      <pre id="log"></pre>
    </section>
  </main>
  ${renderModal()}`;

  wireEvents();
}

async function persist() {
  await api('/api/lamps', { method: 'PUT', body: JSON.stringify(registry) });
}

async function runAction(target, action, value) {
  if (action === 'status') {
    return api('/api/status', { method: 'POST', body: JSON.stringify({ target }) });
  }
  return api('/api/action', { method: 'POST', body: JSON.stringify({ target, action, value }) });
}

function wireEvents() {
  document.getElementById('refresh').onclick = () => load();
  document.getElementById('syncNow').onclick = async () => {
    log('Sync values started...');
    await syncLevelsFromStatus();
    log('Sync values done.');
  };

  document.getElementById('save').onclick = async () => {
    const txt = document.getElementById('json').value;
    try {
      const parsed = JSON.parse(txt);
      registry = parsed;
      await persist();
      log('Saved registry');
      await load();
    } catch (e) {
      log(`Save failed: ${e.message}`);
    }
  };

  document.getElementById('saveGroups').onclick = async () => {
    try {
      const parsed = JSON.parse(document.getElementById('groupsJson').value);
      registry.groups = parsed;
      await persist();
      log('Saved groups');
      await load();
    } catch (e) {
      log(`Save groups failed: ${e.message}`);
    }
  };

  document.getElementById('addLampBtn').onclick = async () => {
    try {
      const id = (document.getElementById('addId').value || '').trim().toLowerCase();
      if (!id) throw new Error('Lamp id required');
      if (registry.lamps[id]) throw new Error('Lamp id already exists');
      const lamp = defaultLamp(document.getElementById('addName').value || id);
      lamp.ip = (document.getElementById('addIp').value || '').trim();
      lamp.device_id = (document.getElementById('addDev').value || '').trim();
      lamp.local_key = (document.getElementById('addKey').value || '').trim();
      lamp.version = Number(document.getElementById('addVer').value || 3.3) || 3.3;
      registry.lamps[id] = lamp;
      await persist();
      log(`Added lamp ${id}`);
      await load();
    } catch (e) {
      log(`Add failed: ${e.message}`);
    }
  };

  document.getElementById('discoverBtn').onclick = async () => {
    try {
      log('Discovery started...');
      const r = await api('/api/discover', { method: 'POST', body: '{}' });
      discovered = r?.result?.devices || [];
      log(`Discovery finished: ${discovered.length} devices found | ${formatExec(r.exec)}`);
      render();
    } catch (e) {
      log(`Discovery failed: ${e.message} | ${formatExec(e?.payload?.exec)}`);
    }
  };

  app.querySelectorAll('[data-act]').forEach((btn) => {
    btn.onclick = async () => {
      const target = btn.getAttribute('data-target');
      const action = btn.getAttribute('data-act');
      try {
        const r = await runAction(target, action);
        if (action === 'status') {
          const dps = r?.result?.result?.dps || {};
          const b = dpsToPct(dps['22']);
          const t = dpsToPct(dps['23']);
          const h = dps24ToHue(dps['24']);
          if (!uiLevels[target]) uiLevels[target] = { brightness: 50, temp: 50, hue: 0 };
          if (b !== null) uiLevels[target].brightness = b;
          if (t !== null) uiLevels[target].temp = t;
          if (h !== null) uiLevels[target].hue = h;
          const bInput = app.querySelector(`[data-brightness="${target}"]`);
          const bLbl = document.getElementById(`bval-${target}`);
          if (bInput && b !== null) bInput.value = String(b);
          if (bLbl && b !== null) bLbl.textContent = `${b}%`;
          const tInput = app.querySelector(`[data-temp="${target}"]`);
          const tLbl = document.getElementById(`tval-${target}`);
          if (tInput && t !== null) tInput.value = String(t);
          if (tLbl && t !== null) tLbl.textContent = `${t}%`;
          const hInput = app.querySelector(`[data-hue="${target}"]`);
          const hLbl = document.getElementById(`hval-${target}`);
          if (hInput && h !== null) hInput.value = String(h);
          if (hLbl && h !== null) hLbl.textContent = `${h}°`;
        }
        log(`${target} ${action}: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`);
      } catch (e) {
        log(`${target} ${action} failed: ${e.message} | ${formatExec(e?.payload?.exec)}`);
      }
    };
  });

  app.querySelectorAll('[data-group]').forEach((btn) => {
    btn.onclick = async () => {
      const target = btn.getAttribute('data-group');
      try {
        const r = await runAction(target, 'off');
        log(`${target} off: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`);
      } catch (e) {
        log(`${target} off failed: ${e.message} | ${formatExec(e?.payload?.exec)}`);
      }
    };
  });

  app.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-del');
      if (!confirm(`Delete lamp ${id}?`)) return;
      delete registry.lamps[id];
      for (const g of Object.keys(registry.groups || {})) {
        registry.groups[g] = (registry.groups[g] || []).filter(x => x !== id);
      }
      try {
        await persist();
        log(`Deleted lamp ${id}`);
        await load();
      } catch (e) {
        log(`Delete failed: ${e.message}`);
      }
    };
  });

  app.querySelectorAll('[data-add-discovered]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const i = Number(btn.getAttribute('data-add-discovered'));
        const d = discovered[i];
        if (!d) throw new Error('Discovery item not found');
        const suggested = (btn.getAttribute('data-suggested-id') || '').toLowerCase();
        const id = (prompt('Lamp id for registry', suggested) || '').trim().toLowerCase();
        if (!id) return;
        if (registry.lamps[id]) throw new Error('Lamp id already exists');
        registry.lamps[id] = {
          ...defaultLamp(d.name || id),
          ip: d.ip || '',
          device_id: d.gwId || '',
          version: Number(d.version || 3.3) || 3.3,
          notes: 'Added from network discovery. local_key still required.',
        };
        await persist();
        log(`Discovered device added as ${id}. Please fill local_key.`);
        await load();
      } catch (e) {
        log(`Add discovered failed: ${e.message}`);
      }
    };
  });

  app.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = () => {
      editId = btn.getAttribute('data-edit');
      render();
    };
  });

  app.querySelectorAll('[data-brightness]').forEach((input) => {
    input.oninput = () => {
      const id = input.getAttribute('data-brightness');
      const val = input.value;
      const label = document.getElementById(`bval-${id}`);
      if (label) label.textContent = `${val}%`;
      if (!uiLevels[id]) uiLevels[id] = { brightness: 50, temp: 50, hue: 0 };
      uiLevels[id].brightness = Number(val);

      scheduleDebounced(`brightness:${id}`, async () => {
        try {
          const r = await runAction(id, 'brightness', val);
          log(`${id} brightness ${val}%: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`);
        } catch (e) {
          log(`${id} brightness failed: ${e.message} | ${formatExec(e?.payload?.exec)}`);
        }
      }, 1000);
    };
  });

  app.querySelectorAll('[data-temp]').forEach((input) => {
    input.oninput = () => {
      const id = input.getAttribute('data-temp');
      const val = input.value;
      const label = document.getElementById(`tval-${id}`);
      if (label) label.textContent = `${val}%`;
      if (!uiLevels[id]) uiLevels[id] = { brightness: 50, temp: 50, hue: 0 };
      uiLevels[id].temp = Number(val);

      scheduleDebounced(`temp:${id}`, async () => {
        try {
          const r = await runAction(id, 'temp', val);
          log(`${id} temp ${val}%: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`);
        } catch (e) {
          log(`${id} temp failed: ${e.message} | ${formatExec(e?.payload?.exec)}`);
        }
      }, 1000);
    };
  });

  app.querySelectorAll('[data-hue]').forEach((input) => {
    input.oninput = () => {
      const id = input.getAttribute('data-hue');
      const val = input.value;
      const label = document.getElementById(`hval-${id}`);
      if (label) label.textContent = `${val}°`;
      if (!uiLevels[id]) uiLevels[id] = { brightness: 50, temp: 50, hue: 0 };
      uiLevels[id].hue = Number(val);

      scheduleDebounced(`hue:${id}`, async () => {
        try {
          const r = await runAction(id, 'hue', val);
          log(`${id} hue ${val}°: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`);
        } catch (e) {
          log(`${id} hue failed: ${e.message} | ${formatExec(e?.payload?.exec)}`);
        }
      }, 1000);
    };
  });

  app.querySelectorAll('[data-color]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-color');
      const val = btn.getAttribute('data-value');
      const action = (val === 'warmweiß') ? 'warmwhite' : (val === 'kaltweiß' ? 'coldwhite' : 'color');
      const value = action === 'color' ? val : undefined;
      try {
        const r = await runAction(id, action, value);
        log(`${id} ${action}${value ? ` ${value}` : ''}: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`);
      } catch (e) {
        log(`${id} ${action} failed: ${e.message} | ${formatExec(e?.payload?.exec)}`);
      }
    };
  });

  const modalClose = document.getElementById('modalClose');
  const modalBody = document.getElementById('modalBody');
  if (modalClose && modalBody) {
    modalClose.onclick = (e) => {
      if (e.target === modalClose) {
        editId = null;
        render();
      }
    };
    document.getElementById('m_cancel').onclick = () => {
      editId = null;
      render();
    };
    document.getElementById('m_save').onclick = async () => {
      try {
        const lamp = registry.lamps[editId];
        lamp.name = document.getElementById('m_name').value.trim();
        lamp.ip = document.getElementById('m_ip').value.trim();
        lamp.device_id = document.getElementById('m_device').value.trim();
        lamp.local_key = document.getElementById('m_key').value.trim();
        lamp.version = Number(document.getElementById('m_version').value || 3.3) || 3.3;
        lamp.notes = document.getElementById('m_notes').value.trim();
        await persist();
        log(`Updated lamp ${editId}`);
        editId = null;
        await load();
      } catch (e) {
        log(`Update failed: ${e.message}`);
      }
    };
    document.getElementById('m_test').onclick = async () => {
      try {
        const r = await runAction(editId, 'status');
        log(`Test ${editId}: ${JSON.stringify(r.result)} | ${formatExec(r.exec)}`);
      } catch (e) {
        log(`Test failed: ${e.message} | ${formatExec(e?.payload?.exec)}`);
      }
    };
  }
}

function formatExec(exec) {
  if (!exec) return '';
  return [
    exec.command ? `cmd: ${exec.command}` : '',
    exec.code !== undefined ? `code: ${exec.code}` : '',
    exec.stdout ? `stdout: ${exec.stdout}` : '',
    exec.stderr ? `stderr: ${exec.stderr}` : '',
  ].filter(Boolean).join(' | ');
}

function log(msg) {
  const el = document.getElementById('log');
  if (!el) return;
  const ts = new Date().toLocaleTimeString();
  el.textContent = `[${ts}] ${msg}\n` + el.textContent;
}

load().catch((e) => {
  app.innerHTML = `<main class="wrap"><h1>Tuya Lights v1.1</h1><p>Failed to load API: ${esc(e.message)}</p></main>`;
});
