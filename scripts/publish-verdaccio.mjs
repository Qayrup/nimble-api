import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// === Config ===
const REGISTRY = process.env.NPM_REGISTRY ?? 'http://localhost:4873';
const BUMP = process.argv[2] ?? 'patch';

// Publish order: deps must come first
const PACKAGES = [
  'eventhub',
  'api-service',
  'node-adapter',
  'api-extend',
  'sse-service',
  'oidc',
];

// === Helpers ===
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}
function patchWorkspaceDeps(pkg, version) {
  let changed = false;
  for (const field of ['dependencies', 'peerDependencies']) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, val] of Object.entries(deps)) {
      if (val === '*') {
        deps[name] = `^${version}`;
        changed = true;
      }
    }
  }
  return changed;
}

function restoreDeps(pkg, version, patched) {
  if (!patched) return;
  for (const field of ['dependencies', 'peerDependencies']) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [depName, val] of Object.entries(deps)) {
      if (val === `^${version}`) deps[depName] = '*';
    }
  }
}

function bumpVersion(version, level) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// === Main ===
console.log(`\n📦 发布 ${PACKAGES.length} 个包到 ${REGISTRY}（${BUMP} bump）\n`);

for (const name of PACKAGES) {
  const pkgPath = path.join(__dirname, '..', name, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.log(`  ⚠ ${name} — 目录不存在，跳过`);
    continue;
  }

  // 1. Bump version
  const pkg = readJson(pkgPath);
  const oldVer = pkg.version;
  const newVer = bumpVersion(oldVer, BUMP);
  pkg.version = newVer;
  writeJson(pkgPath, pkg);

  console.log(`  ${name}: ${oldVer} → ${newVer}`);

  // 2. Build
  try {
    execSync(`npm run build -w @nimble-api/${name}`, {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
    });
  } catch (err) {
    console.error(`  ❌ ${name} build 失败`, err?.message ?? err);
    process.exit(1);
  }

  // 3. Replace workspace * with ^version for publish
  const patched = patchWorkspaceDeps(pkg, newVer);
  if (patched) writeJson(pkgPath, pkg);

  // 4. Publish
  try {
    execSync(`npm publish -w @nimble-api/${name} --registry ${REGISTRY}`, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    });
    console.log(`  ✅ ${name}@${newVer} 发布成功\n`);
  } catch {
    console.error(`  ❌ ${name} 发布失败，恢复...`);
    restoreDeps(pkg, newVer, patched);
    pkg.version = oldVer;
    writeJson(pkgPath, pkg);
    process.exit(1);
  }

  // Restore * for local development
  restoreDeps(pkg, newVer, patched);
  if (patched) writeJson(pkgPath, pkg);
}

console.log('🎉 全部发布完成');
