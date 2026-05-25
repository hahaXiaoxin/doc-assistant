#!/usr/bin/env bash
# check-docs-index.sh
#
# 用途:
#   对 docs/ideas/ 与 docs/bugs/ 这两套"单文件单条目"索引做一致性检查。
#   是 ideas / bugs 双向同步约定的轻量校验,不依赖 node / python,
#   只用常见 unix 工具(grep / awk / sed / find)。
#
# 检查项:
#   1) 每个 <id>.<slug>.md 文件,在同目录 README.md 索引表里能 grep 到一行。
#   2) 每个 <id>.<slug>.md 文件都包含 `**状态**:` 与 `**来源**:` 两个字段。
#   3) 文件名里的 <id> 与文件正文里第一处 `ID: ideas-XXX` / `ID: bugs-XXX` 一致。
#
# 运行方式:
#   bash scripts/check-docs-index.sh
#
# 频率定位:
#   这是低频校验,**不强制接到 git hook**;推荐每次新增 idea / bug 后手动跑一次,
#   或在做 backlog/ROADMAP 大整理后顺手跑一遍。
#
# 退出码:
#   0 = 全部通过(打印 "docs index OK")
#   非 0 = 发现至少一条不一致(每条都会打印具体文件 + 一句话原因)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

errors=0

report() {
  # report <file> <reason>
  printf '✗ %s — %s\n' "$1" "$2" >&2
  errors=$((errors + 1))
}

check_dir() {
  # check_dir <dir> <kind>   kind = ideas | bugs
  local dir="$1"
  local kind="$2"
  local readme="$dir/README.md"

  if [ ! -f "$readme" ]; then
    report "$readme" "README.md 不存在"
    return
  fi

  # 找到目录下所有 NNN.<slug>.md(排除 README.md)
  local files
  files=$(find "$dir" -maxdepth 1 -type f -name '*.md' ! -name 'README.md' | sort)

  if [ -z "$files" ]; then
    return
  fi

  while IFS= read -r file; do
    local base name_id body_id
    base=$(basename "$file")

    # 校验 1: README 里能 grep 到这个文件名
    if ! grep -q -F "$base" "$readme"; then
      report "$file" "README.md 索引表里找不到对应行(grep '$base' 无命中)"
    fi

    # 校验 2: 状态 + 来源 字段都存在
    if ! grep -q '\*\*状态\*\*[::]' "$file"; then
      report "$file" "缺少 \`**状态**:\` 字段"
    fi
    if ! grep -q '\*\*来源\*\*[::]' "$file"; then
      report "$file" "缺少 \`**来源**:\` 字段"
    fi

    # 校验 3: 文件名 id 与正文 ID 一致
    # 文件名形如 005.persona-extraction-boundary.md → 取首段三位数
    name_id=$(printf '%s' "$base" | sed -E 's/^([0-9]+)\..*/\1/')
    if ! printf '%s' "$name_id" | grep -Eq '^[0-9]+$'; then
      report "$file" "文件名前缀不是数字 ID(应为 NNN.<slug>.md)"
      continue
    fi

    # 取正文里第一处 ID 字段(允许 markdown 加粗 / 全半角冒号)
    # 形如 `- **ID**: ideas-001`、`ID: bugs-003` 等
    body_id=$(grep -m1 -Eo "ID(\*\*)?[[:space:]]*[::][[:space:]]*${kind}-[0-9]+" "$file" \
      | sed -E "s/.*${kind}-([0-9]+).*/\1/" || true)
    if [ -z "${body_id:-}" ]; then
      report "$file" "正文里找不到 'ID: ${kind}-NNN'"
      continue
    fi

    if [ "$name_id" != "$body_id" ]; then
      report "$file" "文件名 id=$name_id 与正文 ${kind}-$body_id 不一致"
    fi
  done <<< "$files"
}

check_dir docs/ideas ideas
check_dir docs/bugs  bugs

if [ "$errors" -gt 0 ]; then
  printf '\n✗ docs index has %d issue(s)\n' "$errors" >&2
  exit 1
fi

echo "docs index OK"
