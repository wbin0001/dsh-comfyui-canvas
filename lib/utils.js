/**
 * dsh-comfyui-canvas — pure helpers.
 *
 * Extracted out of lib/index.js so they are unit-testable without a DSH
 * runtime. Nothing here touches ctx/settings/fetch — every function is a
 * pure function of its arguments.
 */

/** Guess a media type from a file extension (lowercased, no dot). Unknown → null. */
export const MEDIA_TYPE_BY_EXT = {
  // image
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  // audio
  wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
  // video
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  // 3D
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'model/obj', fbx: 'model/fbx', stl: 'model/stl',
  // text / prompts / structured inputs
  txt: 'text/plain', md: 'text/markdown', srt: 'application/x-subrip',
  json: 'application/json', csv: 'text/csv', yaml: 'application/yaml', yml: 'application/yaml',
}

/** @returns mediaType for `ext` (case-insensitive, leading dot tolerated), or null when unknown. */
export function mediaTypeOf(ext) {
  if (typeof ext !== 'string') return null
  const key = ext.trim().toLowerCase().replace(/^\./, '')
  return MEDIA_TYPE_BY_EXT[key] ?? null
}

/**
 * Extract a structured execution error from a ComfyUI history item. ComfyUI
 * stores it under status.execution_error (newer) or status.messages[] entries
 * of type "execution_error" (classic). Returns null when the run had none.
 */
export function extractExecutionError(item) {
  const status = item?.status
  if (!status) return null
  if (status.execution_error && typeof status.execution_error === 'object') {
    const e = status.execution_error
    return {
      nodeId: e.node_id ?? null,
      nodeType: e.node_type ?? null,
      exceptionType: e.exception_type ?? null,
      message: e.exception_message ?? null,
      traceback: Array.isArray(e.traceback) ? e.traceback.join('\n').slice(0, 2000) : (e.traceback ?? null),
    }
  }
  if (Array.isArray(status.messages)) {
    for (const [type, payload] of status.messages) {
      if (type === 'execution_error' && payload && typeof payload === 'object') {
        return {
          nodeId: payload.node_id ?? null,
          nodeType: payload.node_type ?? null,
          exceptionType: payload.exception_type ?? null,
          message: payload.exception_message ?? null,
          traceback: Array.isArray(payload.traceback) ? payload.traceback.join('\n').slice(0, 2000) : (payload.traceback ?? null),
        }
      }
    }
  }
  return null
}

/**
 * Next auto-increment number for `outputStem` naming: scan existing filenames
 * for `<stem>.<NN>.<ext>`, return max(NN)+1 (1 when none). Names like
 * `stem_old.01.png` must NOT match (the stem prefix is `stem.`).
 */
export function nextStemNumber(existingNames, stem) {
  if (!stem) return 1
  const stemPrefix = stem + '.'
  const nums = []
  for (const name of existingNames) {
    if (!name.startsWith(stemPrefix)) continue
    const rest = name.slice(stemPrefix.length)
    const dot = rest.indexOf('.')
    if (dot <= 0) continue
    const numStr = rest.slice(0, dot)
    if (/^\d+$/.test(numStr)) nums.push(Number(numStr))
  }
  return nums.length > 0 ? Math.max(...nums) + 1 : 1
}

/**
 * Upsert one run trace into a runs.json array. Re-downloading the same
 * promptId updates its entry instead of appending a duplicate; `run` numbers
 * continue from the max seen. Returns a NEW array (pure).
 */
export function upsertRun(runs, entry) {
  const list = Array.isArray(runs) ? runs : []
  const existing = list.findIndex((r) => r && r.promptId === entry.promptId)
  const run = existing >= 0 ? list[existing].run : (list.reduce((m, r) => Math.max(m, r?.run || 0), 0) + 1)
  const next = { ...entry, run }
  const out = list.slice()
  if (existing >= 0) out[existing] = next
  else out.push(next)
  return out
}

/**
 * Expand the batch_run `matrix` form into concrete runs (override-set arrays),
 * or pass `runs` through unchanged. Exactly one of the two must be present.
 * - matrix.mode 'zip': parallel slots — the i-th value of every field forms
 *   run i (length = the shared field length); unequal lengths are an error
 *   rather than a silent crop.
 * - matrix.mode 'product': cartesian product — every combination of one value
 *   per field (length = product of field lengths).
 * @param args - the tool args ({runs} or {matrix}).
 * @returns the concrete runs array passed to the bridge.
 */
export function expandBatchMatrix(args) {
  if (Array.isArray(args?.runs)) return args.runs
  const matrix = args?.matrix
  if (!matrix || typeof matrix !== 'object') {
    throw new Error('batch_run requires either `runs` (override sets) or `matrix` (declarative sweep)')
  }
  const fields = Array.isArray(matrix.fields) ? matrix.fields : []
  if (fields.length === 0) throw new Error('matrix.fields must be a non-empty array of {nodeId, key, values}')
  const mode = matrix.mode === 'zip' ? 'zip' : 'product'
  const normalized = fields.map((f) => {
    if (!f || typeof f !== 'object' || !Array.isArray(f.values)) {
      throw new Error(`matrix field invalid: expected {nodeId, key, values: []} (got ${JSON.stringify(f)})`)
    }
    return { nodeId: f.nodeId, key: f.key, values: f.values }
  })
  if (mode === 'zip') {
    const length = Math.min(...normalized.map((f) => f.values.length))
    for (const f of normalized) {
      if (f.values.length !== length) {
        throw new Error(`zip mode requires equal-length fields (got ${JSON.stringify(f.values.length)} vs ${length})`)
      }
    }
    const runs = []
    for (let i = 0; i < length; i++) {
      runs.push({ overrides: normalized.map((f) => ({ nodeId: f.nodeId, key: f.key, value: f.values[i] })) })
    }
    return runs
  }
  // product: cartesian expansion, field order stable (last field varies fastest)
  let runs = [{}]
  for (const f of normalized) {
    const next = []
    for (const combo of runs) {
      for (const value of f.values) {
        next.push({ ...combo, [JSON.stringify([f.nodeId, f.key])]: value })
      }
    }
    runs = next
  }
  return runs.map((combo) => ({
    overrides: Object.entries(combo).map(([k, value]) => {
      const [nodeId, key] = JSON.parse(k)
      return { nodeId: +nodeId, key, value }
    }),
  }))
}
