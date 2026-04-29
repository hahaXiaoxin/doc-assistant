# Doc Assistant · 隐私政策

> 最近更新：2026-04-29（v0.4.0）
> 适用版本：v0.4.0 起

Doc Assistant 是一个"自带 LLM"（bring-your-own-LLM）的浏览器扩展——大模型服务由**你自己配置**，插件只是前端壳子。本文档解释插件会接触到哪些数据、数据去哪了、以及 `<all_urls>` 广域权限的必要性。

---

## 1. 数据三原则

### 1.1 API Key 仅存本机

- 所有 Provider 的 API Key（主对话 / 辅助 / Embedding）都只保存在 `chrome.storage.local`
- **不**通过 `chrome.storage.sync` 同步到 Google 账号
- **不**上传到任何我们（或第三方）控制的服务器
- 日志中 API Key 一律脱敏（如 `sk-****1234`）

### 1.2 对话内容 + 页面摘要仅发送到你配置的 baseURL

- 侧边栏对话消息、反思任务抽取的 visit_summary / Persona candidate、话题识别调用——**唯一**的网络出口是你在配置页填入的 LLM `baseURL`
- 我们不代理、不中转、不采集任何对话内容
- 页面正文提取完全在本地（content script）进行，只有在调用 LLM 时才会作为 context 发送到**你配置的** baseURL
- 如果你填入的是 OpenAI 官方端点，数据就发到 OpenAI；如果是自托管 Qwen，数据就发到你的自托管服务器；如果是 Anthropic，数据就发到 Anthropic——**发送目标完全由你的配置决定**

### 1.3 IDB 记忆（四层）完全本地

v0.2 起引入的四层记忆系统——Persona（长期指令）/ Episodic（事件记忆，消息 + visit 摘要）/ SessionTopic（会话话题）/ WorkingMemory（工作记忆）——全部存储在 IndexedDB（Dexie）里，**仅限本机**：

- 不上传、不同步、不备份到云
- 向量 embedding 在本地存储，召回计算也在本地完成
- 你可以在配置页「记忆浏览器」Tab 中浏览全部 visit_summary，并单条删除
- 卸载扩展或清除浏览器数据时，所有记忆随之清空

---

## 2. 权限说明

### 2.1 为什么需要 `<all_urls>`？

v0.4.0 起，扩展的 `host_permissions` 声明为 `<all_urls>`。这是出于一个直接的工程原因：

> **Chrome 的 CORS 策略要求扩展在 manifest 里预声明目标域名，否则 `fetch()` 会被拦截。**

v0.3.0 起我们开放了 Provider 抽象，允许你填写任意 OpenAI 兼容 baseURL（OpenAI / Anthropic / Azure / 自托管 Qwen / vLLM / Ollama 等）。因为 LLM 服务提供商数量庞大、baseURL 由用户决定，我们**无法预先枚举**你可能用到的所有域名；选择 `<all_urls>` 一次放开是唯一兼容"用户自配端点"的做法。

**关键澄清**——这个权限**不等于**：

- ❌ 不等于插件会在后台读取你浏览的所有网页
- ❌ 不等于插件会自动向任意域名发起请求
- ❌ 不等于插件会扫描你的浏览历史

实际行为：

- ✅ content script **仅在用户主动激活 sidebar 时注入**，不在后台常驻监听
- ✅ 除你自己配置的 LLM `baseURL` 外，插件**不向任何域发起 fetch**
- ✅ 页面内容提取完全在本地，仅在你发起对话时作为上下文发送到**你配置的** baseURL
- ✅ 你可以在 `chrome://extensions` 里随时查看或吊销本扩展的权限

### 2.2 我们明确**不做**的事

v0.4.0 明确决定：

- **不做** `optional_host_permissions` 动态申请——那会把"加一个 Provider"拆成"先授权 + 再填 baseURL"两步体验，反而降低可用性
- **不做** LLM 访问第三方域的 content filter / 提示词限制——各大厂商 API 自身已经有脱敏与合规机制，插件在前端再做一遍既无意义也不可靠
- **不做**任何形式的数据上报（analytics / telemetry / crash reporting）

---

## 3. 第三方依赖

扩展在运行时**不加载**任何外部 JS / CSS / 字体 / 图片等资源。所有依赖（React / Ant Design / Lexical / Dexie / AI SDK 等）均在构建时打包进扩展产物。

扩展加载时的**唯一**网络行为，是向你配置的 LLM `baseURL` 发起请求。

---

## 4. 你的控制权

你可以随时：

- 在配置页 → 基础 Tab 修改或删除 API Key / baseURL
- 在配置页 → 记忆浏览器 Tab 浏览与删除单条记忆
- 在 `chrome://extensions` 页面禁用或卸载插件（卸载后所有本地数据清空）
- 在浏览器的 DevTools → Application → IndexedDB 下查看 `doc-assistant` 数据库的原始数据

---

## 5. 联系与反馈

本项目为私有项目。若对隐私条款有疑问，请通过仓库 Issue 联系维护者。

---

## 附录 · CWS 权限 justification 模板

> 提交 Chrome Web Store 审核时，直接复制本附录内容到表单对应字段。
> 本文档 v0.4.0 仅准备话术，**不在本期打 tag 前提交 CWS**——审核周期与版本节奏解耦。

见 [`docs/CWS-REVIEW-NOTES.md`](./CWS-REVIEW-NOTES.md)。
