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
const LAMP_CONTROL = path.join(TUYA_ROOT, 'lamp_control.py');
const DISCOVER_SCRIPT = path.join(TUYA_ROOT, 'discover_lamps.py');
const lampctlCandidates = process.platform === 'win32'
  ? [path.join(TUYA_ROOT, 'lampctl.exe'), path.join(TUYA_ROOT, 'lightsctl.exe')]
  : [path.join(TUYA_ROOT, 'lampctl')];
const LAMPCTL_PATH = lampctlCandidates.find((p) => existsSync(p)) || lampctlCandidates[0];

const HAS_LAMPCTL = existsSync(LAMPCTL_PATH);
const HAS_PYTHON_BACKEND = existsSync(LAMP_CONTROL) && existsSync(DISCOVER_SCRIPT);

function chooseInitialBackend() {
  if (HAS_LAMPCTL) return 'lampctl';
  if (HAS_PYTHON_BACKEND) return 'python';
  return 'none';
}

let backendMode = chooseInitialBackend();

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '1mb' }));

function canUseLampctl() { return HAS_LAMPCTL; }
function canUsePython() { return HAS_PYTHON_BACKEND; }
function usingLampctl() { return backendMode === 'lampctl'; }

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

function runScript(scriptPath, args = [], timeoutMs = 8000) {
  return runCommand('python', [scriptPath, ...args], TUYA_ROOT, timeoutMs);
}

function runPy(args = []) {
  if (!canUsePython()) return Promise.reject({ ok: false, code: -1, command: 'python', stdout: '', stderr: 'Python backend files not found in this project' });
  return runScript(LAMP_CONTROL, args);
}

function runLampctl(args = [], timeoutMs = 8000) {
  if (!canUseLampctl()) return Promise.reject({ ok: false, code: -1, command: LAMPCTL_PATH, stdout: '', stderr: `lampctl executable not found: ${LAMPCTL_PATH}` });
  return runCommand(LAMPCTL_PATH, args, path.dirname(LAMPCTL_PATH), timeoutMs);
}

async function runAction(target, action, value) {
  const args = [String(target), String(action)];
  if (value !== undefined && value !== null && value !== '') args.push('--value', String(value));
  return usingLampctl() ? runLampctl(args) : runPy(args);
}

async function runStatus(target) {
  return usingLampctl() ? runLampctl([String(target), 'status']) : runPy([String(target), 'status']);
}

async function runDiscover() {
  return usingLampctl() ? runLampctl(['discover'], 30000) : runScript(DISCOVER_SCRIPT, [], 30000);
}

function tryParseJSON(raw) { try { return JSON.parse(raw); } catch { return raw; } }
function normalizeDiscoverResult(parsed) {
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.devices)) return parsed;
  if (Array.isArray(parsed)) return { ok: true, count: parsed.length, devices: parsed.map((item) => ({ ip: item.ip, gwId: item.gwId, version: item.version, productKey: item.productKey, name: item.data?.name || item.name || '', raw: item })) };
  return { ok: true, count: 0, devices: [] };
}

async function loadRegistry() { return JSON.parse(await readFile(REGISTRY_PATH, 'utf-8')); }
async function saveRegistry(data) { await writeFile(REGISTRY_PATH, JSON.stringify(data, null, 2), 'utf-8'); }
async function loadCatalog() { if (!existsSync(CATALOG_PATH)) return { templates: {} }; return JSON.parse(await readFile(CATALOG_PATH, 'utf-8')); }

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, registryPath: REGISTRY_PATH, backendMode, useLampctl: usingLampctl(), lampctlPath: LAMPCTL_PATH, hasLampctl: HAS_LAMPCTL, hasPythonBackend: HAS_PYTHON_BACKEND, platform: process.platform });
});

app.post('/api/backend-mode', (req, res) => {
  const mode = String(req.body?.mode || '').toLowerCase();
  if (!['lampctl', 'python'].includes(mode)) return res.status(400).json({ error: 'mode must be lampctl or python' });
  if (mode === 'lampctl' && !canUseLampctl()) return res.status(400).json({ error: 'lampctl backend is not available' });
  if (mode === 'python' && !canUsePython()) return res.status(400).json({ error: 'python backend is not available' });
  backendMode = mode;
  res.json({ ok: true, backendMode, useLampctl: usingLampctl() });
});

app.get('/api/lamps', async (_req, res) => { try { res.json(await loadRegistry()); } catch (e) { res.status(500).json({ error: String(e.message || e) }); } });
app.get('/api/catalog', async (_req, res) => { try { res.json(await loadCatalog()); } catch (e) { res.status(500).json({ error: String(e.message || e) }); } });
app.put('/api/lamps', async (req, res) => { try { const next = req.body; if (!next || typeof next !== 'object' || !next.lamps) return res.status(400).json({ error: 'Invalid registry payload (need lamps object)' }); await saveRegistry(next); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: String(e.message || e) }); } });
app.post('/api/action', async (req, res) => { try { const { target, action, value } = req.body || {}; if (!target || !action) return res.status(400).json({ error: 'target and action required' }); const exec = await runAction(target, action, value); res.json({ ok: true, result: tryParseJSON(exec.stdout), exec }); } catch (e) { res.status(500).json({ error: 'Action failed', exec: e }); } });
app.post('/api/status', async (req, res) => { try { const { target } = req.body || {}; if (!target) return res.status(400).json({ error: 'target required' }); const exec = await runStatus(target); res.json({ ok: true, result: tryParseJSON(exec.stdout), exec }); } catch (e) { res.status(500).json({ error: 'Status failed', exec: e }); } });
app.post('/api/discover', async (_req, res) => { try { const exec = await runDiscover(); res.json({ ok: true, result: normalizeDiscoverResult(tryParseJSON(exec.stdout)), exec }); } catch (e) { res.status(500).json({ error: 'Discover failed', exec: e }); } });

const PORT = Number(process.env.TUYA_GUI_API_PORT || 4890);
app.listen(PORT, () => {
  console.log(`Tuya GUI API listening on http://127.0.0.1:${PORT}`);
  console.log(`Backend mode: ${backendMode}`);
});
