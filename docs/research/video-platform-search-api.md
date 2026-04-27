# 视频平台搜索API研究

> 说明：本文中的平台可用性、成功率倾向与耗时数字属于探索阶段观察样本，不应视为长期稳定结论；实际接入前应按当前网络环境、平台策略和接口状态重新验证。

## 四大平台搜索能力总结

| 平台 | API可用性 | 速度 | 备注 |
|------|-----------|------|------|
| **B站 (Bilibili)** | ✅ 已验证可用（样本） | 0.3s | JSON格式，返回较完整视频信息 |
| **优酷 (Youku)** | ⚠️ 有限可用（样本） | 0.2s | videoId是base64，url为空 |
| **腾讯 (Tencent)** | ⚠️ 本轮样本未打通 | - | 返回错误码 |
| **爱奇艺 (iQiyi)** | ⚠️ 本轮样本未打通 | - | 返回HTML，解析无效 |

### 搜索引擎备用

| 引擎 | 速度 | 可用性 | 备注 |
|------|------|--------|------|
| **百度移动端** | 0.7s | ✅ 可用（需验证） | 找到BV号，需验证 |
| **Google** | 1s+ | ⚠️ 依赖网络环境 | 部分环境下访问受限 |
| **必应** | 1s+ | ⚠️ 结果不稳定 | 链接提取困难 |

---

## B站搜索API

### API端点
```
https://api.bilibili.com/x/web-interface/search/all
```

### 请求参数
| 参数 | 说明 | 示例 |
|------|------|------|
| `keyword` | 搜索关键词 | `小潮院长+羊村` |
| `page` | 页码 | `1` |
| `page_size` | 每页数量 | `10` |
| `platform` | 平台 | `web` |

### 完整请求示例
```python
import requests

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
}

url = "https://api.bilibili.com/x/web-interface/search/all"
params = {
    "keyword": "小潮院长 羊村",
    "page": 1,
    "page_size": 10,
    "platform": "web"
}

r = requests.get(url, params=params, headers=headers, timeout=10)
data = r.json()
videos = data['data']['result']['video']
```

### 返回字段
```json
{
  "bvid": "BV1ULBgBiEjT",
  "title": "<em class=\"keyword\">羊村</em>第五季（1）：启动篇",
  "author": "小潮院长",
  "aid": 115770054940272,
  "pic": "//i1.hdslb.com/bfs/archive/54f77a0cab2f2dda7b6c50ff73001a055ef03975.jpg",
  "play": 16558351,
  "duration": "85:18",
  "arcurl": "https://www.bilibili.com/video/BV1ULBgBiEjT",
  "pubdate": 1704067200
}
```

### 速度对比

| 方式 | 耗时 | 说明 |
|------|------|------|
| **浏览器 new_page** | ~3.2s | new_page(2.4s) + snapshot(0.8s) |
| **API请求** | ~0.3s | 直接HTTP GET + JSON解析 |
| **提升** | **约 10x（样本）** | |

---

## 视频URL格式

### B站
```
https://www.bilibili.com/video/{bvid}
示例: https://www.bilibili.com/video/BV1ULBgBiEjT
```

### 优酷
```
https://v.youku.com/v_show/id_{video_id}.html
```

### 腾讯视频
```
https://v.qq.com/x/cover/{album_id}/{video_id}.html
```

### 爱奇艺
```
https://www.iqiyi.com/v_{video_id}.html
```

---

## 发现层策略建议

### 角色边界

本文聚焦**搜索/发现层证据**，不单独定义完整播放工作流。

- 平台偏好（用于选择最佳正版播放源）应为：`iQiyi → Youku → Tencent → Bilibili`
- 发现顺序可以不同：优先用当前最成熟、结构化程度最高的路径缩小候选，再把候选映射到目标平台

### 基于现状证据的发现顺序

1. **先试结构化/API 路径** - 当前以 B 站 API 作为最成熟、字段最完整的快路径
2. **再试搜索引擎或其他 metadata 辅助** - 仅作候选补充，结果需校验
3. **最后走浏览器搜索** - 用于没有可靠 API 的平台，或需要拿到最终正版落点

### 与播放工作流的衔接

1. 结构化结果可用时，先用标题、作者、时长、集数做确认
2. 若已拿到**最终目标平台**的 canonical URL，优先直接打开目标页
3. 若只有搜索结果页，退化为 DOM click
4. 只有在浏览器渲染结果仍有歧义时，才需要截图确认

