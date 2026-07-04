const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const scanRoots = ['server.js', 'src', 'public/js', 'scripts'];
const ignoredDirectories = new Set(['.git', 'node_modules', 'uploads', 'dist', 'build']);
const ignoredFiles = new Set([]);

function walk(targetPath, files = []) {
  if (!fs.existsSync(targetPath)) return files;

  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    if (path.extname(targetPath).toLowerCase() === '.js' && !ignoredFiles.has(path.basename(targetPath))) {
      files.push(targetPath);
    }
    return files;
  }

  if (!stat.isDirectory()) return files;

  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    walk(path.join(targetPath, entry.name), files);
  }

  return files;
}

const files = scanRoots
  .flatMap((relativePath) => walk(path.join(root, relativePath)))
  .map((filePath) => path.relative(root, filePath))
  .sort((left, right) => left.localeCompare(right));

let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8'
  });

  if (result.status === 0) {
    console.log(`OK ${file}`);
    continue;
  }

  failed = true;
  console.error(`FAIL ${file}`);
  if (result.stdout) console.error(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
}

if (!files.length) {
  console.warn('No JavaScript files found for syntax check.');
}

if (failed) process.exit(1);

console.log(`Checked ${files.length} JavaScript files.`);