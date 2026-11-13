#!/usr/bin/env bash
# NectarPush 恢复脚本：把 backup.sh 产出的 tar.gz 解回数据卷。
#
# 恢复会清空目标卷，默认拒绝在非空卷上执行；确认后加 --force。
#
# 用法：
#   deploy/restore.sh backups/nectarpush-20261112-020000.tar.gz -c nectarpush --force
set -euo pipefail

NL='
'

VOLUME="${NP_VOLUME:-deploy_nectarpush-data}"
CONTAINER="${NP_CONTAINER:-}"
IMAGE="${NP_IMAGE:-deploy-nectarpush:latest}"
FORCE=0
ARCHIVE=""

usage() {
  cat <<'EOF'
用法: deploy/restore.sh <归档.tar.gz> [选项]

  -v, --volume <名字>     目标数据卷（默认 deploy_nectarpush-data，不存在则创建）
  -c, --container <名字>  恢复前后停止/启动的容器
      --force             允许覆盖非空卷（会删除卷内现有数据）
  -h, --help              显示帮助

环境变量：NP_VOLUME / NP_CONTAINER / NP_IMAGE
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -v|--volume) VOLUME="${2:?}"; shift 2 ;;
    -c|--container) CONTAINER="${2:?}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
    *) ARCHIVE="$1"; shift ;;
  esac
done

[[ -n "$ARCHIVE" ]] || { echo "错误：缺少归档路径" >&2; usage >&2; exit 2; }
[[ -f "$ARCHIVE" ]] || { echo "错误：归档不存在：$ARCHIVE" >&2; exit 1; }

ARCHIVE_DIR="$(cd "$(dirname "$ARCHIVE")" && pwd)"
ARCHIVE_NAME="$(basename "$ARCHIVE")"

# 先在本机验证 gzip 完整性，避免把坏包写进卷里。
tar tzf "$ARCHIVE" >/dev/null

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

if [[ "$NON_EMPTY" == 1 && "$FORCE" != 1 ]]; then
  echo "错误：数据卷 $VOLUME 非空；确认覆盖请加 --force" >&2
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