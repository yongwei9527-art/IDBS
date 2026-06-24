const fs = require('fs');
const path = require('path');
const vm = require('vm');

const publicDir = path.resolve(__dirname, '..', 'public');
const htmlFiles = fs.readdirSync(publicDir)
  .filter((file) => file.endsWith('.html'))
  .map((file) => path.join(publicDir, file));

let failed = false;

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  scripts.forEach((script, index) => {
    try {
      new vm.Script(script, { filename: `${file}#inline-script-${index + 1}` });
      console.log(`OK ${path.relative(process.cwd(), file)} inline script ${index + 1}`);
    } catch (error) {
      failed = true;
      console.error(`FAIL ${path.relative(process.cwd(), file)} inline script ${index + 1}`);
      console.error(error.message);
    }
  });
}

if (failed) process.exit(1);
