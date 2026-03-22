import { spawn } from 'node:child_process';

const api = spawn('npm run api', { stdio: 'inherit', shell: true });
const dev = spawn('npm run dev', { stdio: 'inherit', shell: true });

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
