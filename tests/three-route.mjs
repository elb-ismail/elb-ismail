// Test-only: serve Three.js from a local npm copy when a browser page asks esm.sh for it.
// The game imports https://esm.sh/three@<version>; this container's network policy blocks esm.sh, so the
// scenarios intercept those requests and answer with the same version's files from node_modules/three
// (install with: npm install --no-save --no-package-lock three@0.186.1). Without a local copy, requests go
// to the real network unchanged.
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

export const THREE_VERSION = '0.186.1';
const ESM = `https://esm.sh/three@${THREE_VERSION}`;

function findThree(root) {
  const cands = [process.env.THREE_DIR, path.join(root, 'node_modules', 'three')];
  try { cands.push(path.join(execSync('npm root -g').toString().trim(), 'three')); } catch (e) {}
  for (const c of cands) {
    if (!c) continue;
    try { if (JSON.parse(readFileSync(path.join(c, 'package.json'), 'utf8')).version === THREE_VERSION) return c; } catch (e) {}
  }
  return null;
}

export async function routeThree(context, root) {
  const dir = findThree(root);
  if (!dir) return false;
  await context.route(/^https:\/\/esm\.sh\//, async route => {
    const u = new URL(route.request().url());
    let p = u.pathname, file = null;
    if (p === `/three@${THREE_VERSION}`) file = 'build/three.module.js';
    else if (p.startsWith(`/three@${THREE_VERSION}/build/`)) file = p.slice(`/three@${THREE_VERSION}/`.length);
    else if (p.startsWith(`/three@${THREE_VERSION}/addons/`)) file = 'examples/jsm/' + p.slice(`/three@${THREE_VERSION}/addons/`.length);
    else if (p.startsWith(`/three@${THREE_VERSION}/examples/jsm/`)) file = p.slice(`/three@${THREE_VERSION}/`.length);
    const full = file && path.join(dir, file);
    if (!full || !existsSync(full)) return route.fulfill({ status: 404, body: 'not in local three copy: ' + p });
    let body = readFileSync(full, 'utf8')
      .replace(/from '\.\/three\.core\.js'/g, `from '${ESM}/build/three.core.js'`)
      .replace(/from 'three\/addons\//g, `from '${ESM}/addons/`)
      .replace(/from 'three'/g, `from '${ESM}'`);
    return route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body });
  });
  return true;
}
