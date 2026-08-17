import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));

export async function spawnJob(jobName: string): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(jobName)) throw new Error('Invalid job name.');
  const compiledPath = resolve(moduleDir, `../jobs/${jobName}.js`);
  const sourcePath = resolve(moduleDir, `../jobs/${jobName}.ts`);
  const target = existsSync(compiledPath) ? compiledPath : sourcePath;
  if (!existsSync(target)) throw new Error(`Job entry point not found: ${jobName}`);

  const args = target.endsWith('.ts')
    ? ['--experimental-strip-types', target]
    : [target];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });

  await new Promise<void>((resolveSpawn, reject) => {
    child.once('spawn', resolveSpawn);
    child.once('error', reject);
  });
  child.unref();
}
