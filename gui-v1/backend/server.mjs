import express from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TUYA_ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY_PATH = path.join(TUYA_ROOT, 'tuya_lamps.json');
const CATALOG_PATH = path.join(TUYA_ROOT, 'tuya_device_catalog.json');
const lampctlCandidates = process.platform === 'win32'
  ? [path.join(TUYA_ROOT, 'lampctl.exe'), path.join(TUYA_ROOT, 'lightsctl.exe')]
  : [path.join(TUYA_ROOT, 'lampctl')];
const LAMPCTL_PATH = lampctlCandidates.find((p) => existsSync(p)) || lampctlCandidates[0];
const HAS_LAMPCTL = existsSync(LAMPCTL_PATH);

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '1mb' }));

function runCommand(command, args = [], cwd = TUYA_ROOT, timeoutMs = Number(process.env.TUYA_CMD_TIMEOUT_MS || 8000)) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { cwd });
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { p.kill(); } catch {}
    }, timeoutMs);
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject({ ok: false, code: -2, command: [command, ...args].join(' '), stdout: out.trim(), stderr: `Timed out after ${timeoutMs}ms` });
      const payload = { ok: code === 0, code, command: [command, ...args].join(' '), stdout: out.trim(), stderr: err.trim() };
      if (code !== 0) return reject(payload);
      resolve(payload);
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      reject({ ok: false, code: -1, command: [command, ...args].join(' '), stdout: out.trim(), stderr: String(e?.message || e) });
    });
  });
}

function runLampctl(args = [], timeoutMs = 8000) {
  if (!HAS_LAMPCTL) {
    return Promise.reject({ ok: false, code: -1, command: LAMPCTL_PATH, stdout: '', stderr: `lampctl executable not found: ${LAMPCTL_PATH}` });
  }
  return runCommand(LAMPCTL_PATH, args, path.dirname(LAMPCTL_PATH), timeoutMs);
}

async function runAction(target, action, value) {
  const args = [String(target), String(action)];
  if (value !== undefined && value !== null && value !== '') args.push('--value', String(value));
  return runLampctl(args);
}

function tryParseJSON(raw) {
  try { return JSON.parse(raw); } catch { return raw; }
}

function normalizeStatusResult(parsed) {
  const base = (parsed && typeof parsed === 'object') ? { ...parsed } : { raw: parsed };
  const hasError = Boolean(base?.error);
  const dps = base?.result?.dps;
  const hasDps = Boolean(dps && typeof dps === 'object' && Object.keys(dps).length > 0);
  return { ...base, online: !hasError && hasDps, error: hasError ? String(base.error) : '' };
}

function normalizeDiscoverResult(parsed) {
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.devices)) return parsed;
  if (Array.isArray(parsed)) {
    return {
      ok: true,
      count: parsed.length,
      devices: parsed.map((item) => ({
        ip: item.ip,
        gwId: item.gwId,
        version: item.version,
        productKey: item.productKey,
        name: item.data?.name || item.name || '',
        raw: item,
      })),
    };
  }
  return { ok: true, count: 0, devices: [] };
}

function normalizeId(value = '') {
  return String(value || '').trim();
}

