window.__ModuleLoader__.load({ id: "dsh-comfyui-canvas", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var React = require("react");

var NAMESPACE = "dsh-comfyui-canvas";
var DEFAULT_BASE = "http://127.0.0.1:8188";
var DEFAULT_RAIL = 360;
var STATE_KEY = "__dsh_comfyui_state__";

// 当前生效的 ComfyUI 地址（默认；设置行更改后由 scope 覆盖）。
var activeBase = DEFAULT_BASE;

// 画布 iframe 永久挂载在 body 上，从不动它：标签切换只改显隐。
// 激活时用 fixed 定位对齐视图区（含顶栏），卸载时 visibility:hidden，
// iframe 文档保持存活，切换标签/插件重载都不会重新加载 ComfyUI。
function canvasState() {
  var state = window[STATE_KEY];
  if (!state) {
    state = {};
    Object.defineProperty(window, STATE_KEY, { value: state, enumerable: false, configurable: true, writable: true });
  }
  return state;
}

// 按会话更新 activeViewBySession 映射（读-改-写整张 map，settings 写入串行安全）。
// 只改自己 sessionId 的键，其它会话不受影响 → 画布模式感知是会话隔离的。
// 上限 MAX_SESSION_VIEWS：会话销毁时不会自动清理，若不封顶 map 会无限增长
// （WKB review 实测已 7 条）。写时裁剪到「当前会话 + 最近的 N-1 条」。
var MAX_SESSION_VIEWS = 50;
function setSessionView(sc, sessionId, mode) {
  var snap = sc.getSnapshot ? sc.getSnapshot() : null;
  var value = snap && snap.value ? snap.value : {};
  var map = {};
  var current = value.activeViewBySession;
  if (current && typeof current === "object") {
    for (var k in current) map[k] = current[k];
  }
  map[String(sessionId)] = mode;
  var keys = Object.keys(map);
  if (keys.length > MAX_SESSION_VIEWS) {
    // Drop oldest keys (object string-key order = insertion order), always
    // keeping the current session.
    var keep = {};
    var currentKey = String(sessionId);
    var kept = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === currentKey || kept < MAX_SESSION_VIEWS - 1) {
        keep[k] = map[k];
        kept++;
      }
    }
    map = keep;
  }
  sc.set("activeViewBySession", map).catch(function () {});
}

// 注意：本插件不再注册 conversation.view 条目——会话标签栏没有 ComfyUI 标签，
// 画布只在 header 的「ComfyUI」按钮打开分屏时出现（见 ComfyUISplitToggle）。
// 这样避免标签高亮落在「对话」的困惑：分屏形态完全由 SplitToggle + 覆盖层承担。

function buildCanvas() {
  var outer = document.createElement("div");
  // 画布背景与对话顶栏同色（bg-layer-1），避免加载/未启动时灰一块。
  outer.style.cssText = "position:fixed;display:none;z-index:40;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-layer-1,#232324);";

  var bar = document.createElement("div");
  bar.style.cssText = "flex:none;display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));font-size:13px;color:var(--dsw-alias-label-primary,#e8e8e8);background:var(--dsw-alias-bg-layer-1,#232324);";
  var title = document.createElement("strong");
  title.textContent = "ComfyUI";

  // 顶栏右侧动作组（只显示图标，hover 用 title 浮现文字，垂直居中）：
  // 状态圆点 + 「刷新画布」按钮 + 「在新标签页打开」外链图标，与标题分居两端。
  var actions = document.createElement("div");
  actions.style.cssText = "margin-left:auto;display:flex;align-items:center;gap:12px;";

  var status = document.createElement("span");
  status.id = "dsh-comfy-status";
  status.title = "检测中…";
  status.style.cssText = "width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-secondary,#9a9aa2);display:inline-block;flex:none;";

  // 刷新画布：重载 iframe（跨域 iframe 不能直接调 contentWindow.location.reload，
  // 给 URL 加时间戳 query 参数触发重新导航）。只重载画布本身，不动 DSH 页面。
  // 用 query 而非 hash：ComfyUI 前端对 location.hash 有内部语义（恢复工作流等）。
  var refresh = document.createElement("button");
  refresh.type = "button";
  refresh.title = "刷新画布";
  refresh.setAttribute("aria-label", "刷新画布");
  refresh.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
  refresh.style.cssText = "background:transparent;border:none;padding:0;color:var(--dsw-alias-state-business-primary,#8ab4f8);cursor:pointer;display:inline-flex;align-items:center;";
  refresh.addEventListener("click", function () {
    var state = canvasState();
    if (!state.canvas) return;
    var f = state.canvas.querySelector("iframe");
    if (!f) return;
    var url;
    try { url = new URL(f.src || activeBase); } catch (e) { url = null; }
    if (url) {
      url.searchParams.set("_dsh_reload", String(Date.now()));
      f.src = url.toString();
    } else {
      f.src = (f.src || activeBase).split("#")[0] + "?_dsh_reload=" + Date.now();
    }
  });

  var link = document.createElement("a");
  link.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  link.href = activeBase;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.title = "在新标签页打开";
  link.style.cssText = "color:var(--dsw-alias-state-business-primary,#8ab4f8);text-decoration:none;display:inline-flex;align-items:center;";

  // 对话 rail 折叠/展开常驻图标（顶栏「在新标签页打开」后面）。
  // 点击派发自定义事件，SplitToggle 监听后切换 railClosedBySession；
  // 字形（›/‹）与 title 由 updateRailToggleIcon 随状态同步。
  // 对话 rail 折叠/展开常驻图标（顶栏「在新标签页打开」后面）。
  // 用 SVG（与刷新/外链同风格，stroke 线条、无字符基线偏移），flex 居中保证
  // 与前面 14px 图标同一水平线；字形（›/‹）由 updateRailToggleIcon 随状态切换。
  var railToggle = document.createElement("button");
  railToggle.type = "button";
  railToggle.id = "dsh-comfy-rail-toggle";
  railToggle.title = "折叠对话栏";
  railToggle.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
  railToggle.style.cssText = "background:transparent;border:none;padding:0;color:var(--dsw-alias-state-business-primary,#8ab4f8);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;";
  railToggle.addEventListener("click", function () {
    document.dispatchEvent(new CustomEvent("dsh-comfyui-toggle-rail", { bubbles: true }));
  });

  actions.appendChild(status);
  actions.appendChild(refresh);
  actions.appendChild(link);
  actions.appendChild(railToggle);
  bar.appendChild(title);
  bar.appendChild(actions);

  var frame = document.createElement("iframe");
  frame.src = activeBase;
  frame.title = "ComfyUI 画布";
  frame.setAttribute("allow", "clipboard-read; clipboard-write; fullscreen");
  // 不设 referrerpolicy：iframe 内请求的 Referer 本来就是 ComfyUI 自己的
  // URL（127.0.0.1:8188），不会泄漏 DSH 的 URL；显式 no-referrer 反而会
  // 让节点预览图（/view）与原生标签页行为不一致，导致预览不显示。
  frame.style.cssText = "flex:1 1 0;min-height:0;width:100%;border:0;display:block;background:var(--dsw-alias-bg-layer-1,#232324);";

  outer.appendChild(bar);
  outer.appendChild(frame);
  document.body.appendChild(outer);
  return outer;
}

