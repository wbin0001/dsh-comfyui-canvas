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
function setSessionView(sc, sessionId, mode) {
  var snap = sc.getSnapshot ? sc.getSnapshot() : null;
  var value = snap && snap.value ? snap.value : {};
  var map = {};
  var current = value.activeViewBySession;
  if (current && typeof current === "object") {
    for (var k in current) map[k] = current[k];
  }
  map[String(sessionId)] = mode;
  sc.set("activeViewBySession", map).catch(function () {});
}

function buildCanvas() {
  var outer = document.createElement("div");
  outer.style.cssText = "position:fixed;visibility:hidden;z-index:40;display:flex;flex-direction:column;overflow:hidden;background:#1e1e1e;";

  var bar = document.createElement("div");
  bar.style.cssText = "flex:none;display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid rgba(128,128,128,.25);font-size:13px;color:#e8e8e8;background:#202024;";
  var title = document.createElement("strong");
  title.textContent = "ComfyUI";
  var link = document.createElement("a");
  link.textContent = "在新标签页打开 ↗";
  link.href = activeBase;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.style.cssText = "margin-left:auto;color:#8ab4f8;text-decoration:none;font-size:12px;";
  bar.appendChild(title);
  bar.appendChild(link);

  var frame = document.createElement("iframe");
  frame.src = activeBase;
  frame.title = "ComfyUI 画布";
  frame.setAttribute("allow", "clipboard-read; clipboard-write; fullscreen");
  // 不让 DSH 的 URL 作为 referrer 泄漏给 ComfyUI（其地址可被配置为局域网/云）。
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.style.cssText = "flex:1 1 0;min-height:0;width:100%;border:0;display:block;background:#1e1e1e;";

  outer.appendChild(bar);
  outer.appendChild(frame);
  document.body.appendChild(outer);
  return outer;
}

// 对齐宿主视图区并显示；宿主宽高为 0（未渲染）时保持隐藏。
function positionAt(host, outer) {
  var rect = host.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) {
    outer.style.visibility = "hidden";
    return false;
  }
  outer.style.left = rect.left + "px";
  outer.style.top = rect.top + "px";
  outer.style.width = rect.width + "px";
  outer.style.height = rect.height + "px";
  outer.style.visibility = "visible";
  return true;
}

// 把 rail 宽度实时应用到分屏对话栏。
// 注意：CSS module 类名是 hash 的（如 _1Hmdja_splitRail），不能写死 `.splitRail`，
// 必须用属性包含匹配 + 标签过滤（主 rail 是 <aside>，其子块是 <div>）。
function applyRailWidth(width) {
  var w = Number(width);
  if (!(w >= 120 && w <= 1200)) w = DEFAULT_RAIL;
  var all = document.querySelectorAll('[class*="splitRail"]');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.tagName === "ASIDE") {
      el.style.width = w + "px";
      el.style.flex = "none";
    }
  }
}

// 把分屏 rail 的图片预览并入输入框内部：rail composer 默认把图片区
// （splitRailImages）渲染在 textarea 上方、是独立 flex 子项，视觉上图片
// 在输入框外面。这里注入 CSS 把整个 composer 变成一个带边框的输入容器，
// 图片 chip 和 textarea 都在同一个框内。CSS module 类名是 hash 的，用
// 属性包含匹配命中可读段（与 applyRailWidth 同样的手法）。
function injectRailComposerStyles() {
  var styleId = "dsh-comfyui-canvas-rail-composer";
  if (document.getElementById(styleId)) return;
  var style = document.createElement("style");
  style.id = styleId;
  style.textContent = [
    '[class*="splitRailComposer"] {',
    '  position: relative !important;',
    '  border: 1px solid var(--dsw-alias-border-l2, #3a3a40) !important;',
    '  border-radius: 10px;',
    '  background: var(--dsw-alias-bg-field, #1f1f23);',
    // 核心注释：rail 右侧 gap 天生比左侧宽约 8px，原始 padding 左12右5 就是
    // 为了补偿。我们覆盖成面板后必须保留这个补偿：右侧 margin 收窄，否则
    // 面板右边缘到侧边栏的距离会明显比左侧宽。
    '  margin: 0 2px 8px 8px;',
    '  padding: 8px 8px 38px 8px;',
    '}',
    // send 按钮从 inputWrap 内部定位提升到 composer 面板：inputWrap 改 static、
    // composer 已设 relative，send 的 absolute 基准就变成面板本身 → 落在真正
    // 的右下角红框处，而不是 textarea 的右下角。
    '[class*="splitRailInputWrap"] {',
    '  position: static !important;',
    '}',
    // textarea 保持透明无边框（面板即边框），并去掉聚焦时的白色高亮外框。
    '[class*="splitRailInputWrap"] [class*="splitRailInput"] {',
    '  border: none !important;',
    '  background: transparent !important;',
    '  box-shadow: none !important;',
    '  outline: none !important;',
    '}',
    '[class*="splitRailInputWrap"] [class*="splitRailInput"]:focus,',
    '[class*="splitRailInputWrap"] [class*="splitRailInput"]:focus-visible {',
    '  outline: none !important;',
    '  border: none !important;',
    '  box-shadow: none !important;',
    '}',
    '[class*="splitRailComposer"] [class*="splitRailSend"] {',
    '  position: absolute !important;',
    '  right: 8px !important;',
    '  bottom: 8px !important;',
    '}',
  ].join("\n");
  document.head.appendChild(style);
}

