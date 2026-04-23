# Doc Assistant · 故障排查手册（Troubleshooting）

> 本文件沉淀项目中**踩过、修过、值得后人警觉**的非显然问题。
> 每条包含：症状、根因、修复、验证点、相关代码锚点。
>
> 加新条目时请遵守下述格式，并在 `docs/CHANGELOG.md` 里引用章节号。

---

## §1 · Lexical 在 Shadow DOM 中光标失效

### 症状

- 对话框里点击输入框后，打字**完全无反应**
- 没有任何报错
- 原生 `<textarea>` 放在同一个 Shadow DOM 里工作正常

### 根因

浏览器 Selection API 被 shadow 边界**故意截断**：

- `document.getSelection()`（即 `window.getSelection()`）**不会**返回 shadow
  内部节点的选区；它看到的 anchorNode 要么是 null，要么指向 shadow host
  本身（即 `<div id="doc-assistant-root">`）
- Chromium 另外提供了 `shadowRoot.getSelection()` 用于拿到 shadow 内选区
- Lexical 0.19 内部仅使用 `window.getSelection()` 判定光标，并在
  `isSelectionWithinEditor` 里验证 anchorNode 是否在 editor root 的子树里
- 拿到的选区永远在 shadow 之外 → 验证失败 → 输入被静默丢弃

这是 Web 规范有意设计的"封装保护"，并非 Chromium bug。所有基于
`contenteditable` 的富文本引擎（Lexical / Slate / TipTap / Quill）
在 Shadow DOM 内都会遇到同类问题。原生 `<textarea>` 不受影响是因为
它的光标由浏览器 C++ 层直接维护，不走 DOM Selection API。

### 修复

`apps/extension/src/sidebar/patch-shadow-selection.ts`

在 React 挂载前包装 `window.getSelection`：

```ts
const patched = () => {
  for (const root of registeredRoots) {
    const shadowSel = root.getSelection?.();
    if (shadowSel?.anchorNode && root.contains(shadowSel.anchorNode)) {
      return shadowSel;
    }
  }
  return nativeGetSelection();
};
window.getSelection = patched;
```

判定必须用 **"anchorNode 真的落在 shadow 子树内"**，而不能仅凭
`shadowRoot.activeElement` 非空——因为焦点停留和选区归属是两回事，
活动选区在页面但焦点仍在 sidebar 的场景下会误判（划词引用失效即此故）。

### 验证点

- Console 启动时出现
  `[extension:sidebar:shadow-selection-patch] window.getSelection 已打补丁以支持 Shadow DOM`
- 在 sidebar 里能正常打字
- **划词引用仍能工作**（说明未误把宿主页面选区吞成 shadow 选区）

### 安全讨论

- Chrome 扩展 content script 运行在 **Isolated World**，我们覆盖的
  `window.getSelection` 仅在 content script 的 JS Realm 生效，**不会**
  被宿主页面脚本看见
- 宿主页面脚本原本就能通过 `document.getElementById('doc-assistant-root').shadowRoot`
  读取我们的 DOM（MV3 content script DOM 共享宿主 document），
  这个 patch 并未引入新的攻击面

---

## §2 · Tool-calling 只走一轮后停止（finish 语义错位）

### 症状

- LLM 明确决定要调 tool（Network 里能看到第一轮响应 `finish_reason: "tool_calls"`）
- Console 能看到 `[agent:loop] loop turn 0` + `收到 tool-call`
- 但**看不到** `tool 执行完成` 日志，也没有第二轮 `chat/completions` 请求
- UI 上呈现"半句话 + 永远不来的回复"

### 根因

"finish" 这个信号在不同层级的语义完全不同，之前代码把它们混用了：

| 层级 | `finish` 的含义 |
|---|---|
| Qwen SSE 最后一块的 `finish_reason` | **一次 HTTP 响应**结束 |
| AI SDK `fullStream` 的 `finish` part | **一次 `streamText` 调用**结束 |
| `ChatChunk.finish`（我们的类型） | **Agent 整段运行结束** |

