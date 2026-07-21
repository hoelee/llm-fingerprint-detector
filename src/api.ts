/**
 * Public high-level API:
 *
 *   fingerprint(endpoint, options?)          → collect a behavioral fingerprint
 *   compare(fingerprintA, fingerprintB)      → distance + verdict
 *   verify(endpoint, reference, options?)    → fingerprint + compare in one call
 */

import { detectReasoningAdapter } from './adapter.js'
import { CELL_PRIORITY_ORDER, getTaskSpec } from './battery.js'
import {
  DEFAULT_CELL_COUNT,
  DEFAULT_CONCURRENCY,
  DEFAULT_SAMPLES_PER_CELL,
  FINGERPRINT_FORMAT_VERSION,
  PROBE_PROTOCOL,
  SPLIT_HALF_WARN_THRESHOLD,
} from './constants.js'
import { resolveEndpoint } from './endpoint.js'
import { runProbeBattery } from './sampler.js'
import { buildCellDistribution, compareCellSets, splitHalfJsd } from './stats.js'
import { buildComparisonResult } from './verdict.js'
import type {
  CellDistribution,
  CellId,
  ComparisonResult,
  Endpoint,
  Fingerprint,
  FingerprintOptions,
  FingerprintRun,
  VerifyResult,
} from './types.js'

function resolveCells(cells: FingerprintOptions['cells']): CellId[] {
  if (cells === undefined) return CELL_PRIORITY_ORDER.slice(0, DEFAULT_CELL_COUNT)
  if (typeof cells === 'number') {
    const count = Math.max(1, Math.min(CELL_PRIORITY_ORDER.length, Math.floor(cells)))
    return CELL_PRIORITY_ORDER.slice(0, count)
  }
  if (cells.length === 0) throw new Error('options.cells must not be empty')
  return cells
}

/**
 * Probe an OpenAI-compatible endpoint and collect its behavioral fingerprint.
 *
 * Steps: normalize the endpoint → detect a working reasoning-disable strategy
 * → run the probe battery (shuffled, concurrent) → aggregate per-cell answer
 * distributions.
 */
export async function fingerprint(
  endpoint: Endpoint,
  options: FingerprintOptions = {},
): Promise<FingerprintRun> {
  const startedAt = Date.now()
  const { resolved, warnings } = resolveEndpoint(endpoint)
  const cells = resolveCells(options.cells)
  const samplesPerCell = options.samplesPerCell ?? DEFAULT_SAMPLES_PER_CELL
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY

  const adapter =
    options.adapter ??
    (await detectReasoningAdapter(resolved, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      onProbe: (strategy) =>
        options.onProgress?.({ stage: 'adapter', done: 0, total: 1, errors: 0, strategy }),
    }))

  if (adapter.postReasoning) {
    warnings.push(
      'Reasoning could not be disabled; fell back to the post-reasoning channel (max_tokens=1024). Fingerprint confidence is reduced.',
    )
  }

  const { samples, samplesByCell, errorCount } = await runProbeBattery({
    endpoint: resolved,
    adapter,
    cells,
    samplesPerCell,
    concurrency,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    signal: options.signal,
    onProgress: options.onProgress,
  })

  const cellDistributions: Partial<Record<CellId, CellDistribution>> = {}
  for (const cellId of cells) {
    cellDistributions[cellId] = buildCellDistribution(
      cellId,
      samplesByCell.get(cellId) ?? [],
      getTaskSpec(cellId).domain,
    )
  }

  const selfJsd = splitHalfJsd(samplesByCell)
  if (selfJsd !== null && selfJsd > SPLIT_HALF_WARN_THRESHOLD) {
    warnings.push(
      `Split-half self distance is high (${selfJsd.toFixed(3)} > ${SPLIT_HALF_WARN_THRESHOLD}); the endpoint may be routing across multiple backends.`,
    )
  }
  if (errorCount > 0) {
    warnings.push(`${errorCount} of ${samples.length} requests failed and were excluded.`)
  }

  const result: FingerprintRun = {
    fingerprint: {
      formatVersion: FINGERPRINT_FORMAT_VERSION,
      protocol: PROBE_PROTOCOL,
      model: resolved.model,
      collectedAt: new Date().toISOString(),
      samplesPerCell,
      postReasoning: adapter.postReasoning,
      cells: cellDistributions,
      meta: {
        tool: 'llm-fingerprint-detector',
        ...options.meta,
      },
    },
    adapter,
    errorCount,
    splitHalfJsd: selfJsd,
    durationMs: Date.now() - startedAt,
    warnings,
  }
  if (options.keepSamples) result.samples = samples
  return result
}

/**
 * Compare two fingerprints: mean per-cell Jensen-Shannon divergence (base 2)
 * over cells where both sides have enough valid samples, plus a three-way
 * verdict against the paper-derived thresholds.
 */
export function compare(a: Fingerprint, b: Fingerprint): ComparisonResult {
  const { entries, meanJsd } = compareCellSets(a.cells, b.cells)
  const protocolMismatch = a.protocol !== b.protocol
  return buildComparisonResult(entries, meanJsd, protocolMismatch)
}

/**
 * Verify that an endpoint behaves like a reference fingerprint: collect a
 * fresh fingerprint from the endpoint, then compare against the reference.
 */
export async function verify(
  endpoint: Endpoint,
  reference: Fingerprint,
  options: FingerprintOptions = {},
): Promise<VerifyResult> {
  const referenceCells = Object.keys(reference.cells) as CellId[]
  const cells =
    options.cells !== undefined
      ? resolveCells(options.cells)
      : CELL_PRIORITY_ORDER.filter((cellId) => referenceCells.includes(cellId))
  if (cells.length === 0) {
    throw new Error('Reference fingerprint has no cells overlapping the probe battery')
  }

  const target = await fingerprint(endpoint, { ...options, cells })
  const comparison = compare(target.fingerprint, reference)

  const warnings = [...target.warnings]
  if (comparison.protocolMismatch) {
    warnings.push(
      `Protocol mismatch: target "${target.fingerprint.protocol}" vs reference "${reference.protocol}". ` +
        'Fingerprints collected under different prompts/batteries are only loosely comparable; treat the verdict as indicative.',
    )
  }
  if (reference.postReasoning) {
    warnings.push('Reference fingerprint was collected over the post-reasoning channel (reduced confidence).')
  }

  return {
    verdict: comparison.verdict,
    meanJsd: comparison.meanJsd,
    comparison,
    target,
    reference,
    warnings,
  }
}
