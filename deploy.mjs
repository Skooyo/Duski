// Builds the installer and installs it on this PC without questions: same install folder, Duski restarts after.
// Run from the repo root:  npm run deploy
// The installer closes a running Duski itself. Keep the agent folder outside the install folder: an update deletes it.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';

execSync('npm run dist', { stdio: 'inherit' });
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const installer = `release/Duski-Setup-${version}.exe`;
// /S: silent, into the folder of the current install. --force-run: start Duski when done.
spawn(installer, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
console.log(`Installing ${installer} in the background. Duski starts again in about 10 seconds.`);