// 同步顶栏状态圆点（颜色 + hover 文案），并联动画布 iframe 显隐：
// 未启动/检测中隐藏 iframe，露出外层背景（对话顶栏同色 #232324），
// 避免浏览器连接错误页（白/灰）透过启动卡遮罩露出来；在线后显示。
function updateCanvasStatus(online) {
  var state = canvasState();
  if (!state.canvas) return;
  var dot = state.canvas.querySelector("#dsh-comfy-status");
  var frame = state.canvas.querySelector("iframe");
  if (online === true) {
    dot.style.background = "var(--dsw-alias-state-success-primary,#22c55e)";
    dot.title = "ComfyUI 运行中";
    if (frame) frame.style.visibility = "visible";
  } else if (online === false) {
    dot.style.background = "var(--dsw-alias-state-error-primary,#ef4444)";
    dot.title = "ComfyUI 未启动";
    if (frame) frame.style.visibility = "hidden";
  } else {
    dot.style.background = "var(--dsw-alias-label-secondary,#9a9aa2)";
    dot.title = "检测中…";
    if (frame) frame.style.visibility = "hidden";
  }
}

// 同步顶栏 rail 折叠图标字形（›=折叠对话栏 / ‹=展开）与 hover 文案。
function updateRailToggleIcon(closed) {
  var state = canvasState();
  if (!state.canvas) return;
  var btn = state.canvas.querySelector("#dsh-comfy-rail-toggle");
  if (!btn) return;
  btn.innerHTML = closed
    ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>'
    : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
  btn.title = closed ? "展开对话栏" : "折叠对话栏";
}

// 把 rail 宽度实时发布为 CSS 变量，供插件注入的 [data-*] 挤压样式引用。
// 零核心依赖：不碰任何 hash 类名，只写 html[data-dsh-split] 作用域下的变量。
function applyRailWidth(width) {
  var w = Number(width);
  if (!(w >= 120 && w <= 1200)) w = DEFAULT_RAIL;
  document.documentElement.style.setProperty("--dsh-comfyui-rail-width", w + "px");
}

// 设置导航图标（非侵入式，不改 DSH 核心）：
// DSH 0.1.x 的 settings.section 只投影 id/order/label，图标由设置壳从内置 id
// 列表里选（外部 section 落到通用齿轮）。这里仿 dsh-better-sidebar 的做法：
// 用 MutationObserver 找到「文字 == 本插件 section label」的导航按钮，打上
// 标记，再用本插件 CSS 的 SVG mask 把那个齿轮替换成 ComfyUI 方形 C 图标。
// 不碰 DSH 核心文件；dispose 时移除标记与 observer，HMR 安全。
const SETTINGS_NAV_MARKER = "data-dsh-comfyui-canvas-settings-nav";

// ComfyUI 方形 C 图标（两个斜切圆角块），单色 currentColor。
// URL 编码的 SVG path（viewBox 30 28 122 126），供 CSS mask 使用。
const COMFYUI_NAV_MASK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='30 28 122 126'%3E%3Cpath fill='black' d='M88.218 35.663C83.809 37.836 81.579 41.233 79.462 49C76.672 59.236 76.92 59 68.933 59C61.118 59 56.643 60.502 53.141 64.301C50.092 67.61 36.74 113.081 37.595 117.249C38.465 121.495 41.516 123 49.254 123C57.436 123 57.918 123.669 55.621 131.853C53.473 139.511 53.541 144.274 55.829 146.345C57.426 147.791 60.77 148 82.252 148H106.847L109.959 145.381C113.987 141.991 115.125 139.591 118.435 127.5C121.512 116.26 121.09 112.745 116.453 110.982C115.032 110.442 105.847 110 96.042 110C81.448 110 78.114 109.739 77.661 108.56C77.065 107.006 85.703 75.314 87.286 73.25C87.995 72.325 93.352 71.999 107.872 71.996C134.256 71.991 134.414 71.897 139.945 52.769C145.339 34.114 145.174 33.992 114.527 34.023C95.367 34.042 90.949 34.317 88.218 35.663Z'/%3E%3C/svg%3E";

/** 注入替换设置导航图标的 CSS（隐藏核心齿轮、用 mask 画 C）。 */
function injectSettingsNavIconStyles() {
  var styleId = "dsh-comfyui-canvas-settings-nav-css";
  if (document.getElementById(styleId)) return;
  var style = document.createElement("style");
  style.id = styleId;
  style.textContent = [
    "[" + SETTINGS_NAV_MARKER + "] > svg:first-child { display: none; }",
    "[" + SETTINGS_NAV_MARKER + "]::before {",
    "  content: '';",
    "  flex: none;",
    "  width: 16px;",
    "  height: 16px;",
    "  background: currentColor;",
    "  -webkit-mask: url(\"" + COMFYUI_NAV_MASK + "\") center / contain no-repeat;",
    "  mask: url(\"" + COMFYUI_NAV_MASK + "\") center / contain no-repeat;",
    "}",
  ].join("\n");
  document.head.appendChild(style);
}

/**
 * 标记本插件在设置导航中的那一行（按 label 文字匹配），配合上面的 CSS
 * 把该行的核心齿轮替换成 ComfyUI C 图标。
 * @param label - locale-aware section label 解析函数。
 * @returns disposer：断开观察并移除本插件打下的所有标记。
 */
function registerSettingsNavIcon(label) {
  var disposed = false;
  var sync = function () {
    if (disposed) return;
    var current = String(label() || "").trim();
    var buttons = document.querySelectorAll('[role="dialog"] nav button');
    for (var i = 0; i < buttons.length; i++) {
      var text = (buttons[i].textContent || "").trim();
      if (current.length > 0 && text === current) {
        buttons[i].setAttribute(SETTINGS_NAV_MARKER, "");
      } else {
        buttons[i].removeAttribute(SETTINGS_NAV_MARKER);
      }
    }
  };
  sync();
  var observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return function () {
    disposed = true;
    observer.disconnect();
    var marked = document.querySelectorAll("[" + SETTINGS_NAV_MARKER + "]");
    for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(SETTINGS_NAV_MARKER);
  };
}