// 在 rail 图片预览处注入「+」号：点它选本地图片，走 DSH 官方附件通道
// （构造 paste 事件派发到 rail 的 textarea，其 onPaste 会调用 addDraftImages）。
// 「+」号放在 .splitRailImages（flex-wrap 图片区）末尾，有图时自动跟随、
// 多图自动向后移；无图时置于 composer 顶部同一行。MutationObserver 跟随
// rail 重渲染时图片区的出现/消失。
function injectRailComposerPlus() {
  var plusId = "dsh-comfyui-canvas-rail-plus";
  if (document.getElementById(plusId)) return;

  var fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp,image/gif";
  fileInput.multiple = true;
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  var plus = document.createElement("button");
  plus.id = plusId;
  plus.type = "button";
  plus.textContent = "+";
  plus.title = "添加图片";
  plus.setAttribute("aria-label", "添加图片");
  plus.style.cssText = [
    "flex:none;width:28px;height:28px;border:1px dashed var(--dsw-alias-border-l2,#3a3a40);",
    "border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#9a9aa2);",
    "cursor:pointer;font-size:16px;line-height:1;display:grid;place-items:center;margin:2px 0;",
  ].join("");

  fileInput.addEventListener("change", function () {
    var files = Array.prototype.slice.call(fileInput.files || []);
    fileInput.value = "";
    if (files.length === 0) return;
    var composer = document.querySelector('[class*="splitRailComposer"]');
    var textarea = composer ? composer.querySelector("textarea") : null;
    if (!textarea) return;
    var dt = new DataTransfer();
    for (var i = 0; i < files.length; i++) dt.items.add(files[i]);
    var evt = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    textarea.dispatchEvent(evt);
  });

  plus.addEventListener("click", function () { fileInput.click(); });

  var place = function () {
    var composer = document.querySelector('[class*="splitRailComposer"]');
    if (!composer) return;
    var images = composer.querySelector('[class*="splitRailImages"]');
    if (images) {
      // 有图：跟随图片区末尾，恢复静态布局（去掉绝对定位）。
      plus.style.position = "";
      plus.style.left = "";
      plus.style.bottom = "";
      // React 不认识手动插入的「+」号：新增图片时会 append 到图片区末尾
      // （落在「+」号后面），所以只要「+」不是容器最后一个子节点就移到末尾，
      // 保证顺序永远是 [图…][+]。
      if (plus.parentNode !== images || images.lastElementChild !== plus) {
        images.appendChild(plus);
      }
    } else {
      // 无图：「+」号绝对定位到面板左下角，与右下角的发送按钮同一水平线。
      plus.style.position = "absolute";
      plus.style.left = "8px";
      plus.style.bottom = "8px";
      if (plus.parentNode !== composer) composer.appendChild(plus);
    }
  };

  place();
  var observer = new MutationObserver(function () { place(); });
  observer.observe(document.body, { childList: true, subtree: true });
}

