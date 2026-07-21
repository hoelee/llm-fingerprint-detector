/**
 * Example 2 — verify that a cheap/unknown endpoint really serves the model it
 * claims, by comparing its live fingerprint against a reference.
 *
 * Run (from the package root, after `npm run build`):
 *   SUSPECT_API_KEY=sk-... node examples/02-verify-endpoint.mjs
 *
 * The reference here is a bundled sample derived from the paper's public
 * dataset (CC-BY-4.0) — handy for a demo. For real audits, collect your own
 * reference from the official API with example 01 and load that file instead.
 */

import { verify } from '../dist/index.js'
import { loadBundledReference } from '../dist/reference.js'

const apiKey = process.env.SUSPECT_API_KEY
if (!apiKey) {
  console.error('Set SUSPECT_API_KEY for the endpoint you want to test.')
  process.exit(1)
}

// Endpoint under test: does it really serve gpt-4o-mini?
const suspectEndpoint = {
  baseUrl: 'https://openrouter.ai/api/v1', // ← put the reseller/aggregator URL here
  model: 'openai/gpt-4o-mini',
  apiKey,
}

const reference = loadBundledReference('openai/gpt-4o-mini')

const result = await verify(suspectEndpoint, reference, {
  cells: 8,
  samplesPerCell: 25,
  onProgress: (e) => {
    if (e.stage === 'sampling') process.stderr.write(`\r${e.done}/${e.total}`)
  },
})
process.stderr.write('\n')

for (const warning of result.warnings) console.warn(`warning: ${warning}`)

console.log(`verdict:  ${result.verdict}`)
console.log(`mean JSD: ${result.meanJsd?.toFixed(3)} over ${result.comparison.comparableCellCount} cells`)
console.log('baselines: same model ≈ 0.14 · cross-provider ≈ 0.227 · different model ≈ 0.463')

console.log('\nmost divergent cells:')
for (const cell of result.comparison.cells.slice(0, 5)) {
  console.log(`  ${cell.cellId.padEnd(26)} JSD ${cell.jsd.toFixed(3)}`)
}

// CI-style decision:
process.exitCode = result.verdict === 'match' ? 0 : 1