function normalizeRegistry(raw) {
  const next = (raw && typeof raw === 'object') ? structuredClone(raw) : {};
  next.lamps = (next.lamps && typeof next.lamps === 'object') ? next.lamps : {};
  next.groups = (next.groups && typeof next.groups === 'object') ? next.groups : {};

  const lampEntries = Object.entries(next.lamps);
  let fallbackOrder = 1;
  for (const [lampId, lamp] of lampEntries) {
    if (!lamp || typeof lamp !== 'object') {
      delete next.lamps[lampId];
      continue;
    }
    lamp.name = String(lamp.name || lampId || '').trim();
    lamp.device_id = String(lamp.device_id || '').trim();
    lamp.ip = String(lamp.ip || '').trim();
    lamp.local_key = String(lamp.local_key || '').trim();
    lamp.notes = String(lamp.notes || '').trim();
    lamp.version = Number(lamp.version || 3.3) || 3.3;
    lamp.type = String(lamp.type || 'bulb').trim() || 'bulb';
    lamp.dps = (lamp.dps && typeof lamp.dps === 'object') ? lamp.dps : { power: 20 };
    const sortOrder = Number(lamp.sort_order);
    lamp.sort_order = Number.isFinite(sortOrder) ? sortOrder : fallbackOrder;
    fallbackOrder += 1;
  }

  const knownLampIds = new Set(Object.keys(next.lamps));
  const nextGroups = {};
  for (const [groupName, members] of Object.entries(next.groups)) {
    const normalizedGroupName = normalizeId(groupName);
    if (!normalizedGroupName) continue;
    const seen = new Set();
    const cleaned = [];
    for (const member of Array.isArray(members) ? members : []) {
      const lampId = normalizeId(member);
      if (!lampId || !knownLampIds.has(lampId) || seen.has(lampId)) continue;
      seen.add(lampId);
      cleaned.push(lampId);
    }
    nextGroups[normalizedGroupName] = cleaned;
  }
  next.groups = nextGroups;
  return next;
}

async function loadRegistry() {
  return normalizeRegistry(JSON.parse(await readFile(REGISTRY_PATH, 'utf-8')));
}

async function saveRegistry(data) {
  const normalized = normalizeRegistry(data);
  await writeFile(REGISTRY_PATH, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

async function loadCatalog() {
  if (!existsSync(CATALOG_PATH)) return { templates: {} };
  return JSON.parse(await readFile(CATALOG_PATH, 'utf-8'));
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, registryPath: REGISTRY_PATH, lampctlPath: LAMPCTL_PATH, hasLampctl: HAS_LAMPCTL, backend: 'lampctl', platform: process.platform });
});

app.get('/api/lamps', async (_req, res) => {
  try {
    const normalized = await loadRegistry();
    await saveRegistry(normalized);
    res.json(normalized);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/catalog', async (_req, res) => {
  try {
    res.json(await loadCatalog());
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put('/api/lamps', async (req, res) => {
  try {
    const next = req.body;
    if (!next || typeof next !== 'object' || !next.lamps) {
      return res.status(400).json({ error: 'Invalid registry payload (need lamps object)' });
    }
    const saved = await saveRegistry(next);
    res.json({ ok: true, registry: saved });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/action', async (req, res) => {
  try {
    const { target, action, value } = req.body || {};
    if (!target || !action) return res.status(400).json({ error: 'target and action required' });
    const exec = await runAction(target, action, value);
    res.json({ ok: true, result: tryParseJSON(exec.stdout), exec });
  } catch (e) {
    res.status(500).json({ error: 'Action failed', exec: e });
  }
});

app.post('/api/status', async (req, res) => {
  try {
    const { target } = req.body || {};
    if (!target) return res.status(400).json({ error: 'target required' });
    const exec = await runLampctl([String(target), 'status']);
    res.json({ ok: true, result: normalizeStatusResult(tryParseJSON(exec.stdout)), exec });
  } catch (e) {
    res.status(500).json({ error: 'Status failed', exec: e });
  }
});

app.post('/api/discover', async (_req, res) => {
  try {
    const exec = await runLampctl(['discover'], 30000);
    res.json({ ok: true, result: normalizeDiscoverResult(tryParseJSON(exec.stdout)), exec });
  } catch (e) {
    res.status(500).json({ error: 'Discover failed', exec: e });
  }
});

const PORT = Number(process.env.TUYA_GUI_API_PORT || 4890);
app.listen(PORT, () => {
  console.log(`Tuya GUI API listening on http://127.0.0.1:${PORT}`);
  console.log(`Backend: lampctl (${LAMPCTL_PATH})`);
});
