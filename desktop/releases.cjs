const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
function releaseUrl(config) {
  let values = {};
  try { values = parseEnv(readFileSync(config, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const repo = values.THUNK_RELEASE_REPO?.trim() || 'Dgiordano33/thunk';
  if (!/^[\w-]+\/[\w.-]+$/.test(repo) || repo.split('/').some(part => part.startsWith('.'))) throw new Error('THUNK_RELEASE_REPO must be a GitHub owner/repository.');
  return `https://github.com/${repo}/releases/latest`;
}
module.exports = { releaseUrl };