// ComfyUI 控制条：
// - 在线：不渲染任何覆盖层——状态由顶栏右侧圆点图标呈现（hover 显示
//   「ComfyUI 运行中」），画布完全可见。
// - 离线/检测中：居中启动卡片，仅覆盖画布视图区（绝对定位于 host 内），
//   不遮挡顶部会话标签栏，可正常切换会话标签。
function ComfyUIControl(props) {
  var online = props.online;
  // 离线/检测中的启动卡片仍需要这两个：starting 控制按钮文案/禁用态，
  // onStart 触发启动。
  var starting = props.starting === true;
  var onStart = props.onStart;
  // 上次启动失败的原因（host 写入 settings.launchError），启动卡片展示，
  // 避免用户只看到"正在启动…"卡死而不知道哪一步失败了。
  var error = typeof props.error === "string" && props.error ? props.error : "";

  // 在线：状态已并入顶栏圆点，这里不再渲染任何遮挡层。
  if (online === true) return null;

  // 离线/检测中：居中启动卡片。
  var wrapStyle = {
    position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
    zIndex: 79, display: "flex", alignItems: "center", justifyContent: "center",
    background: "var(--dsw-alias-bg-mask-3,rgba(0,0,0,0.48))", padding: "24px",
  };
  var cardStyle = {
    width: "min(460px, 100%)", padding: "20px",
    background: "var(--dsw-alias-bg-layer-2, #1f1f23)", color: "var(--dsw-alias-label-primary, #e8e8e8)",
    border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25))",
    borderRadius: "12px", boxShadow: "0 8px 32px rgba(0,0,0,.4)", fontFamily: "inherit",
  };
  var btnStyle = {
    border: "none", borderRadius: "8px", padding: "10px 18px", fontSize: "13px",
    fontWeight: "600", cursor: "pointer",
    // 外层（分屏状态层）pointerEvents:none 放行画布穿透；按钮自行恢复
    // 可点，否则启动卡永远按不动。
    pointerEvents: "auto",
    background: "var(--dsw-alias-state-business-primary, #3b82f6)", color: "#fff",
  };
  var errStyle = {
    fontSize: "12px", color: "var(--dsw-alias-state-error-primary,#ef4444)", lineHeight: 1.5, marginTop: "12px",
    wordBreak: "break-word", whiteSpace: "pre-wrap",
  };
  var detecting = online === null;
  return React.createElement("div", { style: wrapStyle },
    React.createElement("div", { style: cardStyle },
      React.createElement("div", { style: { fontSize: "14px", fontWeight: 600, marginBottom: "8px" } }, "ComfyUI 未启动"),
      React.createElement("div", { style: { fontSize: "13px", color: "var(--dsw-alias-label-secondary, #9a9aa2)", lineHeight: 1.6, marginBottom: "16px" } },
        "检测到 ComfyUI 服务未运行。点击下方按钮会用设置里的「启动命令」后台拉起 ComfyUI，启动完成后画布自动加载。"
      ),
      error ? React.createElement("div", { style: errStyle }, error) : null,
      React.createElement("button", {
        style: btnStyle, disabled: starting || detecting,
        onClick: function () { if (onStart) onStart(); },
      }, starting ? "正在启动…" : detecting ? "检测中…" : "启动 ComfyUI"),
    ),
  );
}

