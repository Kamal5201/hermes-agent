# Windows MCP 命令速查

> 说明：本文中的 `mcp_init`、`mcp_call`、`find_target_link`、`get_latest_page`、`has_player` 等辅助函数名均为说明流程用的伪代码 / 占位符，实际实现需按当前调用封装替换。

## MCP HTTP API

```
Base URL: <windows-mcp-base-url>
Header:   mcp-session-id: {session_id}
Content-Type: application/json
```

## 请求格式

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "PowerShell",
    "arguments": {
      "command": "chrome-devtools <command> <args>",
      "timeout": 30
    }
  },
  "id": 2
}
```

## Session 初始化（示意伪代码）

```python
r = requests.post(BASE, json={
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "hermes", "version": "1.0"}
    },
    "id": 1
}, headers=HEADERS, timeout=10)
sid = r.headers.get('mcp-session-id')
```

---

## Chrome DevTools 命令

### 页面操作

| 命令 | 说明 | 示例 |
|------|------|------|
| `new_page <url>` | 打开新标签页 | `chrome-devtools new_page https://www.iqiyi.com` |
| `list_pages` | 列出所有页面 | 返回页面ID和URL |
| `select_page <num>` | 切换到指定页面 | `chrome-devtools select_page 2` |
| `close_page <num>` | 关闭指定页面 | `chrome-devtools close_page 3` |

### 页面内容

| 命令 | 说明 | 示例 |
|------|------|------|
| `take_snapshot` | 获取DOM快照 | 返回所有可交互元素的uid和文本 |
| `take_screenshot` | 截图 | 返回Windows路径如 `C:\Users\...\screenshot.png` |

### 交互

| 命令 | 说明 | 示例 |
|------|------|------|
| `click <uid>` | 点击元素 | `chrome-devtools click 71_56` |
| `type <uid> <text>` | 输入文本 | `chrome-devtools type 71_3 搜索内容` |
| `press <key>` | 按键 | `chrome-devtools press Enter` |

---

## DOM 元素解析

`take_snapshot` 返回格式:

```
uid=71_56 link "羊村来了 第205集"
uid=71_57 link "羊村日记 第1集"
...
```

解析代码（示意伪代码）:

```python
import re

def parse_snapshot(text):
    results = []
    for line in text.split('\n'):
        m = re.match(r'uid=(\d+_\d+)\s+(.+)', line.strip())
        if m:
            results.append((m.group(1), m.group(2).strip()))
    return results

# 使用
all_links = [(uid, t) for uid, t in elements if 'link' in t.lower()]
bv_links = [(uid, t) for uid, t in all_links if 'BV' in t]
```

---

## 产物回收（artifact retrieval，示意伪代码）

```python
def retrieve_artifact(artifact_uri, local_path, retriever):
    """由调用方注入具体传输方式，例如 HTTP 下载、共享目录同步或其他部署内方案。"""
    return retriever(artifact_uri, local_path)

# 示例占位符
artifact_uri = "<artifact-uri-or-remote_path>"
local_path = "<local_path>"
```

---

## 响应时间参考（实测）

| 操作 | 平均耗时 | 最坏情况 | 优化建议 |
|------|----------|----------|----------|
| `new_page` | 2.4s | 5s | 主要开销，无法优化 |
| `take_snapshot` | 0.8s | 2s | DOM序列化 |
| `take_screenshot` | 0.9s | 2s | Windows截图操作 |
| `click` | 1.2s | 2s | 点击元素 |
| `list_pages` | 0.8s | 1.5s | - |
| `select_page` | ~0s | 0.3s | 极快 |
| `close_page` | 0.5s | 1s | - |
| 产物回收 | 环境相关 | 环境相关 | 与具体传输方式有关 |
| MCP `initialize` | 0.003s | 0.01s | Python启动要3.8s |

---

## 常见调用片段（流程示意伪代码）

### 浏览器搜索页最小调用序列

```python
# 1. 初始化（只做一次）
sid = mcp_init()

# 2. 搜索 - new_page后直接snapshot，不sleep
result = mcp_call(sid, "PowerShell", {
    "command": f'chrome-devtools new_page {search_url}',
    "timeout": 30
})
# 不sleep，直接检测
for i in range(3):
    result = mcp_call(sid, "PowerShell", {
        "command": "chrome-devtools take_snapshot",
        "timeout": 15
    })
    elements = parse_snapshot(result)
    if len(elements) >= 50:
        break

# 3. 点击已确认目标链接
target_uid = find_target_link(elements)
mcp_call(sid, "PowerShell", {
    "command": f'chrome-devtools click {target_uid}',
    "timeout": 30
})

# 4. 切换页面 - 不等待
result = mcp_call(sid, "PowerShell", {
    "command": "chrome-devtools list_pages",
    "timeout": 15
})
latest_page = get_latest_page(result)
mcp_call(sid, "PowerShell", {
    "command": f"chrome-devtools select_page {latest_page}",
    "timeout": 10
})

# 5. 视频页 - 最多检测2-3次状态
for i in range(3):
    result = mcp_call(sid, "PowerShell", {
        "command": "chrome-devtools take_snapshot",
        "timeout": 15
    })
    elements = parse_snapshot(result)
    if i == 0 or has_player(elements):
        break

# 6. 需要时截图
mcp_call(sid, "PowerShell", {
    "command": "chrome-devtools take_screenshot",
    "timeout": 30
})
```

说明：
- 如果上游已经拿到**最终目标平台**的 canonical URL，优先直接 `new_page <canonical_url>`，不必先打开搜索页
- 如果结构化结果已经足够确认，就不必把截图当成默认步骤
- 如果 DOM 点击不稳定，再退化到截图/人工确认

## 占位符约定

```
<windows-mcp-base-url>  MCP HTTP 服务地址
<artifact-uri-or-remote_path>  截图或其他产物的位置标识
<local_path>  本地保存路径
<user> / <host> / <remote_path>  仅在部署文档需要举例远端传输时使用
```
