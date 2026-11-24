import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Smoke-tests the unpacked app electron-builder made for this machine and archives it for sharing:
// a ZIP on macOS and Windows, a .tar.gz on Linux (keeps executable bits and the chrome-sandbox helper).
const { version } = JSON.parse(readFileSync('desktop/package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Desktop version must be x.y.z');
const { platform, arch } = process;
const arm = arch === 'arm64';
const targets = {
  darwin: { folder: arm ? 'mac-arm64' : 'mac', app: 'Thunk.app', backend: 'Thunk.app/Contents/Resources/backend', name: arm ? 'Apple-Silicon' : 'Intel', ext: 'zip' },
  win32: { folder: arm ? 'win-arm64-unpacked' : 'win-unpacked', backend: 'resources/backend', name: arm ? 'Windows-ARM64' : 'Windows-x64', ext: 'zip' },
  linux: { folder: arm ? 'linux-arm64-unpacked' : 'linux-unpacked', backend: 'resources/backend', name: arm ? 'Linux-ARM64' : 'Linux-x64', ext: 'tar.gz' },
};
const target = targets[platform];
if (!target) throw new Error(`No desktop archive for ${platform}`);
const folder = path.join('dist-desktop', target.folder);
execFileSync(process.execPath, ['scripts/smoke-desktop.mjs', path.join(folder, target.backend)], { stdio: 'inherit' });
const archive = path.join('dist-desktop', `Thunk-${version}-${target.name}.${target.ext}`);
if (platform === 'darwin') {
  const bundle = path.join(folder, target.app);
  execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, archive]);
} else {
  // One top-level Thunk folder in the archive. Windows 10+ ships bsdtar, which writes ZIPs with -a.
  const top = `Thunk-${version}`;
  const transform = platform === 'linux' ? ['--transform', `s,^${target.folder},${top},`] : [];
  if (platform === 'linux') execFileSync('tar', ['-czf', archive, ...transform, '-C', 'dist-desktop', target.folder], { stdio: 'inherit' });
  else execFileSync('tar.exe', ['-a', '-cf', archive, '-C', folder, '.'], { stdio: 'inherit' });
}
writeFileSync(`${archive}.sha256`, `${createHash('sha256').update(readFileSync(archive)).digest('hex')}  ${path.basename(archive)}\n`);
console.log(`Ready to share: ${archive}`);