// 画布状态覆盖层：可达性探测 + 启动卡 + 桥接鉴权告警。
// 由分屏覆盖层（ComfyUISplitToggle 的 split-status 层）持有并渲染——
// 分屏覆盖层的 iframe 是插件直接持有的，必须自带这套状态层。
// 渲染为 absolute 填满父容器（父须 relative/fixed），在线时返回 null。
function CanvasStatusOverlay(props) {
  var scope = props.scope;
  var sessionId = props.sessionId;
  // ComfyUI 可达性检测：每隔几秒探一下。优先用正常 CORS 请求并检查 res.ok
  // （能区分"在线"和"500 报错"）；若 DSH 页面 (127.0.0.1:3080) 跨域探测
  // ComfyUI (127.0.0.1:8188) 被 CORS 拦截（抛 TypeError），回退到 mode:'no-cors'
  // 的 opaque 可达性探测——服务可达即 resolve，不可达才 reject。
  var onlineState = React.useState(null); // null=检测中, true=在线, false=离线
  var online = onlineState[0];
  var setOnline = onlineState[1];
  React.useEffect(function () {
    var stopped = false;
    var timer = null;
    // 同步顶栏状态圆点（初始检测中）。
    updateCanvasStatus(null);
    var probe = function () {
      fetch(activeBase + "/system_stats", { method: "GET", signal: AbortSignal.timeout(2500) })
        .then(function (res) {
          if (stopped) return;
          setOnline(res.ok); // 200-299 → 在线；4xx/5xx → 离线（服务在但报错）
          setStarting(false);
          updateCanvasStatus(res.ok);
        })
        .catch(function () {
          if (stopped) return;
          // CORS 拦截（TypeError）或网络错误 → 用 no-cors 回退判断端口是否可达
          fetch(activeBase + "/system_stats", { method: "GET", mode: "no-cors", signal: AbortSignal.timeout(2500) })
            .then(function () {
              if (stopped) return;
              setOnline(true);
              setStarting(false);
              updateCanvasStatus(true);
            })
            .catch(function () {
              if (stopped) return;
              setOnline(false);
              updateCanvasStatus(false);
            });
        });
    };
    probe();
    timer = setInterval(probe, 4000);
    return function () {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  // 请求 host 启动 ComfyUI（写 launchRequested=true，host watcher 负责拉起）。
  var startState = React.useState(false);
  var isStarting = startState[0];
  var setStarting = startState[1];
  // 上次启动失败的原因（host 写入 settings.launchError）。随 scope 订阅更新，
  // 启动卡片据此展示具体失败原因，而不是让用户一直停在"正在启动…"。
  var errorState = React.useState("");
  var launchError = errorState[0];
  var setLaunchError = errorState[1];
  React.useEffect(function () {
    var sc = scope;
    if (!sc || typeof sc.subscribe !== "function" || typeof sc.getSnapshot !== "function") return;
    var sync = function () {
      var snap = sc.getSnapshot();
      var v = snap && snap.value ? snap.value : {};
      setLaunchError(typeof v.launchError === "string" ? v.launchError : "");
    };
    sync();
    var unsub = sc.subscribe(sync);
    return function () { if (typeof unsub === "function") unsub(); };
  }, []);
  var requestLaunch = function () {
    var sc = scope;
    if (!sc || typeof sc.set !== "function") return;
    setStarting(true);
    sc.set("launchRequested", true).catch(function () {
      setStarting(false);
    });
  };

  // 桥接鉴权握手（画布激活时按需触发，非启动路径）：浏览器跨域读不到
  // ComfyUI 状态码（CORS），所以向 host 请求一次代理探测——写
  // probeRequested=true，host watcher 后台探测并把结果写回 bridgeProbe。
  // 这里只负责发起 + 订阅展示，全程异步，不影响任何启动流程。
  var probeState = React.useState(null); // {bridgeAuthEffective, bridgeAuthProbe, checkedAt}
  var bridgeProbe = probeState[0];
  var setBridgeProbe = probeState[1];
  var tokenSetState = React.useState(false);
  var tokenSet = tokenSetState[0];
  var setTokenSet = tokenSetState[1];
  React.useEffect(function () {
    var sc = scope;
    if (!sc) return;
    if (typeof sc.set === "function") {
      sc.set("probeRequested", true).catch(function () {});
    }
    if (typeof sc.subscribe !== "function" || typeof sc.getSnapshot !== "function") return;
    var sync = function () {
      var snap = sc.getSnapshot();
      var v = snap && snap.value ? snap.value : {};
      setBridgeProbe(v.bridgeProbe || null);
      setTokenSet(!!(v.bridgeToken));
    };
    sync();
    var unsub = sc.subscribe(sync);
    return function () { if (typeof unsub === "function") unsub(); };
  }, [sessionId]);

  // 启动超时：host 用 launchCommand 拉起 ComfyUI 通常几十秒内完成；超过
  // 45 秒仍未探测到在线就复位"正在启动…"，允许用户重试，避免永久卡死。
  React.useEffect(function () {
    if (!isStarting) return;
    var timer = setTimeout(function () {
      setStarting(false);
    }, 45000);
    return function () { clearTimeout(timer); };
  }, [isStarting]);

  // 控制条常驻：离线显示启动卡片、在线显示右上角状态提示。
  // 渲染在父容器内部（父须 position:relative/fixed），absolute 只覆盖画布区。
  var control = React.createElement(ComfyUIControl, {
    online: online, starting: isStarting, onStart: requestLaunch, error: launchError,
  });
  var children = [control];
  // 桥接鉴权告警：只有当 DSH 侧配了 token、但桥接握手显示"错误 token 也能
  // 通过"时才亮红字——真正的配置错位（ComfyUI 端没设 DSH_BRIDGE_TOKEN）。
  if (bridgeProbe && bridgeProbe.bridgeAuthEffective === false && tokenSet) {
    children.push(React.createElement("div", {
      style: {
        position: "absolute", top: "8px", left: "50%", transform: "translateX(-50%)",
        zIndex: 45, maxWidth: "86%",
        background: "color-mix(in srgb, var(--dsw-alias-state-error-primary,#f85149) 12%, transparent)",
        color: "var(--dsw-alias-state-error-primary,#f85149)",
        border: "1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary,#f85149) 40%, transparent)",
        borderRadius: "6px",
        padding: "6px 12px", fontSize: "12px", lineHeight: "1.5", textAlign: "center",
      },
    }, "⚠️ 桥接鉴权未生效：ComfyUI 端可能没设 DSH_BRIDGE_TOKEN。打开设置页 → ComfyUI 画布 查看详情。"));
  }
  return React.createElement("div", { style: { position: "absolute", inset: 0 } }, children);
}

// 分屏覆盖层定位：画布 fixed 贴对话区左侧，宽 = 对话列左缘到右侧 rail 左缘，
// 高 = rail 区高度。不依赖任何核心 hash 类名，只认 data-* 锚点。
// 返回覆盖层 rect（供 React 状态层复用定位），画布不可用时返回 null。
function positionSplit(outer) {
  var scroll = document.querySelector('[data-conversation-scroll]');
  var root = scroll ? scroll.closest('[data-phase]') : null;
  if (!root || !scroll) { outer.style.display = "none"; return null; }
  var r = root.getBoundingClientRect();
  var s = scroll.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) { outer.style.display = "none"; return null; }
  var rect = {
    left: r.left,
    top: s.top,
    width: Math.max(0, s.left - r.left),
    height: Math.max(0, s.bottom - s.top),
  };
  // 折叠对话 rail 时画布铺满整个对话列（不受右侧 rail 宽度钳制）。
  if (document.documentElement.getAttribute("data-dsh-rail-closed") === "1") {
    rect.width = Math.max(0, r.right - r.left);
  }
  outer.style.left = rect.left + "px";
  outer.style.top = rect.top + "px";
  outer.style.width = rect.width + "px";
  outer.style.height = rect.height + "px";
  outer.style.display = "flex";
  return rect;
}

// 分屏开关：会话标头右侧 utilities 里的按钮。开 → 画布覆盖层贴左 +
// html[data-dsh-split-on] 启用挤压样式（对话收窄为 rail 靠右）；
// 关 → 隐藏覆盖层并移除开关。状态按会话隔离存 settingsScope。
function ComfyUISplitToggle(props) {
  var sessionId = String(props.sessionId ?? "root");
  var scope = props.scope;
  var snapshot = React.useSyncExternalStore(
    function (cb) { return scope.subscribe(cb); },
    function () { return scope.getSnapshot(); },
  );
  var value = (snapshot && snapshot.value) || {};
  var map = value.splitEnabledBySession || {};
  var enabled = map[sessionId] === true;
  var railWidth = value.railWidth != null ? Number(value.railWidth) : DEFAULT_RAIL;
  // 折叠状态（按会话隔离）：折叠时对话 rail 隐藏、画布铺满整个对话列。
  var railClosedMap = value.railClosedBySession || {};
  var railClosed = railClosedMap[sessionId] === true;
  // 对话 rail 顶部横条高度：量取画布覆盖层顶栏（buildCanvas 的 bar）的真实
  // 渲染高度，保证左右两条顶栏像素级对齐。画布未建时回退 31px。
  var railHeaderHeight = 31;
  var canvasForBar = canvasState().canvas;
  if (canvasForBar && canvasForBar.firstElementChild) {
    var barH = canvasForBar.firstElementChild.offsetHeight;
    if (barH > 0) railHeaderHeight = barH;
  }
  // 分屏只在「对话」标签下生效：读核心 header 里 aria-selected 的 tab 文本
  // （中文「对话」/ 英文 Chat）。轨迹 / DeepSeek Flow / ComfyUI 标签下
  // chatTabActive=false → 分屏自动禁用（用户方案：其他标签下禁用分屏）。
  // 用 MutationObserver 跟随 tab 切换，不依赖 settings 快照时序。
  var chatTabState = React.useState(false);
  var chatTabActive = chatTabState[0];
  var setChatTabActive = chatTabState[1];
  React.useEffect(function () {
    var check = function () {
      var active = document.querySelector('[role="tab"][aria-selected="true"]');
      var label = active ? (active.textContent || "").trim() : "";
      setChatTabActive(label === "对话" || label === "Chat");
    };
    check();
    var observer = typeof MutationObserver === "function"
      ? new MutationObserver(check)
      : null;
    if (observer) observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
    return function () { if (observer) observer.disconnect(); };
  }, []);
  // 分屏仅在对话标签下生效（用户方案确认）。
  var splitActive = enabled && chatTabActive;
  // 画布覆盖层 rect，供 fixed 状态层（启动卡/探测/鉴权告警）定位。
  var rectState = React.useState(null);
  var rect = rectState[0];
  var setRect = rectState[1];
  // 拖拽调宽状态：rail 左缘把手按下时记录起始 X 与起始宽度。
  var dragRef = React.useRef(null);
  var startRailResize = function (e) {
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startW: railWidth,
    };
    var el = e.currentTarget;
    if (el.setPointerCapture) {
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* capture failed: fall back to window move */ }
    }
  };
  var moveRailResize = function (e) {
    var drag = dragRef.current;
    if (!drag) return;
    var w = drag.startW + (drag.startX - e.clientX);
    w = Math.max(120, Math.min(1200, Math.round(w)));
    if (w === drag.lastW) return;
    drag.lastW = w;
    // 即时生效（CSS 变量驱动挤压样式），并持久化 railWidth。
    applyRailWidth(w);
    scope.set("railWidth", w).catch(function () { /* recover handled by scope */ });
    // 拖动中实时重算画布覆盖层与把手位置（rail 左缘随宽度变化），
    // 否则把手会停在起点，脱离 rail 边界。
    var st = canvasState();
    if (st.canvas && document.documentElement.getAttribute("data-dsh-split-on") === "1") {
      setRect(positionSplit(st.canvas));
    }
  };
  var endRailResize = function (e) {
    if (!dragRef.current) return;
    dragRef.current = null;
    var el = e.currentTarget;
    if (el.releasePointerCapture) {
      try { el.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    }
  };

  React.useEffect(function () {
    if (splitActive) {
      var state = canvasState();
      if (!state.canvas) state.canvas = buildCanvas();
      var outer = state.canvas;
      document.documentElement.setAttribute("data-dsh-split-on", "1");
      // 折叠对话 rail（画布铺满整列）。
      if (railClosed) {
        document.documentElement.setAttribute("data-dsh-rail-closed", "1");
      } else {
        document.documentElement.removeAttribute("data-dsh-rail-closed");
      }
      setRect(positionSplit(outer));
      // 画布专注模式：写入 activeViewBySession（host 端 comfyui_config 工具
      // 据此感知当前会话在画布分屏，agent 专注画布操作；按会话隔离）。
      if (scope && typeof scope.set === "function") setSessionView(scope, sessionId, "canvas");
      var observer = null;
      var onResize = function () {
        if (document.documentElement.getAttribute("data-dsh-split-on") === "1") {
          setRect(positionSplit(outer));
        }
      };
      if (typeof ResizeObserver === "function") {
        observer = new ResizeObserver(onResize);
        // 观察对话列 root 与 scrollBody：侧边栏折叠/展开会改变 root 的
        // left/宽度（scroll 尺寸可能不变，只看 scroll 会漏掉），必须两者
        // 都观察 + window resize 兜底，画布才能随主界面布局自适应。
        var root = document.querySelector('[data-phase]');
        if (root) observer.observe(root);
        var scroll = document.querySelector('[data-conversation-scroll]');
        if (scroll) observer.observe(scroll);
        window.addEventListener("resize", onResize);
      }
      return function () {
        if (observer) observer.disconnect();
        window.removeEventListener("resize", onResize);
        document.documentElement.removeAttribute("data-dsh-split-on");
        document.documentElement.removeAttribute("data-dsh-rail-closed");
        setRect(null);
        // 关闭分屏时无条件隐藏画布覆盖层（display:none 连子元素带 iframe
        // 一起隐藏——不可用 visibility，因为 ComfyUI 启动后 iframe 自带
        // visibility:visible 会穿透父级 hidden，导致画布残留）。
        var cv = canvasState();
        if (cv.canvas) cv.canvas.style.display = "none";
        if (scope && typeof scope.set === "function") setSessionView(scope, sessionId, "chat");
      };
    }
    // 非分屏态（开关关了，或不在对话标签）：确保不残留挤压样式与覆盖层，
    // 并隐藏画布（已无 ComfyUI 标签兜底显示）。
    document.documentElement.removeAttribute("data-dsh-split-on");
    document.documentElement.removeAttribute("data-dsh-rail-closed");
    setRect(null);
    var canvas = canvasState();
    if (canvas.canvas) canvas.canvas.style.display = "none";
  }, [enabled, railWidth, sessionId, chatTabActive, railClosed]);

  var toggle = function () {
    var next = {};
    for (var k in map) next[k] = map[k];
    next[sessionId] = !enabled;
    scope.set("splitEnabledBySession", next).catch(function () { /* recover handled by scope */ });
  };

  var toggleRail = function () {
    var next = {};
    for (var k in railClosedMap) next[k] = railClosedMap[k];
    next[sessionId] = !railClosed;
    scope.set("railClosedBySession", next).catch(function () { /* recover handled by scope */ });
  };

  // 顶栏折叠图标（buildCanvas 里 #dsh-comfy-rail-toggle）的点击事件 →
  // 切换本会话 rail 折叠状态；railClosed 变化时同步图标字形。
  React.useEffect(function () {
    updateRailToggleIcon(railClosed);
    var onToggleEvent = function () { toggleRail(); };
    document.addEventListener("dsh-comfyui-toggle-rail", onToggleEvent);
    return function () {
      document.removeEventListener("dsh-comfyui-toggle-rail", onToggleEvent);
    };
  }, [railClosed, sessionId]);

  return React.createElement(React.Fragment, null,
    React.createElement("button", {
      type: "button",
      onClick: toggle,
      title: splitActive
        ? "关闭分屏（画布 + 右侧对话）"
        : !chatTabActive
          ? "分屏仅在对话标签下可用"
          : "开启分屏（画布 + 右侧对话）",
      "aria-pressed": splitActive || undefined,
      style: {
        display: "inline-flex", alignItems: "center", gap: "6px",
        border: "none", borderRadius: "8px", padding: "4px 10px",
        fontSize: "12px", cursor: "pointer", lineHeight: "1.6",
        background: splitActive ? "var(--dsw-alias-state-business-primary,#3b82f6)" : "transparent",
        color: splitActive ? "#fff" : "var(--dsw-alias-label-secondary,#9a9aa2)",
      },
    }, React.createElement("span", {
      style: {
        width: 8, height: 8, borderRadius: "50%", flex: "none",
        background: splitActive ? "#fff" : "var(--dsw-alias-state-warn-primary,#d29922)",
      },
    }), "ComfyUI"),
    // 分屏开启：叠状态层 + 顶部横条 + 折叠/展开把手。
    // 把手始终渲染：展开态贴画布右缘（= rail 左缘）显示 ›，折叠态贴整列右缘
    // 显示 ‹——绝不能让用户找不到展开入口（此前 !railClosed 条件导致折叠后
    // 把手整体消失的死锁）。positionSplit 在折叠态已把 rect 铺满整列。
    ...(splitActive && rect
      ? [React.createElement("div", {
        key: "split-status",
        style: {
          position: "fixed",
          left: rect.left, top: rect.top,
          width: rect.width, height: rect.height,
          zIndex: 60, pointerEvents: "none",
        },
      }, React.createElement(CanvasStatusOverlay, {
        scope: scope, sessionId: sessionId,
      })),
      // 对话 rail 顶部横条（仅展开态）：贴画布右缘，与画布顶栏同高同顶。
      railClosed ? null : React.createElement("div", {
        key: "split-rail-header",
        style: {
          position: "fixed",
          left: (rect.left + rect.width) + "px",
          top: rect.top + "px",
          width: railWidth + "px",
          height: Math.max(28, railHeaderHeight) + "px",
          zIndex: 55,
          display: "flex", alignItems: "center",
          padding: "0 12px", boxSizing: "border-box",
          fontSize: 13, fontWeight: 600,
          color: "var(--dsw-alias-label-primary,#e8e8e8)",
          background: "var(--dsw-alias-bg-layer-1,#232324)",
          borderBottom: "1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25))",
        },
      }, "对话"),
      // 拖拽调宽把手（仅展开态）：rail 左缘一条可拖竖线，按住左右拖实时改宽度。
      railClosed ? null : React.createElement("div", {
        key: "split-rail-resize",
        title: "拖拽调整对话栏宽度",
        onPointerDown: startRailResize,
        onPointerMove: moveRailResize,
        onPointerUp: endRailResize,
        onPointerCancel: endRailResize,
        style: {
          position: "fixed",
          left: (rect.left + rect.width - 4) + "px",
          top: rect.top + "px",
          width: 8, height: rect.height,
          zIndex: 72, cursor: "col-resize",
          touchAction: "none",
          background: "transparent",
          border: "none", padding: 0, margin: 0,
        },
      }),
      ]
      : []),
  );
}

// ------- M3: Settings section —— 左侧导航独立页 “ComfyUI 画布” -------

function ComfyUISettingsRow(props) {
  var scope = props.scope;
  var snapshot = React.useSyncExternalStore(
    function (cb) { return scope.subscribe(cb); },
    function () { return scope.getSnapshot(); },
  );
  var value = (snapshot && snapshot.value) || {};
  var baseUrl = typeof value.baseUrl === "string" && value.baseUrl ? value.baseUrl : DEFAULT_BASE;
  var port = value.port != null ? String(value.port) : "";
  var networkMode = typeof value.networkMode === "string" && value.networkMode ? value.networkMode : "loopback";
  var bridgeToken = typeof value.bridgeToken === "string" ? value.bridgeToken : "";
  var launchCommand = typeof value.launchCommand === "string" ? value.launchCommand : "";
  var comfyuiDir = typeof value.comfyuiDir === "string" ? value.comfyuiDir : "";
  var railWidth = value.railWidth != null ? Number(value.railWidth) : DEFAULT_RAIL;
  var projectDir = typeof value.projectDir === "string" ? value.projectDir : "";
  var writable = !snapshot || snapshot.writable !== false;

  var inputStyle = {
    width: "100%", boxSizing: "border-box",
    background: "var(--dsw-alias-bg-layer-2,#1f1f23)",
    color: "var(--dsw-alias-label-primary,#e8e8e8)",
    border: "1px solid var(--dsw-alias-border-l2,#3a3a40)",
    borderRadius: "6px", padding: "6px 8px",
    fontSize: "13px", fontFamily: "inherit", marginTop: "4px",
  };
  var labelStyle = { fontSize: "12px", color: "var(--dsw-alias-label-secondary,#9a9aa2)", marginTop: "10px", display: "block" };
  var rowStyle = { padding: "12px", display: "flex", flexDirection: "column", gap: "2px" };
  var titleStyle = { fontSize: "13px", fontWeight: "600", color: "var(--dsw-alias-label-primary,#e8e8e8)" };

  function setField(field, raw) {
    if (!writable || !scope.set) return;
    var next = raw === "" ? null : raw;
    scope.set(field, next).catch(function () { /* recover handled by scope */ });
  }

  // 桥接鉴权握手（非启动路径）：设置页打开 / token 变化时向 host 请求一次
  // 探测（probeRequested=true → host 后台探测 → 结果写回 bridgeProbe）。
  // host 代理是因为浏览器跨域读不到 ComfyUI 的状态码（CORS），而 host 端
  // fetch 没有此限制。这里只负责"发起请求 + 展示结果"，不阻塞任何启动流程。
  // 输入 token 时防抖 600ms，避免每个字符触发一次探测。
  React.useEffect(function () {
    if (!bridgeToken) return;
    var timer = setTimeout(function () {
      if (scope && typeof scope.set === "function") {
        scope.set("probeRequested", true).catch(function () {});
      }
    }, 600);
    return function () { clearTimeout(timer); };
  }, [bridgeToken]);
  var probe = value.bridgeProbe || {};
  var probeText = "";
  var probeColor = "var(--dsw-alias-label-secondary,#9a9aa2)";
  if (probe.bridgeAuthEffective === true) {
    probeText = "✅ 桥接鉴权已生效（错误 Token 会被拒绝）";
    probeColor = "var(--dsw-alias-state-success-primary,#3fb950)";
  } else if (probe.bridgeAuthEffective === false) {
    probeText = bridgeToken
      ? "⚠️ 桥接鉴权未生效：ComfyUI 端可能没设 DSH_BRIDGE_TOKEN（检查启动器）"
      : "ℹ️ 未配置桥接 Token —— 桥接不鉴权（ComfyUI 默认信任模型）";
    probeColor = bridgeToken
      ? "var(--dsw-alias-state-error-primary,#f85149)"
      : "var(--dsw-alias-state-warn-primary,#d29922)";
  }

  return React.createElement("div", { style: rowStyle },
    React.createElement("div", { style: titleStyle }, "ComfyUI 画布"),
    React.createElement("label", { style: labelStyle }, "ComfyUI 地址"),
    React.createElement("input", {
      style: inputStyle, value: baseUrl, disabled: !writable,
      spellCheck: false, placeholder: DEFAULT_BASE,
      onChange: function (e) { setField("baseUrl", e.target.value); },
    }),
    React.createElement("label", { style: labelStyle }, "端口（可选，留空用地址里的）"),
    React.createElement("input", {
      style: inputStyle, value: port, disabled: !writable,
      spellCheck: false, placeholder: "8188",
      onChange: function (e) { setField("port", e.target.value === "" ? "" : Number(e.target.value)); },
    }),
    React.createElement("label", { style: labelStyle }, "网络模式"),
    React.createElement("select", {
      style: inputStyle, value: networkMode, disabled: !writable,
      onChange: function (e) { setField("networkMode", e.target.value); },
    },
      React.createElement("option", { value: "loopback" }, "本地回环 (127.0.0.1)"),
      React.createElement("option", { value: "lan" }, "局域网"),
      React.createElement("option", { value: "cloud-selfhosted" }, "云端自部署"),
      React.createElement("option", { value: "saas" }, "托管 SaaS"),
    ),
    React.createElement("label", { style: labelStyle }, "桥接 Token（可选，与 ComfyUI 端 DSH_BRIDGE_TOKEN 一致，留空不鉴权）"),
    React.createElement("input", {
      style: inputStyle, value: bridgeToken, disabled: !writable,
      type: "password", spellCheck: false, autoComplete: "off",
      placeholder: "留空 = 关闭鉴权（同 ComfyUI 默认信任模型）",
      onChange: function (e) { setField("bridgeToken", e.target.value); },
    }),
    React.createElement("label", { style: labelStyle }, "启动命令（启动按钮 / agent 自启）"),
    React.createElement("input", {
      style: inputStyle, value: launchCommand, disabled: !writable,
      spellCheck: false, placeholder: "例如 ComfyUI启动器.bat",
      onChange: function (e) { setField("launchCommand", e.target.value); },
    }),
    React.createElement("label", { style: labelStyle }, "ComfyUI 安装目录（升级 / 启动用，留空则用环境变量）"),
    React.createElement("input", {
      style: inputStyle, value: comfyuiDir, disabled: !writable,
      spellCheck: false, placeholder: "例如 C:\\path\\to\\ComfyUI",
      onChange: function (e) { setField("comfyuiDir", e.target.value); },
    }),
    React.createElement("label", { style: labelStyle }, "项目目录（输出/导出/溯源默认落此；留空用 <工作区>/projects）"),
    React.createElement("input", {
      style: inputStyle, value: projectDir, disabled: !writable,
      spellCheck: false, placeholder: "例如 D:\\AI-Projects（留空 = 工作区 projects/）",
      onChange: function (e) { setField("projectDir", e.target.value); },
    }),
    React.createElement("label", { style: labelStyle }, "右侧面板宽度 (px)（画布宽度 = 总宽 − 右侧面板）"),
    React.createElement("input", {
      style: inputStyle, value: String(railWidth), disabled: !writable,
      type: "number", min: 120, max: 1200, step: 10,
      onChange: function (e) { setField("railWidth", Number(e.target.value)); },
    }),
    probeText ? React.createElement("div", {
      style: { fontSize: "12px", color: probeColor, marginTop: "10px", lineHeight: "1.5" },
    }, probeText) : null,
  );
}

var inject = ["slots", "settingsScope"];

function apply(ctx) {
  var scope = ctx.settingsScope.bind({ namespace: NAMESPACE });
  // 让画布 iframe 使用设置里的地址（并跟随变更）。
  var syncConfig = function () {
    var snap = scope.getSnapshot();
    var v = snap && snap.value;
    var base = v && typeof v.baseUrl === "string" && v.baseUrl
      ? v.baseUrl : DEFAULT_BASE;
    if (v && v.port != null && v.port !== "" && /^\d+$/.test(String(v.port))) {
      base = base.replace(/:\d+$/, "") + ":" + String(v.port);
    }
    activeBase = base;
    var state = canvasState();
    if (state.canvas) {
      var frame = state.canvas.querySelector("iframe");
      if (frame && frame.src !== base) frame.src = base;
      var link = state.canvas.querySelector("a");
      if (link) link.href = base;
    }
    // 实时应用右侧面板宽度（发布 CSS 变量，分屏挤压样式引用）。
    applyRailWidth(v?.railWidth != null ? v.railWidth : DEFAULT_RAIL);
  };
  scope.subscribe(syncConfig);

  // 全局看门狗：保证分屏标记与真实分屏态一致，杜绝 data-dsh-split-on 残留。
  // 挤压规则只在 html[data-dsh-split-on="1"] 时生效；一旦残留打上该属性，
  // 普通对话（未开分屏）也会被压成 rail 宽靠右——"左右距离变了"的根因。
  // 看门狗订阅 settings + 标签切换：只有「存在已开分屏的会话」且「当前在
  // 对话标签」才保留标记；任何其他状态一律移除（组件 effect 清理漏跑也被兜底），
  // 同时强制隐藏画布覆盖层——不隐藏的话 fixed 覆盖层会盖住对话区，
  // 表现为"关分屏后中间还是画布黑底、对话列只剩一条细线"。
  var activeTabLabel = function () {
    var tab = document.querySelector('[role="tab"][aria-selected="true"]');
    return tab ? (tab.textContent || "").trim() : "";
  };
  var enforceSplitMarker = function () {
    var snap = scope.getSnapshot();
    var v = snap && snap.value ? snap.value : {};
    var map = v.splitEnabledBySession || {};
    var anyEnabled = Object.keys(map).some(function (k) { return map[k] === true; });
    var label = activeTabLabel();
    var shouldSplit = anyEnabled && (label === "对话" || label === "Chat");
    // 核心对话列宽度手柄（.widthHandle / data-width-handle）在分屏下必须
    // 强制隐藏：它按对话列宽度计算绝对位置，分屏挤压后位置乱跳，可能落到
    // 画布上或输入框上。JS 直接改内联样式，不依赖 CSS 注入时序；分屏关闭
    // 时恢复空值（CSS module 控制其平时显隐），普通对话不受影响。
    var handles = document.querySelectorAll('[data-width-handle]');
    for (var i = 0; i < handles.length; i++) {
      if (shouldSplit) {
        handles[i].style.display = "none";
      } else {
        handles[i].style.display = "";
      }
    }
    if (!shouldSplit) {
      document.documentElement.removeAttribute("data-dsh-split-on");
      document.documentElement.removeAttribute("data-dsh-rail-closed");
      var canvas = canvasState();
      // display:none 连子元素带 iframe 一起隐藏（visibility 会被 iframe 的
      // visible 穿透，导致画布残留）。
      if (canvas.canvas) canvas.canvas.style.display = "none";
    }
  };
  var splitWatchdog = null;
  scope.subscribe(enforceSplitMarker);
  if (typeof MutationObserver === "function") {
    splitWatchdog = new MutationObserver(enforceSplitMarker);
    splitWatchdog.observe(
      document.body,
      { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected"] },
    );
  }
  // 首次立即执行一次（页面刚加载时若 settings 里残留了分屏开关，标签栏
  // 还没渲染 aria-selected，anyEnabled=true 时按保守逻辑暂不清理；真正打开
  // 对话视图后由上方订阅再次触发，两相覆盖）。
  enforceSplitMarker();
  syncConfig();

  // 窄视口自动退出分屏（验收第 6 条）：视口 < 1200px 时若存在已开分屏的
  // 会话则全部强制关闭——rail 占 360px 后画布剩余空间太小，对话被挤死。
  // 只在「宽→窄」跳变瞬间动作一次（narrowWas 记状态），拉宽后用户可再
  // 手动开；settings 写入异步，先同步清理 DOM 标记与画布，避免残留。
  var narrowQuery = typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 1199px)")
    : null;
  var narrowWas = false;
  var onNarrow = function () {
    var now = narrowQuery ? narrowQuery.matches : (window.innerWidth < 1200);
    if (now && !narrowWas) {
      var snap = scope.getSnapshot();
      var v = snap && snap.value ? snap.value : {};
      var map = v.splitEnabledBySession || {};
      var anyEnabled = Object.keys(map).some(function (k) { return map[k] === true; });
      if (anyEnabled) {
        var cleared = {};
        for (var k in map) cleared[k] = false;
        scope.set("splitEnabledBySession", cleared).catch(function () { /* recover handled by scope */ });
        // 同步清理 DOM，避免 settings 异步落地前挤压样式/画布残留。
        document.documentElement.removeAttribute("data-dsh-split-on");
        document.documentElement.removeAttribute("data-dsh-rail-closed");
        var canvas = canvasState();
        if (canvas.canvas) canvas.canvas.style.display = "none";
        var handles = document.querySelectorAll('[data-width-handle]');
        for (var i = 0; i < handles.length; i++) handles[i].style.display = "";
      }
    }
    narrowWas = now;
  };
  if (narrowQuery && typeof narrowQuery.addEventListener === "function") {
    narrowQuery.addEventListener("change", onNarrow);
    onNarrow();
  } else {
    window.addEventListener("resize", onNarrow);
    onNarrow();
  }

  // 分屏挤压样式 + ComfyUI 画布标签全屏样式（注入一次，用 html 属性开关）：
  // 只认核心的 data-* 锚点与插件自己的 CSS 变量，不碰 hash 类名。
  // - data-dsh-split-on：scrollBody 被压成 rail 宽并靠右，composerSeat 跟随其内
  // - data-dsh-comfyui-fullscreen：ComfyUI 画布标签全屏，隐藏常驻 composer
  //   （ConversationRoot 的 composerSeat 不随视图切换消失，需插件隐藏）
  var splitStyleId = "dsh-comfyui-canvas-split-layout";
  if (!document.getElementById(splitStyleId)) {
    var splitStyle = document.createElement("style");
    splitStyle.id = splitStyleId;
    splitStyle.textContent = [
      'html[data-dsh-split-on="1"] [data-conversation-scroll] {',
      '  width: var(--dsh-comfyui-rail-width, 360px) !important;',
      '  margin-left: auto !important;',
      // 核心消息列/输入框宽度都读 --dsh-chat-content-width（ConversationRoot
      // 按整列计算，最低 680px）；分屏压窄后必须覆盖为 rail 宽减留白，
      // 否则 680px+ 的内容塞进窄 rail 会横向溢出出滚动条。
      '  --dsh-chat-content-width: calc(var(--dsh-comfyui-rail-width, 360px) - 32px) !important;',
      // 兜底：极端内容（超宽代码块/表格）也横向隐藏而非撑出滚动条。
      '  overflow-x: hidden !important;',
      '}',
      'html[data-dsh-split-on="1"] [data-composer-seat] {',
      '  width: var(--dsh-comfyui-rail-width, 360px) !important;',
      '  margin-left: auto !important;',
      '}',
      // 分屏 rail 收窄后隐藏 token 统计栏（StatsLine，注册在
      // conversation.composer.dock 槽）——窄 rail 里它挤占空间且难读。
      'html[data-dsh-split-on="1"] [data-slot="conversation.composer.dock"] {',
      '  display: none !important;',
      '}',
      // 分屏时隐藏核心对话列宽度调节手柄（data-width-handle，平时透明、
      // hover 高亮）——分屏 rail 宽度由插件的 railWidth 控制，核心手柄
      // 反而会落在 rail 内贴近输入框，挡交互且无意义。
      'html[data-dsh-split-on="1"] [data-width-handle] {',
      '  display: none !important;',
      '}',
      // 折叠对话 rail：整个对话滚动区 + 输入框隐藏（display:none 让 scrollBody
      // 宽度归零，positionSplit 据此把画布覆盖层铺满整个对话列）。
      'html[data-dsh-split-on="1"][data-dsh-rail-closed="1"] [data-conversation-scroll],',
      'html[data-dsh-split-on="1"][data-dsh-rail-closed="1"] [data-composer-seat] {',
      '  width: 0 !important;',
      '  margin-left: auto !important;',
      '  overflow: hidden !important;',
      '}',
    ].join("\n");
    document.head.appendChild(splitStyle);
  }

  // 设置导航图标（非侵入式）：注入替换 CSS + 按 label 标记自己的导航行。
  // 用 ctx.effect 包装，插件重载/卸载时自动 dispose，HMR 安全。
  var settingsLabel = function () { return "ComfyUI 画布"; };
  if (ctx.effect) {
    ctx.effect(function () {
      injectSettingsNavIconStyles();
      return registerSettingsNavIcon(settingsLabel);
    }, "dsh-comfyui-canvas: settings navigation icon");
  } else {
    injectSettingsNavIconStyles();
    registerSettingsNavIcon(settingsLabel);
  }

  // 分屏入口（唯一）：会话标头右侧 utilities 槽（官方 0.1.2 原生插槽）。
  // 不注册 conversation.view 条目——会话标签栏不再有 ComfyUI 标签，画布只在
  // 分屏开启时出现（点本按钮 = 画布左 + 对话 rail 右）。布局完全由插件
  // 覆盖层 + data-* 挤压实现。
  ctx.slots.inject("conversation.session.header.utilities", function () {
    return ctx.slots.register({
      name: "conversation.session.header.utilities",
      id: "comfyui-canvas-split-toggle",
      order: 20,
      label: function () { return "ComfyUI"; },
      inject: function (sessionId) { return { sessionId: String(sessionId), scope: scope }; }
    }, ComfyUISplitToggle);
  });

  ctx.slots.inject("settings.section", function () {
    return ctx.slots.register({
      name: "settings.section",
      id: "comfyui-canvas",
      order: 40,
      label: settingsLabel,
      inject: function () { return { scope: scope }; },
    }, ComfyUISettingsRow);
  });
}

module.exports = { apply: apply, inject: inject };
return module.exports; } });