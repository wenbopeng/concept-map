#!/bin/bash

# 从剪贴板读取概念地图 JSON，生成 HTML 并在浏览器打开
export LC_ALL=en_US.UTF-8

target_dir="/Users/wenbo/WIKI/RAW/assets/conceptmap"
mkdir -p "$target_dir"

clipboard_content=$(pbpaste)

# 简单校验：剪贴板内容应包含 "nodes" 字段
if ! echo "$clipboard_content" | grep -q '"nodes"'; then
  osascript -e 'display alert "概念地图" message "剪贴板内容不像是概念地图 JSON，请先复制 JSON 数据。"'
  exit 1
fi

# 尝试从 JSON 的 meta.title 提取标题，失败则用默认值
title=$(echo "$clipboard_content" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('meta',{}).get('title','概念地图'))" \
  2>/dev/null || echo "概念地图")

html_content='<!DOCTYPE html>
<meta charset="utf-8">
<title>'"${title}"'</title>

<script type="application/json" id="conceptmap-data">
'"${clipboard_content}"'
</script>

<script src="conceptmap-init.js"></script>
'

safe_title=$(echo "$title" | tr '/:*?"<>|\\' '_' | xargs)
filename="${safe_title:-$(date +"%Y%m%d%H%M%S")}.html"
file_path="${target_dir}/${filename}"

printf "%s" "$html_content" > "$file_path"

open "$file_path"
