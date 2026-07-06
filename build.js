/**
 * Build script using caxa - packages the project into a self-extracting executable.
 *
 * Usage: node build.js
 * Output: dist/ddbot-wsa-webui.exe (Windows) or dist/ddbot-wsa-webui (Linux/macOS)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIST_DIR = path.join(__dirname, 'dist');
const BUILD_DIR = path.join(__dirname, '.build');
const isWin = process.platform === 'win32';
const OUTPUT = path.join(DIST_DIR, isWin ? 'ddbot-wsa-webui.exe' : 'ddbot-wsa-webui');

console.log('=== DDBOT-WSa WebUI Build ===\n');

if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

// Clean previous build dir
try { fs.rmSync(BUILD_DIR, { recursive: true, force: true }); } catch {}
fs.mkdirSync(BUILD_DIR, { recursive: true });

// Copy only production files to .build/
console.log('[1/3] Preparing build directory...');

const copyRecursive = (src, dest, exclude = []) => {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      if (exclude.includes(f)) continue;
      copyRecursive(path.join(src, f), path.join(dest, f), exclude);
    }
  } else {
    fs.copyFileSync(src, dest);
  }
};

// Copy source files
copyRecursive(path.join(__dirname, 'server.js'), path.join(BUILD_DIR, 'server.js'));
copyRecursive(path.join(__dirname, 'package.json'), path.join(BUILD_DIR, 'package.json'));
copyRecursive(path.join(__dirname, 'lib'), path.join(BUILD_DIR, 'lib'));
copyRecursive(path.join(__dirname, 'public'), path.join(BUILD_DIR, 'public'));

// Install production-only dependencies in build dir
console.log('[2/3] Installing production dependencies...');
execSync('npm install --omit=dev --ignore-scripts', {
  cwd: BUILD_DIR,
  stdio: 'pipe'
});

// Remove unnecessary files from node_modules
const cleanDir = (dir) => {
  if (!fs.existsSync(dir)) return;
  const patterns = [
    /\.md$/i, /README/i, /LICENSE/i, /CHANGELOG/i,
    /test/i, /tests/i, /__tests__/i, /spec/i,
    /\.map$/, /\.d\.ts$/, /tsconfig/,
    /\.github/, /\.travis/, /\.circleci/,
    /example/i, /doc/i, /docs/i,
  ];
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const fp = path.join(d, f);
      const stat = fs.statSync(fp);
      if (stat.isDirectory()) {
        if (/^(test|tests|__tests__|spec|example|examples|doc|docs|\.github)$/i.test(f)) {
          fs.rmSync(fp, { recursive: true, force: true });
          continue;
        }
        walk(fp);
      } else if (patterns.some(p => p.test(f))) {
        fs.unlinkSync(fp);
      }
    }
  };
  walk(dir);
};

cleanDir(path.join(BUILD_DIR, 'node_modules'));

const buildSize = (() => {
  let total = 0;
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const fp = path.join(d, f);
      const s = fs.statSync(fp);
      if (s.isDirectory()) walk(fp);
      else total += s.size;
    }
  };
  walk(BUILD_DIR);
  return total;
})();
console.log(`  Build dir size: ${(buildSize / 1024 / 1024).toFixed(1)} MB\n`);

// Pack with caxa
console.log('[3/3] Packing with caxa...');

const caxaBin = path.join(__dirname, 'node_modules', '.bin', isWin ? 'caxa.cmd' : 'caxa');

const args = [
  '--input', BUILD_DIR,
  '--output', OUTPUT,
  '--no-dedupe',
  '--no-remove-build-directory',
  '--',
  '{{caxa}}/node_modules/.bin/node',
  '{{caxa}}/server.js',
];

try {
  execSync(`"${caxaBin}" ${args.map(a => `"${a}"`).join(' ')}`, {
    stdio: 'inherit',
    cwd: __dirname
  });
} catch (e) {
  console.error('\ncaxa failed:', e.message);
  process.exit(1);
}

// Cleanup
try { fs.rmSync(BUILD_DIR, { recursive: true, force: true }); } catch {}

if (fs.existsSync(OUTPUT)) {
  const stats = fs.statSync(OUTPUT);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
  console.log(`\n=== Build Complete ===`);
  console.log(`Output: ${OUTPUT}`);
  console.log(`Size: ${sizeMB} MB`);
  console.log(`\nUsage:`);
  console.log(`  ${OUTPUT}`);
  console.log(`  WEBUI_PORT=8080 DDBOT_DIR=D:\\DDBOT ${OUTPUT}`);
}
