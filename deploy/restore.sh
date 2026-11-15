#!/usr/bin/env bash
# NectarPush 恢复脚本：把 backup.sh 产出的 tar.gz 解回数据目录或数据卷。
#
# 恢复会清空目标，默认拒绝在非空目标上执行；确认后加 --force。
#
# 用法：
#   deploy/restore.sh backups/nectarpush-20261112-020000.tar.gz -c nectarpush --force
#   deploy/restore.sh backups/xxx.tar.gz -d /path/to/data -c nectarpush --force
set -euo pipefail

NL='
'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VOLUME="${NP_VOLUME:-deploy_nectarpush-data}"
DATA_DIR="${NP_DATA:-$REPO_ROOT/deploy/data}"
MODE=""            # volume | dir，解析参数后确定
CONTAINER="${NP_CONTAINER:-}"
IMAGE="${NP_IMAGE:-deploy-nectarpush:latest}"
FORCE=0
ARCHIVE=""

usage() {
  cat <<'EOF'
用法: deploy/restore.sh <归档.tar.gz> [选项]

  -d, --dir <目录>        恢复目标宿主机目录（默认 <repo>/deploy/data）
  -v, --volume <名字>     恢复目标 Docker 数据卷（旧的卷部署方式）
  -c, --container <名字>  恢复前后停止/启动的容器
      --force             允许覆盖非空目标（会删除目标内现有数据）
  -h, --help              显示帮助

默认行为：给定 -d 或存在 <repo>/deploy/data 时按目录恢复，否则按数据卷恢复。
环境变量：NP_DATA / NP_VOLUME / NP_CONTAINER / NP_IMAGE
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--dir) DATA_DIR="${2:?}"; MODE=dir; shift 2 ;;
    -v|--volume) VOLUME="${2:?}"; MODE=volume; shift 2 ;;
    -c|--container) CONTAINER="${2:?}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
    *) ARCHIVE="$1"; shift ;;
  esac
done

if [[ -z "$MODE" ]]; then
  if [[ -d "$DATA_DIR" ]]; then MODE=dir; else MODE=volume; fi
fi

[[ -n "$ARCHIVE" ]] || { echo "错误：缺少归档路径" >&2; usage >&2; exit 2; }
[[ -f "$ARCHIVE" ]] || { echo "错误：归档不存在：$ARCHIVE" >&2; exit 1; }

ARCHIVE_DIR="$(cd "$(dirname "$ARCHIVE")" && pwd)"
ARCHIVE_NAME="$(basename "$ARCHIVE")"

# 先在本机验证 gzip 完整性，避免把坏包写进卷里。
tar tzf "$ARCHIVE" >/dev/null

if [[ "$MODE" == volume ]]; then
  docker image inspect "$IMAGE" >/dev/null 2>&1 || {
    echo "错误：辅助镜像 $IMAGE 不存在（用 NP_IMAGE 指定一个含 tar 的镜像）" >&2
    exit 1
  }
  if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    echo "数据卷 $VOLUME 不存在，创建 ..."
    docker volume create "$VOLUME" >/dev/null
  fi
  NON_EMPTY=0
  # 覆盖 ENTRYPOINT，避免应用镜像的入口脚本把命令吞掉。
  if docker run --rm --entrypoint sh -v "$VOLUME":/data "$IMAGE" -c 'ls -A /data 2>/dev/null | grep -q .'; then
    NON_EMPTY=1
  fi
else
  [[ -d "$DATA_DIR" ]] || {
    echo "错误：数据目录 $DATA_DIR 不存在" >&2
    exit 1
  }
  command -v tar >/dev/null 2>&1 || {
    echo "错误：宿主机没有 tar 命令" >&2
    exit 1
  }
  NON_EMPTY=0
  if [[ -n "$(ls -A "$DATA_DIR" 2>/dev/null)" ]]; then NON_EMPTY=1; fi
fi

if [[ "$NON_EMPTY" == 1 && "$FORCE" != 1 ]]; then
  echo "错误：${MODE} 目标非空（$([[ "$MODE" == dir ]] && echo "$DATA_DIR" || echo "$VOLUME")）；确认覆盖请加 --force" >&2
  exit 1
fi

restart_container() {
  if [[ -n "$CONTAINER" ]]; then
    docker start "$CONTAINER" >/dev/null 2>&1 || true
    echo "已启动容器 $CONTAINER"
  fi
}

if [[ -n "$CONTAINER" ]]; then
  trap restart_container EXIT
  echo "停止容器 $CONTAINER ..."
  docker stop "$CONTAINER" >/dev/null
fi

if [[ "$MODE" == dir ]]; then
  echo "清空数据目录 $DATA_DIR ..."
  find "$DATA_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  echo "解包 $ARCHIVE_NAME -> $DATA_DIR ..."
  tar xzf "$ARCHIVE" -C "$DATA_DIR"
  echo "完成：$DATA_DIR 已从 $ARCHIVE_NAME 恢复"
else
  echo "清空数据卷 $VOLUME ..."
  docker run --rm --entrypoint sh -v "$VOLUME":/data "$IMAGE" \
    -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} +'

  echo "解包 $ARCHIVE_NAME -> $VOLUME ..."
  docker run --rm --entrypoint tar \
    -v "$VOLUME":/data \
    -v "$ARCHIVE_DIR":/backup:ro \
    "$IMAGE" \
    xzf "/backup/$ARCHIVE_NAME" -C /data

  echo "完成：$VOLUME 已从 $ARCHIVE_NAME 恢复"
fi