// 分屏画布视图下 DSH 核心不渲染 conversation.composer 链条，授权弹窗
// 永远不会出现。这里由插件自己渲染：读会话 pending 里的 approval 项，
// 覆盖在画布上，允许一次 / 拒绝，通过 wait.respond 回传。
function ComfyUIApprovalOverlay(props) {
  var wait = props.wait;
  var payload = wait && wait.payload ? wait.payload : {};
  var answered = React.useState(false);
  var isAnswered = answered[0];
  var setAnswered = answered[1];

  function answer(outcome) {
    if (isAnswered || !wait) return;
    setAnswered(true);
    var value = {
      sessionId: wait.sessionId,
      approvalId: payload.approvalId,
      outcome: outcome,
    };
    wait.respond({ ok: true, value: value }).then(
      function () { /* resolved frame 会自动把它从 pending 移除 */ },
      function () { setAnswered(false); },
    );
  }

  var wrapStyle = {
    // 绝对定位于 host 内部（host 为 relative）：只盖画布视图区，不再整屏
    // fixed 遮挡顶部会话标签栏，待审批时仍可切换会话标签。
    position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
    zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(0,0,0,0.35)", padding: "24px",
  };
  var cardStyle = {
    width: "min(520px, 100%)", maxHeight: "80%", overflow: "auto",
    background: "var(--dsw-alias-bg-base, #202024)", color: "var(--dsw-alias-label-primary, #e8e8e8)",
    border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25))",
    borderRadius: "12px", boxShadow: "0 8px 32px rgba(0,0,0,.4)", fontFamily: "inherit",
  };
  var stripStyle = {
    display: "flex", alignItems: "center", gap: "8px",
    padding: "10px 14px", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25))",
    fontSize: "13px", fontWeight: "600", color: "#b8860b",
  };
  var bodyStyle = { padding: "14px", fontSize: "13px", lineHeight: 1.6 };
  var headStyle = { fontSize: "14px", fontWeight: "600", marginBottom: "8px", whiteSpace: "pre-wrap", wordBreak: "break-word" };
  var subStyle = { color: "var(--dsw-alias-label-secondary, #9a9aa2)", marginBottom: "12px", wordBreak: "break-word" };
  var actionStyle = {
    display: "flex", gap: "10px", justifyContent: "flex-end",
    padding: "0 14px 14px",
  };
  var btnBase = {
    border: "none", borderRadius: "8px", padding: "8px 16px", fontSize: "13px",
    fontWeight: "600", cursor: "pointer",
  };

  return React.createElement("div", { style: wrapStyle },
    React.createElement("div", { style: cardStyle },
      React.createElement("div", { style: stripStyle },
        React.createElement("span", { style: { width: 8, height: 8, borderRadius: "50%", background: "#b8860b", display: "inline-block" } }),
        "等待审批",
      ),
      React.createElement("div", { style: bodyStyle },
        React.createElement("div", { style: headStyle },
          payload.reason || ("工具 " + (payload.toolName || "未知") + " 请求越权执行"),
        ),
        payload.toolName && React.createElement("div", { style: subStyle }, "工具：" + payload.toolName),
      ),
      React.createElement("div", { style: actionStyle },
        React.createElement("button", {
          style: Object.assign({}, btnBase, {
            background: "transparent", color: "var(--dsw-alias-label-secondary, #9a9aa2)",
            border: "1px solid var(--dsw-alias-border-l2, #3a3a40)",
          }),
          disabled: isAnswered,
          onClick: function () { answer("rejected"); },
        }, "拒绝"),
        React.createElement("button", {
          style: Object.assign({}, btnBase, {
            background: "var(--dsw-alias-state-business-primary, #3b82f6)", color: "#fff",
          }),
          disabled: isAnswered,
          onClick: function () { answer("allowed-once"); },
        }, "允许一次"),
      ),
    ),
  );
}

