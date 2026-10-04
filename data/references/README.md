# Reference fingerprints (trusted, collected with this tool)

These are **first-party** references — collected by `llm-fingerprint-detector`
itself against a provider you trust, using the package's own `one-token/v1`
battery. Unlike `../reference-fingerprints.sample.json` (Zenodo paper data,
`bruckner-zenodo-2026` protocol), these are protocol-matched, so a
`compare()` against them is a direct, non-indicative comparison.

| file | model id | provider | collected | protocol | battery |
|---|---|---|---|---|---|
| `deepseek-v4.1-flash.official.json` | `deepseek-flash` | api.deepseek.com (official) | 2026-10-04 | `one-token/v1` | 8 cells × 25 samples |

## `deepseek-v4.1-flash.official.json`

- **Endpoint:** `https://api.deepseek.com/v1`
- **Model id requested:** `deepseek-flash` (API-reported name: `DeepSeek-V4.1-Flash`)
- **Collected:** 2026-10-04, standard preset, `temperature=1`, reasoning disabled
  via the `openai-effort` adapter
- **Result:** 200/200 samples valid, 0 errors, `postReasoning: false`
- **Use it to verify a reseller:** a reseller advertising `deepseek-v4.1-flash`
  (or `deepseek-flash`) should land in the *match* band against this file.

```bash
# verify a suspect endpoint against this trusted reference
llm-fingerprint verify \
  --base-url https://reseller.example.com/v1 \
  --model deepseek-v4.1-flash \
  --reference data/references/deepseek-v4.1-flash.official.json
```

### The official fingerprint's most discriminative cells

| cell | official DeepSeek-V4.1-Flash | notes |
|---|---|---|
| `random-number-1-100:en` | `42` ×19 / 25 | overwhelming 42 bias |
| `random-number-1-100:zh` | `42` ×14 / 25 | same bias, Chinese |
| `random-color:en` | `blue` ×25 / 25 | fully deterministic |
| `coin-flip:en` | `heads` ×25 / 25 | fully deterministic |
| `random-number-1-10:en` | `7` ×23 / 25 | near-deterministic |
| `random-letter:en` | `q` ×18 / 25 | q ≫ k ≫ g |
| `random-color:zh` | `蓝` ×20 / 25 | 蓝 ≫ 紫, 橙 |
| `random-animal:en` | `elephant` ×11, `cat` ×9 | elephant dominates |

**Caveat:** references drift as providers ship model updates. Re-collect if the
file is more than ~1–2 months old, or if a verification you trust starts
returning `uncertain`.
