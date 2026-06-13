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
  var PALETTE = {
    key:     { g1: "#FF7E5F", g2: "#FD3A69", border: "#D81B60", text: "#ffffff", glow: "#FF7E5F" },
    blue:    { g1: "#4FACFE", g2: "#2D6CDF", border: "#1E5BC6", text: "#ffffff", glow: "#4FACFE" },
    green:   { g1: "#43E97B", g2: "#22B36B", border: "#159957", text: "#ffffff", glow: "#43E97B" },
    purple:  { g1: "#B06AB3", g2: "#7B2FF7", border: "#6A1B9A", text: "#ffffff", glow: "#B06AB3" },
    orange:  { g1: "#FFB75E", g2: "#F7971E", border: "#E07B00", text: "#ffffff", glow: "#FFB75E" },
    red:     { g1: "#FF6A6A", g2: "#E53935", border: "#C62828", text: "#ffffff", glow: "#FF6A6A" },
    pink:    { g1: "#FF9A9E", g2: "#FF4E8B", border: "#E91E63", text: "#ffffff", glow: "#FF9A9E" },
    teal:    { g1: "#2BE9D6", g2: "#06A398", border: "#00897B", text: "#ffffff", glow: "#2BE9D6" },
    yellow:  { g1: "#FDD835", g2: "#F9A825", border: "#F57F17", text: "#3a2c00", glow: "#FDD835" },
    gray:    { g1: "#B0BEC5", g2: "#78909C", border: "#546E7A", text: "#ffffff", glow: "#B0BEC5" },
    default: { g1: "#9BB5FF", g2: "#5C7CFA", border: "#3B5BDB", text: "#ffffff", glow: "#9BB5FF" }
  };
  function pal(type) { return PALETTE[type] || PALETTE.default; }

  var CROSS_COLOR = "#FF1FA2";        // 交叉连接线（强调色）
  var EDGE_COLOR  = "#8A94A6";        // 普通连接线

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
      "#cm-stage{position:fixed;inset:0;background:radial-gradient(circle at 20% 15%,#1b2a4a 0%,#0d1526 55%,#070b14 100%);}",
      "#cm-cy{position:absolute;inset:0;}",

      /* 标题 */
      "#cm-title{position:fixed;top:18px;left:24px;z-index:10;color:#fff;",
      "  font-size:20px;font-weight:700;letter-spacing:.5px;",
      "  text-shadow:0 2px 12px rgba(0,0,0,.6);pointer-events:none;max-width:60%;}",
      "#cm-title small{display:block;font-size:12px;font-weight:400;opacity:.7;margin-top:4px;}",

      /* 图例 */
      "#cm-legend{position:fixed;top:18px;right:18px;z-index:10;",
      "  background:rgba(20,28,48,.72);backdrop-filter:blur(8px);",
      "  border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px 14px;",
      "  color:#cfd8e6;font-size:12px;line-height:1.9;max-width:220px;}",
      "#cm-legend .row{display:flex;align-items:center;gap:8px;}",
      "#cm-legend .swatch{width:14px;height:14px;border-radius:4px;flex:0 0 auto;}",
      "#cm-legend .dash{width:22px;height:0;border-top:2px dashed " + CROSS_COLOR + ";}",
      "#cm-legend .solid{width:22px;height:0;border-top:2px solid " + EDGE_COLOR + ";}",

      /* 控制按钮 */
      "#cm-ctrl{position:fixed;bottom:18px;right:18px;z-index:10;display:flex;gap:8px;}",
      "#cm-ctrl button{width:40px;height:40px;border:none;border-radius:10px;cursor:pointer;",
      "  background:rgba(20,28,48,.8);color:#fff;font-size:18px;line-height:1;",
      "  border:1px solid rgba(255,255,255,.12);transition:.15s;backdrop-filter:blur(8px);}",
      "#cm-ctrl button:hover{background:rgba(60,90,160,.9);transform:translateY(-1px);}",

      /* HTML 节点卡片 */
      ".cm-node{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;",
      "  align-items:center;justify-content:center;text-align:center;padding:6px 10px;",
      "  pointer-events:none;user-select:none;}",
      ".cm-node .cm-t{font-weight:700;line-height:1.25;}",
      ".cm-node .cm-d{font-weight:400;opacity:.9;line-height:1.2;margin-top:3px;}",
      ".cm-node.cm-key .cm-t{font-size:16px;}",
      ".cm-node.cm-key .cm-d{font-size:11px;}",
      ".cm-node .cm-t{font-size:14px;}",
      ".cm-node .cm-d{font-size:10.5px;}",

      /* 描述气泡（无 html-label 扩展时的兜底，hover 显示 desc） */
      "#cm-tip{position:fixed;z-index:20;max-width:260px;pointer-events:none;",
      "  background:rgba(10,16,30,.95);color:#eaf0fb;border:1px solid rgba(255,255,255,.15);",
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
    var cy = document.createElement("div"); cy.id = "cm-cy";
    stage.appendChild(cy);

    var title = document.createElement("div"); title.id = "cm-title";
    title.innerHTML = (meta && meta.title ? esc(meta.title) : "概念地图") +
      (meta && meta.subtitle ? "<small>" + esc(meta.subtitle) + "</small>" : "");
    stage.appendChild(title);

    var legend = document.createElement("div"); legend.id = "cm-legend";
    legend.innerHTML =
      "<div class='row'><span class='swatch' style='background:linear-gradient(135deg," + PALETTE.key.g1 + "," + PALETTE.key.g2 + ")'></span>核心概念</div>" +
      "<div class='row'><span class='swatch' style='background:linear-gradient(135deg," + PALETTE.blue.g1 + "," + PALETTE.blue.g2 + ")'></span>分支概念</div>" +
      "<div class='row'><span class='solid'></span>连接（关系）</div>" +
      "<div class='row'><span class='dash'></span>交叉连接（长程）</div>";
    stage.appendChild(legend);

    var tip = document.createElement("div"); tip.id = "cm-tip";
    stage.appendChild(tip);

    var ctrl = document.createElement("div"); ctrl.id = "cm-ctrl";
    ctrl.innerHTML =
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
  function buildStyle(htmlLabels) {
    var nodeStyle = {
      "shape": "round-rectangle",
      "width": function (n) { return n.data("type") === "key" ? 200 : 168; },
      "height": function (n) { return n.data("type") === "key" ? 84 : 66; },
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": function (n) { var p = pal(n.data("type")); return p.g1 + " " + p.g2; },
      "background-gradient-direction": "to-bottom-right",
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
          "border-color": "#FFE57F"
      }},
      { selector: "node.cm-dim", style: { "opacity": 0.25 } },

      { selector: "edge", style: {
          "width": 2.4,
          "line-color": EDGE_COLOR,
          "line-opacity": 0.85,
          "curve-style": "bezier",
          "target-arrow-color": EDGE_COLOR,
          "target-arrow-shape": "triangle",
          "arrow-scale": 1.1,
          "label": "data(label)",
          "font-size": 11,
          "color": "#dfe6f2",
          "text-background-color": "#0d1526",
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
          "color": "#ffd0ec",
          "z-index": 5
      }},

      { selector: "edge.cm-hl", style: {
          "line-color": "#FFE57F",
          "target-arrow-color": "#FFE57F",
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

    var elements = (data.nodes || []).concat(data.edges || []);

    var cy = cytoscape({
      container: dom.cyEl,
      elements: elements,
      style: buildStyle(true),     // 先按“有 html 标签”渲染（隐藏原生文字）
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
            var t = "<div class='cm-t'>" + esc(d.label || "") + "</div>";
            var dsc = d.desc ? "<div class='cm-d'>" + esc(d.desc) + "</div>" : "";
            return "<div class='" + cls + "'>" + t + dsc + "</div>";
          }
        }]);
        htmlOk = true;
      } catch (e) { console.warn("[conceptmap] nodeHtmlLabel 初始化失败，回退原生标签", e); }
    }
    if (!htmlOk) {
      // 回退：显示原生标题文字 + hover 显示描述
      cy.style(buildStyle(false)).update();
      bindTooltip(cy, dom.tip);
    }

    runLayout(cy, hasFcose);
    bindInteractions(cy);
    bindControls(cy, dom.ctrl);

    window.addEventListener("resize", function () { cy.resize(); });
    // 暴露给控制台调试
    window.cy = cy;
  }

  /* ---------------------------------------------------------------------------
   * 8. 布局
   * ------------------------------------------------------------------------- */
  function runLayout(cy, hasFcose) {
    var opts = hasFcose
      ? { name: "fcose", quality: "proof", animate: true, animationDuration: 600,
          randomize: true, padding: 60, nodeSeparation: 140,
          idealEdgeLength: 150, nodeRepulsion: 9000, gravity: 0.25,
          fit: true, packComponents: true }
      : { name: "cose", animate: true, animationDuration: 600, padding: 60,
          nodeRepulsion: 12000, idealEdgeLength: 150, fit: true };
    var layout = cy.layout(opts);
    layout.run();
    layout.on("layoutstop", function () { cy.animate({ fit: { padding: 60 } }, { duration: 300 }); });
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
  function bindControls(cy, ctrl) {
    ctrl.addEventListener("click", function (e) {
      var act = e.target && e.target.getAttribute("data-act");
      if (!act) return;
      if (act === "fit") { cy.animate({ fit: { padding: 60 } }, { duration: 300 }); return; }
      var factor = act === "in" ? 1.25 : 0.8;
      var z = cy.zoom() * factor;
      cy.animate({ zoom: { level: z, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } }, { duration: 180 });
    });
  }

  function showError(msg) {
    var d = document.getElementById("cm-stage");
    if (!d) { d = document.createElement("div"); d.id = "cm-stage"; document.body.appendChild(d); }
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
