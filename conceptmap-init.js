/* =============================================================================
 * conceptmap-init.js  —  概念地图渲染器（固定模板层）
 * -----------------------------------------------------------------------------
 * 用法（Markdeep 风格）：在一个 .html 文件里放入概念地图 JSON，再加一行
 *
 *     <script type="application/json" id="conceptmap-data"> { ...JSON... } </script>
 *     <script src="conceptmap-init.js"></script>
 *
 * 浏览器打开即渲染。所有渲染逻辑、配色、布局都固化在本文件里，
 * AI 每次只需产出 JSON 数据，无需改动本文件。
 * =========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------------------------
   * 1. 配色方案（节点 type → 渐变色 / 边框 / 文字色）
   *    AI 输出的 node.data.type 命中下表的某个 key 即采用对应配色，
   *    未命中则回退到 "default"。
   * ------------------------------------------------------------------------- */
  // Flexoki 配色（单色平涂）：bg=accent-100 浅底，border=accent-600 标识色，text=accent-900 深字。
  // key 为焦点，用 red-600 实心 + paper 文字突出。日夜共用一套。
  var PALETTE = {
    key:     { bg: "#db7c77", border: "#942822", text: "#FFFCF0" },
    blue:    { bg: "#C6DDE8", border: "#205EA6", text: "#12253B" },
    green:   { bg: "#DDE2B2", border: "#66800B", text: "#252D09" },
    purple:  { bg: "#E2D9E9", border: "#5E409D", text: "#261C39" },
    orange:  { bg: "#FED3AF", border: "#BC5215", text: "#40200D" },
    red:     { bg: "#FFCABB", border: "#AF3029", text: "#3E1715" },
    pink:    { bg: "#FCCFDA", border: "#A02F6F", text: "#39172B" },
    teal:    { bg: "#BFE8D9", border: "#24837B", text: "#122F2C" },
    yellow:  { bg: "#F6E2A0", border: "#AD8301", text: "#3A2D04" },
    gray:    { bg: "#E6E4D9", border: "#878580", text: "#282726" },
    default: { bg: "#DAD8CE", border: "#6F6E69", text: "#282726" }
  };
  function pal(type) { return PALETTE[type] || PALETTE.default; }

  var DOWN_COLOR  = "#1098AD";        // 后代路径高亮色（青色，日夜通用）

  // 字号常量：CSS 渲染层与 SVG 导出层共用，改这里即同步生效。
  var FONT_SIZES = {
    keyTitle: 30, keyDesc: 15,
    title: 30,    desc: 15,
    edge: 30,
    tooltip: 20
  };

  /* 边的外观设置：线宽与荧光（光晕）。改这里即全局生效。
     width 为基础边宽，交叉边按 ×1.5、高亮边按 ×1.8 比例同步加粗；
     glow 开启后在边四周渲染一圈与边同色的光晕（cytoscape underlay 实现）。 */
  var EDGE = {
    width: 4,           // 基础边宽（px）
    glow: true,         // 边荧光：是否在边周围展示同色光晕
    glowPadding: 6,     // 荧光向外扩散的半径（px）
    glowOpacity: 0.45   // 荧光强度（0–1，越大越亮）
  };
  var EDGE_CROSS_RATIO = 1.5;   // 交叉边相对基础边的宽度倍率
  var EDGE_HL_RATIO    = 1.8;   // 高亮边相对基础边的宽度倍率

  // 荧光带（underlay）的强度/范围片段；关闭时显式置 0（便于运行时实时开关）。
  function glowBand() {
    return { "underlay-padding": EDGE.glowPadding, "underlay-opacity": EDGE.glow ? EDGE.glowOpacity : 0 };
  }
  /* ---------------------------------------------------------------------------
   * 1b. 可调数值参数 → 设置面板（滑块）。出厂默认在任何 localStorage 覆盖前快照，
   *     供"重置"使用。schema 描述每个参数的取值范围与生效方式。
   * ------------------------------------------------------------------------- */
  var FONT_DEFAULTS = Object.assign({}, FONT_SIZES);
  var EDGE_DEFAULTS  = Object.assign({}, EDGE);

  // apply 字段：nodefont=改卡片字号(需重测高度)，tooltip=改气泡字号，edge=改连线度量
  var SETTINGS_SCHEMA = [
    { grp: "节点字号" },
    { obj: "font", key: "keyTitle", label: "焦点标题", min: 12, max: 48, step: 1, apply: "nodefont" },
    { obj: "font", key: "title",    label: "节点标题", min: 12, max: 48, step: 1, apply: "nodefont" },
    { obj: "font", key: "keyDesc",  label: "焦点描述", min: 8,  max: 32, step: 1, apply: "nodefont" },
    { obj: "font", key: "desc",     label: "节点描述", min: 8,  max: 32, step: 1, apply: "nodefont" },
    { grp: "其它字号" },
    { obj: "font", key: "edge",     label: "连线标签", min: 10, max: 48, step: 1, apply: "edge" },
    { obj: "font", key: "tooltip",  label: "悬浮提示", min: 10, max: 36, step: 1, apply: "tooltip" },
    { grp: "连线" },
    { obj: "edge", key: "width",       label: "边宽",     min: 1, max: 16, step: 0.5,  apply: "edge" },
    { obj: "edge", key: "glow",        label: "荧光",     type: "toggle",              apply: "edge" },
    { obj: "edge", key: "glowOpacity", label: "荧光强度", min: 0, max: 1,  step: 0.05, apply: "edge" },
    { obj: "edge", key: "glowPadding", label: "荧光范围", min: 0, max: 30, step: 1,    apply: "edge" }
  ];
  function settingsObj(o) { return o === "edge" ? EDGE : FONT_SIZES; }

  // 把持久化的参数合并进 FONT_SIZES / EDGE（须在 injectCSS / buildStyle 之前调用）
  function loadSettings() {
    var raw; try { raw = JSON.parse(localStorage.getItem("cm-settings") || "{}"); } catch (e) { raw = {}; }
    if (raw && raw.font) Object.keys(raw.font).forEach(function (k) {
      if (k in FONT_SIZES && typeof raw.font[k] === "number") FONT_SIZES[k] = raw.font[k];
    });
    if (raw && raw.edge) Object.keys(raw.edge).forEach(function (k) {
      var t = typeof raw.edge[k];
      if (k in EDGE && (t === "number" || t === "boolean")) EDGE[k] = raw.edge[k];
    });
  }
  function saveSettings() {
    try {
      localStorage.setItem("cm-settings", JSON.stringify({
        font: FONT_SIZES,
        edge: { width: EDGE.width, glow: EDGE.glow, glowPadding: EDGE.glowPadding, glowOpacity: EDGE.glowOpacity }
      }));
    } catch (e) {}
  }

  // 卡片/气泡字号走一段动态 CSS（替换 textContent，不累积规则）；注入在主样式之后即可覆盖默认值。
  var _fontStyleEl = null;
  function applyFontCSS() {
    if (!_fontStyleEl) {
      _fontStyleEl = document.createElement("style");
      _fontStyleEl.id = "cm-dyn-font";
      document.head.appendChild(_fontStyleEl);
    }
    _fontStyleEl.textContent =
      ".cm-node.cm-key .cm-t{font-size:" + FONT_SIZES.keyTitle + "px;}" +
      ".cm-node.cm-key .cm-d{font-size:" + FONT_SIZES.keyDesc + "px;}" +
      ".cm-node .cm-t{font-size:" + FONT_SIZES.title + "px;}" +
      ".cm-node .cm-d{font-size:" + FONT_SIZES.desc + "px;}" +
      "#cm-tip{font-size:" + FONT_SIZES.tooltip + "px;}";
  }

  // 字号变化后重测各节点卡片高度（宽度固定），并按当前"描述显隐"状态设置 _h。
  function remeasureNodes(cy, showDesc) {
    cy.nodes().forEach(function (n) {
      var d = n.data();
      var full = measureNode(d);
      var min  = measureNode(Object.assign({}, d, { desc: "" }));
      n.data("_w", full.w);
      n.data("_hFull", full.h);
      n.data("_hMin", min.h);
      n.data("_h", showDesc ? full.h : min.h);
    });
  }

  /* 主题相关的边/标签颜色（Flexoki base 中性色系；节点卡片配色日夜共用，见 PALETTE）。
     页面其余 UI 颜色走 CSS 变量，见 injectCSS。 */
  var THEMES = {
    dark:  { edgeLine: "#878580", edgeText: "#CECDC3", edgeLabelBg: "#1C1B1A", hl: "#DFB431" },
    light: { edgeLine: "#6F6E69", edgeText: "#403E3C", edgeLabelBg: "#FFFCF0", hl: "#205EA6" }
  };

  function loadTheme(def) {
    try { var t = localStorage.getItem("cm-theme"); if (t === "light" || t === "dark") return t; } catch (e) {}
    return (def === "light" || def === "dark") ? def : "dark";
  }
  function saveTheme(t) { try { localStorage.setItem("cm-theme", t); } catch (e) {} }

  // 节点固定宽度（文字在此宽度内自动换行），高度按内容实测
  var NODE_W      = { key: 210, other: 184 };
  var NODE_MIN_H  = { key: 84,  other: 60  };

  /* 用一个隐藏元素实测卡片在固定宽度下换行后的高度，
     使节点尺寸恰好包住文字，既不裁剪也不留大片空白。 */
  var _meas = null;
  function measureNode(d) {
    if (!_meas) {
      _meas = document.createElement("div");
      _meas.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0;";
      document.body.appendChild(_meas);
    }
    var isKey = d.type === "key";
    var w = isKey ? NODE_W.key : NODE_W.other;
    var cls = "cm-node cm-" + (PALETTE[d.type] ? d.type : "default");
    _meas.style.width = w + "px";
    _meas.innerHTML =
      "<div class='" + cls + "' style='width:" + w + "px;height:auto'>" +
      "<div class='cm-t'>" + esc(d.label || "") + "</div>" +
      (d.desc ? "<div class='cm-d'>" + esc(d.desc) + "</div>" : "") +
      "</div>";
    var h = _meas.firstChild.offsetHeight;
    return { w: w, h: Math.max(h, isKey ? NODE_MIN_H.key : NODE_MIN_H.other) };
  }

  /* ---------------------------------------------------------------------------
   * 2. 依赖脚本（CDN）。按顺序加载，加载失败时优雅降级。
   * ------------------------------------------------------------------------- */
  var SCRIPTS = [
    "https://cdn.jsdelivr.net/npm/cytoscape@3.30.2/dist/cytoscape.min.js",
    "https://cdn.jsdelivr.net/npm/layout-base@2.0.1/layout-base.min.js",
    "https://cdn.jsdelivr.net/npm/cose-base@2.2.0/cose-base.min.js",
    "https://cdn.jsdelivr.net/npm/cytoscape-fcose@2.2.0/cytoscape-fcose.min.js",
    "https://cdn.jsdelivr.net/npm/dagre@0.8.5/dist/dagre.min.js",
    "https://cdn.jsdelivr.net/npm/cytoscape-dagre@2.5.0/cytoscape-dagre.js",
    "https://cdn.jsdelivr.net/npm/elkjs@0.9.3/lib/elk.bundled.js",
    "https://cdn.jsdelivr.net/npm/cytoscape-elk@2.2.0/dist/cytoscape-elk.js",
    "https://cdn.jsdelivr.net/npm/cytoscape-node-html-label@1.2.2/dist/cytoscape-node-html-label.min.js",
    "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js",
    "https://cdn.jsdelivr.net/npm/cytoscape-svg@0.4.0/cytoscape-svg.js"
  ];

  function loadScript(src) {
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = function () { resolve(true); };
      s.onerror = function () { console.warn("[conceptmap] 加载失败，已跳过:", src); resolve(false); };
      document.head.appendChild(s);
    });
  }

  function loadAll() {
    // 串行加载，保证扩展在 cytoscape 之后注册
    return SCRIPTS.reduce(function (p, src) {
      return p.then(function () { return loadScript(src); });
    }, Promise.resolve());
  }

  /* ---------------------------------------------------------------------------
   * 3. 注入页面样式（整页画布 + 渐变背景 + UI 控件 + 节点卡片）
   * ------------------------------------------------------------------------- */
  function injectCSS() {
    var css = [
      "html,body{margin:0;padding:0;height:100%;width:100%;overflow:hidden;",
      "  font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',Segoe UI,sans-serif;}",

      /* 主题变量：夜间（Flexoki base 暗色） */
      "#cm-stage.cm-dark{",
      "  --cm-bg:radial-gradient(circle at 20% 15%,#282726 0%,#1C1B1A 55%,#100F0F 100%);",
      "  --cm-fg:#CECDC3; --cm-fg-soft:#878580;",
      "  --cm-panel:rgba(40,39,38,.78); --cm-panel-solid:rgba(40,39,38,.88); --cm-panel-hover:rgba(87,86,83,.92);",
      "  --cm-border:rgba(206,205,195,.14); --cm-edge:#878580;",
      "  --cm-tip-bg:rgba(28,27,26,.96); --cm-tip-fg:#E6E4D9;",
      "  --cm-title-shadow:0 2px 12px rgba(0,0,0,.6);}",
      /* 主题变量：日间（Flexoki paper / base 亮色） */
      "#cm-stage.cm-light{",
      "  --cm-bg:radial-gradient(circle at 20% 15%,#FFFCF0 0%,#F2F0E5 60%,#E6E4D9 100%);",
      "  --cm-fg:#100F0F; --cm-fg-soft:#6F6E69;",
      "  --cm-panel:rgba(242,240,229,.82); --cm-panel-solid:rgba(242,240,229,.92); --cm-panel-hover:rgba(183,181,172,.85);",
      "  --cm-border:rgba(16,15,15,.14); --cm-edge:#6F6E69;",
      "  --cm-tip-bg:rgba(255,252,240,.97); --cm-tip-fg:#282726;",
      "  --cm-title-shadow:0 1px 6px rgba(255,255,255,.55);}",

      "#cm-stage{position:fixed;inset:0;background:var(--cm-bg);transition:background .35s ease;}",
      "#cm-cy{position:absolute;inset:0;}",

      /* 标题 */
      "#cm-title{position:fixed;top:18px;left:24px;z-index:10;color:var(--cm-fg);",
      "  font-size:20px;font-weight:700;letter-spacing:.5px;",
      "  text-shadow:var(--cm-title-shadow);pointer-events:none;max-width:60%;}",
      "#cm-title small{display:block;font-size:12px;font-weight:400;opacity:.7;margin-top:4px;}",

      /* 图例 */

      /* 控制按钮 */
      "#cm-ctrl{position:fixed;bottom:18px;right:18px;z-index:10;display:flex;gap:8px;}",
      "#cm-ctrl button{width:40px;height:40px;border-radius:10px;cursor:pointer;",
      "  background:var(--cm-panel-solid);color:var(--cm-fg);font-size:18px;line-height:1;",
      "  border:1px solid var(--cm-border);transition:.15s;backdrop-filter:blur(8px);}",
      "#cm-ctrl button:hover{background:var(--cm-panel-hover);transform:translateY(-1px);}",

      /* 弹出菜单（导出 / 布局 / 边样式） */
      "#cm-export-menu,#cm-layout-menu,#cm-edge-menu{position:fixed;bottom:66px;right:18px;z-index:11;display:none;",
      "  flex-direction:column;gap:6px;background:var(--cm-panel-solid);backdrop-filter:blur(8px);",
      "  border:1px solid var(--cm-border);border-radius:10px;padding:8px;",
      "  box-shadow:0 8px 28px rgba(0,0,0,.35);}",
      "#cm-export-menu.open,#cm-layout-menu.open,#cm-edge-menu.open{display:flex;}",
      "#cm-export-menu button,#cm-layout-menu button,#cm-edge-menu button{min-width:148px;height:34px;border-radius:8px;cursor:pointer;",
      "  background:transparent;color:var(--cm-fg);font-size:13px;line-height:1;",
      "  border:1px solid var(--cm-border);transition:.15s;padding:0 12px;text-align:left;}",
      "#cm-export-menu button:hover,#cm-layout-menu button:hover,#cm-edge-menu button:hover{background:var(--cm-panel-hover);}",
      "#cm-layout-menu button.cm-act,#cm-edge-menu button.cm-act{font-weight:700;border-color:var(--cm-fg);}",

      /* 参数设置面板（滑块） */
      "#cm-settings-menu{position:fixed;bottom:66px;right:18px;z-index:11;display:none;flex-direction:column;gap:3px;",
      "  background:var(--cm-panel-solid);backdrop-filter:blur(8px);border:1px solid var(--cm-border);border-radius:10px;",
      "  padding:10px 12px;box-shadow:0 8px 28px rgba(0,0,0,.35);width:250px;max-height:72vh;overflow-y:auto;}",
      "#cm-settings-menu.open{display:flex;}",
      "#cm-settings-menu .cm-set-grp{font-size:11px;font-weight:700;opacity:.55;letter-spacing:.5px;margin:8px 0 2px;}",
      "#cm-settings-menu .cm-set-grp:first-child{margin-top:0;}",
      "#cm-settings-menu .cm-set-row{display:flex;align-items:center;gap:8px;height:26px;font-size:12px;color:var(--cm-fg);}",
      "#cm-settings-menu .cm-set-row>span{flex:0 0 60px;}",
      "#cm-settings-menu .cm-set-row input[type=range]{flex:1;min-width:0;accent-color:var(--cm-fg);cursor:pointer;}",
      "#cm-settings-menu .cm-set-row input[type=checkbox]{margin-left:auto;width:16px;height:16px;accent-color:var(--cm-fg);cursor:pointer;}",
      "#cm-settings-menu .cm-set-row output{flex:0 0 30px;text-align:right;font-variant-numeric:tabular-nums;opacity:.8;}",
      "#cm-settings-menu .cm-set-reset{margin-top:9px;height:30px;border-radius:8px;cursor:pointer;background:transparent;",
      "  color:var(--cm-fg);font-size:12px;border:1px solid var(--cm-border);transition:.15s;}",
      "#cm-settings-menu .cm-set-reset:hover{background:var(--cm-panel-hover);}",

      /* HTML 节点卡片 */
      ".cm-node{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;",
      "  align-items:center;justify-content:center;text-align:center;padding:8px 12px;",
      "  pointer-events:none;user-select:none;overflow-wrap:break-word;word-break:break-word;",
      "  transition:opacity .15s;}",
      ".cm-node .cm-t{font-weight:700;line-height:1.3;}",
      ".cm-node .cm-d{font-weight:400;opacity:.9;line-height:1.35;margin-top:4px;}",
      ".cm-node.cm-key .cm-t{font-size:" + FONT_SIZES.keyTitle + "px;}",
      ".cm-node.cm-key .cm-d{font-size:" + FONT_SIZES.keyDesc + "px;}",
      ".cm-node .cm-t{font-size:" + FONT_SIZES.title + "px;}",
      ".cm-node .cm-d{font-size:" + FONT_SIZES.desc + "px;}",
      "#cm-stage.cm-desc-hidden .cm-d{display:none!important;}",

      /* 描述气泡（无 html-label 扩展时的兜底，hover 显示 desc） */
      "#cm-tip{position:fixed;z-index:20;max-width:260px;pointer-events:none;",
      "  background:var(--cm-tip-bg);color:var(--cm-tip-fg);border:1px solid var(--cm-border);",
      "  border-radius:10px;padding:8px 12px;font-size:" + FONT_SIZES.tooltip + "px;line-height:1.5;",
      "  box-shadow:0 8px 28px rgba(0,0,0,.5);opacity:0;transition:opacity .12s;display:none;}",

      "#cm-error{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;",
      "  color:#ff9a9a;font-size:15px;text-align:center;padding:40px;line-height:1.7;}",

      /* 布局种子显示 */
      "#cm-seed{position:fixed;bottom:18px;left:18px;z-index:10;display:flex;align-items:center;gap:10px;",
      "  background:var(--cm-panel-solid);border:1px solid var(--cm-border);border-radius:10px;",
      "  padding:6px 10px 6px 14px;backdrop-filter:blur(8px);color:var(--cm-fg);}",
      "#cm-seed .cm-seed-lbl{opacity:.5;font-size:11px;font-weight:700;letter-spacing:.4px;white-space:nowrap;}",
      "#cm-seed-val{font-size:13px;font-variant-numeric:tabular-nums;font-weight:600;letter-spacing:.5px;min-width:88px;}",
      "#cm-seed button{height:26px;padding:0 10px;border-radius:7px;cursor:pointer;",
      "  background:transparent;color:var(--cm-fg);font-size:12px;line-height:1;white-space:nowrap;",
      "  border:1px solid var(--cm-border);transition:.15s;}",
      "#cm-seed button:hover{background:var(--cm-panel-hover);}"
    ].join("\n");
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------------------
   * 4. 读取数据：优先读 <script id="conceptmap-data">，否则读 window.CONCEPT_MAP
   * ------------------------------------------------------------------------- */
  function readData() {
    var el = document.getElementById("conceptmap-data");
    if (el) {
      try { return JSON.parse(el.textContent); }
      catch (e) { throw new Error("conceptmap-data 不是合法 JSON：" + e.message); }
    }
    if (window.CONCEPT_MAP) return window.CONCEPT_MAP;
    throw new Error("未找到概念地图数据。请提供 <script type=\"application/json\" id=\"conceptmap-data\"> … </script>");
  }

  /* ---------------------------------------------------------------------------
   * 5. 构建 DOM 骨架
   * ------------------------------------------------------------------------- */
  function buildDOM(meta) {
    var stage = document.createElement("div"); stage.id = "cm-stage";
    stage.className = "cm-" + loadTheme();   // 立即套用主题，避免首帧无样式闪烁
    var cy = document.createElement("div"); cy.id = "cm-cy";
    stage.appendChild(cy);

    var title = document.createElement("div"); title.id = "cm-title";
    title.innerHTML = (meta && meta.title ? esc(meta.title) : "概念地图") +
      (meta && meta.subtitle ? "<small>" + esc(meta.subtitle) + "</small>" : "");
    stage.appendChild(title);

    var tip = document.createElement("div"); tip.id = "cm-tip";
    stage.appendChild(tip);

    var ctrl = document.createElement("div"); ctrl.id = "cm-ctrl";
    ctrl.innerHTML =
      "<button data-act='theme'  title='切换日间/夜间'>🌙</button>" +
      "<button data-act='in'     title='放大'>＋</button>" +
      "<button data-act='out'    title='缩小'>－</button>" +
      "<button data-act='fit'    title='适应屏幕'>⤢</button>" +
      "<button data-act='desc'      title='隐藏描述'>≣</button>" +
      "<button data-act='edgelabel' title='隐藏边标签'>≋</button>" +
      "<button data-act='edgecolor' title='开启同色边'>╌</button>" +
      "<button data-act='layout'    title='切换布局'>⊞</button>" +
      "<button data-act='edge'   title='边样式'>⌒</button>" +
      "<button data-act='settings' title='参数设置'>⚙</button>" +
      "<button data-act='export' title='导出图片'>⬇</button>";
    stage.appendChild(ctrl);

    var menu = document.createElement("div"); menu.id = "cm-export-menu";
    menu.innerHTML =
      "<button data-fmt='png'>导出 PNG</button>" +
      "<button data-fmt='svg'>导出 SVG</button>";
    stage.appendChild(menu);

    var layoutMenu = document.createElement("div"); layoutMenu.id = "cm-layout-menu";
    layoutMenu.innerHTML =
      "<button data-layout='fcose'>力导向（默认）</button>" +
      "<button data-layout='dagre-tb'>层级 ↓ 从上到下</button>" +
      "<button data-layout='dagre-lr'>层级 → 从左到右</button>" +
      "<button data-layout='elk-tb'>ELK 层级 ↓ 从上到下</button>" +
      "<button data-layout='elk-lr'>ELK 层级 → 从左到右</button>" +
      "<button data-layout='breadthfirst'>树形展开 ↓</button>" +
      "<button data-layout='breadthfirst-lr'>树形展开 →</button>" +
      "<button data-layout='concentric'>同心圆</button>";
    stage.appendChild(layoutMenu);

    var edgeMenu = document.createElement("div"); edgeMenu.id = "cm-edge-menu";
    edgeMenu.innerHTML =
      "<button data-edge='bezier'>贝塞尔曲线（默认）</button>" +
      "<button data-edge='taxi-h'>正交折线（横向优先）</button>" +
      "<button data-edge='taxi-v'>正交折线（纵向优先）</button>";
    stage.appendChild(edgeMenu);

    // 参数设置面板：由 SETTINGS_SCHEMA 生成滑块 / 开关
    var settingsMenu = document.createElement("div"); settingsMenu.id = "cm-settings-menu";
    settingsMenu.innerHTML = SETTINGS_SCHEMA.map(function (it) {
      if (it.grp) return "<div class='cm-set-grp'>" + it.grp + "</div>";
      var v = settingsObj(it.obj)[it.key];
      var attr = "data-sobj='" + it.obj + "' data-skey='" + it.key + "' data-apply='" + it.apply + "'";
      if (it.type === "toggle") {
        return "<label class='cm-set-row'><span>" + it.label + "</span>" +
          "<input type='checkbox' " + attr + (v ? " checked" : "") + "></label>";
      }
      return "<label class='cm-set-row'><span>" + it.label + "</span>" +
        "<input type='range' " + attr + " min='" + it.min + "' max='" + it.max + "' step='" + it.step + "' value='" + v + "'>" +
        "<output>" + v + "</output></label>";
    }).join("") + "<button class='cm-set-reset' type='button'>重置为默认</button>";
    stage.appendChild(settingsMenu);

    var seedDisplay = document.createElement("div"); seedDisplay.id = "cm-seed";
    seedDisplay.innerHTML = "<span class='cm-seed-lbl'>布局种子</span>" +
      "<span id='cm-seed-val'>—</span>" +
      "<button id='cm-seed-copy' title='复制种子，可粘贴到 meta.seed 字段以复现此布局'>复制</button>";
    stage.appendChild(seedDisplay);

    document.body.appendChild(stage);
    return { cyEl: cy, tip: tip, ctrl: ctrl, menu: menu, layoutMenu: layoutMenu, edgeMenu: edgeMenu, settingsMenu: settingsMenu };
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------------------------------------------------------------------------
   * 6. 构建 cytoscape 样式
   * ------------------------------------------------------------------------- */
  function buildStyle(htmlLabels, t) {
    t = t || THEMES.dark;
    var nodeStyle = {
      "shape": "round-rectangle",
      // HTML 标签模式：用实测尺寸；原生模式：让节点随文字自适应
      "width": htmlLabels
        ? function (n) { return n.data("_w") || (n.data("type") === "key" ? NODE_W.key : NODE_W.other); }
        : "label",
      "height": htmlLabels
        ? function (n) { return n.data("_h") || (n.data("type") === "key" ? NODE_MIN_H.key : NODE_MIN_H.other); }
        : "label",
      "padding": htmlLabels ? 0 : 12,
      "background-color": function (n) { return pal(n.data("type")).bg; },
      "border-width": 2,
      "border-color": function (n) { return pal(n.data("type")).border; },
      "border-opacity": 0.9,
      // 原生文字：作为 html-label 扩展不可用时的兜底
      "label": htmlLabels ? "" : "data(label)",
      "color": function (n) { return pal(n.data("type")).text; },
      "font-size": function (n) { return n.data("type") === "key" ? 15 : 13; },
      "font-weight": 700,
      "text-valign": "center",
      "text-halign": "center",
      "text-wrap": "wrap",
      "text-max-width": function (n) { return n.data("type") === "key" ? 180 : 150; },
      "text-opacity": htmlLabels ? 0 : 1,
      "transition-property": "border-width border-color",
      "transition-duration": "0.15s"
    };

    return [
      { selector: "node", style: nodeStyle },

      { selector: "node.cm-hl", style: {
          "border-width": 5,
          "border-color": t.hl
      }},
      { selector: "node.cm-hl-down", style: {
          "border-width": 5,
          "border-color": DOWN_COLOR
      }},
      { selector: "node.cm-focus", style: {
          "border-width": 8,
          "border-color": "#E03131",
          "shadow-blur": 48,
          "shadow-color": "#E03131",
          "shadow-opacity": 1,
          "shadow-offset-x": 0,
          "shadow-offset-y": 0,
          "z-index": 30
      }},
      { selector: "node.cm-dim", style: { "opacity": 0.25 } },

      { selector: "edge", style: Object.assign({
          "width": EDGE.width,
          "line-color": t.edgeLine,
          "underlay-color": t.edgeLine,
          "line-opacity": 0.8,
          "curve-style": "bezier",
          "target-arrow-color": t.edgeLine,
          "target-arrow-shape": "triangle",
          "arrow-scale": 2,
          "label": "data(label)",
          "font-size": FONT_SIZES.edge,
          "color": t.edgeText,
          "text-wrap": "none",
          "text-background-color": t.edgeLabelBg,
          "text-background-opacity": 0.85,
          "text-background-shape": "round-rectangle",
          "text-background-padding": 3,
          "text-rotation": "autorotate"
      }, glowBand()) },

      { selector: "edge[?cross]", style: {
          "line-style": "dashed",
          "line-dash-pattern": [8, 5],
          "line-color": t.edgeLine,
          "target-arrow-color": t.edgeLine,
          "underlay-opacity": 0,
          "width": EDGE.width * EDGE_CROSS_RATIO,
          "color": t.edgeText,
          "z-index": 5
      }},

      { selector: "edge.cm-hl", style: {
          "line-color": t.hl,
          "target-arrow-color": t.hl,
          "underlay-color": t.hl,
          "width": EDGE.width * EDGE_HL_RATIO,
          "line-opacity": 1,
          "z-index": 20
      }},
      { selector: "edge.cm-hl-cross", style: {
          "line-color": "#3CB371",
          "target-arrow-color": "#3CB371",
          "underlay-color": "#3CB371",
          "color": "#3CB371",
          "width": EDGE.width * EDGE_HL_RATIO,
          "line-opacity": 1,
          "z-index": 21
      }},
      { selector: "edge.cm-hl-down", style: {
          "line-color": DOWN_COLOR,
          "target-arrow-color": DOWN_COLOR,
          "underlay-color": DOWN_COLOR,
          "color": DOWN_COLOR,
          "width": EDGE.width * EDGE_HL_RATIO,
          "line-opacity": 1,
          "z-index": 22
      }},
      { selector: "edge.cm-dim", style: { "opacity": 0.12 } },
      { selector: "edge.cm-el-hide", style: { "label": "" } }
    ];
  }

  /* ---------------------------------------------------------------------------
   * 7. 主流程
   * ------------------------------------------------------------------------- */
  function init() {
    var data, dom;
    try {
      loadSettings();   // 先合并持久化的数值参数，使首帧 CSS / 样式即采用用户设定
      injectCSS();
      data = readData();
    } catch (e) {
      showError(e.message);
      return;
    }

    var meta = data.meta || {};
    dom = buildDOM(meta);

    if (typeof cytoscape === "undefined") {
      showError("Cytoscape 加载失败，请检查网络连接（需要访问 cdn.jsdelivr.net）。");
      return;
    }

    // 注册 fcose（若可用）
    var hasFcose = false;
    try {
      if (window.cytoscapeFcose) { cytoscape.use(window.cytoscapeFcose); hasFcose = true; }
    } catch (e) { /* 已注册或不可用 */ hasFcose = !!window.cytoscapeFcose; }

    // 注册 dagre（若可用）
    var hasDagre = false;
    try {
      if (window.cytoscapeDagre) { cytoscape.use(window.cytoscapeDagre); hasDagre = true; }
    } catch (e) { /* 已注册或不可用 */ hasDagre = !!window.cytoscapeDagre; }

    // 注册 elk（若可用）
    var hasElk = false;
    try {
      if (window.cytoscapeElk) { cytoscape.use(window.cytoscapeElk); hasElk = true; }
    } catch (e) { /* 已注册或不可用 */ hasElk = !!window.cytoscapeElk; }

    // 注册 cytoscape-svg（矢量导出，若可用）
    try {
      if (window.cytoscapeSvg) { cytoscape.use(window.cytoscapeSvg); }
    } catch (e) { /* 已注册或不可用 */ }

    // 预先实测每个节点的卡片尺寸（文字换行后），写入 data._w / _h / _hFull / _hMin
    (data.nodes || []).forEach(function (n) {
      if (n && n.data) {
        var sFull   = measureNode(n.data);
        var origDesc = n.data.desc;
        n.data.desc = "";
        var sMin    = measureNode(n.data);
        n.data.desc = origDesc;
        n.data._w     = sFull.w;
        n.data._h     = sFull.h;
        n.data._hFull = sFull.h;
        n.data._hMin  = sMin.h;
      }
    });

    var elements = (data.nodes || []).concat(data.edges || []);

    var theme = loadTheme(meta.theme);

    var cy = cytoscape({
      container: dom.cyEl,
      elements: elements,
      style: buildStyle(true, THEMES[theme]),   // 先按“有 html 标签”渲染（隐藏原生文字）
      wheelSensitivity: 0.25,
      minZoom: 0.2,
      maxZoom: 2.5
    });

    // HTML 富文本节点（标题 + 描述）
    var htmlOk = false;
    if (typeof cy.nodeHtmlLabel === "function") {
      try {
        cy.nodeHtmlLabel([{
          query: "node",
          valign: "center", halign: "center",
          valignBox: "center", halignBox: "center",
          tpl: function (d) {
            var cls = "cm-node cm-" + (PALETTE[d.type] ? d.type : "default");
            // 显式锁定卡片宽度（与 measureNode 一致），文字才会在此宽度内换行；
            // 否则 html-label 容器无固定宽度，width:100% 会塌缩成内容宽度而不换行
            var w = d._w || (d.type === "key" ? NODE_W.key : NODE_W.other);
            var t = "<div class='cm-t'>" + esc(d.label || "") + "</div>";
            var dsc = d.desc ? "<div class='cm-d'>" + esc(d.desc) + "</div>" : "";
            return "<div class='" + cls + "' data-cm-nid='" + d.id + "' style='width:" + w + "px'>" + t + dsc + "</div>";
          }
        }]);
        htmlOk = true;
      } catch (e) { console.warn("[conceptmap] nodeHtmlLabel 初始化失败，回退原生标签", e); }
    }
    if (!htmlOk) {
      // 回退：显示原生标题文字 + hover 显示描述
      cy.style(buildStyle(false, THEMES[theme])).update();
    }

    // 应用主题：只改“配色”——页面 UI 走 CSS 变量（切 class 即可），
    // 连线颜色走 cytoscape，用增量 selector 局部覆盖，绝不重建节点样式，
    // 节点卡片在日夜两种模式下都用同一套彩色渐变，保持不变。
    var stage = dom.cyEl.parentNode;            // #cm-stage

    // 描述显示/隐藏状态（持久化到 localStorage）
    var showDesc = (function() { try { return localStorage.getItem("cm-desc") !== "0"; } catch(e) { return true; } })();
    var descBtn  = dom.ctrl.querySelector("[data-act='desc']");
    function setDescVisible(v) {
      showDesc = v;
      stage.classList.toggle("cm-desc-hidden", !v);
      // 切换每个节点的高度：隐藏描述时用仅含标题的最小高度
      cy.nodes().forEach(function(n) {
        n.data("_h", v ? n.data("_hFull") : n.data("_hMin"));
      });
      cy.style().update();
      if (descBtn) {
        descBtn.textContent = v ? "≣" : "≡";
        descBtn.title       = v ? "隐藏描述" : "显示描述";
      }
      try { localStorage.setItem("cm-desc", v ? "1" : "0"); } catch(e) {}
    }
    setDescVisible(showDesc);

    // 同色边状态
    var sameColorEdge = (function() { try { return localStorage.getItem("cm-edgecolor") === "1"; } catch(e) { return false; } })();
    var ecBtn = dom.ctrl.querySelector("[data-act='edgecolor']");
    function applySameColorEdge(v) {
      sameColorEdge = v;
      var allTypes = Object.keys(PALETTE).filter(function(k) { return k !== "default"; });
      cy.edges().forEach(function(e) {
        allTypes.forEach(function(k) { e.removeClass("cm-ec-" + k); });
        if (v && !e.data("cross")) {
          // 按目标（下级）节点的颜色着色：既覆盖同主题内部连线，
          // 也让每个节点“上一级路径”（父节点指向它的边）同色。
          var tt = e.target().data("type");
          if (tt && PALETTE[tt] && tt !== "default") e.addClass("cm-ec-" + tt);
        }
      });
      cy.style().update();  // 强制刷新，确保类变化立即生效
      if (ecBtn) {
        ecBtn.textContent = v ? "━" : "╌";
        ecBtn.title       = v ? "关闭同色边" : "开启同色边";
      }
      try { localStorage.setItem("cm-edgecolor", v ? "1" : "0"); } catch(e) {}
    }
    if (sameColorEdge) applySameColorEdge(true);  // 恢复持久化状态

    // 边标签显示/隐藏状态
    var showEdgeLabel = (function() { try { return localStorage.getItem("cm-edgelabel") !== "0"; } catch(e) { return true; } })();
    var edgeLabelBtn  = dom.ctrl.querySelector("[data-act='edgelabel']");
    function setEdgeLabelVisible(v) {
      showEdgeLabel = v;
      if (v) { cy.edges().removeClass("cm-el-hide"); }
      else   { cy.edges().addClass("cm-el-hide"); }
      cy.style().update();
      if (edgeLabelBtn) {
        edgeLabelBtn.textContent = v ? "≋" : "═";
        edgeLabelBtn.title       = v ? "隐藏边标签" : "显示边标签";
      }
      try { localStorage.setItem("cm-edgelabel", v ? "1" : "0"); } catch(e) {}
    }
    setEdgeLabelVisible(showEdgeLabel);

    // 按钮点击（bindControls 会对未知 act 直接 return，这里独立监听）
    dom.ctrl.addEventListener("click", function(e) {
      var act = e.target && e.target.getAttribute("data-act");
      if (act === "desc")      setDescVisible(!showDesc);
      if (act === "edgelabel") setEdgeLabelVisible(!showEdgeLabel);
      if (act === "edgecolor") applySameColorEdge(!sameColorEdge);
    });
    // tooltip：节点 desc 在卡片中可见时抑制节点提示；边标签可见时抑制边提示
    bindTooltip(cy, dom.tip, function() { return htmlOk && showDesc; }, function() { return showEdgeLabel; });

    var themeBtn = dom.ctrl.querySelector("[data-act='theme']");
    function applyEdgeColors(t) {
      var s = cy.style()
        .selector("node.cm-hl").style({
          "border-color": t.hl
        })
        .selector("edge").style(Object.assign({
          "line-color": t.edgeLine, "target-arrow-color": t.edgeLine,
          "underlay-color": t.edgeLine,
          "color": t.edgeText, "text-background-color": t.edgeLabelBg
        }, glowBand()))
        .selector("edge[?cross]").style({
          "line-color": t.edgeLine, "target-arrow-color": t.edgeLine,
          "underlay-opacity": 0, "color": t.edgeText
        });
      // 同色边规则：在基础 edge 之后注册（盖过中性边色），在 cm-hl* 之前注册（高亮色仍可盖过它）。
      // cytoscape 增量样式按注册顺序定优先级，故每次切主题都在此重建这一相对顺序。
      Object.keys(PALETTE).forEach(function (k) {
        if (k === "default") return;
        s.selector("edge.cm-ec-" + k).style({
          "line-color": PALETTE[k].border, "target-arrow-color": PALETTE[k].border,
          "underlay-color": PALETTE[k].border
        });
      });
      s.selector("edge.cm-hl").style({
          "line-color": t.hl, "target-arrow-color": t.hl, "underlay-color": t.hl
        })
        .selector("edge.cm-hl-cross").style({
          "line-color": "#3CB371", "target-arrow-color": "#3CB371",
          "underlay-color": "#3CB371", "color": "#3CB371"
        })
        .selector("edge.cm-hl-down").style({
          "line-color": DOWN_COLOR, "target-arrow-color": DOWN_COLOR,
          "underlay-color": DOWN_COLOR, "color": DOWN_COLOR
        })
        .update();
    }
    function setTheme(name) {
      theme = name;
      stage.classList.remove("cm-dark", "cm-light");
      stage.classList.add("cm-" + name);
      applyEdgeColors(THEMES[name]);
      if (themeBtn) {
        themeBtn.textContent = name === "dark" ? "🌙" : "☀";
        themeBtn.title = name === "dark" ? "切换到日间模式" : "切换到夜间模式";
      }
      saveTheme(name);
    }
    setTheme(theme);

    // meta.seed 指定时传固定值，否则传 null（runLayout 内每次自行随机）
    var seed = meta.seed != null ? meta.seed >>> 0 : null;
    var currentLayout = meta.layout || "fcose";
    var currentEdgeStyle = meta.edgeStyle || "bezier";

    // 种子展示与复制
    var seedValEl  = document.getElementById("cm-seed-val");
    var seedCopyBtn = document.getElementById("cm-seed-copy");
    function onSeedUsed(s) {
      if (seedValEl) seedValEl.textContent = s;
    }
    if (seedCopyBtn) {
      seedCopyBtn.addEventListener("click", function () {
        var txt = seedValEl ? seedValEl.textContent : "";
        if (!txt || txt === "—") return;
        var restore = function () { setTimeout(function () { seedCopyBtn.textContent = "复制"; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(function () {
            seedCopyBtn.textContent = "已复制!"; restore();
          }).catch(function () { seedCopyBtn.textContent = "失败"; restore(); });
        } else {
          var ta = document.createElement("textarea");
          ta.value = txt; document.body.appendChild(ta); ta.select();
          try { document.execCommand("copy"); seedCopyBtn.textContent = "已复制!"; } catch (e) { seedCopyBtn.textContent = "失败"; }
          document.body.removeChild(ta); restore();
        }
      });
    }

    runLayout(cy, hasFcose, hasDagre, hasElk, seed, currentLayout, currentEdgeStyle, onSeedUsed);
    bindInteractions(cy, function() { return currentEdgeStyle; });
    bindControls(cy, dom.ctrl, function () { setTheme(theme === "dark" ? "light" : "dark"); });
    bindExport(stage, dom.ctrl, dom.menu, dom.layoutMenu, dom.edgeMenu, cy, meta, function () { return theme; });
    bindLayout(dom.ctrl, dom.layoutMenu, dom.menu, dom.edgeMenu, currentLayout, function (name) {
      currentLayout = name;
      runLayout(cy, hasFcose, hasDagre, hasElk, seed, name, currentEdgeStyle, onSeedUsed);
    });
    bindEdge(dom.ctrl, dom.edgeMenu, dom.menu, dom.layoutMenu, currentEdgeStyle, function (name) {
      currentEdgeStyle = name;
      applyEdgeStyle(cy, name);
    });

    // 连线度量（边宽 / 荧光 / 标签字号）实时重应用——供设置面板调用。
    // 只设宽度/荧光/字号，不碰 line-color，故不影响同色边与高亮的配色叠放顺序。
    function applyEdgeMetrics() {
      cy.style()
        .selector("edge").style(Object.assign({ "width": EDGE.width, "font-size": FONT_SIZES.edge }, glowBand()))
        .selector("edge[?cross]").style({ "width": EDGE.width * EDGE_CROSS_RATIO, "underlay-opacity": 0 })
        .selector("edge.cm-hl").style({ "width": EDGE.width * EDGE_HL_RATIO })
        .selector("edge.cm-hl-cross").style({ "width": EDGE.width * EDGE_HL_RATIO })
        .selector("edge.cm-hl-down").style({ "width": EDGE.width * EDGE_HL_RATIO })
        .update();
    }
    bindSettings(dom.ctrl, dom.settingsMenu, cy, function () { return showDesc; }, applyEdgeMetrics);

    window.addEventListener("resize", function () { cy.resize(); });
    // 暴露给控制台调试
    window.cy = cy;
    window.cmSetTheme = setTheme;
  }

  /* ---------------------------------------------------------------------------
   * 8. 布局
   * ------------------------------------------------------------------------- */
  // 确定性 PRNG（mulberry32）。布局期间临时替换 Math.random，
  // 使 fcose/cose 的随机初始化可复现 —— 同一份数据每次刷新得到相同布局。
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 支持的布局：
  //   "fcose"        — 力导向，有机分布（默认，需 CDN）
  //   "dagre-tb"     — 有向层级，自上而下（需 CDN）
  //   "dagre-lr"     — 有向层级，从左到右（需 CDN）
  //   "elk-tb"       — ELK layered，自上而下（需 CDN）
  //   "elk-lr"       — ELK layered，从左到右（需 CDN）
  //   "breadthfirst" — BFS 树形展开（内置）
  //   "concentric"   — 同心圆，度数高的节点居中（内置）
  //   "cose"         — 力导向降级（内置）
  // 在 JSON meta.layout 字段指定，未填则默认 "fcose"。
  // 按边标签长度计算理想边长：不折行，文字单行显示。
  // 中文字符约 15px/字（font-size 15），两端各留 40px（节点边缘 + 箭头）。
  function edgeLengthFn(edge) {
    var lbl = (edge.data ? edge.data("label") : edge.label) || "";
    return Math.max(160, lbl.length * 15 + 260);  // 两端各 40px 缓冲
  }

  // 图中所有边标签的最大文字像素宽度（不含布局缓冲），供层级/树形布局使用。
  function maxLabelPx(cy) {
    var max = 0;
    cy.edges().forEach(function(e) {
      var px = (e.data("label") || "").length * 15;
      if (px > max) max = px;
    });
    return max;
  }

  function runLayout(cy, hasFcose, hasDagre, hasElk, seed, layoutName, edgeStyle, onSeed) {
    var req = layoutName || "fcose";
    var opts;
    // seed 为 null 时每次调用随机生成，不为 null 时使用固定值（可复现）
    var effectiveSeed = seed != null ? seed >>> 0 : (Math.random() * 0x100000000 >>> 0);
    if (onSeed) onSeed(effectiveSeed);

    // 层级/树形布局用纯文字宽度 + 小缓冲；力导布局用 edgeLengthFn（含自身缓冲）。
    var mlpx = maxLabelPx(cy);

    // 每次切换布局前清除上次留下的逐边样式覆盖（rerouteBlockedEdges / taxi）
    cy.edges().forEach(function(e) {
      e.removeStyle("curve-style");
      e.removeStyle("taxi-direction");
      e.removeStyle("text-rotation");
      e.removeStyle("control-point-weights");
      e.removeStyle("control-point-distances");
    });

    if (req === "dagre-tb" || req === "dagre-lr") {
      if (hasDagre) {
        opts = { name: "dagre", rankDir: req === "dagre-lr" ? "LR" : "TB",
                 animate: true, animationDuration: 600, padding: 60,
                 nodeSep: 80, rankSep: Math.max(120, mlpx + 40), fit: true };
      } else {
        console.warn("[conceptmap] dagre 未加载，降级为 fcose/cose");
        req = "fcose";
      }
    }

    if (req === "elk-tb" || req === "elk-lr") {
      if (hasElk) {
        var elkDir = req === "elk-lr" ? "RIGHT" : "DOWN";
        var nodeGap = Math.max(120, mlpx + 40);
        opts = { name: "elk", animate: true, animationDuration: 600, padding: 60, fit: true,
                 elk: {
                   algorithm: "layered",
                   "elk.direction": elkDir,
                   "elk.layered.spacing.nodeNodeBetweenLayers": String(nodeGap),
                   "elk.spacing.nodeNode": "80",
                   "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX"
                 } };
      } else {
        console.warn("[conceptmap] elk 未加载，降级为 dagre/fcose");
        req = hasDagre ? (req === "elk-lr" ? "dagre-lr" : "dagre-tb") : "fcose";
        runLayout(cy, hasFcose, hasDagre, false, seed, req, edgeStyle, onSeed);
        return;
      }
    }

    if (req === "breadthfirst-lr") {
      var bfSpacing = Math.max(1.6, (mlpx + 40) / 120);
      var bfLayout = cy.layout({ name: "breadthfirst", animate: false,
                                 spacingFactor: bfSpacing, directed: true, fit: false });
      bfLayout.on("layoutstop", function () {
        var bb = cy.elements().boundingBox({});
        var midX = (bb.x1 + bb.x2) / 2, midY = (bb.y1 + bb.y2) / 2;
        cy.nodes().forEach(function (n) {
          var p = n.position();
          n.position({ x: p.y - midY, y: p.x - midX });
        });
        applyEdgeStyle(cy, edgeStyle);
        cy.animate({ fit: { padding: 60 } }, { duration: 600 });
      });
      var origRandom2 = Math.random;
      Math.random = makeRng(effectiveSeed);
      try { bfLayout.run(); }
      finally { Math.random = origRandom2; }
      return;
    }

    if (!opts && req === "breadthfirst") {
      opts = { name: "breadthfirst", animate: true, animationDuration: 600,
               padding: 60, spacingFactor: Math.max(1.6, (mlpx + 40) / 120),
               directed: true, fit: true };
    }

    if (!opts && req === "concentric") {
      opts = { name: "concentric", animate: true, animationDuration: 600,
               padding: 60, minNodeSpacing: Math.max(40, mlpx - 60), fit: true,
               concentric: function (n) { return n.degree(); },
               levelWidth: function () { return 2; } };
    }

    if (!opts && req === "cose") {
      opts = { name: "cose", animate: true, animationDuration: 600, padding: 60,
               nodeRepulsion: 12000, idealEdgeLength: edgeLengthFn, fit: true };
    }

    // fcose（默认）或其他未知值
    if (!opts) {
      opts = hasFcose
        ? { name: "fcose", quality: "proof", animate: true, animationDuration: 600,
            randomize: true, padding: 60, nodeSeparation: 140,
            idealEdgeLength: edgeLengthFn, nodeRepulsion: 9000, gravity: 0.25,
            fit: true, packComponents: true }
        : { name: "cose", animate: true, animationDuration: 600, padding: 60,
            nodeRepulsion: 12000, idealEdgeLength: edgeLengthFn, fit: true };
    }

    var layout = cy.layout(opts);
    layout.on("layoutstop", function () {
      applyEdgeStyle(cy, edgeStyle);
      cy.animate({ fit: { padding: 60 } }, { duration: 300 });
    });

    // 布局计算在 run() 内同步完成（随机数也在此期间消费），
    // 用 try/finally 把 Math.random 的替换严格限制在这段窗口内。
    var origRandom = Math.random;
    Math.random = makeRng(effectiveSeed);
    try { layout.run(); }
    finally { Math.random = origRandom; }
  }

  /* ---------------------------------------------------------------------------
   * 9. 边绕行路由：检测穿越其他节点的边，自动弯曲绕开遮挡
   * ------------------------------------------------------------------------- */
  // Liang-Barsky 算法：线段与轴对齐矩形相交检测
  function lineSegmentIntersectsRect(p1, p2, rect) {
    var dx = p2.x - p1.x, dy = p2.y - p1.y;
    var t0 = 0, t1 = 1;
    function clip(p, q) {
      if (Math.abs(p) < 1e-9) return q >= 0;
      var r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else        { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    }
    return clip(-dx, p1.x - rect.x1) && clip(dx, rect.x2 - p1.x) &&
           clip(-dy, p1.y - rect.y1) && clip(dy, rect.y2 - p1.y) &&
           t0 < t1;
  }

  function rerouteBlockedEdges(cy) {
    var CLEAR = 28;    // 绕行时与节点边框的额外间距（模型坐标 px）
    var MIN_SHIFT = 8; // 偏移量低于此值时不更改样式

    cy.edges().forEach(function (edge) {
      if (edge.source().id() === edge.target().id()) return; // 跳过自环

      var sp = edge.source().position();
      var tp = edge.target().position();
      var dx = tp.x - sp.x, dy = tp.y - sp.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) return;

      var srcId = edge.source().id(), tgtId = edge.target().id();
      var totalOffset = 0;

      cy.nodes().forEach(function (node) {
        if (node.id() === srcId || node.id() === tgtId) return;

        var bb = node.boundingBox();
        var padBB = { x1: bb.x1 - CLEAR, y1: bb.y1 - CLEAR,
                      x2: bb.x2 + CLEAR, y2: bb.y2 + CLEAR };
        if (!lineSegmentIntersectsRect(sp, tp, padBB)) return;

        // 节点中心到边线的有符号垂直距离（屏幕坐标中 cross>0 表示节点在边方向右侧）
        var np = node.position();
        var cross = dx * (np.y - sp.y) - dy * (np.x - sp.x);
        var signedDist = cross / len;
        var halfSize = Math.max(node.width(), node.height()) / 2 + CLEAR;
        var shortage = halfSize - Math.abs(signedDist);
        if (shortage <= 0) return;

        // 节点在右侧(cross>0) → 往左推(负偏移)；在左侧 → 往右推(正偏移)
        totalOffset += -Math.sign(cross) * shortage * 1.6;
      });

      if (Math.abs(totalOffset) >= MIN_SHIFT) {
        edge.style({
          "curve-style": "unbundled-bezier",
          "control-point-weights": 0.5,
          "control-point-distances": totalOffset
        });
      } else {
        edge.removeStyle("curve-style");
        edge.removeStyle("control-point-weights");
        edge.removeStyle("control-point-distances");
      }
    });
  }

  /* ---------------------------------------------------------------------------
   * 10. 边样式：贝塞尔曲线 / 正交折线（taxi），独立于布局
   * ------------------------------------------------------------------------- */
  function applyEdgeStyle(cy, styleKey) {
    // 先清除所有逐边样式覆盖
    cy.edges().forEach(function(e) {
      e.removeStyle("curve-style");
      e.removeStyle("taxi-direction");
      e.removeStyle("text-rotation");
      e.removeStyle("control-point-weights");
      e.removeStyle("control-point-distances");
      e.removeStyle("label");
    });
    if (!styleKey || styleKey === "bezier") {
      rerouteBlockedEdges(cy);
    } else {
      // 正交折线：标签定位在折点，必然与节点/其他标签重叠，统一隐藏
      var dir = styleKey === "taxi-v" ? "vertical" : "horizontal";
      cy.edges().forEach(function(e) {
        e.style({ "curve-style": "taxi", "taxi-direction": dir,
                  "text-rotation": "none", "label": "" });
      });
    }
  }

  /* ---------------------------------------------------------------------------
   * 11. 交互：点击节点高亮其邻居与相连边，点空白还原
   * ------------------------------------------------------------------------- */
  function bindInteractions(cy, getEdgeStyle) {
    // 动态 <style> 注入法：CSS 规则住在 <head>，即使 html-label 插件重建 DOM 元素，
    // 浏览器也会立即对匹配 data-cm-nid 的元素重新应用，不存在 querySelector 时序问题。
    var dimStyleEl = document.createElement("style");
    document.head.appendChild(dimStyleEl);

    function syncHtmlOpacity() {
      var rules = "";
      cy.nodes(".cm-dim").forEach(function (n) {
        rules += '[data-cm-nid="' + n.id() + '"]{opacity:.25!important}';
      });
      dimStyleEl.textContent = rules;
    }

    cy.on("tap", "node", function (evt) {
      var n = evt.target;
      var upstream   = n.predecessors();
      var downstream = n.successors();
      cy.elements().addClass("cm-dim").removeClass("cm-hl cm-focus cm-hl-cross cm-hl-down");
      upstream.union(n).removeClass("cm-dim").addClass("cm-hl");
      downstream.removeClass("cm-dim").addClass("cm-hl-down");

      // 判断哪些上游边属于"纯实线路径"（双向 BFS）：
      // solidBack：从 n 反向只走非 cross 边可到达的节点（即"到 n 存在纯实线通道"）
      var solidBack = {};
      solidBack[n.id()] = true;
      var q1 = [n];
      while (q1.length) {
        var a = q1.shift();
        upstream.edges().forEach(function (ue) {
          var sid = ue.source().id();
          if (ue.target().id() === a.id() && !ue.data("cross") && !solidBack[sid]) {
            solidBack[sid] = true;
            q1.push(ue.source());
          }
        });
      }

      // solidFwd：从上游根节点正向只走非 cross 边可到达的节点（即"从起点有纯实线通道"）
      var solidFwd = {};
      upstream.nodes().forEach(function (node) {
        if (node.incomers("edge").intersection(upstream).length === 0) {
          solidFwd[node.id()] = true;
        }
      });
      var q2 = upstream.nodes().filter(function (node) { return !!solidFwd[node.id()]; }).toArray();
      while (q2.length) {
        var b = q2.shift();
        upstream.edges().forEach(function (ue) {
          var tid = ue.target().id();
          if (ue.source().id() === b.id() && !ue.data("cross") && !solidFwd[tid]) {
            solidFwd[tid] = true;
            q2.push(ue.target());
          }
        });
      }

      // 不在任何纯实线路径上的上游边 → 绿色（含 cross 边，以及只能经 cross 才可到达的边）
      upstream.edges().forEach(function (ue) {
        var onSolid = !ue.data("cross") && solidFwd[ue.source().id()] && solidBack[ue.target().id()];
        if (!onSolid) ue.removeClass("cm-hl").addClass("cm-hl-cross");
      });

      n.removeClass("cm-hl").addClass("cm-focus");
      syncHtmlOpacity();
    });
    cy.on("tap", function (evt) {
      if (evt.target === cy) {
        cy.elements().removeClass("cm-dim cm-hl cm-focus cm-hl-cross cm-hl-down");
        syncHtmlOpacity();
      }
    });
    cy.on("dragfree", "node", function () {
      applyEdgeStyle(cy, getEdgeStyle ? getEdgeStyle() : "bezier");
    });
  }

  function bindTooltip(cy, tip, getDescVisible, getEdgeLabelVisible) {
    var hideTimer = null;

    function showTip(content, evt) {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      tip.textContent = content;
      tip.style.display = "block";
      var e = evt.originalEvent;
      if (e) {
        tip.style.left = (e.clientX + 14) + "px";
        tip.style.top  = (e.clientY + 14) + "px";
      }
      requestAnimationFrame(function () { tip.style.opacity = "1"; });
    }
    function moveTip(evt) {
      var e = evt.originalEvent; if (!e) return;
      tip.style.left = (e.clientX + 14) + "px";
      tip.style.top  = (e.clientY + 14) + "px";
    }
    function hideTip() {
      tip.style.opacity = "0";
      hideTimer = setTimeout(function () { tip.style.display = "none"; hideTimer = null; }, 150);
    }

    cy.on("mouseover", "node", function (evt) {
      if (getDescVisible && getDescVisible()) return;
      var d = evt.target.data(); if (!d.desc) return;
      showTip(d.desc, evt);
    });
    cy.on("mousemove", "node", function (evt) {
      if (getDescVisible && getDescVisible()) return;
      moveTip(evt);
    });
    cy.on("mouseout", "node", hideTip);

    cy.on("mouseover", "edge", function (evt) {
      if (getEdgeLabelVisible && getEdgeLabelVisible()) return;
      var label = evt.target.data("label"); if (!label) return;
      showTip(label, evt);
    });
    cy.on("mousemove", "edge", function (evt) {
      if (getEdgeLabelVisible && getEdgeLabelVisible()) return;
      moveTip(evt);
    });
    cy.on("mouseout", "edge", hideTip);
  }

  /* ---------------------------------------------------------------------------
   * 11. 缩放控制
   * ------------------------------------------------------------------------- */
  function bindControls(cy, ctrl, onTheme) {
    ctrl.addEventListener("click", function (e) {
      var act = e.target && e.target.getAttribute("data-act");
      if (!act) return;
      if (act === "theme") { if (onTheme) onTheme(); return; }
      if (act === "fit") { cy.animate({ fit: { padding: 60 } }, { duration: 300 }); return; }
      if (act !== "in" && act !== "out") return;   // export 等按钮由各自处理器接管
      var factor = act === "in" ? 1.25 : 0.8;
      var z = cy.zoom() * factor;
      cy.animate({ zoom: { level: z, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } }, { duration: 180 });
    });
  }

  /* ---------------------------------------------------------------------------
   * 12. 导出图片：把整个舞台（渐变背景 + 标题 + 图例 + 节点卡片 + 连线）
   *     用 html-to-image 截图为 PNG / SVG。节点文字是 HTML 覆盖层，
   *     cytoscape 自带的 cy.png() 无法捕获，故走 DOM 截图方案。
   * ------------------------------------------------------------------------- */
  function bindExport(stage, ctrl, menu, layoutMenu, edgeMenu, cy, meta, getTheme) {
    var btn = ctrl.querySelector("[data-act='export']");
    if (!btn || !menu) return;

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (layoutMenu) layoutMenu.classList.remove("open");
      if (edgeMenu)   edgeMenu.classList.remove("open");
      var _sm = document.getElementById("cm-settings-menu"); if (_sm) _sm.classList.remove("open");
      menu.classList.toggle("open");
    });
    menu.addEventListener("click", function (e) {
      var fmt = e.target && e.target.getAttribute("data-fmt");
      if (!fmt) return;
      menu.classList.remove("open");
      exportImage(stage, cy, meta, getTheme(), fmt);
    });
    // 点击别处关闭菜单
    document.addEventListener("click", function () { menu.classList.remove("open"); });
  }

  function bindLayout(ctrl, menu, exportMenu, edgeMenu, initialLayout, onLayout) {
    var btn = ctrl.querySelector("[data-act='layout']");
    if (!btn || !menu) return;

    function syncActive(name) {
      menu.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("cm-act", b.getAttribute("data-layout") === name);
      });
    }
    syncActive(initialLayout);

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (exportMenu) exportMenu.classList.remove("open");
      if (edgeMenu)   edgeMenu.classList.remove("open");
      var _sm = document.getElementById("cm-settings-menu"); if (_sm) _sm.classList.remove("open");
      menu.classList.toggle("open");
    });

    menu.addEventListener("click", function (e) {
      var name = e.target && e.target.getAttribute("data-layout");
      if (!name) return;
      menu.classList.remove("open");
      syncActive(name);
      onLayout(name);
    });

    document.addEventListener("click", function () { menu.classList.remove("open"); });
  }

  function bindEdge(ctrl, menu, exportMenu, layoutMenu, initialEdge, onEdge) {
    var btn = ctrl.querySelector("[data-act='edge']");
    if (!btn || !menu) return;

    function syncActive(name) {
      menu.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("cm-act", b.getAttribute("data-edge") === name);
      });
      btn.title = name === "bezier" ? "边样式：贝塞尔曲线" :
                  name === "taxi-h" ? "边样式：正交折线（横向）" : "边样式：正交折线（纵向）";
    }
    syncActive(initialEdge);

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (exportMenu) exportMenu.classList.remove("open");
      if (layoutMenu) layoutMenu.classList.remove("open");
      var _sm = document.getElementById("cm-settings-menu"); if (_sm) _sm.classList.remove("open");
      menu.classList.toggle("open");
    });

    menu.addEventListener("click", function (e) {
      var name = e.target && e.target.getAttribute("data-edge");
      if (!name) return;
      menu.classList.remove("open");
      syncActive(name);
      onEdge(name);
    });

    document.addEventListener("click", function () { menu.classList.remove("open"); });
  }

  /* 参数设置面板：滑块 / 开关实时改 FONT_SIZES、EDGE，并持久化。
     字号变化重写动态 CSS（必要时重测卡片高度），连线变化重应用边度量。
     拖动时用 requestAnimationFrame 合并重活，避免每个 input 事件都跑一遍。 */
  function bindSettings(ctrl, menu, cy, getShowDesc, applyEdgeMetrics) {
    var btn = ctrl.querySelector("[data-act='settings']");
    if (!btn || !menu) return;

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      ["cm-export-menu", "cm-layout-menu", "cm-edge-menu"].forEach(function (id) {
        var m = document.getElementById(id); if (m) m.classList.remove("open");
      });
      menu.classList.toggle("open");
    });
    menu.addEventListener("click", function (e) { e.stopPropagation(); }); // 面板内点击不关闭

    var fontRaf = 0, edgeRaf = 0;
    function scheduleNodeFont() {
      if (fontRaf) return;
      fontRaf = requestAnimationFrame(function () { fontRaf = 0; remeasureNodes(cy, getShowDesc()); cy.style().update(); });
    }
    function scheduleEdge() {
      if (edgeRaf) return;
      edgeRaf = requestAnimationFrame(function () { edgeRaf = 0; applyEdgeMetrics(); });
    }
    function applyOne(apply) {
      if (apply === "nodefont") { applyFontCSS(); scheduleNodeFont(); }
      else if (apply === "tooltip") { applyFontCSS(); }
      else if (apply === "edge") { scheduleEdge(); }
    }

    menu.addEventListener("input", function (e) {
      var t = e.target, key = t.getAttribute("data-skey");
      if (!key) return;
      var obj = settingsObj(t.getAttribute("data-sobj"));
      if (t.type === "checkbox") {
        obj[key] = t.checked;
      } else {
        obj[key] = parseFloat(t.value);
        var out = t.parentNode.querySelector("output"); if (out) out.textContent = t.value;
      }
      applyOne(t.getAttribute("data-apply"));
      saveSettings();
    });

    var resetBtn = menu.querySelector(".cm-set-reset");
    if (resetBtn) resetBtn.addEventListener("click", function () {
      Object.keys(FONT_DEFAULTS).forEach(function (k) { FONT_SIZES[k] = FONT_DEFAULTS[k]; });
      Object.keys(EDGE_DEFAULTS).forEach(function (k) { EDGE[k] = EDGE_DEFAULTS[k]; });
      menu.querySelectorAll("input[data-skey]").forEach(function (inp) {
        var v = settingsObj(inp.getAttribute("data-sobj"))[inp.getAttribute("data-skey")];
        if (inp.type === "checkbox") { inp.checked = !!v; }
        else { inp.value = v; var o = inp.parentNode.querySelector("output"); if (o) o.textContent = v; }
      });
      applyFontCSS(); remeasureNodes(cy, getShowDesc()); cy.style().update(); applyEdgeMetrics();
      saveSettings();
    });

    document.addEventListener("click", function () { menu.classList.remove("open"); });
  }

  function exportImage(stage, cy, meta, theme, format) {
    // SVG 走矢量路线（cytoscape-svg）：连线 / 边标签 / 节点底框都输出为真矢量，
    // 节点文字用 <foreignObject> 矢量卡片叠加——文件小、无限缩放都清晰，
    // 不做任何栅格化。扩展不可用时才回退到位图方案。
    if (format === "svg" && typeof cy.svg === "function") {
      exportSvgVector(stage, cy, meta, theme);
      return;
    }
    exportRaster(stage, cy, meta, theme, format);
  }

  function exportFilename(meta) {
    return ((meta && meta.title ? meta.title : "concept-map")
      .replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "concept-map");
  }

  /* PNG（以及无 cytoscape-svg 时的 SVG 回退）：用 html-to-image 把整个舞台
     截成位图。连线 / 边标签是 canvas，临时拉高渲染分辨率使其更清晰。 */
  function exportRaster(stage, cy, meta, theme, format) {
    if (!window.htmlToImage) {
      alert("导出组件未加载，请检查网络连接（需要访问 cdn.jsdelivr.net）。");
      return;
    }
    var savedZoom = cy.zoom();
    var savedPan = { x: cy.pan().x, y: cy.pan().y };

    var EXPORT_PR = 3;
    var renderer = cy.renderer();
    var prevForced = (renderer && "forcedPixelRatio" in renderer) ? renderer.forcedPixelRatio : undefined;
    if (renderer) {
      try { renderer.forcedPixelRatio = EXPORT_PR; cy.resize(); } catch (e) { /* 退回默认分辨率 */ }
    }

    cy.fit(60);

    var opts = {
      width: stage.clientWidth,
      height: stage.clientHeight,
      pixelRatio: format === "png" ? 2 : 1,
      filter: function (node) {
        if (!node || !node.id) return true;
        return node.id !== "cm-ctrl" && node.id !== "cm-export-menu" && node.id !== "cm-tip";
      }
    };
    var toImage = format === "svg" ? window.htmlToImage.toSvg : window.htmlToImage.toPng;
    var restore = function () {
      if (renderer) { try { renderer.forcedPixelRatio = prevForced; cy.resize(); } catch (e) {} }
      cy.zoom(savedZoom); cy.pan(savedPan);
    };

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        toImage(stage, opts).then(function (dataUrl) {
          restore();
          var a = document.createElement("a");
          a.download = exportFilename(meta) + "." + format;
          a.href = dataUrl;
          a.click();
        }).catch(function (err) {
          restore();
          console.error("[conceptmap] 导出失败", err);
          alert("导出失败：" + (err && err.message ? err.message : err));
        });
      });
    });
  }

  /* 矢量 SVG：cy.svg() 把连线、边标签、节点底框输出为真矢量；节点上的
     富文本（标题 + 描述）是 HTML 覆盖层，cy.svg 捕获不到，这里按每个节点
     的屏幕坐标用 <foreignObject> 卡片叠加。坐标取 renderedPosition，与
     cy.svg(full:false) 的视口坐标系一致。 */
  function exportSvgVector(stage, cy, meta, theme) {
    var savedZoom = cy.zoom();
    var savedPan = { x: cy.pan().x, y: cy.pan().y };
    cy.fit(60);

    function restore() { cy.zoom(savedZoom); cy.pan(savedPan); }

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        try {
          var bg = theme === "light" ? "#FFFCF0" : "#1C1B1A";
          var svgStr = cy.svg({ full: false, scale: 1, bg: bg });

          // cytoscape-svg 内部会把输出再乘以 devicePixelRatio（见其 bufferCanvasImage），
          // 因此 SVG 坐标系 = S × 屏幕坐标，S = scale × pixelRatio。直接读它实际写入的
          // width 反推 S，最稳妥（不依赖内部实现细节），再用 S 补偿叠加层的坐标与缩放。
          var S = 1;
          var mW = svgStr.match(/<svg[^>]*\bwidth="([\d.]+)"/i);
          if (mW) { var sw = parseFloat(mW[1]); if (sw > 0 && cy.width() > 0) S = sw / cy.width(); }

          // 仅当 HTML 卡片在用时才叠加文字（否则 cy.svg 已含原生文字标签）
          var sample = stage.querySelector(".cm-node");
          if (sample) {
            var zoom = cy.zoom();
            var FONT = "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',Segoe UI,sans-serif";
            var color = getComputedStyle(sample).color || "#282726";
            // 描述是否在卡片中可见：与屏幕保持一致（“悬停才显示描述”开启时卡片不含描述）
            var descVisible = !stage.classList.contains("cm-desc-hidden");
            var foStr = "";
            cy.nodes().forEach(function (node) {
              var d = node.data();
              var isKey = d.type === "key";
              var mw = d._w || (isKey ? NODE_W.key : NODE_W.other);
              var mh = d._h || (isKey ? NODE_MIN_H.key : NODE_MIN_H.other);
              var rp = node.renderedPosition();
              var rw = node.renderedWidth(), rh = node.renderedHeight();
              // 卡片底框在 cy.svg 里位于 S×屏幕坐标处、尺寸为 S×屏幕尺寸；
              // 卡片按模型尺寸 mw×mh 排版，再 scale(zoom×S) 即可严丝合缝贴合。
              foStr += svgCardFO(
                d,
                (rp.x - rw / 2) * S, (rp.y - rh / 2) * S,
                rw * S, rh * S,
                mw, mh, zoom * S, color, FONT, isKey, descVisible
              );
            });
            svgStr = svgStr.replace(/<\/svg>\s*$/i, foStr + "</svg>");
          }

          restore();
          var blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.download = exportFilename(meta) + ".svg";
          a.href = url;
          a.click();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        } catch (err) {
          restore();
          console.error("[conceptmap] SVG 矢量导出失败，回退位图方案", err);
          exportRaster(stage, cy, meta, theme, "svg");
        }
      });
    });
  }

  // 生成一个节点的 <foreignObject> 矢量卡片（标题 + 描述）。卡片按模型尺寸
  // (mw×mh) 排版，再用 transform:scale(sc) 缩放到目标尺寸 (fw×fh)，与
  // cy.svg 的几何对齐。样式全部内联，导出的 SVG 自包含、无需外部 CSS。
  function svgCardFO(d, x, y, fw, fh, mw, mh, sc, color, font, isKey, descVisible) {
    var tFont = isKey ? FONT_SIZES.keyTitle : FONT_SIZES.title;
    var dFont = isKey ? FONT_SIZES.keyDesc  : FONT_SIZES.desc;
    var wrap = "box-sizing:border-box;width:" + mw + "px;height:" + mh + "px;" +
      "transform:scale(" + sc + ");transform-origin:top left;" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "text-align:center;padding:8px 12px;font-family:" + font + ";color:" + color + ";" +
      "overflow-wrap:break-word;word-break:break-word;";
    var title = "<div style=\"font-weight:700;line-height:1.3;font-size:" + tFont + "px\">" + esc(d.label || "") + "</div>";
    // 仅当描述在屏幕上可见时才写入，保证导出 SVG 与屏幕一致（默认可见）
    var desc = (d.desc && descVisible !== false)
      ? "<div style=\"font-weight:400;opacity:.9;line-height:1.35;margin-top:4px;font-size:" + dFont + "px\">" + esc(d.desc) + "</div>"
      : "";
    return "<foreignObject x=\"" + x + "\" y=\"" + y + "\" width=\"" + fw + "\" height=\"" + fh + "\">" +
      "<div xmlns=\"http://www.w3.org/1999/xhtml\" style=\"" + wrap + "\">" + title + desc + "</div>" +
      "</foreignObject>";
  }

  function showError(msg) {
    var d = document.getElementById("cm-stage");
    if (!d) { d = document.createElement("div"); d.id = "cm-stage"; d.className = "cm-" + loadTheme(); document.body.appendChild(d); }
    var e = document.createElement("div");
    e.id = "cm-error";
    e.innerHTML = "⚠ 概念地图渲染出错<br><br>" + esc(msg);
    d.appendChild(e);
  }

  /* ---------------------------------------------------------------------------
   * 启动
   * ------------------------------------------------------------------------- */
  function boot() {
    loadAll().then(init);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
