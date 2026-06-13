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
  // 单色平涂、淡雅配色：浅色填充 + 深色文字（保证可读性），描边用饱和色标识类别
  var PALETTE = {
    key:     { bg: "#F1CFC4", border: "#C77B62", text: "#5E3526" },
    blue:    { bg: "#D2DDEC", border: "#6D89B0", text: "#34465E" },
    green:   { bg: "#CFE3D8", border: "#6FA088", text: "#2E4C3D" },
    purple:  { bg: "#DDD4E8", border: "#8C7AA6", text: "#463A57" },
    orange:  { bg: "#EEDAC2", border: "#C2945F", text: "#5E4327" },
    red:     { bg: "#EDD2CF", border: "#C2756F", text: "#5E302C" },
    pink:    { bg: "#EBD7E2", border: "#BE87A4", text: "#5A3A4B" },
    teal:    { bg: "#CFE2E2", border: "#6FA0A0", text: "#2E4C4C" },
    yellow:  { bg: "#EDE6C4", border: "#C7B56B", text: "#4D441E" },
    gray:    { bg: "#DCE0E5", border: "#8A95A1", text: "#3A434D" },
    default: { bg: "#D7DCE8", border: "#7C8AA6", text: "#353F52" }
  };
  function pal(type) { return PALETTE[type] || PALETTE.default; }

  var CROSS_COLOR = "#FF1FA2";        // 交叉连接线（强调色，日夜通用）

  /* 主题相关的边/标签颜色（节点卡片为彩色渐变，日夜通用，无需切换）。
     页面其余 UI 颜色走 CSS 变量，见 injectCSS。 */
  var THEMES = {
    dark:  { edgeLine: "#8A94A6", edgeText: "#dfe6f2", edgeLabelBg: "#0d1526", crossText: "#ffd0ec", hl: "#FFE57F" },
    light: { edgeLine: "#7a8499", edgeText: "#33405a", edgeLabelBg: "#ffffff", crossText: "#c2185b", hl: "#2F6BD8" }
  };

  function loadTheme() {
    try { var t = localStorage.getItem("cm-theme"); if (t === "light" || t === "dark") return t; } catch (e) {}
    return "dark";
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
    "https://cdn.jsdelivr.net/npm/cytoscape-node-html-label@1.2.2/dist/cytoscape-node-html-label.min.js"
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

      /* 主题变量：夜间 */
      "#cm-stage.cm-dark{",
      "  --cm-bg:radial-gradient(circle at 20% 15%,#1b2a4a 0%,#0d1526 55%,#070b14 100%);",
      "  --cm-fg:#ffffff; --cm-fg-soft:#cfd8e6;",
      "  --cm-panel:rgba(20,28,48,.72); --cm-panel-solid:rgba(20,28,48,.8); --cm-panel-hover:rgba(60,90,160,.9);",
      "  --cm-border:rgba(255,255,255,.12); --cm-edge:#8A94A6;",
      "  --cm-tip-bg:rgba(10,16,30,.95); --cm-tip-fg:#eaf0fb;",
      "  --cm-title-shadow:0 2px 12px rgba(0,0,0,.6);}",
      /* 主题变量：日间 */
      "#cm-stage.cm-light{",
      "  --cm-bg:radial-gradient(circle at 20% 15%,#eef3fb 0%,#dde6f3 55%,#cbd6ea 100%);",
      "  --cm-fg:#1c2536; --cm-fg-soft:#44506a;",
      "  --cm-panel:rgba(255,255,255,.78); --cm-panel-solid:rgba(255,255,255,.86); --cm-panel-hover:rgba(120,160,235,.9);",
      "  --cm-border:rgba(20,40,80,.14); --cm-edge:#7a8499;",
      "  --cm-tip-bg:rgba(255,255,255,.97); --cm-tip-fg:#25304a;",
      "  --cm-title-shadow:0 1px 6px rgba(255,255,255,.55);}",

      "#cm-stage{position:fixed;inset:0;background:var(--cm-bg);transition:background .35s ease;}",
      "#cm-cy{position:absolute;inset:0;}",

      /* 标题 */
      "#cm-title{position:fixed;top:18px;left:24px;z-index:10;color:var(--cm-fg);",
      "  font-size:20px;font-weight:700;letter-spacing:.5px;",
      "  text-shadow:var(--cm-title-shadow);pointer-events:none;max-width:60%;}",
      "#cm-title small{display:block;font-size:12px;font-weight:400;opacity:.7;margin-top:4px;}",

      /* 图例 */
      "#cm-legend{position:fixed;top:18px;right:18px;z-index:10;",
      "  background:var(--cm-panel);backdrop-filter:blur(8px);",
      "  border:1px solid var(--cm-border);border-radius:12px;padding:10px 14px;",
      "  color:var(--cm-fg-soft);font-size:12px;line-height:1.9;max-width:220px;}",
      "#cm-legend .row{display:flex;align-items:center;gap:8px;}",
      "#cm-legend .swatch{width:14px;height:14px;border-radius:4px;flex:0 0 auto;}",
      "#cm-legend .dash{width:22px;height:0;border-top:2px dashed " + CROSS_COLOR + ";}",
      "#cm-legend .solid{width:22px;height:0;border-top:2px solid var(--cm-edge);}",

      /* 控制按钮 */
      "#cm-ctrl{position:fixed;bottom:18px;right:18px;z-index:10;display:flex;gap:8px;}",
      "#cm-ctrl button{width:40px;height:40px;border-radius:10px;cursor:pointer;",
      "  background:var(--cm-panel-solid);color:var(--cm-fg);font-size:18px;line-height:1;",
      "  border:1px solid var(--cm-border);transition:.15s;backdrop-filter:blur(8px);}",
      "#cm-ctrl button:hover{background:var(--cm-panel-hover);transform:translateY(-1px);}",

      /* HTML 节点卡片 */
      ".cm-node{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;",
      "  align-items:center;justify-content:center;text-align:center;padding:8px 12px;",
      "  pointer-events:none;user-select:none;overflow-wrap:break-word;word-break:break-word;}",
      ".cm-node .cm-t{font-weight:700;line-height:1.3;}",
      ".cm-node .cm-d{font-weight:400;opacity:.9;line-height:1.35;margin-top:4px;}",
      ".cm-node.cm-key .cm-t{font-size:16px;}",
      ".cm-node.cm-key .cm-d{font-size:11px;}",
      ".cm-node .cm-t{font-size:14px;}",
      ".cm-node .cm-d{font-size:10.5px;}",

      /* 描述气泡（无 html-label 扩展时的兜底，hover 显示 desc） */
      "#cm-tip{position:fixed;z-index:20;max-width:260px;pointer-events:none;",
      "  background:var(--cm-tip-bg);color:var(--cm-tip-fg);border:1px solid var(--cm-border);",
      "  border-radius:10px;padding:8px 12px;font-size:12.5px;line-height:1.5;",
      "  box-shadow:0 8px 28px rgba(0,0,0,.5);opacity:0;transition:opacity .12s;display:none;}",

      "#cm-error{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;",
      "  color:#ff9a9a;font-size:15px;text-align:center;padding:40px;line-height:1.7;}"
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

    var legend = document.createElement("div"); legend.id = "cm-legend";
    legend.innerHTML =
      "<div class='row'><span class='swatch' style='background:" + PALETTE.key.bg + ";border:1.5px solid " + PALETTE.key.border + "'></span>核心概念</div>" +
      "<div class='row'><span class='swatch' style='background:" + PALETTE.blue.bg + ";border:1.5px solid " + PALETTE.blue.border + "'></span>分支概念</div>" +
      "<div class='row'><span class='solid'></span>连接（关系）</div>" +
      "<div class='row'><span class='dash'></span>交叉连接（长程）</div>";
    stage.appendChild(legend);

    var tip = document.createElement("div"); tip.id = "cm-tip";
    stage.appendChild(tip);

    var ctrl = document.createElement("div"); ctrl.id = "cm-ctrl";
    ctrl.innerHTML =
      "<button data-act='theme' title='切换日间/夜间'>🌙</button>" +
      "<button data-act='in'  title='放大'>＋</button>" +
      "<button data-act='out' title='缩小'>－</button>" +
      "<button data-act='fit' title='适应屏幕'>⤢</button>";
    stage.appendChild(ctrl);

    document.body.appendChild(stage);
    return { cyEl: cy, tip: tip, ctrl: ctrl };
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

      { selector: "node:selected, node.cm-hl", style: {
          "border-width": 5,
          "border-color": t.hl
      }},
      { selector: "node.cm-dim", style: { "opacity": 0.25 } },

      { selector: "edge", style: {
          "width": 2.4,
          "line-color": t.edgeLine,
          "line-opacity": 0.85,
          "curve-style": "bezier",
          "target-arrow-color": t.edgeLine,
          "target-arrow-shape": "triangle",
          "arrow-scale": 1.1,
          "label": "data(label)",
          "font-size": 11,
          "color": t.edgeText,
          "text-wrap": "wrap",
          "text-max-width": 120,
          "text-background-color": t.edgeLabelBg,
          "text-background-opacity": 0.85,
          "text-background-shape": "round-rectangle",
          "text-background-padding": 3,
          "text-rotation": "autorotate"
      }},

      { selector: "edge[?cross]", style: {
          "line-style": "dashed",
          "line-dash-pattern": [8, 5],
          "line-color": CROSS_COLOR,
          "target-arrow-color": CROSS_COLOR,
          "width": 3,
          "color": t.crossText,
          "z-index": 5
      }},

      { selector: "edge.cm-hl", style: {
          "line-color": t.hl,
          "target-arrow-color": t.hl,
          "width": 3.6,
          "line-opacity": 1,
          "z-index": 20
      }},
      { selector: "edge.cm-dim", style: { "opacity": 0.12 } }
    ];
  }

  /* ---------------------------------------------------------------------------
   * 7. 主流程
   * ------------------------------------------------------------------------- */
  function init() {
    var data, dom;
    try {
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

    // 预先实测每个节点的卡片尺寸（文字换行后），写入 data._w / _h
    (data.nodes || []).forEach(function (n) {
      if (n && n.data) {
        var s = measureNode(n.data);
        n.data._w = s.w;
        n.data._h = s.h;
      }
    });

    var elements = (data.nodes || []).concat(data.edges || []);

    var theme = loadTheme();

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
            return "<div class='" + cls + "' style='width:" + w + "px'>" + t + dsc + "</div>";
          }
        }]);
        htmlOk = true;
      } catch (e) { console.warn("[conceptmap] nodeHtmlLabel 初始化失败，回退原生标签", e); }
    }
    if (!htmlOk) {
      // 回退：显示原生标题文字 + hover 显示描述
      cy.style(buildStyle(false, THEMES[theme])).update();
      bindTooltip(cy, dom.tip);
    }

    // 应用主题：只改“配色”——页面 UI 走 CSS 变量（切 class 即可），
    // 连线颜色走 cytoscape，用增量 selector 局部覆盖，绝不重建节点样式，
    // 节点卡片在日夜两种模式下都用同一套彩色渐变，保持不变。
    var stage = dom.cyEl.parentNode;            // #cm-stage
    var themeBtn = dom.ctrl.querySelector("[data-act='theme']");
    function applyEdgeColors(t) {
      cy.style()
        .selector("node:selected, node.cm-hl").style({
          "border-color": t.hl
        })
        .selector("edge").style({
          "line-color": t.edgeLine, "target-arrow-color": t.edgeLine,
          "color": t.edgeText, "text-background-color": t.edgeLabelBg
        })
        .selector("edge[?cross]").style({
          "line-color": CROSS_COLOR, "target-arrow-color": CROSS_COLOR, "color": t.crossText
        })
        .selector("edge.cm-hl").style({
          "line-color": t.hl, "target-arrow-color": t.hl
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

    // 固定随机种子：默认常量，可在 JSON 的 meta.seed 中覆盖
    var seed = (meta.seed != null ? meta.seed : 20240613) >>> 0;
    runLayout(cy, hasFcose, seed);
    bindInteractions(cy);
    bindControls(cy, dom.ctrl, function () { setTheme(theme === "dark" ? "light" : "dark"); });

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

  function runLayout(cy, hasFcose, seed) {
    var opts = hasFcose
      ? { name: "fcose", quality: "proof", animate: true, animationDuration: 600,
          randomize: true, padding: 60, nodeSeparation: 140,
          idealEdgeLength: 150, nodeRepulsion: 9000, gravity: 0.25,
          fit: true, packComponents: true }
      : { name: "cose", animate: true, animationDuration: 600, padding: 60,
          nodeRepulsion: 12000, idealEdgeLength: 150, fit: true };
    var layout = cy.layout(opts);
    layout.on("layoutstop", function () { cy.animate({ fit: { padding: 60 } }, { duration: 300 }); });

    // 布局计算在 run() 内同步完成（随机数也在此期间消费），
    // 用 try/finally 把 Math.random 的替换严格限制在这段窗口内。
    var origRandom = Math.random;
    Math.random = makeRng(seed >>> 0);
    try { layout.run(); }
    finally { Math.random = origRandom; }
  }

  /* ---------------------------------------------------------------------------
   * 9. 交互：点击节点高亮其邻居与相连边，点空白还原
   * ------------------------------------------------------------------------- */
  function bindInteractions(cy) {
    cy.on("tap", "node", function (evt) {
      var n = evt.target;
      var nb = n.closedNeighborhood();
      cy.elements().addClass("cm-dim");
      nb.removeClass("cm-dim").addClass("cm-hl");
      n.removeClass("cm-dim");
    });
    cy.on("tap", function (evt) {
      if (evt.target === cy) {
        cy.elements().removeClass("cm-dim cm-hl");
      }
    });
  }

  function bindTooltip(cy, tip) {
    cy.on("mouseover", "node", function (evt) {
      var d = evt.target.data();
      if (!d.desc) return;
      tip.textContent = d.desc;
      tip.style.display = "block";
      requestAnimationFrame(function () { tip.style.opacity = "1"; });
    });
    cy.on("mousemove", "node", function (evt) {
      var e = evt.originalEvent;
      if (!e) return;
      tip.style.left = (e.clientX + 14) + "px";
      tip.style.top  = (e.clientY + 14) + "px";
    });
    cy.on("mouseout", "node", function () {
      tip.style.opacity = "0";
      setTimeout(function () { tip.style.display = "none"; }, 150);
    });
  }

  /* ---------------------------------------------------------------------------
   * 10. 缩放控制
   * ------------------------------------------------------------------------- */
  function bindControls(cy, ctrl, onTheme) {
    ctrl.addEventListener("click", function (e) {
      var act = e.target && e.target.getAttribute("data-act");
      if (!act) return;
      if (act === "theme") { if (onTheme) onTheme(); return; }
      if (act === "fit") { cy.animate({ fit: { padding: 60 } }, { duration: 300 }); return; }
      var factor = act === "in" ? 1.25 : 0.8;
      var z = cy.zoom() * factor;
      cy.animate({ zoom: { level: z, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } }, { duration: 180 });
    });
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
