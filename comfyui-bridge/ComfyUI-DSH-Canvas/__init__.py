# ComfyUI-DSH-Canvas bridge backend
# Exposes the live ComfyUI canvas state to the DSH-ComfyUI-Canvas plugin.
#
# M0: read path — the injected frontend passively reports graph changes.
# M1: write path — /dsh-bridge/command pushes LiteGraph commands to the
#     frontend over the ComfyUI WebSocket, results are stored for the caller.
# M3: optional shared-token auth (DSH_BRIDGE_TOKEN), report body size limit,
#     and per-tab command targeting via the last-reported clientId.

import os
import time
import uuid

import server
from aiohttp import web

WEB_DIRECTORY = "entry"
NODE_CLASS_MAPPINGS = {}
__all__ = ["NODE_CLASS_MAPPINGS"]

# Largest accepted /dsh-bridge/report body (bytes). A hostile or broken
# reporter must not be able to balloon ComfyUI's memory with one upload.
MAX_REPORT_BYTES = 8 * 1024 * 1024

# Optional shared secret. When set, every /dsh-bridge/* request must carry
# `Authorization: Bearer <token>`. When unset (the default), the bridge stays
# open for backward compatibility — same trust model as ComfyUI's own /prompt.
_BRIDGE_TOKEN = os.environ.get("DSH_BRIDGE_TOKEN", "").strip()

# Latest graph-change report from the injected frontend (M0 in-memory only).
_latest = {"nodes": [], "workflow": None, "prompt": None, "updated_at": None}

# Completed command results, keyed by command id (M1). Short-lived: the DSH
# tool polls a result, then this dict is trimmed opportunistically.
_command_results: dict[str, dict] = {}


def _authorized(request) -> bool:
    """True when no token is configured, or the request carries it."""
    if not _BRIDGE_TOKEN:
        return True
    header = request.headers.get("Authorization", "")
    return header == f"Bearer {_BRIDGE_TOKEN}"


def _reject_unauthorized(request) -> web.Response | None:
    if _authorized(request):
        return None
    return web.json_response({"ok": False, "error": "unauthorized"}, status=401)


@server.PromptServer.instance.routes.get("/dsh-bridge/workflow")
async def get_workflow(request):
    """DSH reads the last reported canvas state (nodes summary + workflow JSON)."""
    denied = _reject_unauthorized(request)
    if denied:
        return denied
    return web.json_response(_latest)


@server.PromptServer.instance.routes.post("/dsh-bridge/report")
async def report(request):
    """The injected frontend posts graph changes here.

    This endpoint is called by the injected bridge.js inside the ComfyUI page,
    which cannot hold the optional token, so it is intentionally NOT gated by
    `_reject_unauthorized`. It only mutates the in-memory `_latest` snapshot
    and never triggers execution, so it adds no execution surface beyond what
    ComfyUI's own unauthenticated /prompt already exposes.
    """
    try:
        raw = await request.read()
    except Exception:
        return web.Response(status=400, text="read failed")
    if len(raw) > MAX_REPORT_BYTES:
        return web.Response(status=413, text=f"report body exceeds {MAX_REPORT_BYTES} bytes")
    try:
        import json

        data = json.loads(raw)
    except Exception:
        return web.Response(status=400, text="invalid json")
    if not isinstance(data, dict):
        return web.Response(status=400, text="expected a json object")
    _latest["nodes"] = data.get("nodes") or []
    _latest["workflow"] = data.get("workflow")
    _latest["prompt"] = data.get("prompt")
    _latest["client_id"] = data.get("clientId")
    _latest["updated_at"] = time.time()
    return web.json_response({"accepted": True})


@server.PromptServer.instance.routes.post("/dsh-bridge/command")
async def command(request):
    """DSH tool dispatches a LiteGraph command to the canvas frontend.

    The command is forwarded to every connected ComfyUI frontend over the
    native WebSocket (`send_sync`); the injected bridge.js listens for the
    `dsh-bridge-command` event, executes it, and POSTs the result back to
    /dsh-bridge/result. M3 targets the command at the last-reported frontend
    (its `clientId`) so multiple open tabs do not each execute the command.
    """
    denied = _reject_unauthorized(request)
    if denied:
        return denied
    try:
        data = await request.json()
    except Exception:
        return web.Response(status=400, text="invalid json")
    if not isinstance(data, dict) or "cmd" not in data:
        return web.Response(status=400, text="expected { cmd, ... }")

    cmd_id = data.get("id") or uuid.uuid4().hex
    payload = {
        "id": cmd_id,
        "cmd": data.get("cmd"),
        "payload": data.get("payload", {}),
        # Only the frontend that last reported should act on the command.
        "target": _latest.get("client_id"),
    }
    try:
        server.PromptServer.instance.send_sync("dsh-bridge-command", payload)
    except Exception as exc:
        return web.json_response({"ok": False, "error": f"ws send failed: {exc}"})
    return web.json_response({"accepted": True, "id": cmd_id})


@server.PromptServer.instance.routes.post("/dsh-bridge/result")
async def result(request):
    """The injected frontend reports a command's outcome.

    Frontend-originated like /report, so not token-gated. A spoofed POST would
    need to guess the random command id, and it only records an in-memory
    outcome — it never dispatches execution.
    """
    try:
        data = await request.json()
    except Exception:
        return web.Response(status=400, text="invalid json")
    cmd_id = data.get("id")
    if not cmd_id:
        return web.Response(status=400, text="missing id")
    _command_results[cmd_id] = data
    # Opportunistic trim: keep only the newest 200 results.
    if len(_command_results) > 200:
        for stale in list(_command_results)[: len(_command_results) - 200]:
            _command_results.pop(stale, None)
    return web.json_response({"accepted": True})


@server.PromptServer.instance.routes.get("/dsh-bridge/result/{cmd_id}")
async def get_result(request):
    """DSH tool polls a command result by id."""
    denied = _reject_unauthorized(request)
    if denied:
        return denied
    cmd_id = request.match_info.get("cmd_id", "")
    item = _command_results.get(cmd_id)
    if item is None:
        return web.json_response({"ok": False, "error": "not_found"})
    return web.json_response(item)