多轮 tool-calling 场景下一次"用户问 → 助手回答"对应**多次** HTTP
请求：

```
请求 1：LLM 返回 "我要调 read_page_content" → finish_reason=tool_calls
[本地执行 tool]
请求 2：LLM 拿着 tool 结果继续写回答 → finish_reason=stop
```

之前 `QwenProvider` 把 AI SDK 的每次 `finish` 原样归一化后透传，
`runAgentLoop` 继续透传，`useStreamingChat` 一看到 `finish` 就
`break`——这个 break 让 AsyncGenerator 被 `return()`，反向沿链路
传播终止：

```
useStreamingChat break
  → Agent.run() 迭代被 return
    → runAgentLoop() 迭代被 return
      → loop 还没来得及执行 tool、更没发起第二轮
```

### 修复

`packages/agent/src/loop.ts`

- 循环内对 `case 'finish'` **不再 yield**，仅记录 `finishReason`
- 每轮结束后 loop 根据 `pendingCalls / finishReason` 自行决定：
  - 执行 tool → 进入下一轮
  - 或 yield 自己合成的终止 `finish` 退出
- `packages/shared/src/chat.ts` 的 `ChatChunk.finish` 增加 JSDoc：
  > 这里的 finish **代表 Agent 层整段对话的结束**（包含所有
  > tool-calling 轮次）。底层每次 LLM HTTP 请求也会有自己的
  > "finish"，但 runAgentLoop 会吞掉那些中间 finish。

此外：`useStreamingChat` 给 `applyChunk(chunk)` 套了 `try/catch`，
防止 UI 渲染异常通过 generator return 反向吞掉上游 loop。

### 验证点

开启 Verbose 日志，Console 里应看到完整链路：

```
[agent:loop] loop turn 0
[agent:loop] turn 0 收集到 1 个 tool-call，开始执行
[agent:loop] tool read_page_content 执行完成 isError=false
[agent:loop] loop turn 1
[agent:loop] turn 1 无 pendingCalls，结束
```

Network 里应看到**两次** `chat/completions` POST。

### 经验教训

跨层事件流里**同名不同义**的信号非常危险。防御做法：

- 跨层通信的类型在名字或注释里体现"这是哪一层的事件"
- 避免"原样上抛"——每一层都应把下层的事件**翻译**成自己这层的
  语义，而不是透传

---

## §3 · 构建产物在宿主页面 origin 下 404

### 症状

DevTools Network 看到大量类似请求：

```
GET https://datawhalechina.github.io/assets/logger-yPrDaEQy.js   404
GET https://datawhalechina.github.io/assets/messaging-xxx.js     404
```

**注意**：代码其实正常运行，因为真正的 `import` 仍走相对路径能加载成功。
上面 404 的是 `<link rel="modulepreload">` 预加载。

### 根因

三种 URL 解析方式混在一起：

| 方式 | 基准 URL | 在扩展里是否正确 |
|---|---|---|
| `chrome.runtime.getURL('...')` | 扩展域（显式） | ✅ |
| 相对路径 `./xxx.js`（ES module） | **文件自身 URL** | ✅（文件在扩展域） |
| 绝对路径 `/assets/xxx.js`（`<link>`） | **当前 document origin** | ❌（document 是宿主页面） |

Vite 默认会注入 `__vitePreload` 辅助函数，它按 `base: '/'` 生成
`<link rel="modulepreload" href="/assets/xxx.js">`，在普通 web 项目
正确，但在 content script 上下文里 `/` 被解析成**宿主页面 origin**。

### 修复

`apps/extension/vite.config.ts`：

```ts
build: {
  modulePreload: false,
}
```

关闭预加载后，真正的 `import` 由浏览器按相对路径自然解析到
`chrome-extension://...`，全部成功。

### 代价

失去 "modulepreload 拍平依赖瀑布"的首屏优化，多 1~2 次网络 RTT。
对"用户主动点击才出现的 sidebar"无感。

