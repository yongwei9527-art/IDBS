const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scanRoots = ['public', 'src', 'web/src', 'docs', 'scripts', 'sql'];
const rootFiles = ['README.md', 'DISCLAIMER.md', 'package.json'];
const textExtensions = new Set(['.css', '.html', '.js', '.jsx', '.json', '.md', '.ps1', '.sh', '.sql', '.ts', '.tsx', '.txt']);
const ignoredDirectories = new Set(['.git', 'node_modules', 'uploads', 'dist', 'build']);

const hardPatterns = [
  { name: 'replacement character', regex: /\uFFFD/u },
  { name: 'classic mojibake marker', regex: /(\u951F\u65A4\u62F7|[\u00C2\u00C3\u00E2])/u },
  { name: 'garbled Chinese sequence', regex: /(涓婂崍|涓嬪崍|澶滈棿|瀹為獙瀹|瀹屾垚|澶辫触)/u },
  { name: 'broken closing tag', regex: /\?\/(?:h[1-6]|p|a|button|option|div)>/u }
];

const cjkMojibakeChars = /[\u93C1\u6434\u951B\u9359\u95C7\u93C8\u93B5\u7035\u7EFE\u9286\u9428\u6769\u6DC7\u5BB8]/gu;
const whitelistFiles = new Set([path.normalize('scripts/check-mojibake.js')]);

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (textExtensions.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

function inspectFile(filePath) {
  const relative = path.normalize(path.relative(root, filePath));
  if (whitelistFiles.has(relative)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const findings = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const pattern of hardPatterns) {
      if (pattern.regex.test(line)) findings.push({ line: index + 1, reason: pattern.name, text: line.trim().slice(0, 160) });
    }

    const suspiciousCount = (line.match(cjkMojibakeChars) || []).length;
    if (suspiciousCount >= 2) findings.push({ line: index + 1, reason: 'common CJK mojibake sequence', text: line.trim().slice(0, 160) });
  });
  return findings;
}

const allFindings = [];
for (const relativeRoot of scanRoots) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) continue;
  for (const filePath of walk(absoluteRoot)) {
    for (const finding of inspectFile(filePath)) allFindings.push({ file: path.relative(root, filePath), ...finding });
  }
}

for (const relativeFile of rootFiles) {
  const filePath = path.join(root, relativeFile);
  if (!fs.existsSync(filePath)) continue;
  for (const finding of inspectFile(filePath)) allFindings.push({ file: path.relative(root, filePath), ...finding });
}

if (allFindings.length) {
  console.error('Possible mojibake text found:');
  for (const finding of allFindings) console.error(`${finding.file}:${finding.line} ${finding.reason}: ${finding.text}`);
  process.exit(1);
}

console.log('No mojibake patterns found.');
