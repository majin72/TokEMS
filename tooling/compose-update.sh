#!/usr/bin/env bash
# TokEMS 服务器手工 Compose 更新。
# 给 ecs-user 在源码目录执行，不依赖宿主机 Node.js / pnpm。
# 不改组织 slug，不开启 SEED_DEMO_DATA，不打印 .env 机密。

set -Eeuo pipefail
IFS=$'\n\t'

APP_DIR="${APP_DIR:-$HOME/TokEMS}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://hui.ailingdaoli.com}"
COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-300}"

readonly BUILD_SERVICES=(api worker web admin gateway)
readonly RUN_SERVICES=(api web payment-web admin gateway worker)

#
# 输出带时间戳的进度信息。
#
# @param mixed ...$message 要打印的内容
#
log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

#
# 在条件失败时退出，并打印原因。
#
# @param string $1 失败说明
#
die() {
  printf '[%s] ERROR: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >&2
  exit 1
}

#
# 确保当前用户能读写项目 .env。
#
# @return void
#
ensure_env_readable() {
  if [[ ! -f .env ]]; then
    die "找不到 .env"
  fi
  if [[ ! -r .env ]]; then
    log ".env 当前用户不可读，尝试 chown"
    sudo chown "$(id -u):$(id -g)" .env
    chmod 600 .env
  fi
  [[ -r .env ]] || die ".env 仍不可读，Compose 会把 BUILD_* 变成 unknown"
  [[ -w .env ]] || die ".env 不可写，无法持久化构建身份"
}

#
# 写入或替换 .env 中的一行 KEY=value。
#
# @param string $1 环境变量名
# @param string $2 环境变量值
#
set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

#
# 计算并校验四项构建身份，写入 .env 并 export。
#
# @return void
#
prepare_build_identity() {
  BUILD_SHA="$(git rev-parse HEAD)"
  BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  BUILD_MIGRATION="$(
    find packages/database/drizzle -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]_*.sql' -printf '%f\n' \
      | sort \
      | tail -n 1
  )"
  [[ -n "$BUILD_MIGRATION" ]] || die "找不到迁移文件"
  BUILD_MIGRATION_HASH="$(sha256sum "packages/database/drizzle/${BUILD_MIGRATION}" | awk '{print $1}')"

  [[ -n "$BUILD_SHA" && "$BUILD_SHA" != unknown ]] || die "BUILD_SHA 无效"
  [[ -n "$BUILD_TIME" && "$BUILD_TIME" != unknown ]] || die "BUILD_TIME 无效"
  [[ -n "$BUILD_MIGRATION" && "$BUILD_MIGRATION" != unknown ]] || die "BUILD_MIGRATION 无效"
  [[ -n "$BUILD_MIGRATION_HASH" && "$BUILD_MIGRATION_HASH" != unknown ]] || die "BUILD_MIGRATION_HASH 无效"

  set_env BUILD_SHA "$BUILD_SHA"
  set_env BUILD_TIME "$BUILD_TIME"
  set_env BUILD_MIGRATION "$BUILD_MIGRATION"
  set_env BUILD_MIGRATION_HASH "$BUILD_MIGRATION_HASH"

  export BUILD_SHA BUILD_TIME BUILD_MIGRATION BUILD_MIGRATION_HASH
  log "BUILD_SHA=$BUILD_SHA"
  log "BUILD_MIGRATION=$BUILD_MIGRATION"
  log "BUILD_MIGRATION_HASH=$BUILD_MIGRATION_HASH"
}

#
# 备份 PostgreSQL，不打印连接信息。
#
# @return void
#
backup_database() {
  local backup_file
  backup_file="${HOME}/tokems-backup-$(date +%Y%m%d-%H%M%S).sql.gz"
  log "备份数据库到 ${backup_file}"
  docker compose exec -T postgres pg_dump -U conference -d conference \
    | gzip > "$backup_file"
  [[ -s "$backup_file" ]] || die "数据库备份是空文件"
}

#
# 拉取当前跟踪分支。
#
# @return void
#
pull_source() {
  log "git pull"
  git pull --ff-only
  git status --short --branch
  log "HEAD=$(git log -1 --oneline)"
}

#
# 构建镜像、跑迁移、切换应用容器。
#
# @return void
#
deploy_compose() {
  log "构建 ${BUILD_SERVICES[*]}"
  COMPOSE_PARALLEL_LIMIT="$COMPOSE_PARALLEL_LIMIT" \
    docker compose build "${BUILD_SERVICES[@]}"

  log "运行 db-init"
  SEED_DEMO_DATA=false docker compose up --no-build --force-recreate --wait --wait-timeout "$WAIT_TIMEOUT" db-init

  log "切换 ${RUN_SERVICES[*]}"
  docker compose up -d --no-build --force-recreate --wait --wait-timeout "$WAIT_TIMEOUT" \
    "${RUN_SERVICES[@]}"
}

#
# 核对容器内构建身份和公网健康接口。
#
# @return void
#
verify_release() {
  local health
  health="$(docker compose exec -T api sh -lc 'printf "%s %s\n" "$BUILD_SHA" "$BUILD_MIGRATION_HASH"')"
  log "容器 BUILD_SHA/HASH=${health}"
  if [[ "$health" == *unknown* ]]; then
    die "容器内 BUILD_* 仍是 unknown，健康检查会失败"
  fi

  curl -fsS "${PUBLIC_ORIGIN}/api/v1/health"
  printf '\n'
  curl -fsS "${PUBLIC_ORIGIN}/version.json"
  printf '\n'
  curl -fsS -o /dev/null -w "homepage: %{http_code}\n" "${PUBLIC_ORIGIN}/"
}

main() {
  cd "$APP_DIR" || die "进不了 ${APP_DIR}"
  [[ -f docker-compose.yml ]] || die "${APP_DIR} 不是 TokEMS 源码目录"

  log "工作目录=$(pwd -P)"
  ensure_env_readable

  if grep -E '^(PUBLIC_ORGANIZATION_SLUG|NUXT_PUBLIC_ORGANIZATION_SLUG)=' .env | grep -q tokems-demo; then
    die "组织 slug 仍是 tokems-demo，当前生产应是 geo-conference"
  fi

  pull_source
  backup_database
  prepare_build_identity
  deploy_compose
  verify_release
  log "更新完成"
}

main "$@"