### 未来优化（不急）

想恢复预加载可用 `build.modulePreload.resolveDependencies`
自定义 URL 生成逻辑，转成 `chrome.runtime.getURL(...)` 形式。
MVP 阶段不值得。

---

## §4 · LLM 请求被 CORS 拦截

### 症状

- sidebar UI 正常
- 发送消息后 Network 里没有到 `dashscope.aliyuncs.com` 的请求，
  或有请求但响应被 CORS 挡下
- Console 出现 `Access-Control-Allow-Origin` 相关报错

### 根因

Manifest V3 下 content script 发起的跨源请求**仍受 CORS 约束**，
与普通网页脚本一致。必须在 manifest 里通过 `host_permissions`
声明允许的目标域，Chrome 才会豁免 CORS。

### 修复

`apps/extension/manifest.json`：

```json
"host_permissions": [
  "https://dashscope.aliyuncs.com/*",
  "https://dashscope-intl.aliyuncs.com/*"
]
```

> 新增 host_permissions 后必须在 `chrome://extensions` 手动刷新
> 扩展一次，已打开的 tab 也需刷新。

### 未来扩展

若支持更多 Provider（OpenAI、Anthropic、Ollama……），每个域都要
追加到 `host_permissions`。建议 Options 页允许用户自行填 baseURL
时，同时提示"本扩展仅预授权 `dashscope.aliyuncs.com`，其他域
需在 manifest 声明后重新打包"。

---

## §5 · 输入卡顿 + 宿主页面 404 请求风暴

### 症状

- 在 sidebar 输入框敲字有 **秒级** 延迟
- 与此同时宿主页面（尤其技术博客）控制台刷屏 `GET /404.thml` 404
  （注意不是我们发的，是宿主页面自己的代码）

### 根因

原 `ChatPanel` 的 `pageSummary` 计算是**同步且无缓存**的：

```tsx
const pageSummary = getPageSummary();  // 每次 render 都同步调用
```

而 `getPageSummary` 内部跑 `runIdentityPipeline + runContentPipeline`，
会 `document.cloneNode(true)` 并运行 Readability 解析全量 DOM。
Lexical 每敲一键通过 `OnChangePlugin → forceTick` 触发 ChatPanel
重渲染 → **打一个字就全量提取一次页面**。

大量读 DOM 又触发了宿主博客的 IntersectionObserver 预取逻辑（其 URL
里手滑写成 `.thml`），形成 404 风暴。

### 修复

`packages/ui/src/features/chat/ChatPanel.tsx`：

```tsx
const pageSummary = useMemo(() => getPageSummary(), [visible]);
```

只在面板显隐切换时重算。`send` 时 `buildInvokeContext` 会通过
`getPageSummary()` 即时取最新摘要，保证发给 LLM 的信息仍然新鲜。

### 验证点

- 输入延迟 < 50ms（流畅）
- Network 中的 404 请求不再因输入而增加

---

## §6 · 划词引用点击无反应

### 症状

- 页面上划词 → 弹出"引用到 Doc Assistant"按钮
- 点击后 sidebar 打开了，但输入框里**没有出现 chip**
- Console 看不到任何错误

### 根因

两个叠加的闭包/时序问题：

**Bug A：shadow-selection patch 过度激进**
之前 patch 的判定条件是 `shadowRoot.activeElement 非空`，用户划词
后焦点可能仍在 sidebar 的 contenteditable 上，导致
`window.getSelection()` 返回了 shadow 内的空选区，吞掉用户真实选区。
修为严格判定"anchorNode 必须落在 shadow 子树内"。

**Bug B：Lexical plugin 的 useEffect 顺序**

```tsx
<InsertReferencePlugin registerInsert={fn => insertRef.current = fn} />
{/* ... */}
{actionsRef && <ActionsBridge actionsRef={actionsRef} />}
```

