import { packager } from '@electron/packager';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.resolve(root, 'release');
if (!outputDirectory.startsWith(root + path.sep)) throw new Error('Build output must stay within this project.');
// Keep the temporary copy outside OneDrive. OneDrive may turn new folders in
// the project into cloud reparse points while Electron Packager is cleaning
// them up, which makes an otherwise successful build fail at the final rmdir.
const stagingDirectory = path.join(os.tmpdir(), 'jarvis-package-staging');
if (!stagingDirectory.startsWith(os.tmpdir() + path.sep)) throw new Error('Package staging must stay within the system temp directory.');

async function makeWritable(directory) {
  try { await fs.chmod(directory, 0o777); } catch { /* Best effort on Windows. */ }
  let entries = [];
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
  await Promise.all(entries.map(async entry => {
    const child = path.join(directory, entry.name);
    try { await fs.chmod(child, entry.isDirectory() ? 0o777 : 0o666); } catch { /* Best effort. */ }
    if (entry.isDirectory()) await makeWritable(child);
  }));
}

await makeWritable(stagingDirectory);
await fs.rm(stagingDirectory, { recursive: true, force: true });
await fs.mkdir(stagingDirectory, { recursive: true });
await fs.copyFile(path.join(root, 'package.json'), path.join(stagingDirectory, 'package.json'));
// OneDrive can expose project folders as cloud reparse points. Dereference
// them into ordinary files so the packager can clean its staging directory.
await fs.cp(path.join(root, 'src'), path.join(stagingDirectory, 'src'), { recursive: true, dereference: true });
// Include only runtime document-parser dependencies, using the lockfile's
// installed layout. Development tools and Electron itself are excluded.
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
for (const [relative, metadata] of Object.entries(lock.packages || {})) {
  if (!relative.startsWith('node_modules/') || metadata.dev) continue;
  const source = path.resolve(root, relative), destination = path.resolve(stagingDirectory, relative);
  if (!source.startsWith(root + path.sep) || !destination.startsWith(stagingDirectory + path.sep)) throw new Error('Invalid dependency path.');
  try { await fs.access(source); } catch (error) { if (metadata.optional) continue; throw error; }
  await fs.cp(source, destination, { recursive: true, dereference: true });
}
await makeWritable(stagingDirectory);
await makeWritable(path.join(outputDirectory, 'Jarvis-win32-x64'));
const outputs = await packager({
  dir: stagingDirectory, name: 'Jarvis', executableName: 'Jarvis', platform: 'win32', arch: 'x64', electronVersion: '44.3.0',
  out: outputDirectory, overwrite: true, asar: false,
  icon: path.join(root, 'src', 'ui', 'jarvis.ico'),
  appCopyright: 'Personal JARVIS browser',
  prune: false,
});
await fs.rm(stagingDirectory, { recursive: true, force: true });
console.log(`Browser packaged: ${outputs.join(', ')}`);