### 混合搜索示意

```
用户: "我要看 XXX"

1. B站API搜索 (0.3s)
   └→ 找到视频?
       ├→ Yes: 返回候选 metadata / 候选 canonical URL（如可得）
       └→ No: 继续

2. 按需要补浏览器搜索（优先 iQiyi → Youku → Tencent → Bilibili）
   └→ 找到可确认结果?
       ├→ Yes: 返回最终目标平台的 canonical URL 或页面候选
       └→ No: 返回"未找到"

3. 如果B站找到多个结果:
   └→ 先展示标题 + 播放数 + 封面图等结构化信息
   └→ 用户选择: "第X个"
   └→ 再按平台偏好确认最终打开落点
```

### 模糊词处理

```
用户: "我要看羊村"
    ↓
B站API搜索 "羊村" → 返回所有含"羊村"的视频
    ↓
展示给用户（含封面、标题、播放数等结构化信息）
    ↓
用户确认: "小潮院长的那个，第3个"
    ↓
若已有最终目标平台的 canonical URL → 直接打开
若需要寻找更优正版源 → 再按 iQiyi → Youku → Tencent → Bilibili 补落点
```

---

### 已知问题

#### B站API限制
- 部分API需要登录Cookie
- `search/type` API返回412（需要完整cookie）
- `search/all` API可用（不需要cookie）

#### 优酷问题
- videoId是base64编码，无法直接使用
- url字段为null，需要额外解析
- 需要进一步研究如何获取直链

#### 腾讯视频
- 返回 `ret: 10401 unknow error`
- API端点需要特定参数

#### 爱奇艺
- 返回HTML而非JSON
- 需要浏览器环境才能正确渲染

#### 百度搜索
- 部分BV号是假的（如`BVVVVVVVVVVV`）
- 需要验证BV号是否有效（HEAD请求）
- 返回大量噪音数据

---

## 综合搜索实现

### 搜索策略（发现层）

```
1. B站API搜索（当前最成熟的快路径）
   └→ 返回结构化数据，便于先做歧义消解

2. 百度移动端搜索（备用 metadata 路径）
   └→ 返回 BV 号列表
   └→ 需验证 BV 有效性，且不能替代最终平台落点确认

3. 浏览器搜索（兜底）
   └→ 用于无可靠 API 的平台，以及最终正版播放页定位
```

### 综合搜索代码

```python
import requests
import re
import base64

def search_bilibili(query, page=1, page_size=10):
    """B站API搜索 - 当前已验证的结构化快路径之一"""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/plain, */*",
    }
    url = "https://api.bilibili.com/x/web-interface/search/all"
    params = {"keyword": query, "page": page, "page_size": page_size, "platform": "web"}
    r = requests.get(url, params=params, headers=headers, timeout=10)
    data = r.json()
    videos = data.get('data', {}).get('result', {}).get('video', [])
    return [
        {
            "bvid": v.get('bvid'),
            "title": re.sub(r'<[^>]+>', '', v.get('title', '')),
            "author": v.get('author'),
            "play": v.get('play'),
            "duration": v.get('duration'),
            "url": f"https://www.bilibili.com/video/{v.get('bvid')}"
        }
        for v in videos
    ]

def search_baidu(query, count=10):
    """百度移动端搜索 - 备用方案"""
    headers = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"}
    url = "https://www.baidu.com/s"
    params = {"wd": f"{query} site:bilibili.com", "rn": count}
    r = requests.get(url, params=params, headers=headers, timeout=10)
    bvs = re.findall(r'BV[a-zA-Z0-9]{10}', r.text)
    bvs = list(set(bvs))
    return [{"bvid": bv, "url": f"https://www.bilibili.com/video/{bv}"} for bv in bvs]

def search_all(query):
    """综合搜索：先拿结构化候选，再决定是否需要浏览器补落点"""
    results = {"bilibili": [], "baidu": []}
    results['bilibili'] = search_bilibili(query)
    if not results['bilibili']:
        results['baidu'] = search_baidu(query)
    return results
```

### 搜索速度对比

| 方式 | 速度 | 备注 |
|------|------|------|
| B站API | 0.3s | 发现层快路径 |
| 百度移动端 | 0.7s | 备用 metadata 路径 |
| 浏览器搜索 | 3s+ | 慢路径 / 最终兜底 |
