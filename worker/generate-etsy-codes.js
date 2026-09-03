#!/usr/bin/env node
// One-off script: generates a fresh batch of unique lifetime access codes
// for the new Etsy digital-download PDF, and a wrangler-bulk-put-ready JSON
// file to load them into the PP_LICENSES KV namespace.
//
// Run: node generate-etsy-codes.js
// Then load into KV with:
//   npx wrangler kv bulk put etsy-codes-kv-bulk.json --binding=PP_LICENSES --remote
// (drop --remote for a local/dev namespace instead)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CODE_COUNT = 300;
const CODE_DIGITS = 5; // matches the existing "82667" style
const EXCLUDED_CODES = new Set(['82667']); // already issued - never regenerate/collide with this

function randomCode() {
  const min = Math.pow(10, CODE_DIGITS - 1);
  const max = Math.pow(10, CODE_DIGITS) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

function generateUniqueCodes(count) {
  const codes = new Set();
  while (codes.size < count) {
    const code = randomCode();
    if (EXCLUDED_CODES.has(code)) continue;
    codes.add(code);
  }
  return Array.from(codes);
}

const codes = generateUniqueCodes(CODE_COUNT);
const now = Date.now();

const bulkPayload = codes.map((code) => ({
  key: code,
  value: JSON.stringify({ type: 'lifetime', createdAt: now, revoked: false }),
}));

const outDir = __dirname;
const bulkPath = path.join(outDir, 'etsy-codes-kv-bulk.json');
const codesListPath = path.join(outDir, 'etsy-codes-list.json');

fs.writeFileSync(bulkPath, JSON.stringify(bulkPayload, null, 2));
fs.writeFileSync(codesListPath, JSON.stringify({ generatedAt: now, count: codes.length, codes }, null, 2));

console.log(`Generated ${codes.length} unique ${CODE_DIGITS}-digit codes.`);
console.log(`- ${bulkPath}  (load into KV: npx wrangler kv bulk put ${path.basename(bulkPath)} --binding=PP_LICENSES --remote)`);
console.log(`- ${codesListPath}  (plain list, used to build the new PDF)`);

// The already-issued grandfathered key - a one-time single-entry seed,
// separate from the new batch above, so it's obvious this isn't "one of
// the 300" and doesn't get accidentally treated as reusable/reassignable.
const existingKeyPath = path.join(outDir, 'seed-existing-key-82667.json');
fs.writeFileSync(
  existingKeyPath,
  JSON.stringify([{ key: '82667', value: JSON.stringify({ type: 'lifetime', createdAt: now, revoked: false }) }], null, 2)
);
console.log(`- ${existingKeyPath}  (the already-issued 82667 key - load this too: npx wrangler kv bulk put ${path.basename(existingKeyPath)} --binding=PP_LICENSES --remote)`);
