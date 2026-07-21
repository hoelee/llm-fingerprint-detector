#!/usr/bin/env node
/**
 * Build data/reference-fingerprints.sample.json from the paper's public
 * Zenodo dataset (DOI 10.5281/zenodo.21278557, CC-BY-4.0).
 *
 * Input: the dataset's aggregated `distributions.json` — an object with a
 * `distributions` array of per-cell records:
 *   { model, task_id, lang, temperature, n_valid, dist: { answer: probability }, ... }
 *
 * Counts are reconstructed as round(probability × n_valid) and answers are
 * re-normalized with this package's normalizer so vocabularies line up
 * (e.g. the dataset's coin answers h/t → heads/tails, 蓝色 → 蓝). Cells that
 * lose more than 20% of their probability mass in re-normalization are
 * skipped.
 *
 * Usage:
 *   npm run build   # the script imports the compiled normalizer from dist/
 *   node scripts/build-sample-references.mjs <path-to-distributions.json> \
 *     [--models comma,separated,slugs] [--out data/reference-fingerprints.sample.json]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { PROBE_TASKS } from '../dist/battery.js'
import { normalizeAnswer } from '../dist/normalizer.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Dataset task_id → this package's battery task id. */
const TASK_MAP = {
  'num100-random': 'random-number-1-100',
  'num10-random': 'random-number-1-10',
  'letter-random': 'random-letter',
  'color-random': 'random-color',
  'coin-flip': 'coin-flip',
  'animal-random': 'random-animal',
  'city-random': 'random-city',
  'num-favorite': 'favorite-number',
}

const LANGS = new Set(['en', 'zh'])

/** The dataset folds coin answers to single letters; pre-expand before normalizing. */
const COIN_PREMAP = { h: 'heads', t: 'tails' }

const DEFAULT_MODELS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'openai/gpt-4.1-mini',
  'anthropic/claude-sonnet-4.5',
  'google/gemini-2.5-flash',
  'deepseek/deepseek-chat',
  'meta-llama/llama-3.1-8b-instruct',
  'qwen/qwen3-30b-a3b-instruct-2507',
  'mistralai/mistral-small-3.2-24b-instruct',
  'z-ai/glm-4.5',
  'moonshotai/kimi-k2',
]

function parseArgs(argv) {
  const args = { input: null, models: DEFAULT_MODELS, out: join(HERE, '..', 'data', 'reference-fingerprints.sample.json') }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--models') args.models = argv[++i].split(',').map((m) => m.trim())
    else if (token === '--out') args.out = argv[++i]
    else if (!token.startsWith('--') && !args.input) args.input = token
    else throw new Error(`Unknown argument: ${token}`)
  }
  if (!args.input) {
    console.error('usage: node scripts/build-sample-references.mjs <distributions.json> [--models a,b] [--out file]')
    process.exit(1)
  }
  return args
}

function convertCell(record, taskId) {
  const domain = PROBE_TASKS[taskId].domain
  const counts = {}
  let keptMass = 0
  let totalMass = 0
  for (const [rawAnswer, probability] of Object.entries(record.dist)) {
    totalMass += probability
    const premapped = taskId === 'coin-flip' ? (COIN_PREMAP[rawAnswer] ?? rawAnswer) : rawAnswer
    const { normalized, category } = normalizeAnswer(premapped, domain)
    if (category !== 'valid' || normalized === null) continue
    const count = Math.round(probability * record.n_valid)
    if (count <= 0) continue
    counts[normalized] = (counts[normalized] ?? 0) + count
    keptMass += probability
  }
  if (totalMass <= 0 || keptMass / totalMass < 0.8) return null
  const n = Object.values(counts).reduce((sum, c) => sum + c, 0)
  if (n < 10) return null
  return { n, counts }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const payload = JSON.parse(readFileSync(args.input, 'utf8'))
  const records = payload.distributions
  if (!Array.isArray(records)) throw new Error('Input has no "distributions" array')

  const collectedAt = (payload.generated_utc ?? '').slice(0, 10) || 'unknown'
  const wanted = new Set(args.models)
  const models = {}
  let skippedCells = 0

  for (const record of records) {
    if (!wanted.has(record.model)) continue
    if (!LANGS.has(record.lang)) continue
    const taskId = TASK_MAP[record.task_id]
    if (!taskId) continue
    if (record.temperature !== 1) continue

    const cell = convertCell(record, taskId)
    if (!cell) {
      skippedCells += 1
      continue
    }
    const cellId = `${taskId}:${record.lang}`
    models[record.model] ??= {
      model: record.model,
      collectedAt,
      channel: 'openrouter',
      cells: {},
    }
    models[record.model].cells[cellId] = cell
  }

  for (const model of args.models) {
    const entry = models[model]
    if (!entry) {
      console.warn(`warn: model not found in dataset: ${model}`)
    } else if (Object.keys(entry.cells).length < 8) {
      console.warn(`warn: ${model} only has ${Object.keys(entry.cells).length} usable cells`)
    }
  }

  const output = {
    formatVersion: 1,
    protocol: 'bruckner-zenodo-2026',
    samplesPerCell: 30,
    source: {
      dataset:
        'Single-token output distributions as behavioral fingerprints of large language models',
      author: 'Tomáš Bruckner (Prague University of Economics and Business)',
      datasetDoi: '10.5281/zenodo.21278557',
      paper: 'arXiv:2607.10252',
      license: 'CC-BY-4.0',
      note:
        'Counts reconstructed as round(probability × n_valid) from the published per-cell distributions; ' +
        'answers re-normalized with the llm-fingerprint-detector normalizer. Collected via OpenRouter by ' +
        "the paper's harness under the paper's prompt protocol (not this package's battery), so comparisons " +
        'against these samples are indicative rather than strict.',
    },
    models,
  }

  writeFileSync(args.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  const cellTotal = Object.values(models).reduce((sum, m) => sum + Object.keys(m.cells).length, 0)
  console.log(
    `wrote ${args.out}: ${Object.keys(models).length} models, ${cellTotal} cells (${skippedCells} cells skipped in re-normalization)`,
  )
}

main()
