import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Parse CLI args
let BUMP = 'patch';
let OTP = '';
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--otp=')) {
    OTP = arg.slice('--otp='.length);
  } else if (!arg.startsWith('--')) {
    BUMP = arg;
  }
}

// Publish order: deps must come first
const PACKAGES = [
  'eventhub',
  'api-service',
  'node-adapter',
  'api-extend',
  'sse-service',
  'oidc',
];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}
function bumpVersion(version, level) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// ═══ 以 eventhub 为准一版本源，所有包强制统一版本 ═══
const eventhubPkg = readJson(path.join(ROOT, 'eventhub', 'package.json'));
const OLD_VERSION = eventhubPkg.version;
const NEW_VERSION = bumpVersion(OLD_VERSION, BUMP);

console.log(`\n📦 统一升级 ${PACKAGES.length} 个包: ${OLD_VERSION} → ${NEW_VERSION} (${BUMP})\n`);

// Phase 1: Bump all versions + patch workspace deps
const patched = new Set();
for (const name of PACKAGES) {
  const pkgPath = path.join(ROOT, name, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.log(`  ⚠ ${name} — 目录不存在，跳过`);
    continue;
  }

  const pkg = readJson(pkgPath);
  pkg.version = NEW_VERSION;

  // Replace workspace * with ^version for publish
  for (const field of ['dependencies', 'peerDependencies']) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [depName, val] of Object.entries(deps)) {
      if (val === '*') {
        deps[depName] = `^${NEW_VERSION}`;
        patched.add(`${name}:${depName}`);
      }
    }
  }

  writeJson(pkgPath, pkg);
  console.log(`  📝 ${name}: ${OLD_VERSION} → ${NEW_VERSION}`);
}

// Phase 2: Build + Publish (from package dir, NOT -w)
console.log('');
let failed = false;
for (const name of PACKAGES) {
  const pkgPath = path.join(ROOT, name, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;

  const pkgDir = path.join(ROOT, name);

  // Build
  console.log(`  🔨 ${name} building...`);
  try {
    execSync(`npm run build -w @nimble-api/${name}`, {
      cwd: ROOT,
      stdio: 'pipe',
    });
  } catch (err) {
    console.error(`  ❌ ${name} build 失败: ${err?.stderr?.toString() ?? err?.message ?? err}`);
    failed = true;
    break;
  }

  // Publish from the package directory (avoids npm injecting workspace:^)
  const publishCmd = `npm publish${OTP ? ` --otp=${OTP}` : ''}`;
  try {
    execSync(publishCmd, { cwd: pkgDir, stdio: 'inherit' });
    console.log(`  ✅ ${name}@${NEW_VERSION} 发布成功\n`);
  } catch {
    console.error(`  ❌ ${name} 发布失败\n`);
    failed = true;
    break;
  }
}

// Phase 3: Restore workspace * for local development
console.log('🔄 恢复本地 workspace 依赖...');
for (const name of PACKAGES) {
  const pkgPath = path.join(ROOT, name, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;

  const pkg = readJson(pkgPath);
  if (failed) {
    // Rollback version to old
    pkg.version = OLD_VERSION;
  }
  for (const field of ['dependencies', 'peerDependencies']) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [depName, val] of Object.entries(deps)) {
      if (patched.has(`${name}:${depName}`) && val === `^${NEW_VERSION}`) {
        deps[depName] = '*';
      }
    }
  }
  writeJson(pkgPath, pkg);
}

if (failed) {
  console.error(`\n❌ 发布中断，版本已回滚到 ${OLD_VERSION}`);
  process.exit(1);
}
console.log(`🎉 全部 ${PACKAGES.length} 个包 @${NEW_VERSION} 发布完成`);
