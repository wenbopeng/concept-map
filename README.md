# 概念地图渲染器

让 AI 解析文本后，只输出一段 **JSON**，配上一行 `<script>` 即可在浏览器中渲染出**色彩鲜艳、图文并茂**的概念地图（Concept Map）。

灵感来自 Markdeep：渲染逻辑、配色、布局全部固化在模板里，AI 每次只负责产出数据。

## 文件

| 文件 | 作用 |
|------|------|
| [`conceptmap-init.js`](conceptmap-init.js) | **渲染器（模板层）**，写一次固定不变。加载 Cytoscape、注入样式、读取 JSON 并渲染。 |
| [`concept_map_prompt_json.md`](concept_map_prompt_json.md) | **喂给 AI 的提示词**，只让它输出 JSON。 |
| [`example.html`](example.html) | 可直接打开的完整示例。 |
| [`new-concept-map.sh`](new-concept-map.sh) | macOS 快捷脚本：从剪贴板读取 JSON，自动生成 HTML 并用浏览器打开。 |

## 使用流程

```
① 把【提示词 concept_map_prompt_json.md】+【要分析的文本】发给 AI
        ↓
② AI 只返回一段 JSON
        ↓
③ 套用下面的 HTML 模板：粘入 JSON，保存为 .html
  （或用 new-concept-map.sh 脚本：复制 JSON 后运行脚本，一步完成）
        ↓
④ 用浏览器打开，完成渲染
```

### 第 ③ 步的 HTML 模板

把 AI 返回的 JSON 粘进 `<script type="application/json" id="conceptmap-data">` 里即可：

```html
<!DOCTYPE html>
<meta charset="utf-8">
<title>概念地图</title>

<script type="application/json" id="conceptmap-data">
{ ...把 AI 输出的 JSON 粘到这里... }
</script>

<script src="conceptmap-init.js"></script>
```

保证 `conceptmap-init.js` 与该 html 在同一目录（或改成正确路径）即可。
直接双击用浏览器打开就能看到地图。

> 渲染器从 CDN（cdn.jsdelivr.net）加载 Cytoscape，首次打开需联网。

### macOS 快捷脚本

`new-concept-map.sh` 可以把"复制 JSON → 生成 HTML → 浏览器打开"三步合一：

1. 复制 AI 输出的 JSON 到剪贴板
2. 运行 `bash new-concept-map.sh`（或绑定到 macOS 快捷指令 / Alfred）
3. 浏览器自动打开概念地图

脚本会从 JSON 的 `meta.title` 读取文件名，保存到 `~/WIKI/RAW/assets/conceptmap/` 目录。

## JSON 数据格式

就是 Cytoscape 原生的 `elements` 格式，AI 直接输出无需转换：

```json
{
  "meta": {
    "title": "标题",
    "subtitle": "副标题（可选）",
    "seed": 1
  },
  "nodes": [
    { "data": { "id": "core", "label": "核心概念", "desc": "精炼解释", "type": "key" } },
    { "data": { "id": "a1",   "label": "分支概念", "desc": "精炼解释", "type": "blue" } }
  ],
  "edges": [
    { "data": { "source": "core", "target": "a1", "label": "包括",      "cross": false } },
    { "data": { "source": "a1",   "target": "b2", "label": "由……引起",  "cross": true  } }
  ]
}
```

- **`type`** 控制节点配色，详见下表。
- **`desc`** 是概念的通俗解释——这是概念地图区别于普通框图的关键，请保留。
- **`cross`** 控制连接线样式：`false` = 实线（常规/层级关系）；`true` = 强调色虚线（**长程/跨领域连接**，概念地图的精髓）。
- **`seed`** 固定布局随机种子，相同种子每次刷新得到完全一样的布局，省去手动调整。

### 节点配色

| type | 适用场景 |
|------|----------|
| `key` | 核心/中心概念（红底白字，最突出） |
| `blue` | 理论、原则、规范类概念 |
| `green` | 方法、过程、成果类概念 |
| `purple` | 抽象、哲学、价值观类概念 |
| `orange` | 应用、实践、行动类概念 |
| `teal` | 技术、系统、工具类概念 |
| `yellow` | 需要特别关注的重要概念 |
| `red` | 问题、矛盾、挑战类概念 |
| `pink` | 情感、关系、人文类概念 |
| `gray` | 背景性、次要、辅助概念 |

配色策略：同一分支下的子节点用同一种颜色；全图控制在 4~5 种颜色以内，视觉最和谐。

## 交互

- **点击节点**：高亮经过该节点的所有路径——沿有向边向上追溯所有来源，向下展开全部后续分支；其余节点淡出。点击空白处还原。
- **滚轮 / 拖拽**：缩放、平移画布。
- **右下角按钮**：
  - `+` / `−`：放大 / 缩小
  - `⊡`：适应屏幕
  - `🌙` / `☀`：切换夜间 / 日间模式（偏好保存到 localStorage）
  - `⬇`：导出，弹出菜单选择格式

## 导出

右下角点击 `⬇` 可导出当前地图：

| 格式 | 说明 |
|------|------|
| **PNG** | 位图截图，适合嵌入文档或分享 |
| **SVG** | 真矢量导出，文字与连线均为矢量，无限放大不失真，文件体积远小于位图 |

SVG 导出使用 `cytoscape-svg` 捕获连线层，再叠加 `<foreignObject>` 写入卡片富文本，完整保留渐变背景、配色、描述文字。

## 布局

- 使用 **fCoSE** 弹力布局算法（自动降级为 CoSE），高质量分布节点。
- 布局完成后自动运行**防遮挡路由**：检测穿越节点的连线，基于 Liang-Barsky 算法自动弯曲绕开遮挡，无需手动调整。

## 自定义

所有视觉参数都集中在 `conceptmap-init.js` 顶部，改这里即可全局调整，无需改动数据：

| 常量 | 作用 |
|------|------|
| `PALETTE` | 各 type 的背景色 / 边框色 / 文字色 |
| `CROSS_COLOR` | 交叉连接线颜色 |
| `THEMES` | 夜间 / 日间模式的连线色、标签色 |
| `FONT_SIZES` | 卡片标题、描述、边标签的字号（改这里，屏幕渲染与 SVG 导出同步生效） |
| `NODE_W` | 节点卡片宽度（key / other） |
| `NODE_MIN_H` | 节点卡片最小高度 |
