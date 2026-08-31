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
export const inject = ['tools', 'settings', 'shell']

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
          try {
            const cmd = (value?.launchCommand || '').trim()
            if (!cmd) {
              console.warn('[dsh-comfyui-canvas] launch requested but launchCommand is empty')
              return
            }
            const workdir = (value?.comfyuiDir || '').trim() || undefined
            const shell = ctx.get?.('shell')
            if (shell && typeof shell.start === 'function') {
              const proc = shell.start(shell.resolve({ command: cmd, ...(workdir ? { workdir } : {}) }))
              console.log(`[dsh-comfyui-canvas] launching ComfyUI: ${cmd}`)
              void proc.done.catch(() => {})
            } else {
              console.warn('[dsh-comfyui-canvas] no shell service available to launch ComfyUI')
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
  ctx.tools.register(defineTool({
    name: 'comfyui_run',
    description: 'Run the current ComfyUI canvas graph (queuePrompt) and return the prompt id. ' +
      'After running, poll results from ComfyUI history or the job system.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJSON },
    async execute(_args, exec) {
      return sendCommand(baseUrl(), bridgeToken(), 'run', {}, exec.signal, { timeoutMs: 20000 })
    },
  }))

  // M2: fetch the output images of a completed run. Reads ComfyUI's own
  // /history/{promptId} (native endpoint, same trust model as /prompt) and
  // lists every output node's images (filename / subfolder / type / view URL).
  // With downloadDir, the images are also saved locally. `ready:false` means
  // the id is not in history yet — the run may still be executing.
  ctx.tools.register(defineTool({
    name: 'comfyui_get_outputs',
    description: 'Fetch the output images produced by a completed ComfyUI run (comfyui_run returns prompt_id). ' +
      'Reads ComfyUI /history/{promptId}, lists every output node with its images (filename/type/subfolder/URL), ' +
      'and optionally downloads them into a local directory. Returns ready:false while the run is still executing.',
    parameters: {
      promptId: { type: 'string', required: true, description: 'The prompt_id returned by comfyui_run.' },
      downloadDir: { type: 'string', description: 'Optional absolute local directory to save the images into. Omit to return URLs only.' },
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
      for (const [nodeId, out] of Object.entries(outputs)) {
        const images = Array.isArray(out?.images) ? out.images : []
        for (const img of images) {
          const filename = img?.filename
          if (!filename) continue
          const subfolder = img?.subfolder ?? ''
          const type = img?.type ?? 'output'
          const qs = `filename=${encodeURIComponent(filename)}` +
            (subfolder ? `&subfolder=${encodeURIComponent(subfolder)}` : '') +
            `&type=${encodeURIComponent(type)}`
          files.push({ nodeId, filename, subfolder, type, url: `${base}/view?${qs}` })
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
}