# dsh-comfyui-canvas

Embed your **local ComfyUI** as a split-screen canvas tab inside [DeepSeek Harness](https://github.com/DeepSeek-Harness/DSH) Web, and give the agent **live canvas tools**: read/edit/run workflows, debug node errors, and manage the canvas — without leaving the chat.

This package is the DSH-side plugin. It works together with a small ComfyUI-side bridge node (see [Install](#install)).

## What you get

| Surface | Description |
|---|---|
| **ComfyUI canvas tab** | A `ComfyUI` conversation view that embeds the local ComfyUI frontend side by side with the Chat rail. The iframe stays alive across tab switches (no reload). |
| **10 agent tools** | `comfyui_read_workflow`, `add_node`, `connect`, `set_param`, `remove_node`, `load_workflow`, `run`, `debug`, `config`, `upgrade` — operate the live canvas straight from the agent. |
| **Canvas focus mode** | The agent can tell (via `comfyui_config`) whether the browser is on the canvas tab for the current session, and focus on canvas work only then. Session-isolated. |
| **Settings page** | ComfyUI base URL / port / network mode / bridge token / launch command / rail width. Changes apply live. |
| **Rail polish** | Image previews inside the input box, a `+` button to attach local images (DSH's official attachment path), approval popup over the canvas (split layout), send button pinned to the panel corner. |

## Install

### 1. Install the DSH plugin

```bash
dsh plugin add github:<your-name>/dsh-comfyui-canvas
```

or from a local checkout:

```bash
# in your DSH profile
pnpm add <path-to-this-package>
```

The bundled `cordis.patch.yml` mounts the plugin automatically (`dsh.bundle.patch`).

### 2. Install the ComfyUI bridge node

The agent tools talk to the ComfyUI page through a bridge (`/dsh-bridge/*`). The bridge node ships **inside this repo** at `comfyui-bridge/ComfyUI-DSH-Canvas` — copy it into ComfyUI's `custom_nodes`:

**Windows (PowerShell / cmd):**

```powershell
# from this repo checkout:
Copy-Item -Recurse comfyui-bridge\ComfyUI-DSH-Canvas <ComfyUI>\custom_nodes\ComfyUI-DSH-Canvas
```

**macOS / Linux (bash):**

```bash
# from this repo checkout:
cp -r comfyui-bridge/ComfyUI-DSH-Canvas <ComfyUI>/custom_nodes/ComfyUI-DSH-Canvas
```

Or, after `dsh plugin add`, the installed package carries it too:

```bash
# Windows (PowerShell)
Copy-Item -Recurse (npm root -g)\dsh-comfyui-canvas\comfyui-bridge\ComfyUI-DSH-Canvas <ComfyUI>\custom_nodes\ComfyUI-DSH-Canvas

# macOS / Linux
cp -r $(npm root -g)/dsh-comfyui-canvas/comfyui-bridge/ComfyUI-DSH-Canvas <ComfyUI>/custom_nodes/ComfyUI-DSH-Canvas
```

Then restart ComfyUI and load the canvas page once (the injected `bridge.js` reports the graph and listens for commands).

### 3. Configure

Open **Settings → ComfyUI 画布** and set the ComfyUI base URL (default `http://127.0.0.1:8188`), port, network mode, optional bridge token, launch command, and the right-side rail width.

The **launch command** differs by platform:

| Platform | Example |
|---|---|
| Windows | `ComfyUI启动器.bat` (or `python main.py`) |
| macOS | `python main.py` or `./start.sh` |
| Linux | `python main.py` or `./start.sh` |

## Security

The bridge (`/dsh-bridge/*`) is the only network surface this plugin adds to ComfyUI. Read this before exposing ComfyUI beyond loopback.

- **Trust model.** By default the bridge is unauthenticated, matching ComfyUI's own `/prompt` trust model — anyone who can reach the ComfyUI port can read the canvas, report state, and dispatch commands (`load_workflow`/`run` consume GPU). Commands are whitelisted on the frontend, so no arbitrary code execution is possible, but the surface is real.
- **Bind to loopback.** Keep ComfyUI on `127.0.0.1` unless you explicitly need LAN/cloud access. `networkMode` is informational; the actual bind is whatever ComfyUI was launched with (`--listen`).
- **Optional shared token.** Set a token in **Settings → ComfyUI 画布 → 桥接 Token** AND launch ComfyUI with the same value in its own environment (`DSH_BRIDGE_TOKEN=...`). When the token is set, every agent-initiated request — reading the canvas, dispatching a command, polling its result — must present `Authorization: Bearer <token>`; the host side sends it automatically and the bridge rejects requests without it. The frontend's own status reporting (`/report`, result callbacks) stays open, since the injected page cannot hold the token; those endpoints only mutate the in-memory snapshot and never dispatch execution. Leave it empty on both sides for the default open behavior.
- **Multiple tabs are safe.** Commands are targeted at the last-reporting frontend (`clientId`), so several open ComfyUI tabs do not each execute a command.

## Platform support

Works on **Windows**, **macOS** and **Linux**. The agent tools talk to ComfyUI over plain HTTP (`/dsh-bridge/*`), so nothing platform-specific lives in the plugin itself — only the copy command and the ComfyUI launch command differ, and both are documented above.

## Usage

1. Open a conversation, switch to the **ComfyUI** tab — the canvas splits on the left, chat on the right.
2. Ask the agent to do canvas work: *"读取当前工作流"*, *"给 KSampler 设 seed 为 42"*, *"检查画布有没有报错"*, *"运行一次"*.
3. The agent reads `comfyui_config` first, so it knows it's on the canvas and stays focused on canvas operations.

## Requirements

- DeepSeek Harness Web (DSH), Node `^22.19.0 || >=24`
- ComfyUI running locally (default `127.0.0.1:8188`) with the bridge node installed
- A browser tab with the ComfyUI page open (the canvas tab loads it automatically)

## Development

```bash
npm run check   # node --check both lib files
```

The plugin lives in the DSH profile under `node_modules/dsh-comfyui-canvas`; edit `lib/index.js` (host tools) and `lib/client.js` (web client), then restart DSH.

## Repository layout

```
dsh-comfyui-canvas/
├── cordis.patch.yml          # DSH bundle layer (auto-mount)
├── comfyui-bridge/           # ComfyUI-side bridge node (self-contained)
│   └── ComfyUI-DSH-Canvas/
│       ├── __init__.py       # /dsh-bridge/* HTTP routes on the ComfyUI server
│       └── entry/bridge.js   # injected frontend: reports graph + runs commands
├── lib/
│   ├── index.js              # DSH host: 10 canvas tools + session-isolated mode
│   └── client.js             # DSH web: canvas tab / settings / rail polish
├── LICENSE
├── README.md
└── package.json
```

The **bridge** is the only ComfyUI-side dependency. It exposes `/dsh-bridge/workflow|report|command|result` and is injected into the ComfyUI page via `app.registerExtension`; without it the agent tools cannot reach the canvas.

## License

MIT