- `InsertReferencePlugin.useEffect` 先跑 → 想把 `fn` 写入
  `actionsRef.current.insertReference` → 此时 actionsRef.current 还是 null，
  什么都没写入
- `ActionsBridge.useEffect` 后跑 → 把 `actionsRef.current` 设成
  `{ insertReference: 空占位, clear, focus }`
- `useSelectionBridge` 拿到的 insertReference 永远是那个空占位

### 修复

让 `ActionsBridge.insertReference` 作为**闭包**实时从 `insertRef`
读取，而不是在 useEffect 瞬间把值固化：

```tsx
actionsRef.current = {
  insertReference: (payload) => insertRef.current?.(payload),
  clear, focus,
};
```

对应 `useSelectionBridge` 从"接受函数"改为"接受 getter"：

```ts
useSelectionBridge(() => inputActionsRef.current?.insertReference ?? null);
```

selection-toolbar 改用 `document.getSelection()`（未被 patch 覆盖）
明确拿宿主页面选区，语义更清晰。

### 验证点

- 页面划词 → 点按钮 → 输入框出现蓝色 chip
- Console 有 `[extension:selection-toolbar] 引用已派发: ref_xxx`

---

## §7 · Shadow DOM 内 `contain: size` 让背景消失

### 症状

- 加了 `contain: layout style size` 到 shadow host 后
- 对话框面板背景变透明，能直接透过看到宿主页面
- 内部布局尚正常

### 根因

`contain: size` 要求元素**在不依赖子内容的情况下计算尺寸**，实际
以 `width:0; height:0`（host 的样式）作为整个 shadow 内容的布局
基准。依赖视口尺寸计算的 `backdrop-filter` 和 `background: rgba(...)`
在 0×0 的 containment 容器里被浏览器**整体跳过渲染**。

此外 `contain: layout` 会改变 `position: fixed` 子孙的包含块规则
（fixed 不再相对视口而是相对该容器），跨浏览器行为不一致。

### 修复

移除全部 `contain:*` 声明，只保留：

```css
pointer-events: none;  /* 0×0 host 不拦截事件 */
all: initial;          /* 避免继承宿主页面样式 */
```

内部需要交互的 `Panel` / `CollapsedFab` 显式 `pointer-events: auto`
恢复命中测试。

### 验证点

- 对话框背景恢复半透明白 + backdrop-filter 毛玻璃
- 宿主页面内容不再透过面板显示

---

## §8 · v0.2.1 · Service Worker 与 sidebar 的 IndexedDB 同源隔离风险

### 症状（预防性条目；本期通过架构规避未触发）

- 在 SW 的 `chrome.alarms.onAlarm` 内 `new DexieMemoryStore()` 并调 `recall/remember`
  可能**读不到** sidebar 写入的数据，或写入的数据 sidebar 也看不见。

### 根因

- sidebar（content script 挂载的 Shadow DOM）跑在**宿主页面 origin**下
  （例如 `https://example.com`），IndexedDB 属于该 origin。
- Service Worker 跑在 **`chrome-extension://<id>`** origin 下，独立的一组 IndexedDB。
- 两边 `DexieMemoryStore` 看似打同名库，但**不是同一个 DB**。反思 Job 若在 SW 跑，
  sidebar 永远看不到结果；反之亦然。

### 修复（本期采用）

选择"**SW 只唤醒、sidebar 执行**"的稳妥方案：
- `chrome.alarms.onAlarm`（SW）→ `chrome.runtime.sendMessage({ type: REFLECTION_SCAN_TICK })` 广播
- sidebar 监听该消息 → 调 `ReflectionScheduler.runPending()`（跑在 sidebar origin）
- 没有 sidebar 在线时消息被丢弃，下次打开 sidebar 时 bootstrap 会主动补跑一次

### 验证点

- `apps/extension/src/background/index.ts` 的 alarm handler 不直接访问 Dexie
- `apps/extension/src/sidebar/index.tsx` 的 `useEffect` 监听 `REFLECTION_SCAN_TICK`
- 真机加载扩展后：alarm 触发 → sidebar 控制台打 "收到 REFLECTION_SCAN_TICK" 日志

