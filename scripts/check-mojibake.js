const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scanRoots = ['public', 'src', 'docs', 'scripts', 'sql'];
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.ps1', '.sh', '.sql', '.txt']);
const ignoredDirectories = new Set(['.git', 'node_modules', 'uploads', 'dist', 'build']);

const hardPatterns = [
  { name: 'replacement character', regex: /\uFFFD/u },
  { name: 'broken closing tag', regex: /\?\/(?:h[1-6]|p|a|button|option|div)>/u }
];

const mojibakeChars = /[\u951B\u7ECB\u7EEF\u9427\u7039\u7481\u6FB6\u9359\u93CC\u5BF0\u93B4\u8930\u9209\u9354\u4FD9\u9239\u946B\u59DD\u9365]/gu;

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (textExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

function inspectFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of hardPatterns) {
      if (pattern.regex.test(line)) {
        findings.push({ line: index + 1, reason: pattern.name, text: line.trim().slice(0, 160) });
      }
    }

    const suspiciousCount = (line.match(mojibakeChars) || []).length;
    if (suspiciousCount >= 2) {
      findings.push({ line: index + 1, reason: 'common mojibake characters', text: line.trim().slice(0, 160) });
    }
  });
  return findings;
}

const allFindings = [];
for (const relativeRoot of scanRoots) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) continue;
  for (const filePath of walk(absoluteRoot)) {
    const findings = inspectFile(filePath);
    for (const finding of findings) {
      allFindings.push({
        file: path.relative(root, filePath),
        ...finding
      });
    }
  }
}

if (allFindings.length) {
  console.error('Possible mojibake text found:');
  for (const finding of allFindings) {
    console.error(`${finding.file}:${finding.line} ${finding.reason}: ${finding.text}`);
  }
  process.exit(1);
}

console.log('No mojibake patterns found.');
