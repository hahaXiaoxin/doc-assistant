# docs/archive · 历史档案

存放**仍有历史价值但日常不再读**的文档。归档≠删除:文件原封不动,链接和 git 历史完整保留,只是从 `docs/` 主视图里挪开,降低日常浏览的噪音。

## 什么文档应该进这里

- **已完成的一次性工程任务** —— 例如某个版本的清理 / 迁移需求,落地后不再迭代
- **设计史 / 复盘文档** —— 大版本的事后回顾,价值在于理解"为什么这么选",不是日常参考
- **被新文档完全取代的旧版本** —— 例如被新需求 supersede 的旧需求(注意:被引用作为"溯源"的需求不要归档,留在 `docs/requirements/`)

不应该进的:
- 仍在维护或被频繁引用的(`backlog.md` `ROADMAP.md` `TROUBLESHOOTING.md` `CHANGELOG.md`)
- 对外披露用的(`PRIVACY.md` `CWS-REVIEW-NOTES.md`)
- 已落地但仍作为"原始合同"被回链的需求(`requirements/v0.4.0-*` `v0.5.0-*` `v0.5.1-*` `v0.6.0-*`)

## 当前归档清单

| 文件 | 原路径 | 一句话说明 |
| --- | --- | --- |
| [`v0.2-DESIGN-HISTORY.md`](./v0.2-DESIGN-HISTORY.md) | `docs/v0.2-DESIGN-HISTORY.md` | v0.2 大版本设计史:从 MVP 对话到四层记忆系统的架构回顾 |
| [`v0.4-v0.5-DESIGN-HISTORY.md`](./v0.4-v0.5-DESIGN-HISTORY.md) | `docs/v0.4-v0.5-DESIGN-HISTORY.md` | v0.4 + v0.5 合并 release 复盘:可见记忆 → Offscreen 架构 |
| [`remove-v0.1-compat.md`](./remove-v0.1-compat.md) | `docs/requirements/remove-v0.1-compat.md` | v0.3.0 移除 v0.1 向后兼容代码的需求(已落地) |

## 找不到内容怎么办

- **当前架构 / 实现细节** → 看 `docs/ROADMAP.md` 设计原则段、各模块源码注释
- **某个版本做了什么** → 看 `docs/CHANGELOG.md`
- **某个需求的验收标准** → 看 `docs/requirements/`
- **历史踩坑** → 看 `docs/TROUBLESHOOTING.md`
- **想法 / 缺陷的现状** → 看 `docs/ideas/` `docs/bugs/` 索引

## 归档流程

1. 在 `docs/archive/` 用 `git mv` 移入文件(保留 git 历史)
2. 在本 README 的"当前归档清单"表格里加一行
3. 用 `grep -rn "<旧路径>" docs/ README.md` 找出指向被归档文件的链接,逐一更新为新路径
4. 跑 `bash scripts/check-docs-index.sh` 确认 ideas/bugs 索引仍然 OK
