import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

console.log(`\n📦 发布 ${PACKAGES.length} 个包到 npm（${BUMP} bump）\n`);

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

  // 3. Publish to npm public registry
  const publishCmd = `npm publish -w @nimble-api/${name}${OTP ? ` --otp=${OTP}` : ''}`;
  try {
    execSync(publishCmd, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    });
    console.log(`  ✅ ${name}@${newVer} 发布成功\n`);
  } catch {
    console.error(`  ❌ ${name} 发布失败，尝试恢复版本...`);
    pkg.version = oldVer;
    writeJson(pkgPath, pkg);
    process.exit(1);
  }
}

console.log('🎉 全部发布完成');
