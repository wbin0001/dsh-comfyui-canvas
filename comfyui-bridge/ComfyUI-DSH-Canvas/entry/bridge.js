// ComfyUI-DSH-Canvas bridge frontend.
// Injected into the ComfyUI page via app.registerExtension. It watches the
// LiteGraph canvas and posts graph changes to the bridge backend, so the DSH
// plugin can read what is on the canvas without touching the iframe DOM.
//
// M0: passive reporting (read path).
// M1: command listener (write path) — add_node / connect / set_param /
//     remove_node executed directly on LiteGraph, results POSTed back.
// M2: load_workflow (rewrite loop) / run (queuePrompt) / highlight (debug).
// M3: validate (structural checks, no execution) + per-tab targeting.

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const REPORT_URL = "/dsh-bridge/report";
const RESULT_URL = "/dsh-bridge/result";
const COMMAND_EVENT = "dsh-bridge-command";
const DEBOUNCE_MS = 300;

// Stable per-tab identity: lets the backend route a command to one frontend
// even when several tabs are open (DSH canvas tab + a native ComfyUI tab).
// The backend echoes the last-reported clientId back as `target`, and only
// that tab executes; the others skip the command.
const CLIENT_ID = (crypto?.randomUUID?.() ?? String(Math.random()).slice(2));

// ------- M0: passive reporting -------

function summarize(graph) {
  const nodes = graph?.nodes ?? [];
  return nodes.map((node) => ({
    id: String(node.id),
    type: node.type ?? node.comfyClass ?? "unknown",
    title: node.title || node.type || "",
  }));
}

function serializeGraph(graph) {
  try {
    return graph?.serialize?.() ?? null;
  } catch {
    return null;
  }
}

function report() {
  try {
    const graph = app.graph;
    if (!graph) return;
    const body = {
      clientId: CLIENT_ID,
      nodes: summarize(graph),
      workflow: serializeGraph(graph),
      prompt: null, // API-format prompt lands with the run path (M2)
    };
    fetch(REPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {
      // Backend may not be up yet during startup; next change retries.
    });
  } catch {
    // Never let a reporting error break the canvas.
  }
}

let timer = null;
function scheduleReport() {
  clearTimeout(timer);
  timer = setTimeout(report, DEBOUNCE_MS);
}

// ------- M1: write path -------

async function resolveLiteGraph() {
  if (window.LiteGraph) return window.LiteGraph;
  try {
    const mod = await import("../../scripts/litegraph.js");
    return mod.LiteGraph ?? window.LiteGraph;
  } catch {
    return window.LiteGraph;
  }
}

