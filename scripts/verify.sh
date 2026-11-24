#!/usr/bin/env bash
# 一键检查入口：类型检查 → 构建 → 单元测试 → 端到端。
# 本地与 CI 用同一套命令，避免“我本机是好的”。
#
# 用法：
#   scripts/verify.sh              # 全量
#   scripts/verify.sh --no-e2e     # 跳过 Playwright
#   scripts/verify.sh --install    # 先 pnpm install --frozen-lockfile
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DO_INSTALL=0
DO_E2E=1
for arg in "$@"; do
  case "$arg" in
    --install) DO_INSTALL=1 ;;
    --no-e2e) DO_E2E=0 ;;
    -h|--help)
      sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

if [[ -t 1 ]]; then
  C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_DIM=$'\033[2m'; C_END=$'\033[0m'
else
  C_OK=''; C_BAD=''; C_DIM=''; C_END=''
fi

STEP_NO=0
STEP_TOTAL=5
FAILED=""

run_step() { # 标题 命令...
  local title=$1; shift
  STEP_NO=$((STEP_NO + 1))
  printf '\n[%d/%d] %s\n' "$STEP_NO" "$STEP_TOTAL" "$title"
  local start=$SECONDS
  "$@"
  local code=$?
  local elapsed=$((SECONDS - start))
  if [[ $code -eq 0 ]]; then
    printf '%s  ✔ %s（%ds）%s\n' "$C_OK" "$title" "$elapsed" "$C_END"
  else
    printf '%s  ✘ %s（%ds，退出码 %d）%s\n' "$C_BAD" "$title" "$elapsed" "$code" "$C_END"
    FAILED="$title"
    return $code
  fi
}

echo "NectarPush 校验：$REPO_ROOT"

if [[ $DO_INSTALL -eq 1 ]]; then
  run_step "安装依赖（frozen lockfile）" pnpm install --frozen-lockfile || exit 1
else
  echo "${C_DIM}跳过安装依赖（需要时加 --install）${C_END}"
fi

run_step "Web 类型检查" pnpm --filter web typecheck || exit 1
# 构建必须排在 API 测试前面：cors.int / proxy.int 这两个集成测试会启动 apps/api/dist/main.js，
# 刚克隆的仓库（包括 CI）还没有 dist，所以要先构建。
run_step "构建（API + Web）" bash -c 'pnpm --filter api build && pnpm --filter web build' || exit 1
run_step "API 单元测试" pnpm --filter api test || exit 1
run_step "Web 单元测试" pnpm --filter web test || exit 1

if [[ $DO_E2E -eq 1 ]]; then
  # 关键：e2e 的 global-setup 会直接启动 apps/api/dist/main.js 与网页静态资源，
  # 所以必须在构建之后跑，不能依赖开发服务器。
  run_step "端到端（Playwright）" bash -c 'pnpm --filter web exec playwright test' || exit 1
else
  echo "${C_DIM}跳过端到端（--no-e2e）${C_END}"
fi

printf '\n%s全部通过%s\n' "$C_OK" "$C_END"