### 相关代码锚点

- `apps/extension/src/background/index.ts` · L88-102 alarm → 广播
- `apps/extension/src/sidebar/index.tsx` · L91-106 sidebar 监听与 runPending
- `packages/shared/src/messaging.ts` · `MessageType.REFLECTION_SCAN_TICK`

---

## §9 · v0.2.1 · aux LLM 返回空 JSON 时 `parseSummaryOutput` 回退行扫描导致误判

### 症状

单测 "aux 返回 `{"summary":""}` → runner 返回 ok:false" 首次失败：
实际拿到 `ok:true` 且把整串 `{"summary":""}` 当作 summary 文本落库。

### 根因

`parseSummaryOutput` 原逻辑：JSON 解析成功但 summary 空时**继续走行扫描回退**，
第一行就是 `{"summary":""}` 被当作有效 summary。

### 修复

`parseSummaryOutput` 改为：**一旦 JSON 解析成功，无论结果是否为空都尊重其结果**
（空 summary → 返回 null），**仅在没有合法 JSON 时**才走行扫描回退。

### 验证点

- `packages/agent/src/__tests__/reflection.test.ts` "aux 返回空摘要 → ok:false" 通过
- `packages/agent/src/__tests__/reflection.test.ts` 其它解析用例均通过

### 相关代码锚点

- `packages/agent/src/reflection/runner.ts` · `parseSummaryOutput`

### 启示

**"宽松解析"不等于"多层兜底"**。当结构化解析成功但值为空，是明确的"无内容"信号，
不应再走二次回退 —— 否则会把自身的数据结构当内容回传给主 LLM。

---

## §10+ · 预留

> v0.2.1 以上踩坑已沉淀。后续若遇到反思 Job 在 SW 真机失败（跨 origin 问题暴露）、
> Dexie 在 fake-indexeddb 与真实 IDB 行为差异、千问 embedding 限流/节流等，继续按
> §1~§9 的格式补齐条目：
>
> - 症状 · 根因 · 修复 · 验证点 · 相关代码锚点

---

## 附录 · 排查方法论

这次修复集中体现的通用技巧，后续踩坑时可复用：

### 1. 相信日志，不相信直觉

- 遇到"流式接口异常"第一反应应是加细粒度日志，而非读代码猜
- 日志的**缺失**本身就是线索：某条日志没打印，意味着代码没走到，
  往往能定位被异常中断或被 generator return 反向终止的位置

### 2. 分层定位

提问顺序：

1. 是**浏览器/平台层**的问题吗？（Shadow DOM selection、CORS、CSP）
2. 是**打包/构建层**的问题吗？（URL 基准、preload、chunk 拆分）
3. 是**框架层**的问题吗？（Lexical、React useEffect 顺序）
4. 是**我们自己业务层**的问题吗？

不跨层混想，往往能快速缩小范围。

### 3. AsyncGenerator / 流式 API 的隐形杀手

**"下游 break → 上游被 return()"** 这个机制常被忽略，但在流式链路
里非常致命。任何跨层流式代码，消费方的 break / 抛错都会**反向传播
到上游**强制终止。解决方式：

- 跨层事件类型名要能体现"这是哪层的事件"
- 消费方在 break 之前确认当前事件确实代表"整段结束"
- 生产方对中间终态事件做**语义翻译**，不原样上抛

### 4. 浏览器扩展的"身份错位"

content script 是扩展开发里最容易出问题的部分，因为它的代码住在
扩展域、但执行在宿主页面 document 里。几乎所有扩展疑难杂症都根源
于此：

- CSP / CORS（按宿主页面 origin）
- `window.getSelection()`（shadow 边界）
- 绝对路径 URL（按宿主 document 解析）
- `document.*` API（宿主 DOM）

**判断某个操作要不要跨身份时，问一句"这个 API 的基准 URL 是什么"。**