// ComfyUI 控制条（始终存在，不再整屏遮挡、也不在检测到运行时消失）：
// - 离线/检测中：居中启动卡片，仅覆盖画布视图区（绝对定位于 host 内），
//   不遮挡顶部会话标签栏，可正常切换会话标签。
// - 在线：右上角绿色状态提示，常驻可见（重启交由智能体/画布内节点处理）。
function ComfyUIControl(props) {
  var online = props.online;
  // 离线/检测中的启动卡片仍需要这两个：starting 控制按钮文案/禁用态，
  // onStart 触发启动。在线分支不渲染它们，但声明在顶部供离线分支使用。
  var starting = props.starting === true;
  var onStart = props.onStart;

  // 在线：左上角状态条（绝对定位于 host 内，不挡标签栏/右侧工具栏）。
  if (online === true) {
    var chipStyle = {
      position: "absolute", top: "8px", left: "8px", zIndex: 79,
      display: "flex", alignItems: "center", gap: "8px",
      padding: "5px 10px", borderRadius: "8px",
      background: "var(--dsw-alias-bg-base, #202024)",
      color: "var(--dsw-alias-label-primary, #e8e8e8)",
      border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25))",
      fontSize: "12px", fontFamily: "inherit",
    };
    return React.createElement("div", { style: chipStyle },
      React.createElement("span", { style: { width: "8px", height: "8px", borderRadius: "50%", background: "#22c55e", display: "inline-block" } }),
      "ComfyUI 运行中",
    );
  }

  // 离线/检测中：居中启动卡片。
  var wrapStyle = {
    position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
    zIndex: 79, display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(0,0,0,0.45)", padding: "24px",
  };
  var cardStyle = {
    width: "min(460px, 100%)", padding: "20px",
    background: "var(--dsw-alias-bg-base, #202024)", color: "var(--dsw-alias-label-primary, #e8e8e8)",
    border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25))",
    borderRadius: "12px", boxShadow: "0 8px 32px rgba(0,0,0,.4)", fontFamily: "inherit",
  };
  var btnStyle = {
    border: "none", borderRadius: "8px", padding: "10px 18px", fontSize: "13px",
    fontWeight: "600", cursor: "pointer",
    background: "var(--dsw-alias-state-business-primary, #3b82f6)", color: "#fff",
  };
  var detecting = online === null;
  return React.createElement("div", { style: wrapStyle },
    React.createElement("div", { style: cardStyle },
      React.createElement("div", { style: { fontSize: "14px", fontWeight: 600, marginBottom: "8px" } }, "ComfyUI 未启动"),
      React.createElement("div", { style: { fontSize: "13px", color: "var(--dsw-alias-label-secondary, #9a9aa2)", lineHeight: 1.6, marginBottom: "16px" } },
        "检测到 ComfyUI 服务未运行。点击下方按钮会用设置里的「启动命令」后台拉起 ComfyUI，启动完成后画布自动加载。"
      ),
      React.createElement("button", {
        style: btnStyle, disabled: starting || detecting,
        onClick: function () { if (onStart) onStart(); },
      }, starting ? "正在启动…" : detecting ? "检测中…" : "启动 ComfyUI"),
    ),
  );
}

