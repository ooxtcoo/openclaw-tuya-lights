import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const lampctlBasename = process.platform === 'win32' ? 'lampctl.exe' : 'lampctl';
const lampctlPath = path.join(projectRoot, lampctlBasename);

const env = {
  ...process.env,
  TUYA_GUI_API_PORT: process.env.TUYA_GUI_API_PORT || '4890',
};

const api = spawn('npm run api', { stdio: 'inherit', shell: true, env, cwd: __dirname });
const dev = spawn('npm run dev', { stdio: 'inherit', shell: true, env, cwd: __dirname });

function shutdown() {
  try { api.kill(); } catch {}
  try { dev.kill(); } catch {}
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

api.on('exit', (code) => {
  if (code !== 0) console.error(`[start-all] API exited with code ${code}`);
});

dev.on('exit', (code) => {
  if (code !== 0) console.error(`[start-all] DEV exited with code ${code}`);
});
