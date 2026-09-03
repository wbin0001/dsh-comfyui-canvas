import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mediaTypeOf, extractExecutionError, nextStemNumber, upsertRun } from '../lib/utils.js'

test('mediaTypeOf maps known extensions', () => {
  assert.equal(mediaTypeOf('png'), 'image/png')
  assert.equal(mediaTypeOf('mp3'), 'audio/mpeg')
  assert.equal(mediaTypeOf('mp4'), 'video/mp4')
  assert.equal(mediaTypeOf('glb'), 'model/gltf-binary')
  assert.equal(mediaTypeOf('json'), 'application/json')
  assert.equal(mediaTypeOf('srt'), 'application/x-subrip')
})

test('mediaTypeOf is case-insensitive and dot-tolerant', () => {
  assert.equal(mediaTypeOf('PNG'), 'image/png')
  assert.equal(mediaTypeOf('Mp3'), 'audio/mpeg')
})

test('mediaTypeOf returns null for unknown extensions', () => {
  assert.equal(mediaTypeOf('xyz'), null)
  assert.equal(mediaTypeOf(''), null)
})

test('extractExecutionError handles modern status.execution_error', () => {
  const item = {
    status: {
      execution_error: {
        node_id: 7,
        node_type: 'CheckpointLoaderSimple',
        exception_type: 'FileNotFoundError',
        exception_message: 'Checkpoint not found: sd_xl_base.safetensors',
        traceback: ['line1', 'line2'],
      },
    },
  }
  const err = extractExecutionError(item)
  assert.equal(err.nodeId, 7)
  assert.equal(err.nodeType, 'CheckpointLoaderSimple')
  assert.equal(err.exceptionType, 'FileNotFoundError')
  assert.equal(err.message, 'Checkpoint not found: sd_xl_base.safetensors')
  assert.equal(err.traceback, 'line1\nline2')
})

test('extractExecutionError handles classic status.messages entries', () => {
  const item = {
    status: {
      messages: [
        ['execution_start', {}],
        ['execution_error', {
          node_id: 3,
          node_type: 'VAEDecode',
          exception_type: 'RuntimeError',
          exception_message: 'CUDA OOM',
          traceback: ['x'],
        }],
      ],
    },
  }
  const err = extractExecutionError(item)
  assert.equal(err.nodeId, 3)
  assert.equal(err.exceptionType, 'RuntimeError')
})

test('extractExecutionError returns null when no error', () => {
  assert.equal(extractExecutionError({ status: { status_str: 'success' } }), null)
  assert.equal(extractExecutionError({ outputs: {} }), null)
  assert.equal(extractExecutionError(undefined), null)
})

test('extractExecutionError tolerates malformed messages', () => {
  assert.equal(extractExecutionError({ status: { messages: 'nope' } }), null)
  assert.equal(extractExecutionError({ status: { messages: [['other', {}]] } }), null)
})

test('nextStemNumber starts at 1 on empty', () => {
  assert.equal(nextStemNumber([], 'char_ref'), 1)
})

test('nextStemNumber continues from existing sequence', () => {
  assert.equal(nextStemNumber(['char_ref.01.png', 'char_ref.02.png'], 'char_ref'), 3)
  assert.equal(nextStemNumber(['char_ref.99.png', 'char_ref.100.png'], 'char_ref'), 101)
})

test('nextStemNumber ignores unrelated names and prefix collisions', () => {
  // char_ref_old.01.png shares the prefix up to the dot but must NOT match
  assert.equal(nextStemNumber(['other.png', 'char_ref.07.png', 'x.1.y.png'], 'char_ref'), 8)
  assert.equal(nextStemNumber(['char_ref_old.01.png', 'char_ref.05.png'], 'char_ref'), 6)
})

test('nextStemNumber skips names without an extension', () => {
  assert.equal(nextStemNumber(['char_ref.03'], 'char_ref'), 1)
})

test('nextStemNumber returns 1 when stem is empty', () => {
  assert.equal(nextStemNumber(['x.01.png'], ''), 1)
})

test('upsertRun appends new entries with incrementing run numbers', () => {
  const runs = upsertRun([], {
    promptId: 'p1',
    overrides: [],
    timestamp: 't1',
    status: 'queued',
    files: ['a.png'],
  })
  assert.equal(runs.length, 1)
  assert.equal(runs[0].run, 1)

  const runs2 = upsertRun(runs, {
    promptId: 'p2',
    overrides: [],
    timestamp: 't2',
    status: 'queued',
    files: ['b.png'],
  })
  assert.equal(runs2.length, 2)
  assert.equal(runs2[1].run, 2)
})

test('upsertRun updates an existing promptId instead of duplicating', () => {
  const first = upsertRun([], {
    promptId: 'p1',
    overrides: [{ nodeId: 6, key: 'seed', value: 42 }],
    timestamp: 't1',
    status: 'queued',
    files: ['a.png'],
  })
  const updated = upsertRun(first, {
    promptId: 'p1',
    overrides: [{ nodeId: 6, key: 'seed', value: 43 }],
    timestamp: 't2',
    status: 'success',
    files: ['a.png'],
  })
  assert.equal(updated.length, 1, 'must not append a duplicate')
  assert.equal(updated[0].run, 1, 'run number must be preserved')
  assert.equal(updated[0].status, 'success', 'status must be refreshed')
  assert.equal(updated[0].overrides[0].value, 43)
})

test('upsertRun is pure — does not mutate input', () => {
  const input = []
  const out = upsertRun(input, { promptId: 'p1', files: [] })
  assert.equal(input.length, 0, 'input array must stay untouched')
  assert.equal(out.length, 1)
})

test('upsertRun handles non-array input as empty', () => {
  const out = upsertRun(undefined, { promptId: 'p1', files: [] })
  assert.equal(out.length, 1)
  assert.equal(out[0].run, 1)
})