function ComfyUICanvasView(props) {
  var sessionId = String(props.sessionId ?? "root");
  var rootRef = React.useRef(null);
  // 读取当前会话的 pending 授权项：DSH 核心在分屏布局下不渲染
  // conversation.composer 链条（授权弹窗所在），这里由画布视图自己接管。
  // useSession 由 runtime 作为 session-scope 标准 props 注入。
  var pending = typeof props.useSession === "function"
    ? (props.useSession(function (s) { return s && s.pending ? s.pending : []; }) || [])
    : [];
  var approval = null;
  for (var i = 0; i < pending.length; i++) {
    if (pending[i] && pending[i].kind === "approval") { approval = pending[i]; break; }
  }
  // 上报当前激活视图：本组件在 ComfyUI 分屏画布标签激活时才被渲染，
  // 挂载 = 用户正看着画布，卸载 = 切回普通对话。写入共享 settings 里
  // 按会话 id 的映射 activeViewBySession（只改自己的 sessionId 键），
  // host 端 comfyui_config 工具据此让 agent 感知画布专注模式，且会话隔离。
  React.useEffect(function () {
    var sc = props.scope;
    if (sc && typeof sc.set === "function") {
      setSessionView(sc, sessionId, "canvas");
    }
    return function () {
      if (sc && typeof sc.set === "function") {
        setSessionView(sc, sessionId, "chat");
      }
    };
  }, [sessionId]);
  React.useEffect(function () {
    var host = rootRef.current;
    if (!host) return;
    var state = canvasState();
    if (!state.canvas) state.canvas = buildCanvas();
    var outer = state.canvas;
    var observer = null;
    positionAt(host, outer);
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(function () {
        if (host.isConnected) positionAt(host, outer);
      });
      observer.observe(host);
    }
    return function () {
      if (observer) observer.disconnect();
      outer.style.visibility = "hidden";
    };
  }, [sessionId]);

  // ComfyUI 可达性检测：每隔几秒探一下。注意用 mode:'no-cors' —— DSH 页面
  // (127.0.0.1:3080) 跨域探测 ComfyUI (127.0.0.1:8188) 会被 CORS 拦截，no-cors
  // 只要服务可达就 resolve（opaque），不可达才 reject，适合纯可达性探测。
  var onlineState = React.useState(null); // null=检测中, true=在线, false=离线
  var online = onlineState[0];
  var setOnline = onlineState[1];
  React.useEffect(function () {
    var stopped = false;
    var timer = null;
    var probe = function () {
      fetch(activeBase + "/system_stats", { method: "GET", mode: "no-cors", signal: AbortSignal.timeout(2500) })
        .then(function () {
          if (stopped) return;
          setOnline(true);
          setStarting(false); // 服务已可达，清掉"正在启动"态
        })
        .catch(function () { if (!stopped) setOnline(false); });
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
  var requestLaunch = function () {
    var sc = props.scope;
    if (!sc || typeof sc.set !== "function") return;
    setStarting(true);
    sc.set("launchRequested", true).catch(function () {
      setStarting(false);
    });
  };

  // 控制条常驻：离线显示启动卡片、在线显示右上角状态提示。
  // 渲染在 host 内部（host 为 relative），绝对定位只覆盖画布视图区，
  // 不再整屏 fixed 遮挡顶部会话标签栏，可正常切换会话标签。
  // 重启不做 UI 按钮——由智能体在画布内通过自定义节点操作。
  var control = React.createElement(ComfyUIControl, {
    online: online, starting: isStarting, onStart: requestLaunch,
  });
  // 授权弹窗渲染在 host 内部（与控制条同级），absolute 定位锚定 host 的
  // relative 边界 → 只盖画布视图区，不会挡住顶栏/右侧 rail。
  var hostChildren = [control];
  if (approval) {
    hostChildren.push(React.createElement(ComfyUIApprovalOverlay, { wait: approval }));
  }
  var hostEl = React.createElement("div", {
    ref: rootRef, style: { flex: "1 1 0", minHeight: 0, minWidth: 0, position: "relative" },
  }, hostChildren);
  return hostEl;
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
  var writable = !snapshot || snapshot.writable !== false;

  var inputStyle = {
    width: "100%", boxSizing: "border-box", background: "#1f1f23", color: "#e8e8e8",
    border: "1px solid #3a3a40", borderRadius: "6px", padding: "6px 8px",
    fontSize: "13px", fontFamily: "inherit", marginTop: "4px",
  };
  var labelStyle = { fontSize: "12px", color: "#9a9aa2", marginTop: "10px", display: "block" };
  var rowStyle = { padding: "12px", display: "flex", flexDirection: "column", gap: "2px" };
  var titleStyle = { fontSize: "13px", fontWeight: "600" };

  function setField(field, raw) {
    if (!writable || !scope.set) return;
    var next = raw === "" ? null : raw;
    scope.set(field, next).catch(function () { /* recover handled by scope */ });
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
      spellCheck: false, placeholder: "例如 E:\\AI-ComfyUI\\ComfyUI_windows_portable\\ComfyUI",
      onChange: function (e) { setField("comfyuiDir", e.target.value); },
    }),
    React.createElement("label", { style: labelStyle }, "右侧面板宽度 (px)（画布宽度 = 总宽 − 右侧面板）"),
    React.createElement("input", {
      style: inputStyle, value: String(railWidth), disabled: !writable,
      type: "number", min: 120, max: 1200, step: 10,
      onChange: function (e) { setField("railWidth", Number(e.target.value)); },
    }),
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
    // 实时应用右侧面板宽度。
    applyRailWidth(v?.railWidth != null ? v.railWidth : DEFAULT_RAIL);
  };
  scope.subscribe(syncConfig);
  syncConfig();

  // 分屏 rail 图片预览并入输入框内部（CSS 覆盖，不动 DSH 核心）。
  injectRailComposerStyles();
  // rail 图片预览处注入「+」号（选本地图片，走 DSH 官方附件通道）。
  injectRailComposerPlus();

  ctx.slots.inject("conversation.view", function () {
    return ctx.slots.register({
      name: "conversation.view",
      id: "comfyui-canvas",
      order: 30,
      label: function () { return "ComfyUI"; },
      meta: { split: true },
      inject: function (sessionId) { return { sessionId: String(sessionId), scope: scope }; }
    }, ComfyUICanvasView);
  });

  ctx.slots.inject("settings.section", function () {
    return ctx.slots.register({
      name: "settings.section",
      id: "comfyui-canvas",
      order: 40,
      label: function () { return "ComfyUI 画布"; },
      inject: function () { return { scope: scope }; },
    }, ComfyUISettingsRow);
  });
}

module.exports = { apply: apply, inject: inject };
return module.exports; } });