import express from 'express';
import { readFile, writeFile } from 'node:fs/promises';
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

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '1mb' }));

function runScript(scriptPath, args = [], timeoutMs = Number(process.env.TUYA_CMD_TIMEOUT_MS || 20000)) {
  return new Promise((resolve, reject) => {
    const cmd = ['python', scriptPath, ...args];
    const p = spawn(cmd[0], cmd.slice(1), { cwd: TUYA_ROOT });
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
      if (timedOut) {
        return reject({ ok: false, code: -2, command: cmd.join(' '), stdout: out.trim(), stderr: `Timed out after ${timeoutMs}ms` });
      }
      const payload = { ok: code === 0, code, command: cmd.join(' '), stdout: out.trim(), stderr: err.trim() };
      if (code !== 0) return reject(payload);
      resolve(payload);
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      reject({ ok: false, code: -1, command: cmd.join(' '), stdout: out.trim(), stderr: String(e?.message || e) });
    });
  });
}

function runPy(args = []) {
  return runScript(LAMP_CONTROL, args);
}

async function loadRegistry() {
  const raw = await readFile(REGISTRY_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function saveRegistry(data) {
  await writeFile(REGISTRY_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

async function loadCatalog() {
  const raw = await readFile(CATALOG_PATH, 'utf-8');
  return JSON.parse(raw);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, registryPath: REGISTRY_PATH });
});

app.get('/api/lamps', async (_req, res) => {
  try {
    const reg = await loadRegistry();
    res.json(reg);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/catalog', async (_req, res) => {
  try {
    const catalog = await loadCatalog();
    res.json(catalog);
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
    await saveRegistry(next);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/action', async (req, res) => {
  try {
    const { target, action, value } = req.body || {};
    if (!target || !action) return res.status(400).json({ error: 'target and action required' });
    const args = [String(target), String(action)];
    if (value !== undefined && value !== null && value !== '') args.push('--value', String(value));
    const exec = await runPy(args);
    let parsed = exec.stdout;
    try { parsed = JSON.parse(exec.stdout); } catch {}
    res.json({ ok: true, result: parsed, exec });
  } catch (e) {
    res.status(500).json({ error: 'Action failed', exec: e });
  }
});

app.post('/api/status', async (req, res) => {
  try {
    const { target } = req.body || {};
    if (!target) return res.status(400).json({ error: 'target required' });
    const exec = await runPy([String(target), 'status']);
    let parsed = exec.stdout;
    try { parsed = JSON.parse(exec.stdout); } catch {}
    res.json({ ok: true, result: parsed, exec });
  } catch (e) {
    res.status(500).json({ error: 'Status failed', exec: e });
  }
});

app.post('/api/discover', async (_req, res) => {
  try {
    const exec = await runScript(DISCOVER_SCRIPT, [], 30000);
    let parsed = exec.stdout;
    try { parsed = JSON.parse(exec.stdout); } catch {}
    res.json({ ok: true, result: parsed, exec });
  } catch (e) {
    res.status(500).json({ error: 'Discover failed', exec: e });
  }
});

const PORT = Number(process.env.TUYA_GUI_API_PORT || 4890);
app.listen(PORT, () => {
  console.log(`Tuya GUI API listening on http://127.0.0.1:${PORT}`);
});