async function executeCommand(cmd, payload) {
  const graph = app.graph;
  const LiteGraph = await resolveLiteGraph();

  switch (cmd) {
    case "add_node": {
      const type = payload.class ?? payload.type;
      if (!type) throw new Error("add_node requires payload.class");
      const node = LiteGraph?.createNode?.(type) ?? null;
      if (!node) throw new Error(`unknown node class: ${type}`);
      if (Array.isArray(payload.pos)) node.pos = [payload.pos[0], payload.pos[1]];
      graph.add(node);
      scheduleReport();
      return { nodeId: String(node.id), type: node.type };
    }

    case "connect": {
      const { srcId, srcSlot, dstId, dstSlot } = payload;
      const src = graph.getNodeById(+srcId);
      const dst = graph.getNodeById(+dstId);
      if (!src) throw new Error(`source node not found: ${srcId}`);
      if (!dst) throw new Error(`destination node not found: ${dstId}`);
      const ok = src.connect(+srcSlot, dst, +dstSlot);
      if (!ok) throw new Error("connection rejected by LiteGraph");
      scheduleReport();
      return { connected: `${srcId}:${srcSlot} -> ${dstId}:${dstSlot}` };
    }

    case "set_param": {
      const { nodeId, key, value } = payload;
      const node = graph.getNodeById(+nodeId);
      if (!node) throw new Error(`node not found: ${nodeId}`);
      const widget = (node.widgets ?? []).find((w) => w.name === key);
      if (!widget) throw new Error(`widget not found: ${key}`);
      widget.value = value;
      // Combo widgets keep the selected label string in `.value`; validate it
      // against options so an unknown value fails loudly instead of silently
      // rendering empty, then let the widget's own callback react.
      if (widget.type === "combo" || Array.isArray(widget.options)) {
        const labels = (Array.isArray(widget.options) ? widget.options : widget.options?.values ?? [])
          .map((o) => (typeof o === "object" && o !== null ? (o.value ?? o[0]) : o));
        if (labels.length > 0 && !labels.some((l) => String(l) === String(value))) {
          throw new Error(`value ${JSON.stringify(value)} is not a valid option for ${key} (${labels.join(", ")})`);
        }
      }
      widget.callback?.(widget.value, widget);
      node.onWidgetChanged?.(widget, widget.value, null, null);
      node.setDirtyCanvas?.(true, true);
      scheduleReport();
      return { key, value };
    }

    case "remove_node": {
      const { nodeId } = payload;
      const node = graph.getNodeById(+nodeId);
      if (!node) throw new Error(`node not found: ${nodeId}`);
      graph.remove(node);
      scheduleReport();
      return { removed: String(nodeId) };
    }

    // M2: load a whole workflow back onto the canvas (rewrite loop).
    case "load_workflow": {
      const data = payload.workflow;
      if (!data) throw new Error("load_workflow requires payload.workflow");
      if (typeof data === "string") {
        try { payload.workflow = JSON.parse(data); } catch {
          throw new Error("payload.workflow is not valid JSON");
        }
      }
      await app.loadGraphData(payload.workflow);
      scheduleReport();
      return { loaded: true };
    }

    // M2: run the current canvas graph (queuePrompt) and report the task id.
    case "run": {
      if (typeof app.graphToPrompt !== "function") {
        throw new Error("this ComfyUI frontend lacks app.graphToPrompt");
      }
      const { output } = await app.graphToPrompt();
      const resp = await api.fetchApi("/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: output }),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(json?.error?.message ?? `prompt HTTP ${resp.status}`);
      return { promptId: json.prompt_id, nodeErrors: json.node_errors ?? null };
    }

    // M2: flash/highlight nodes by id (debug output).
    case "highlight": {
      const ids = Array.isArray(payload.ids) ? payload.ids : [];
      for (const id of ids) {
        const node = graph.getNodeById(+id);
        if (node && typeof node.flash === "function") node.flash();
      }
      return { highlighted: ids.map(String) };
    }

    // M3: validate — structural checks only, never submits /prompt, so a valid
    // graph is NOT queued (unlike `run`). Flags nodes with unconnected required
    // inputs so the agent can locate/fix errors without spending a generation.
    case "validate": {
      const nodeErrors = {};
      for (const node of graph?.nodes ?? []) {
        const missing = (node.inputs ?? [])
          .filter((input) => input.link == null && !input.optional && !input.widget)
          .map((input) => `missing required input "${input.name}"`);
        if (missing.length) nodeErrors[String(node.id)] = missing;
      }
      const offendingIds = Object.keys(nodeErrors);
      return { valid: offendingIds.length === 0, nodeErrors, offendingIds };
    }

    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

function postResult(cmdId, ok, raw) {
  const body = { id: cmdId, ok };
  if (ok) {
    body.result = raw;
  } else {
    body.error = raw?.message ?? String(raw ?? "unknown error");
  }
  fetch(RESULT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

app.registerExtension({
  name: "ComfyUI-DSH-Canvas",
  setup() {
    const graph = app.graph;
    if (!graph) return;

    // M0: report on canvas changes, preserving any existing handler.
    // The arrow keeps `this` from the setup scope; forward the graph itself so
    // a handler that relies on `this` still sees the graph.
    const prevOnChange = graph.onChange;
    graph.onChange = (...args) => {
      if (typeof prevOnChange === "function") {
        try { prevOnChange.apply(graph, args); } catch { /* ignore */ }
      }
      scheduleReport();
    };
    const prevGraphConfigure = graph.configure ?? null;
    if (typeof graph.configure === "function") {
      graph.configure = function (...args) {
        const out = prevGraphConfigure.apply(this, args);
        scheduleReport();
        return out;
      };
    }

    // M1: listen for write commands pushed over the WebSocket.
    // Per-tab targeting (M3): when the backend names a target clientId (the
    // last one that reported), only that tab executes — several open ComfyUI
    // tabs must not each run the same command. No target = any tab may run.
    api.addEventListener(COMMAND_EVENT, async (event) => {
      const msg = event?.detail;
      if (!msg || !msg.id || !msg.cmd) return;
      if (msg.target && msg.target !== CLIENT_ID) return;
      try {
        const raw = await executeCommand(msg.cmd, msg.payload ?? {});
        postResult(msg.id, true, raw);
      } catch (err) {
        console.error("[ComfyUI-DSH-Canvas] command failed", msg.cmd, err);
        postResult(msg.id, false, err);
      }
    });

    // Initial report once the canvas is ready.
    setTimeout(report, 1500);
  },
});