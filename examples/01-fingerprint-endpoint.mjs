/**
 * Example 1 — collect a fingerprint from an endpoint you trust and save it
 * as a reference for later verification.
 *
 * Run (from the package root, after `npm run build`):
 *   OPENAI_API_KEY=sk-... node examples/01-fingerprint-endpoint.mjs
 *
 * With the published package, import from 'llm-fingerprint-detector' instead
 * of '../dist/index.js'.
 */

import { writeFileSync } from 'node:fs'

import { fingerprint } from '../dist/index.js'

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) {
  console.error('Set OPENAI_API_KEY (the key is only sent to the endpoint you probe).')
  process.exit(1)
}

const run = await fingerprint(
  {
    baseUrl: 'https://api.openai.com/v1', // any OpenAI-compatible endpoint
    model: 'gpt-4o-mini',
    apiKey,
  },
  {
    cells: 8, // top-8 most discriminative cells (= "standard" preset)
    samplesPerCell: 25,
    concurrency: 4,
    onProgress: (e) => {
      if (e.stage === 'sampling') process.stderr.write(`\r${e.done}/${e.total}`)
    },
  },
)
process.stderr.write('\n')

for (const warning of run.warnings) console.warn(`warning: ${warning}`)

console.log(`model:            ${run.fingerprint.model}`)
console.log(`cells:            ${Object.keys(run.fingerprint.cells).length}`)
console.log(`errors:           ${run.errorCount}`)
console.log(`split-half JSD:   ${run.splitHalfJsd?.toFixed(3) ?? 'n/a'} (same-model baseline ≈ 0.14)`)
console.log(`reasoning adapter: ${run.adapter.strategy}`)

writeFileSync('gpt-4o-mini.fingerprint.json', JSON.stringify(run.fingerprint, null, 2))
console.log('\nsaved to gpt-4o-mini.fingerprint.json — use it later with verify()')
