# dsh-comfyui-canvas

> [中文](README.zh.md) · English

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.3-brightgreen.svg)](https://github.com/wbin0001/dsh-comfyui-canvas/releases)
[![GitHub Stars](https://img.shields.io/github/stars/wbin0001/dsh-comfyui-canvas.svg?style=social)](https://github.com/wbin0001/dsh-comfyui-canvas)
[![DSH](https://img.shields.io/badge/DSH-v0.1.1--rc.2--v0.1.x-blueviolet.svg)](https://github.com/DeepSeek-Harness/DSH)
[![ComfyUI](https://img.shields.io/badge/ComfyUI-0.34+-orange.svg)](https://github.com/comfyanonymous/ComfyUI)
[![Canvas](https://img.shields.io/badge/canvas-split--screen-teal.svg)](docs/architecture.html)

> **⚠️ DSH version compatibility**: this plugin is built against **DSH v0.1.1-rc.2** (`conversation.view` / split-rail contracts).
> - ✅ **Works with**: DSH **v0.1.0.x – v0.1.1.x** (including release candidates)
> - ⚠️ **Not yet adapted**: DSH **v0.1.2+** (breaking client-side changes upstream may break the split-screen view; adaptation planned for v0.1.4)
> - ❌ **Non-official desktop wrappers** (e.g. the community `dsh-desktop`) are not guaranteed compatible — they bundle an upstream version that may be ahead of or behind this plugin's baseline; rely on official DSH.

![dsh-comfyui-canvas demo — agent drives a live ComfyUI workflow and fetches the output grid back into the chat](docs/screenshots/03-workflow-output.png)

Embed your **ComfyUI** (local or cloud) as a split-screen canvas tab inside [DeepSeek Harness](https://github.com/DeepSeek-Harness/DSH) Web, and merge DSH's LLM power with ComfyUI's generation into **one visual creation platform** — the agent sparks ideas, writes prompts and scripts right in the chat, applies them live to the canvas in front of you, and produces images, music, video, and 3D. From idea to finished output without ever leaving the conversation or switching front-ends:

- **Canvas ops** — compose and arrange pipelines, read/write workflows, edit nodes, wire links, run, tune parameters, and debug errors, all live and WYSIWYG on the exact canvas you are looking at
- **Production tasks** — batch parameter sweeps (`batch_run`) and automatic output-image retrieval back into the chat (`get_outputs`), powering multi-modal creative and batch generation across images, music, video, and 3D
- **Environment upkeep** — one-click launch of ComfyUI and one-click upgrade of the core plus every custom node (`upgrade`), keeping the stack healthy without interruption

This package is the DSH-side plugin, and it ships the ComfyUI-side bridge node too. For headless/scale workloads it can be paired with the official ComfyUI MCP server — see [Canvas vs MCP](#canvas-vs-mcp--two-ways-to-drive-comfyui).

> **Where this plugin fits**: use it while **building / tuning a workflow on the live canvas** (the "IDE" role). For **unattended / batch / production runs**, hand the exported workflow to **Comfy CLI** (`comfy-cli run_workflow`) — it runs headlessly without a browser, which this canvas plugin deliberately does not do (the agent drives the canvas you are looking at; a closed browser means no runner). Export a workflow once with `comfyui_export_api`, then script it with the CLI at scale.

## What you get

| Surface | Description |
|---|---|
| **ComfyUI canvas tab** | A `ComfyUI` conversation view that embeds the ComfyUI frontend (local or cloud) side by side with the Chat rail. The iframe stays alive across tab switches (no reload). |
| **Visual canvas copilot** | The agent operates **the canvas you are looking at** — nodes appear, links wire, widgets change and runs trigger live on screen, so you watch every step instead of trusting an opaque JSON edit. Output images come back into the chat via `comfyui_get_outputs`. |
| **Canvas ops tools** | `comfyui_read_workflow`, `add_node`, `connect`, `set_param`, `remove_node`, `inject_text`, `load_workflow`, `run`, `debug` — build and fix workflows on the live canvas; `inject_text` writes conversation text straight into a node or a new wirable source. |
| **Production tools** | `comfyui_batch_run` sweeps a parameter matrix (seeds/prompts/strengths) in one go; `comfyui_get_outputs` pulls the resulting files back into the chat — images, videos, gifs, and audio — with optional `outputStem` auto-incrementing names (`stem.01.png`, never overwrites); `comfyui_attach_file` uploads any local file (image/audio/video/3D/text) into ComfyUI's input/ for the matching Load node; `comfyui_export_api` exports the live canvas as API-format workflow JSON for comfy-cli headless batch runs. |
| **Projects & traceability** | Downloads default to the project directory (Settings → Project directory, default `<workspace>/projects`); every downloaded run appends `runs.json` (promptId / overrides / timestamp / files) so any output can be traced back to its parameters. Failed runs return a structured `executionError` (node id / node type / exception / message) instead of a raw JSON wall. |
| **Skills (SOPs)** | Built-in skills teach the agent the right order of operations: `comfyui-canvas-ops` (read → confirm → edit → run → fetch → self-check), `comfyui-admin-ops` (configure/launch/upgrade/node management), `comfyui-video-audio-ops` (video + voiceover/audio track), and `comfyui-dev-ops` (develop/debug custom nodes). Install the plugin and the skills ship with it — no extra setup. |
| **Upkeep tool** | `comfyui_upgrade` one-click updates the ComfyUI core and every git-backed custom node (concurrent, dirty-safe); `comfyui_config` reports the active connection, canvas focus, project directory, and a bridge-auth handshake check (`bridgeAuthEffective`). |
| **Node dev tools** | `comfyui_read_source` / `comfyui_edit_source` / `comfyui_reload` — read and edit custom-node source under custom_nodes/ and restart ComfyUI from the conversation, then verify on the canvas. |
| **Canvas focus mode** | The agent can tell (via `comfyui_config`) whether the browser is on the canvas tab for the current session, and focus on canvas work only then. Session-isolated. |
| **Settings page** | ComfyUI base URL / port / network mode / bridge token / launch command / project directory / rail width. Changes apply live. Customized nav icon with ComfyUI logo. |
| **Rail polish** | Image previews inside the input box, a `+` button to attach local images (DSH's official attachment path), approval popup over the canvas (split layout), send button pinned to the panel corner. |

## Install

### 1. Install the DSH plugin

```bash
dsh plugin add dsh-comfyui-canvas
```

Or from a GitHub checkout:

```bash
dsh plugin add github:wbin0001/dsh-comfyui-canvas
```

Or from a local checkout:

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

Open **Settings → ComfyUI Canvas** and set the ComfyUI base URL (default `http://127.0.0.1:8188`), port, network mode, optional bridge token, launch command, and the right-side rail width.

The **launch command** differs by platform:

| Platform | Example |
|---|---|
| Windows | `ComfyUI启动器.bat` (the launcher script; or `python main.py`) |
| macOS | `python main.py` or `./start.sh` |
| Linux | `python main.py` or `./start.sh` |

## Security

The bridge (`/dsh-bridge/*`) is the only network surface this plugin adds to ComfyUI. Read this before exposing ComfyUI beyond loopback.

- **Trust model.** By default the bridge is unauthenticated, matching ComfyUI's own `/prompt` trust model — anyone who can reach the ComfyUI port can read the canvas, report state, and dispatch commands (`load_workflow`/`run` consume GPU). Commands are whitelisted on the frontend, so no arbitrary code execution is possible, but the surface is real.
- **Bind to loopback.** Keep ComfyUI on `127.0.0.1` unless you explicitly need LAN/cloud access. `networkMode` is informational; the actual bind is whatever ComfyUI was launched with (`--listen`).
- **Optional shared token.** Set a token in **Settings → ComfyUI Canvas → Bridge Token** AND launch ComfyUI with the same value in its own environment (`DSH_BRIDGE_TOKEN=...`). When the token is set, every agent-initiated request — reading the canvas, dispatching a command, polling its result — must present `Authorization: Bearer <token>`; the host side sends it automatically and the bridge rejects requests without it. The frontend's own status reporting (`/report`, result callbacks) stays open, since the injected page cannot hold the token; those endpoints only mutate the in-memory snapshot and never dispatch execution. Leave it empty on both sides for the default open behavior.
- **Multiple tabs are safe.** Commands are targeted at the last-reporting frontend (`clientId`), so several open ComfyUI tabs do not each execute a command.

## Platform support

Works on **Windows**, **macOS** and **Linux**. The agent tools talk to ComfyUI over plain HTTP (`/dsh-bridge/*`), so nothing platform-specific lives in the plugin itself — only the copy command and the ComfyUI launch command differ, and both are documented above.

## Usage

1. Open a conversation, switch to the **ComfyUI** tab — the canvas splits on the left, chat on the right.
2. Ask the agent to do canvas work: *"read the current workflow"*, *"set KSampler seed to 42"*, *"check the canvas for errors"*, *"run it"*.
3. The agent reads `comfyui_config` first, so it knows it's on the canvas and stays focused on canvas operations.

### Conversation → canvas

Content the agent generates in the chat — images and text — can become ComfyUI workflow node inputs directly, closing the loop from conversation idea to canvas output:

- `comfyui_attach_image`: upload a local image into ComfyUI's `input/` and optionally point a LoadImage node at it. Uses ComfyUI's native `/upload/image` (not the bridge) — the host reads and uploads the file from the agent's own machine, which matters when the DSH machine and the ComfyUI machine differ (cloud deployments).
- `comfyui_inject_text`: write text to a node's widget; or create a new source node, set its value, and connect it to a target input — "conversation text as a wirable source". A one-step wrapper over `add_node + set_param + connect`; `set_param` alone suffices when only an existing widget changes, and `inject_text` is for "create a new source and wire it".
- `comfyui_export_api`: export the live canvas as API-format workflow JSON (the format `/prompt` and comfy-cli `run_workflow` consume), bridging canvas → MCP headless runs.

> Architecture boundary: file transfer (image → `input/`) goes through the host + native API; canvas node ops go through bridge commands; reading results goes through native `/history` + `/view` — three layers that never mix.

### Canvas vs MCP — two ways to drive ComfyUI

This plugin is the **canvas driver**: it sees and edits the *live canvas* the user is looking at (add nodes, wire links, tweak widgets, run, fetch the run's output images via `comfyui_get_outputs`, sweep parameters via `comfyui_batch_run`). It never needs a saved workflow file.

For **pipeline-style / headless workloads**, ComfyUI's official **Comfy CLI** (`comfy-cli`) is a complementary tool. It is a standalone Python CLI (installed via `pip install comfy-cli`, and can also expose an MCP server) — **not** a DSH plugin, so it is used separately from this plugin rather than mounted into the DSH profile. It covers capabilities this canvas plugin deliberately does **not** re-implement:

| Capability | This plugin (canvas) | ComfyUI CLI (comfy-cli) |
|---|---|---|
| Operate the live canvas the user sees | ✅ | — |
| Run a saved / API-format workflow file | ✅ (via canvas) | ✅ (directly) |
| Batch-queue runs + fetch output images | ✅ (`batch_run` + `get_outputs`) | ✅ (`run_workflow` + `fetch_outputs`) |
| Official workflow templates | — | ✅ (`templates`) |
| Model download / management | — | ✅ (`models`) |
| Hosted/paid models (Flux, Veo, …) | — | ✅ (`partner`) |
| Pre-flight graph validation (`validate` / deps) | ✅ (`debug`, local) | ✅ (`validate`, server) |

**Recommended split**: use this plugin while you are *building/tuning* a workflow on the canvas; use the Comfy CLI once you want to *run the same graph headlessly at scale* (batch pipelines, templates, model management, hosted models). They talk to the same ComfyUI instance and can be used side by side. Install the Comfy CLI with:

```bash
pip install comfy-cli   # standalone CLI, not a DSH plugin — see https://github.com/Comfy-Org/comfy-cli
```

## Requirements

- DeepSeek Harness Web (DSH), Node `^22.19.0 || >=24`
- ComfyUI running (local by default at `127.0.0.1:8188`; for a cloud instance, deploy the bridge node there and make sure DSH can reach it) with the bridge node installed
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
│   ├── index.js              # DSH host: 19 canvas tools + 4 built-in skills
│   └── client.js             # DSH web: canvas tab / settings / rail polish
├── LICENSE
├── README.md
└── package.json
```

The **bridge** is the only ComfyUI-side dependency. It exposes `/dsh-bridge/workflow|report|command|result` and is injected into the ComfyUI page via `app.registerExtension`; without it the agent tools cannot reach the canvas.

## Known issues

- `comfyui_reload` currently supports **Windows only** (uses `netstat`/`taskkill`); on macOS/Linux it fails loud instead of pretending, restart ComfyUI manually there.
- The former "node previews missing after a run" is fixed in v0.1.1: removed the iframe's `referrerpolicy="no-referrer"` to match the native tab environment, and `bridge.js` now listens to ComfyUI's `executed` event to force a canvas redraw.

## License

MIT
