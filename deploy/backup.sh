#!/usr/bin/env bash
# NectarPush 备份脚本：把 SQLite 数据打成 tar.gz。
#
# 支持两种数据落盘方式：
#   1. 宿主机目录（compose 默认，./data 绑定挂载）——直接在宿主机 tar，无需辅助镜像；
#   2. Docker 命名卷（旧部署）——用辅助镜像 tar。
# 脚本按「显式 -v / -d」→「deploy/data 是否存在」的顺序自动判断。
#
# 镜像里没有 sqlite3 CLI，无法在线执行 `.backup`；因此这里采用
# 「短暂停机 + 归档」的方式，确保备份是崩溃一致的。默认不停容器，
# 只有在传入 -c/--container 或 NP_CONTAINER 时才停服。
#
# 用法：
#   deploy/backup.sh -c nectarpush
#   deploy/backup.sh -d /path/to/data -o /var/backups
#   deploy/backup.sh -v deploy_nectarpush-data -o /var/backups
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VOLUME="${NP_VOLUME:-deploy_nectarpush-data}"
DATA_DIR="${NP_DATA:-$REPO_ROOT/deploy/data}"
MODE=""            # volume | dir，解析参数后确定
OUT="${NP_BACKUP_DIR:-$REPO_ROOT/backups}"
CONTAINER="${NP_CONTAINER:-}"
IMAGE="${NP_IMAGE:-deploy-nectarpush:latest}"

usage() {
  cat <<'EOF'
用法: deploy/backup.sh [选项]

  -d, --dir <目录>        要备份的宿主机数据目录（默认 <repo>/deploy/data）
  -v, --volume <名字>     要备份的 Docker 数据卷（旧的卷部署方式）
  -o, --out <目录>        归档输出目录（默认 <repo>/backups）
  -c, --container <名字>  先停止该容器再归档，结束后自动启动（推荐）
      --no-stop           不停容器（仅在实例已停止时使用）
  -h, --help              显示帮助

默认行为：给定 -d 或存在 <repo>/deploy/data 时按目录备份，否则按数据卷备份。
环境变量：NP_DATA / NP_VOLUME / NP_BACKUP_DIR / NP_CONTAINER / NP_IMAGE
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--dir) DATA_DIR="${2:?}"; MODE=dir; shift 2 ;;
    -v|--volume) VOLUME="${2:?}"; MODE=volume; shift 2 ;;
    -o|--out) OUT="${2:?}"; shift 2 ;;
    -c|--container) CONTAINER="${2:?}"; shift 2 ;;
    --no-stop) CONTAINER=""; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$MODE" ]]; then
  if [[ -d "$DATA_DIR" ]]; then MODE=dir; else MODE=volume; fi
fi

if [[ "$MODE" == volume ]]; then
  docker volume inspect "$VOLUME" >/dev/null 2>&1 || {
    echo "错误：数据卷 $VOLUME 不存在" >&2
    exit 1
  }
  docker image inspect "$IMAGE" >/dev/null 2>&1 || {
    echo "错误：辅助镜像 $IMAGE 不存在（用 NP_IMAGE 指定一个含 tar 的镜像）" >&2
    exit 1
  }
else
  [[ -d "$DATA_DIR" ]] || {
    echo "错误：数据目录 $DATA_DIR 不存在" >&2
    exit 1
  }
  command -v tar >/dev/null 2>&1 || {
    echo "错误：宿主机没有 tar 命令" >&2
    exit 1
  }
fi

mkdir -p "$OUT"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="nectarpush-$STAMP.tar.gz"
ARCHIVE="$OUT/$NAME"

restart_container() {
  if [[ -n "$CONTAINER" ]]; then
    docker start "$CONTAINER" >/dev/null 2>&1 || true
    echo "已启动容器 $CONTAINER"
  fi
  echo "$ARCHIVE"
}

if [[ -n "$CONTAINER" ]]; then
  trap restart_container EXIT
  echo "停止容器 $CONTAINER ..."
  docker stop "$CONTAINER" >/dev/null
fi

if [[ "$MODE" == dir ]]; then
  echo "归档数据目录 $DATA_DIR -> $ARCHIVE ..."
  tar czf "$ARCHIVE" -C "$DATA_DIR" .
else
  echo "归档数据卷 $VOLUME -> $ARCHIVE ..."
  # 必须覆盖 ENTRYPOINT：应用镜像的入口脚本会先跑迁移再启动 API，
  # 否则 tar 命令会被忽略、辅助容器变成第二个 API 实例。
  docker run --rm --entrypoint tar \
    -v "$VOLUME":/data:ro \
    -v "$OUT":/backup \
    "$IMAGE" \
    czf "/backup/$NAME" -C /data .
fi

SIZE="$(du -h "$ARCHIVE" | awk '{print $1}')"
if command -v sha256sum >/dev/null 2>&1; then
  SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
else
  SHA="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
fi

echo "完成：${ARCHIVE}（${SIZE}）"
echo "sha256：$SHA"