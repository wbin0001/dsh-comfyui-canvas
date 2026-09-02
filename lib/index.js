/**
 * DSH-ComfyUI-Canvas — host-side agent tools.
 *
 * Registers the canvas tools the agent uses to operate the live ComfyUI
 * canvas through ComfyUI-DSH-Canvas bridge (a custom_node injected into
 * ComfyUI). Reads go straight to the bridge's /dsh-bridge/workflow store;
 * writes POST a command, then poll the frontend's execution result.
 *
 * M1: read_workflow + add_node / connect / set_param / remove_node.
 * M2: load_workflow (rewrite loop) + run + debug (validate + highlight).
 * M3: settings-driven configuration — the base URL is read from the
 *     `dsh-comfyui-canvas` settings namespace (registration optional so an
 *     environment without the settings service still starts with defaults).
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

export const name = 'dsh-comfyui-canvas'
export const inject = ['tools', 'settings', 'shell', 'skills']

const NAMESPACE = settingsNamespace('dsh-comfyui-canvas')
const DEFAULT_BASE = 'http://127.0.0.1:8188'
const ENV_BASE = (process.env.COMFYUI_URL || '').replace(/\/+$/, '')

const ConfigSchema = z.object({
  /** ComfyUI HTTP server base URL. */
  baseUrl: z.string().default(DEFAULT_BASE),
  /** Optional port shortcut; when non-empty it rewrites the base URL's port. */
  port: z.number(),
  /** loopback | lan | cloud-selfhosted | saas */
  networkMode: z.string().default('loopback'),
  /** Launch command used by the canvas Start button / agent auto-start. */
  launchCommand: z.string().default(''),
  /**
   * Absolute path to the ComfyUI install directory. Used by comfyui_upgrade
   * (git pull core + custom nodes) and by the launch button's working dir.
   * Empty falls back to the launch command's own directory / env COMfyUI_DIR.
   */
  comfyuiDir: z.string().default(''),
  /** Split-rail width in px. */
  railWidth: z.number().default(360),
  /**
   * Optional shared secret for the ComfyUI bridge. When set, every agent
   * request carries `Authorization: Bearer <token>`, and the bridge only
   * answers requests that present the same token (the bridge reads it from
   * its OWN `DSH_BRIDGE_TOKEN` env var). Empty keeps the bridge open, the
   * same trust model as ComfyUI's own /prompt. Keep both sides identical.
   */
  bridgeToken: z.string().default(''),
  /**
   * One-shot launch request: the client start button sets this true, the host
   * watcher picks it up, starts ComfyUI via launchCommand, then clears it.
   */
  launchRequested: z.boolean().default(false),
  /**
   * Last launch failure message (host writes it when the launch command exits
   * before ComfyUI comes up). The client start card shows it instead of
   * hanging on "正在启动…" forever. Cleared on the next successful launch.
   */
  launchError: z.string().default(''),
  /**
   * Per-session record of which conversation view is active in the browser
   * right now, keyed by session id: 'canvas' = the ComfyUI split-screen tab is
   * selected for that session, 'chat' = the plain Chat tab is. Written by the
   * client view component on mount/unmount for ITS OWN session only, so one
   * session's canvas state never leaks into another. comfyui_config reads the
   * current session's value so the agent knows whether to focus on canvas work.
   */
  activeViewBySession: z.dict(z.union([z.const('canvas'), z.const('chat')])).default({}),
})

