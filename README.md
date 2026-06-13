# 概念地图渲染器

让 AI 解析文本后，只输出一段 **JSON**，配上一行 `<script>` 即可在浏览器中渲染出**色彩鲜艳、图文并茂**的概念地图（Concept Map）。

灵感来自 Markdeep：渲染逻辑、配色、布局全部固化在模板里，AI 每次只负责产出数据。

## 文件

| 文件 | 作用 |
|------|------|
| [`conceptmap-init.js`](conceptmap-init.js) | **渲染器（模板层）**，写一次固定不变。加载 Cytoscape、注入样式、读取 JSON 并渲染。 |
| [`concept_map_prompt_json.md`](concept_map_prompt_json.md) | **喂给 AI 的提示词**，只让它输出 JSON。 |
| [`example.html`](example.html) | 可直接打开的完整示例。 |

## 使用流程

```
① 把【提示词 concept_map_prompt_json.md】+【要分析的文本】发给 AI
        ↓
② AI 只返回一段 JSON
        ↓
③ 套用下面的 HTML 模板：粘入 JSON，保存为 .html
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

## JSON 数据格式

就是 Cytoscape 原生的 `elements` 格式，AI 直接输出无需转换：

```json
{
  "meta":  { "title": "标题", "subtitle": "副标题" },
  "nodes": [
    { "data": { "id": "core", "label": "核心概念", "desc": "精炼解释", "type": "key" } },
    { "data": { "id": "a1",   "label": "分支概念", "desc": "精炼解释", "type": "blue" } }
  ],
  "edges": [
    { "data": { "source": "core", "target": "a1", "label": "包括",  "cross": false } },
    { "data": { "source": "a1",   "target": "b2", "label": "导致",  "cross": true  } }
  ]
}
```

- **`type`** 控制节点配色：`key`（核心，最大）/ `blue` `green` `purple` `orange` `teal`（各分支）/ `red` `pink` `yellow`（强调）/ `gray`（次要）。
- **`desc`** 是概念的通俗解释——这是概念地图区别于普通框图的关键，请保留。
- **`cross`** 控制连接线样式：`false` = 实线（常规/层级关系）；`true` = 强调色虚线（**长程/跨领域连接**，概念地图的精髓）。

## 交互

- **点击节点**：高亮其直接关联的概念与连线，其余淡出；点击空白处还原。
- **滚轮 / 拖拽**：缩放、平移画布。
- **右下角按钮**：放大、缩小、适应屏幕。
- 鼠标悬停节点：在不支持富文本节点的环境下会以气泡显示 `desc`。

## 自定义

所有视觉参数都集中在 `conceptmap-init.js` 顶部：`PALETTE`（配色）、`CROSS_COLOR` / `EDGE_COLOR`（连线色）、`runLayout`（布局参数）。改这里即可全局调整，无需改动数据。
