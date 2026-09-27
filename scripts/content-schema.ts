/** Перегенерирует data/schema/*.schema.json из схем в src/core/content/schema.ts.  npm run content:schema */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/content-node';
import { generateSchemas } from './lib/schemas';

for (const [file, body] of Object.entries(generateSchemas())) {
  writeFileSync(join(ROOT, file), body);
  console.log(`записан ${file}`);
}