function renderJSON(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/** Guess a media type from a file extension (lowercased, no dot). Unknown → null. */
const MEDIA_TYPE_BY_EXT = {
  // image
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  // audio
  wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
  // video
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  // 3D
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'model/obj', fbx: 'model/fbx', stl: 'model/stl',
}
function mediaTypeOf(ext) {
  return MEDIA_TYPE_BY_EXT[ext] ?? null
}

/** Extra headers for bridge requests; carries the optional shared token. */
function bridgeHeaders(token) {
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' }
}

/** POST a write command to the bridge and poll for the frontend result. */
async function sendCommand(baseUrl, token, cmd, payload, signal, { pollMs = 400, timeoutMs = 8000 } = {}) {
  const started = Date.now()
  const res = await fetch(`${baseUrl}/dsh-bridge/command`, {
    method: 'POST',
    headers: bridgeHeaders(token),
    body: JSON.stringify({ cmd, payload }),
    signal,
  })
  if (!res.ok) throw new Error(`bridge command HTTP ${res.status}`)
  const { accepted, id, error } = await res.json()
  if (!accepted) throw new Error(error || 'bridge command not accepted')

  while (Date.now() - started < timeoutMs) {
    const r = await fetch(`${baseUrl}/dsh-bridge/result/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal,
    })
    const item = await r.json().catch(() => null)
    if (item && item.error !== 'not_found') {
      if (item.ok === false) throw new Error(item.error || 'command failed')
      return item.result
    }
    await new Promise((done) => setTimeout(done, pollMs))
  }
  throw new Error('bridge command timed out — is the ComfyUI page loaded with the bridge?')
}

export function apply(ctx) {
  let resolveBase = () => ENV_BASE || DEFAULT_BASE
  // Function-level handle to the settings scope (used by comfyui_config's
  // activeView read); undefined when the settings service is unavailable.
  let settingsScope = undefined

  // M3: prefer the settings namespace when the settings service is present.
  // Registration is optional so missing settings never blocks startup.
  const settings = ctx.settings ?? ctx.get?.('settings')
  if (settings && typeof settings.register === 'function') {
    try {
      const scope = settings.register(NAMESPACE, ConfigSchema, { applies: 'live' })
      settingsScope = scope
      resolveBase = () => {
        const value = scope.get()
        const base = (value?.baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
        if (value?.port != null && value.port !== '' && /^\d+$/.test(String(value.port))) {
          return base.replace(/:\d+$/, '') + ':' + String(value.port)
        }
        return base
      }
      // Launch watcher: the client Start button sets launchRequested=true; we
      // start ComfyUI via launchCommand (background), then clear the flag.
      let launching = false
      scope.watch(() => {
        const value = scope.get()
        if (!value?.launchRequested || launching) return
        launching = true
        void (async () => {
          const fail = (message) => {
            console.error(`[dsh-comfyui-canvas] ${message}`)
            try { scope.update({ launchError: message }) } catch { /* best effort */ }
          }
          try {
            const cmd = (value?.launchCommand || '').trim()
            if (!cmd) {
              fail('launch requested but launchCommand is empty')
              return
            }
            // Clear any stale error from a previous attempt before launching.
            try { scope.update({ launchError: '' }) } catch { /* best effort */ }
            const workdir = (value?.comfyuiDir || '').trim() || undefined
            const shell = ctx.get?.('shell')
            if (shell && typeof shell.start === 'function') {
              // ComfyUI lives outside the session workspace (E: drive) and
              // writes output/temp as a long-lived server, so the launch must
              // run unconfined — the default workspace-write sandbox would
              // deny the bat and kill ComfyUI before it ever binds 8188.
              const proc = shell.start(shell.resolve({
                command: cmd,
                ...(workdir ? { workdir } : {}),
                sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: process.cwd() },
              }))
              console.log(`[dsh-comfyui-canvas] launching ComfyUI: ${cmd}`)
              // A healthy launch keeps python alive well past this grace
              // window; an immediate exit (bad command / sandbox denial /
              // crash) is a launch failure the client must see.
              let grace = setTimeout(() => { grace = null }, 30000)
              const settle = (detail) => {
                if (!grace) return // still running after grace = launched OK
                clearTimeout(grace)
                grace = null
                fail(`ComfyUI launch process exited (${detail}) — check the launch command / install dir`)
              }
              proc.done.then(
                (outcome) => settle(`exit ${outcome?.exitCode ?? outcome?.code ?? '?'}`),
                (err) => settle(String(err?.message ?? err)),
              )
            } else {
              fail('no shell service available to launch ComfyUI')
            }
          } finally {
            launching = false
            try { scope.update({ launchRequested: false }) } catch { /* best effort */ }
          }
        })()
      })
    } catch {
      // Duplicate registration or unavailable provider — keep defaults.
    }
  }

  const baseUrl = () => resolveBase()
  const bridgeToken = () => String(settingsScope?.get?.()?.bridgeToken || '')

  ctx.tools.register(defineTool({
    name: 'comfyui_read_workflow',
    description: 'Read the current ComfyUI canvas state: node list summary plus the full workflow JSON. ' +
      'Use before editing the canvas so you know which node ids exist and how they are connected.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(_args, exec) {
      // Ask the live frontend to re-report the graph right now, so an open but
      // idle page does not serve a stale cache. Best-effort: if no frontend is
      // loaded (or the bridge is missing), this times out and is ignored.
      await sendCommand(baseUrl(), bridgeToken(), 'refresh_report', {}, exec.signal, { timeoutMs: 2500 })
        .catch(() => null)
      const res = await fetch(`${baseUrl()}/dsh-bridge/workflow`, {
        headers: bridgeToken() ? { Authorization: `Bearer ${bridgeToken()}` } : undefined,
        signal: exec.signal,
      })
      if (!res.ok) throw new Error(`bridge HTTP ${res.status}`)
      const data = await res.json()
      if (!data.updated_at) {
        return {
          ready: false,
          error: 'No ComfyUI frontend has reported canvas state yet — open the ComfyUI canvas page (the bridge reports on load and on every change).',
          nodes: [],
          workflow: null,
          updated_at: null,
        }
      }
      return { ready: true, ...data }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'comfyui_add_node',
    description: 'Add a node to the live ComfyUI canvas. `class` is the ComfyUI node class (e.g. "KSampler", "VAEDecode"). ' +
      '`pos` is an optional [x, y] canvas position. The node appears on the canvas immediately.',
    parameters: {
      class: { type: 'string', required: true, description: 'ComfyUI node class name' },
      pos: { type: 'array', description: 'Optional [x, y] canvas position' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(args, exec) {
      return sendCommand(baseUrl(), bridgeToken(), 'add_node', { class: args.class, pos: args.pos }, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'comfyui_connect',
    description: 'Connect two nodes on the live ComfyUI canvas: `srcId:srcSlot` to `dstId:dstSlot`. ' +
      'Slots are output/input indexes; use comfyui_read_workflow to see exact ids.',
    parameters: {
      srcId: { type: 'number', required: true, description: 'Source node id' },
      srcSlot: { type: 'number', required: true, description: 'Source output slot index' },
      dstId: { type: 'number', required: true, description: 'Destination node id' },
      dstSlot: { type: 'number', required: true, description: 'Destination input slot index' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(args, exec) {
      return sendCommand(baseUrl(), bridgeToken(), 'connect', {
        srcId: args.srcId, srcSlot: args.srcSlot, dstId: args.dstId, dstSlot: args.dstSlot,
      }, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'comfyui_set_param',
    description: 'Set a widget value on a node in the live ComfyUI canvas (e.g. a prompt text, seed, or steps).',
    parameters: {
      nodeId: { type: 'number', required: true, description: 'Node id' },
      key: { type: 'string', required: true, description: 'Widget name, e.g. "text", "seed", "steps"' },
      value: { type: 'json', description: 'New widget value (string, number, or boolean)' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(args, exec) {
      return sendCommand(baseUrl(), bridgeToken(), 'set_param', { nodeId: args.nodeId, key: args.key, value: args.value }, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'comfyui_remove_node',
    description: 'Remove a node (and its connections) from the live ComfyUI canvas.',
    parameters: {
      nodeId: { type: 'number', required: true, description: 'Node id to remove' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(args, exec) {
      return sendCommand(baseUrl(), bridgeToken(), 'remove_node', { nodeId: args.nodeId }, exec.signal)
    },
  }))

  // M2: rewrite loop — swap the whole canvas for a workflow JSON.
  ctx.tools.register(defineTool({
    name: 'comfyui_load_workflow',
    description: 'Replace the entire live ComfyUI canvas with a workflow JSON (UI format, as returned by ' +
      'comfyui_read_workflow). Use to apply a full rewrite: read → modify node list/links → load back.',
    parameters: {
      workflow: { type: 'json', required: true, description: 'Workflow JSON (UI format with nodes/links). May also be the object from comfyui_read_workflow.workflow.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(args, exec) {
      const data = args.workflow
      // A full comfyui_read_workflow result carries `nodes`/`prompt`/`updated_at`
      // alongside the actual UI workflow under `workflow`. When the caller passes
      // that whole object (the documented usage), unwrap to its `.workflow`
      // instead of feeding the read envelope to the bridge.
      const isReadResult = data && typeof data === 'object' && !Array.isArray(data)
        && Array.isArray(data.nodes)
        && data.workflow && typeof data.workflow === 'object'
      const wf = isReadResult ? data.workflow : data
      return sendCommand(baseUrl(), bridgeToken(), 'load_workflow', { workflow: wf }, exec.signal, { timeoutMs: 15000 })
    },
  }))

  // M2: run the current canvas graph and return the prompt id.
  // `overrides` temporarily sets widget values (e.g. seed/prompt) for this run
  // only — the canvas is restored afterwards, so the same graph can be swept.
  ctx.tools.register(defineTool({
    name: 'comfyui_run',
    description: 'Run the current ComfyUI canvas graph (queuePrompt) and return the prompt id. ' +
      'Optionally pass `overrides` ([{nodeId, key, value}]) to run with temporary widget values ' +
      '(e.g. seed/prompt/strength) — the canvas is restored afterwards, leaving it untouched. ' +
      'After running, poll results with comfyui_get_outputs(promptId).',
    parameters: {
      overrides: { type: 'array', description: 'Optional [{nodeId, key, value}] temporary widget values for this run only.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(args, exec) {
      return sendCommand(baseUrl(), bridgeToken(), 'run', { overrides: args.overrides }, exec.signal, { timeoutMs: 20000 })
    },
  }))

  // M4: batch run — sweep the current graph over a parameter matrix.
  // Each run in `runs` is an override set; every run is queued as its own
  // prompt and returns a prompt_id. ComfyUI executes the queue serially.
  ctx.tools.register(defineTool({
    name: 'comfyui_batch_run',
    description: 'Batch-run the current ComfyUI graph over a parameter matrix. ' +
      '`runs` is a list of override sets, e.g. [{overrides: [{nodeId, key, value}]}], one per run. ' +
      'Each run is queued as its own prompt (ComfyUI executes serially) and returns its prompt_id. ' +
      'The canvas is restored after every run. Collect results with comfyui_get_outputs per id.',
    parameters: {
      runs: {
        type: 'array', required: true,
        description: 'Override sets, one per run. Each is [{nodeId, key, value}] temporary widget values.',
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(args, exec) {
      return sendCommand(baseUrl(), bridgeToken(), 'batch_run', { runs: args.runs }, exec.signal, { timeoutMs: 30000 })
    },
  }))

  // M2: fetch the output files of a completed run (images, videos, gifs,
  // audio). Reads ComfyUI's own /history/{promptId} (native endpoint, same
  // trust model as /prompt) and lists every output node's files (kind /
  // filename / subfolder / type / view URL). With downloadDir, the files are
  // also saved locally. `ready:false` means the id is not in history yet.
  ctx.tools.register(defineTool({
    name: 'comfyui_get_outputs',
    description: 'Fetch the output files produced by a completed ComfyUI run (comfyui_run returns prompt_id): ' +
      'images, videos, gifs, and audio. Reads ComfyUI /history/{promptId}, lists every output node with its ' +
      'files (kind/filename/type/subfolder/URL), and optionally downloads them into a local directory. ' +
      'Returns ready:false while the run is still executing.',
    parameters: {
      promptId: { type: 'string', required: true, description: 'The prompt_id returned by comfyui_run.' },
      downloadDir: { type: 'string', description: 'Optional absolute local directory to save the output files into. Omit to return URLs only.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(args, exec) {
      const base = baseUrl()
      const pid = encodeURIComponent(args.promptId)
      const res = await fetch(`${base}/history/${pid}`, { signal: exec.signal })
      if (!res.ok) throw new Error(`history HTTP ${res.status}`)
      const history = await res.json()
      const item = history?.[args.promptId]
      if (!item) {
        return { promptId: args.promptId, ready: false, error: 'not in history yet — run may still be executing, or the id is wrong' }
      }
      const outputs = item.outputs ?? {}
      const files = []
      // ComfyUI history outputs carry file arrays under per-kind keys:
      // images / videos / gifs / audio (depends on the node). Scan them all so
      // a run's video/audio/3D outputs come back like images do — each entry
      // keeps its kind + a /view URL (the view endpoint serves any stored file).
      const FILE_KINDS = ['images', 'videos', 'gifs', 'audio']
      for (const [nodeId, out] of Object.entries(outputs)) {
        for (const kind of FILE_KINDS) {
          const list = Array.isArray(out?.[kind]) ? out[kind] : []
          for (const file of list) {
            const filename = file?.filename
            if (!filename) continue
            const subfolder = file?.subfolder ?? ''
            const type = file?.type ?? 'output'
            const qs = `filename=${encodeURIComponent(filename)}` +
              (subfolder ? `&subfolder=${encodeURIComponent(subfolder)}` : '') +
              `&type=${encodeURIComponent(type)}`
            files.push({ nodeId, kind: kind.slice(0, -1), filename, subfolder, type, url: `${base}/view?${qs}` })
          }
        }
      }
      let downloaded = []
      if (args.downloadDir && files.length > 0) {
        const fs = await import('node:fs')
        const path = await import('node:path')
        fs.mkdirSync(args.downloadDir, { recursive: true })
        for (const f of files) {
          const resp = await fetch(f.url, { signal: exec.signal })
          if (!resp.ok) throw new Error(`download ${f.filename} HTTP ${resp.status}`)
          const buf = Buffer.from(await resp.arrayBuffer())
          const local = path.join(args.downloadDir, f.filename)
          fs.writeFileSync(local, buf)
          downloaded.push({ ...f, local })
        }
      }
      return {
        promptId: args.promptId,
        ready: true,
        status: item.status?.status_str ?? null,
        completed: item.status?.completed ?? false,
        nodeCount: Object.keys(outputs).length,
        outputs: files,
        downloaded,
      }
    },
  }))

  // M2: debug — validate the graph and flash offending nodes.
  // Uses the bridge's validate command (local structural checks only), which
  // never submits /prompt, so debug has no side effect on a valid graph.
  // Note: validate flags nodes with unconnected REQUIRED inputs; type-mismatch
  // links cannot survive — LiteGraph's connect() rejects them at connect time.
  // Dynamic-slot nodes (switch/index, numbered inputs like image15) report as
  // `warnings` instead of errors, so debug does not false-flag expected slots.
  ctx.tools.register(defineTool({
    name: 'comfyui_debug',
    description: 'Validate the current ComfyUI canvas. Checks the live graph for structural problems ' +
      '(unconnected required inputs) without running it, flashes the offending nodes, ' +
      'and returns the error map. Dynamic-slot nodes (switch/index selectors with numbered inputs ' +
      'such as image15) are reported as warnings, not errors.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(_args, exec) {
      return sendCommand(baseUrl(), bridgeToken(), 'validate', {}, exec.signal, { timeoutMs: 8000 })
        .then(async (res) => {
          const errors = res?.nodeErrors ?? {}
          const warnings = res?.warnings ?? {}
          const ids = res?.offendingIds ?? Object.keys(errors)
          if (ids.length > 0) {
            await sendCommand(baseUrl(), bridgeToken(), 'highlight', { ids }, exec.signal, { timeoutMs: 5000 }).catch(() => null)
          }
          return { nodeErrors: errors, warnings, highlighted: ids }
        })
    },
  }))

  // M3: expose the active configuration to the agent (read-only convenience).
  // activeView is session-isolated: the client writes per-session values keyed
  // by session id, and this tool reads the value for the CURRENT session.
  // 'canvas' = the user has the ComfyUI split canvas tab selected for this
  // session right now; 'chat' = plain chat tab. The session id comes from the
  // stable tool-run contract (exec.agent.session), falling back to the
  // inherited initiator; when neither is available the caller is told
  // activeViewKnown=false instead of silently assuming chat.
  ctx.tools.register(defineTool({
    name: 'comfyui_config',
    description: 'Show the active ComfyUI connection configuration the canvas plugin is using, ' +
      'plus `activeView` for the CURRENT session ("canvas" when the ComfyUI split canvas tab is ' +
      'selected in the browser for this session, "chat" when the plain chat tab is). ' +
      'Read this before canvas work to confirm the user is on the canvas in THIS session.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(_args, exec) {
      const value = settingsScope?.get?.()
      let currentSessionId
      let sessionSource = 'none'
      try {
        currentSessionId = exec?.agent?.session?.id
        if (currentSessionId) sessionSource = 'exec.agent'
      } catch { /* exec contract unavailable */ }
      if (!currentSessionId) {
        try {
          currentSessionId = ctx.get?.('agents')?.currentInitiator?.()?.session?.id
          if (currentSessionId) sessionSource = 'currentInitiator'
        } catch { /* agents service unavailable */ }
      }
      let activeView = 'chat'
      let activeViewKnown = false
      if (currentSessionId && value?.activeViewBySession?.[currentSessionId] === 'canvas') {
        activeView = 'canvas'
        activeViewKnown = true
      } else if (currentSessionId && value?.activeViewBySession?.[currentSessionId] === 'chat') {
        activeView = 'chat'
        activeViewKnown = true
      }
      return {
        baseUrl: baseUrl(),
        activeView,
        activeViewKnown,
        sessionSource,
        bridgeTokenSet: Boolean(value?.bridgeToken),
        comfyuiDir: value?.comfyuiDir || '',
        launchCommand: value?.launchCommand || '',
      }
    },
  }))

  // M4: one-click upgrade — git pull the ComfyUI core, then every git-backed
  // custom node under custom_nodes/. Platform-neutral via the shell service.
  ctx.tools.register(defineTool({
    name: 'comfyui_upgrade',
    description: 'Upgrade the local ComfyUI install: git pull the core, then git pull every git-backed ' +
      'custom node under custom_nodes/. Returns per-repo results. Requires the ComfyUI install directory ' +
      '(set it in Settings → ComfyUI 画布 → ComfyUI 安装目录, or env COMFYUI_DIR).',
    parameters: {
      scope: { type: 'string', enum: ['core', 'nodes', 'all'], description: 'What to upgrade: core only, nodes only, or all (default all).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(args) {
      const shell = ctx.get?.('shell')
      if (!shell || typeof shell.run !== 'function') {
        throw new Error('shell service unavailable — cannot run upgrade commands')
      }
      const value = settingsScope?.get?.()
      const dir = (value?.comfyuiDir || process.env.COMFYUI_DIR || '').trim()
      if (!dir) {
        throw new Error('ComfyUI install directory not set. Set comfyuiDir in Settings → ComfyUI 画布, or env COMFYUI_DIR.')
      }
      const fs = await import('node:fs')
      const path = await import('node:path')
      const run = async (label, command, workdir) => {
        try {
          const spec = shell.resolve({ command, workdir, timeoutMs: 120000 })
          const result = await shell.run(spec)
          const out = (result.stdout?.text || result.stdout || '').toString().trim()
          const err = (result.stderr?.text || result.stderr || '').toString().trim()
          return { label, exitCode: result.exitCode, ok: result.exitCode === 0, out, err }
        } catch (e) {
          return { label, ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      }
      const results = []
      const scopeArg = args?.scope ?? 'all'
      // core: the ComfyUI root is itself a git checkout
      if (scopeArg !== 'nodes' && fs.existsSync(path.join(dir, '.git'))) {
        results.push(await run('core', 'git pull', dir))
      }
      // nodes: every git-backed custom node
      if (scopeArg !== 'core') {
        const nodesDir = path.join(dir, 'custom_nodes')
        if (fs.existsSync(nodesDir)) {
          const entries = fs.readdirSync(nodesDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name)
            .sort()
          for (const name of entries) {
            const nodeDir = path.join(nodesDir, name)
            if (fs.existsSync(path.join(nodeDir, '.git'))) {
              results.push(await run(`node:${name}`, 'git pull', nodeDir))
            }
          }
        }
      }
      return { upgraded: results.length, results }
    },
  }))

  // v0.1.2: upload ANY local file (image/audio/video/3D) into ComfyUI's input/
  // and optionally point a Load node at it. Uses ComfyUI's NATIVE /upload/image
  // (the input/ directory is ComfyUI's single upload entry regardless of the
  // endpoint name — audio/video/3D land in the same place, consumable by their
  // native Load nodes). Not the bridge: the source file is on the agent's own
  // machine, so the host reads and uploads it. mediaType defaults to a
  // per-extension guess; nodeId + widgetKey let the caller point the matching
  // Load node (LoadImage→image, LoadAudio→audio, LoadVideo→video, 3D→mesh…).
  ctx.tools.register(defineTool({
    name: 'comfyui_attach_file',
    description: 'Upload a local file (image/audio/video/3D) into ComfyUI\'s input/ directory and optionally ' +
      'point a Load node at it. Uses ComfyUI\'s native upload endpoint (not the bridge); the source file is read ' +
      'from the agent\'s own machine. mediaType is inferred from the extension when omitted. After upload, pass ' +
      'nodeId (and widgetKey for non-image loads) to update the Load node so it takes effect immediately.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute local path to the file.' },
      mediaType: { type: 'string', description: 'Optional explicit media type (e.g. video/mp4, audio/wav, model/gltf-binary); defaults to a per-extension guess.' },
      nodeId: { type: 'number', description: 'Optional Load node id to point at the uploaded file.' },
      widgetKey: { type: 'string', description: 'Optional widget name on the Load node (default "image"; use audio/video/mesh for other Loads).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(args, exec) {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const filePath = args.path
      if (!fs.existsSync(filePath)) throw new Error(`file not found: ${filePath}`)
      const buf = fs.readFileSync(filePath)
      const filename = path.basename(filePath)
      const ext = path.extname(filePath).toLowerCase().replace('.', '')
      const mediaType = args.mediaType || mediaTypeOf(ext) || 'application/octet-stream'
      // ComfyUI's /upload/image is the input/ upload entry; it accepts any
      // file type there. overwrite=false dedups a clashing name and returns the
      // actually-stored name.
      const form = new FormData()
      form.append('image', new Blob([buf]), filename)
      form.append('type', 'input')
      form.append('overwrite', 'false')
      const res = await fetch(`${baseUrl()}/upload/image`, {
        method: 'POST',
        body: form,
        signal: exec.signal,
      })
      if (!res.ok) throw new Error(`upload HTTP ${res.status}`)
      const data = await res.json()
      const stored = (data.subfolder ? `${data.subfolder}/${data.name}` : data.name)
      const out = { filename: stored, name: data.name, subfolder: data.subfolder ?? '', type: data.type ?? 'input', mediaType }
      if (args.nodeId != null) {
        const key = args.widgetKey || 'image'
        const r = await sendCommand(baseUrl(), bridgeToken(), 'set_param', { nodeId: args.nodeId, key, value: stored }, exec.signal)
        out.nodeId = args.nodeId
        out.updated = r
      }
      return out
    },
  }))

  // v0.1.1: upload a local image into ComfyUI's input/ and optionally point a
  // LoadImage node at it. Uses ComfyUI's NATIVE /upload/image (not the bridge):
  // the source file is on the agent's own machine, so the host reads and
  // uploads it — same trust model as get_outputs' /history + /view. The bridge
  // token does not apply (native endpoint, not /dsh-bridge/*).
  ctx.tools.register(defineTool({
    name: 'comfyui_attach_image',
    description: 'Upload a local image into ComfyUI\'s input/ directory and optionally point a LoadImage ' +
      'node at it. Uses ComfyUI\'s native /upload/image (not the bridge), so the source file is read from ' +
      'the agent\'s own machine. After upload, pass nodeId to update a LoadImage node\'s image widget to ' +
      'the new filename so it takes effect immediately.',
    parameters: {
      image: { type: 'string', required: true, description: 'Absolute local path to the image file (png/jpeg/webp/gif).' },
      nodeId: { type: 'number', description: 'Optional LoadImage node id to point at the uploaded file.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(args, exec) {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const filePath = args.image
      if (!fs.existsSync(filePath)) throw new Error(`image not found: ${filePath}`)
      const buf = fs.readFileSync(filePath)
      const filename = path.basename(filePath)
      // Node 22: global FormData + Blob are available; fetch sends a real
      // multipart body when handed a FormData. overwrite=false lets ComfyUI
      // dedup a clashing name and return the actually-stored name.
      const form = new FormData()
      form.append('image', new Blob([buf]), filename)
      form.append('type', 'input')
      form.append('overwrite', 'false')
      const res = await fetch(`${baseUrl()}/upload/image`, {
        method: 'POST',
        body: form,
        signal: exec.signal,
      })
      if (!res.ok) throw new Error(`upload HTTP ${res.status}`)
      const data = await res.json()
      // ComfyUI returns { name, subfolder, type }; LoadImage's image widget
      // expects "subfolder/name" when a subfolder is present, else "name".
      const stored = (data.subfolder ? `${data.subfolder}/${data.name}` : data.name)
      const out = { filename: stored, name: data.name, subfolder: data.subfolder ?? '', type: data.type ?? 'input' }
      if (args.nodeId != null) {
        const r = await sendCommand(baseUrl(), bridgeToken(), 'set_param', { nodeId: args.nodeId, key: 'image', value: stored }, exec.signal)
        out.nodeId = args.nodeId
        out.updated = r
      }
      return out
    },
  }))

  // v0.1.1: inject conversation text into the canvas. With nodeId: write a
  // widget directly. With newClass: create a source node, set its widget, and
  // optionally connect it to a target input — a one-step "conversation text →
  // canvas node". The bridge's inject_text branch composes add_node + set_param
  // + connect; set_param alone already covers "write an existing widget", so
  // inject_text is the convenience for "create a new source and wire it".
  ctx.tools.register(defineTool({
    name: 'comfyui_inject_text',
    description: 'Inject text into the live ComfyUI canvas. With nodeId: writes the text to that ' +
      'node\'s widget (default key "text"). With newClass: creates a new node of that class, sets its ' +
      'widget, and (if targetId given) connects it to the target input — a text source you can wire. ' +
      'A convenience wrapper over add_node + set_param + connect for one-step conversation text → canvas node.',
    parameters: {
      text: { type: 'string', required: true, description: 'The text to inject.' },
      nodeId: { type: 'number', description: 'Target node id to write the widget directly (mode 1).' },
      widgetKey: { type: 'string', description: 'Widget name to write (default "text").' },
      newClass: { type: 'string', description: 'Create a new node of this class as the text source, e.g. "CLIPTextEncode" (mode 2).' },
      targetId: { type: 'number', description: 'Connect the new node\'s output to this target node input.' },
      targetSlot: { type: 'number', description: 'Target input slot index for the connection.' },
      sourceSlot: { type: 'number', description: 'Source output slot index, default 0.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(args, exec) {
      return sendCommand(baseUrl(), bridgeToken(), 'inject_text', {
        text: args.text,
        nodeId: args.nodeId,
        widgetKey: args.widgetKey ?? 'text',
        newClass: args.newClass,
        targetId: args.targetId,
        targetSlot: args.targetSlot,
        sourceSlot: args.sourceSlot ?? 0,
      }, exec.signal, { timeoutMs: 10000 })
    },
  }))

  // v0.1.1: export the current canvas as API-format workflow JSON — the format
  // ComfyUI's /prompt and comfy-cli run_workflow consume. Bridges the live
  // canvas to headless/MCP batch runs: build a graph on the canvas, export it,
  // then run it at scale via comfy-cli run_workflow.
  ctx.tools.register(defineTool({
    name: 'comfyui_export_api',
    description: 'Export the current ComfyUI canvas as an API-format workflow JSON (the format ComfyUI\'s ' +
      '/prompt and comfy-cli run_workflow consume). Use to bridge the live canvas to headless/MCP batch ' +
      'runs: build a graph on the canvas, export it, then run it at scale. Run comfyui_debug first if the ' +
      'canvas has unconnected required inputs (graphToPrompt will reject them).',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(_args, exec) {
      return sendCommand(baseUrl(), bridgeToken(), 'export_api', {}, exec.signal, { timeoutMs: 10000 })
    },
  }))

  // v0.1.2 C: node development/debug tools — read / edit custom-node source and
  // reload ComfyUI so the change takes effect, all from the conversation. The
  // canvas doubles as the observation window: edit → reload → run a minimal
  // workflow on the canvas → see the result, without leaving the chat.
  const requireComfyUIDir = async () => {
    const value = settingsScope?.get?.()
    const dir = (value?.comfyuiDir || process.env.COMFYUI_DIR || '').trim()
    if (!dir) throw new Error('ComfyUI install directory not set. Set comfyuiDir in Settings → ComfyUI 画布, or env COMFYUI_DIR.')
    return dir
  }
  const resolveNodeDir = async (root, nodeName) => {
    const { join, resolve, sep } = await import('node:path')
    const nodeDir = join(root, 'custom_nodes', nodeName)
    const rootReal = resolve(root)
    const nodeReal = resolve(nodeDir)
    if (!nodeReal.startsWith(rootReal + sep)) throw new Error(`invalid node path: ${nodeName}`)
    return nodeDir
  }
  // Shared helper: list source files under a node dir (top two levels, skipping
  // .git / node_modules / __pycache__ / .venv), or read one file's content.
  const inspectNodeSource = async (nodeDir, relPath) => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    if (relPath) {
      const target = path.resolve(nodeDir, relPath)
      if (!target.startsWith(path.resolve(nodeDir) + path.sep)) throw new Error('path escapes node dir')
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`file not found: ${relPath}`)
      return { path: relPath, content: fs.readFileSync(target, 'utf8') }
    }
    const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build'])
    const tree = []
    const walk = (dir, depth) => {
      if (depth > 2) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue
        const full = path.join(dir, entry.name)
        const rel = path.relative(nodeDir, full).replace(/\\/g, '/')
        tree.push({ path: rel, type: entry.isDirectory() ? 'dir' : 'file', size: entry.isFile() ? fs.statSync(full).size : null })
        if (entry.isDirectory()) walk(full, depth + 1)
      }
    }
    walk(nodeDir, 0)
    return { node: path.basename(nodeDir), tree }
  }
  ctx.tools.register(defineTool({
    name: 'comfyui_read_source',
    description: 'Read a ComfyUI custom node\'s source under custom_nodes/<name>/. Without path: list its source tree ' +
      '(top two levels, skipping .git/node_modules/caches). With path: return that file\'s full content. ' +
      'Use during node development to inspect or debug a custom node (including this plugin\'s own bridge node).',
    parameters: {
      node: { type: 'string', required: true, description: 'Custom node directory name under ComfyUI custom_nodes/ (e.g. ComfyUI-DSH-Canvas).' },
      path: { type: 'string', description: 'Optional relative file path inside the node dir to read (omit to list the tree).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(args) {
      const fs = await import('node:fs')
      const dir = await requireComfyUIDir()
      const nodeDir = await resolveNodeDir(dir, args.node)
      if (!fs.existsSync(nodeDir)) throw new Error(`custom node not found: ${args.node}`)
      return inspectNodeSource(nodeDir, args.path)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'comfyui_edit_source',
    description: 'Edit a file inside a ComfyUI custom node\'s source (custom_nodes/<name>/). Writes new content to the ' +
      'given relative path; path is confined to the node dir. Pair with comfyui_reload to apply the change: ' +
      'edit → reload → run a minimal workflow on the canvas to verify. This is how you develop/debug a custom node ' +
      'from the conversation without touching the ComfyUI UI.',
    parameters: {
      node: { type: 'string', required: true, description: 'Custom node directory name under ComfyUI custom_nodes/.' },
      path: { type: 'string', required: true, description: 'Relative file path inside the node dir to write (e.g. __init__.py or entry/bridge.js).' },
      content: { type: 'string', required: true, description: 'Full new file content (replaces the file).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(args) {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const dir = await requireComfyUIDir()
      const nodeDir = await resolveNodeDir(dir, args.node)
      const target = path.resolve(nodeDir, args.path)
      if (!target.startsWith(path.resolve(nodeDir) + path.sep)) throw new Error('path escapes node dir')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, args.content, 'utf8')
      return { node: args.node, path: args.path, bytes: Buffer.byteLength(args.content, 'utf8'), ok: true }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'comfyui_reload',
    description: 'Restart the local ComfyUI so custom-node source changes take effect: find the process listening on ' +
      'the ComfyUI port, kill it, then relaunch via the configured launch command. Use after comfyui_edit_source, ' +
      'then run a minimal workflow on the canvas to verify the change. Warns about running generations; cancels ' +
      'pending work by restarting.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(_args) {
      const value = settingsScope?.get?.()
      const base = baseUrl()
      const port = (() => { try { return new URL(base).port || '8188' } catch { return '8188' } })()
      const cmd = (value?.launchCommand || '').trim()
      const workdir = (value?.comfyuiDir || process.env.COMFYUI_DIR || '').trim() || undefined
      const shell = ctx.get?.('shell')
      if (!shell || typeof shell.run !== 'function') throw new Error('shell service unavailable — cannot reload ComfyUI')
      if (!cmd) throw new Error('launchCommand is empty — set it in Settings → ComfyUI 画布 to allow reload')
      // 1. find the PID on the ComfyUI port
      const netstat = await shell.run(shell.resolve({ command: `netstat -ano | findstr :${port} | findstr LISTENING`, timeoutMs: 15000 }))
      const out = (netstat.stdout?.text || netstat.stdout || '').toString()
      const pids = [...new Set([...out.matchAll(/\s(\d+)\s*$/gm)].map(m => m[1]))]
      // 2. kill those PIDs (best-effort; ignore failures so relaunch still runs)
      const killed = []
      for (const pid of pids) {
        try {
          await shell.run(shell.resolve({ command: `taskkill /PID ${pid} /F`, timeoutMs: 10000 }))
          killed.push(pid)
        } catch { /* already gone or denied — proceed */ }
      }
      // 3. relaunch via the same unconfined path the Start button uses
      const proc = shell.start(shell.resolve({
        command: cmd,
        ...(workdir ? { workdir } : {}),
        sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: process.cwd() },
      }))
      // 4. wait for /system_stats to come back
      const deadline = Date.now() + 45000
      let up = false
      let lastErr = ''
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(3000) })
          if (res.ok) { up = true; break }
        } catch (e) { lastErr = e instanceof Error ? e.message : String(e) }
        await new Promise((done) => setTimeout(done, 1500))
      }
      return { reloaded: up, killed, port, launched: cmd, error: up ? null : (lastErr || 'timed out waiting for ComfyUI to come back') }
    },
  }))

  // v0.1.2: register the skills (SOPs) that teach the agent HOW to use the
  // canvas/admin tools in the right order. Runtime skills ship inside the
  // plugin, so `dsh plugin add` installs them with zero extra steps.
  const skills = ctx.skills ?? ctx.get?.('skills')
  if (skills && typeof skills.register === 'function') {
    skills.register({
      name: 'comfyui-canvas-ops',
      source: 'runtime',
      description: 'Operate the live ComfyUI canvas with the agent: read/edit/run workflows, fetch outputs.',
      whenToUse: 'Use when the user asks to make an image, edit a workflow, adjust a node, run the canvas, or fetch its outputs.',
      content: [
        '# ComfyUI 画布操作 SOP',
        '',
        '当用户要求用画布作图 / 修改工作流 / 出图时，按此顺序执行：',
        '',
        '1. comfyui_config —— 确认画布在前台（activeView=canvas）、连接正常；不在画布视图时先提示用户切到 ComfyUI 标签',
        '2. comfyui_read_workflow —— 读取当前图，向用户复述关键节点并确认要改什么',
        '3. 按需修改：comfyui_set_param（改参数）、comfyui_connect（连线）、comfyui_add_node / comfyui_remove_node（增删节点）、comfyui_inject_text（注入文本）',
        '4. 修改前说明改了哪些；运行前用 comfyui_debug 校验（不触发执行）',
        '5. comfyui_run 运行（可传 overrides 临时覆盖参数，跑完还原画布）',
        '6. comfyui_get_outputs 取回出图（支持 images/videos/gifs/audio）',
        '7. 用 vision 工具自检出图质量 → 不达标回 step 3 迭代；达标再交付',
        '',
        '安全约定：读取永远只读；写操作（改节点/运行/替换图）先向用户确认；批量用 comfyui_batch_run。',
      ].join('\n'),
    })
    skills.register({
      name: 'comfyui-admin-ops',
      source: 'runtime',
      description: 'Manage the ComfyUI environment: configure, launch, upgrade, and list/install custom nodes.',
      whenToUse: 'Use when the user asks to configure ComfyUI, start it, update it, upgrade its nodes, or manage installed custom nodes.',
      content: [
        '# ComfyUI 环境管理 SOP',
        '',
        '当用户要求配置 / 启动 / 更新 ComfyUI、管理已装节点时，按此顺序执行：',
        '',
        '1. 配置管理 —— comfyui_config 读/改连接（baseUrl / port / networkMode / 桥接 token / 启动命令 / rail 宽度）',
        '2. 启动 / 状态 —— 用设置里的启动命令拉起 ComfyUI（launchRequested 机制），轮询 /system_stats 确认在线；读 launchError 排查启动失败',
        '3. 更新 —— comfyui_upgrade：git pull 核心 + 全部节点（scope=core/nodes/all），失败不中断其余',
        '4. 节点管理 —— 用文件系统工具列出 custom_nodes/、识别 git 托管与手工目录；安装/更新节点用 shell 走 git 或 pnpm',
        '',
        '安全约定：更新 / 重启 / 装节点是重操作 —— 先确认、讲清影响（如「更新 60+ 节点」「重启中断生成」）；更新前检查是否有运行中任务。',
      ].join('\n'),
    })
    skills.register({
      name: 'comfyui-video-audio-ops',
      source: 'runtime',
      description: 'Create video with audio/voiceover on ComfyUI: generate video, attach audio, fetch the merged file.',
      whenToUse: 'Use when the user wants a video with sound / voiceover / music track produced through the ComfyUI canvas.',
      content: [
        '# ComfyUI 音画创作 SOP',
        '',
        '当用户要求「视频 + 配音 / 音轨 / 音乐」时，按此顺序执行：',
        '',
        '1. 生成视频 —— 读画布上的视频工作流（如 Wan / Kling / LTX），comfyui_run 运行',
        '2. 生成音频 —— 用 comfyui_attach_file 把 TTS 生成的 wav / 音轨文件上传进 ComfyUI input/（供 LoadAudio 节点）',
        '3. 音画合成 —— 走 VideoAddAudio 或对应音画工作流，comfyui_run 合并',
        '4. comfyui_get_outputs 取回含音轨的视频文件（URL/路径）',
        '5. 交付时给出文件路径/URL；DSH 不播放，用户本地打开',
        '',
        '提示：TTS 音频只是「传输的一类文件」，上传即用；播放能力由 DSH 生态负责，本插件只做传输。',
      ].join('\n'),
    })
    skills.register({
      name: 'comfyui-dev-ops',
      source: 'runtime',
      description: 'Develop or debug a ComfyUI custom node from the conversation: read its source, edit it, reload ComfyUI, and verify on the canvas.',
      whenToUse: 'Use when the user wants to develop, modify, or debug a ComfyUI custom node (including this plugin\'s bridge node) — read/edit its source, restart ComfyUI, or verify a change on the canvas.',
      content: [
        '# ComfyUI 节点开发调试 SOP',
        '',
        '当用户要求开发 / 修改 / 调试 ComfyUI 自定义节点（含本插件的桥接节点）时，按此循环执行：',
        '',
        '1. comfyui_read_source —— 读目标节点源码（列出目录树或读单个文件，如 __init__.py / entry/bridge.js），先弄清结构与注册方式',
        '2. comfyui_edit_source —— 修改源码（受控写文件，仅限该节点目录内）',
        '3. comfyui_reload —— 重启 ComfyUI 使改动生效（会中断运行中任务，先确认）；等 /system_stats 恢复在线',
        '4. 画布验证 —— 在画布上搭一个用到该节点的最小工作流，comfyui_run 运行',
        '5. comfyui_get_outputs 看结果 → 不达标回 step 2 迭代',
        '',
        '安全约定：改的是 custom_nodes/ 下的本机源码 —— 写操作先确认、讲清改哪个文件；重启前检查是否有运行中任务；改坏了节点可能让 ComfyUI 起不来（保留备份 / 可回退）。',
      ].join('\n'),
    })
  }
}