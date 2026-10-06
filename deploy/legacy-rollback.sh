#!/usr/bin/env bash
# Roll the first blue/green migration back to the pre-blue/green container
# `dogfight` (it still exists: scripts/deploy.sh removes it only on a later
# deploy). Run on the server, detached so a dropped ssh cannot cut it short:
#   cd $DEPLOY_DIR && setsid nohup ./legacy-rollback.sh >legacy-rollback.log 2>&1; cat legacy-rollback.log
# It holds deploy.lock next to it and never uses compose or env-<color>
# files. NGINX_CONTAINER and NGINX_CONF come from server.env next to it
# (written by scripts/deploy.sh from deploy/deploy.env); the environment wins.
#
# Invariant: nginx never points at a stopped container. Blue stays up and
# serving until nginx points at a healthy legacy; on any error or signal
# the script reads the upstream line in NGINX_CONF and either finishes (nginx
# already on legacy) or undoes (nginx still on blue), never stopping the
# container nginx points at.
#
# Legacy still running (its handoff helper too): pause the helper (it keeps
# the stats lock but can no longer stop legacy), legacy restart policy
# unless-stopped, nginx -> dogfight, settle, stop blue, remove the helper.
# Legacy already exited: blue releases its stats store and keeps serving
# (SIGWINCH; a blue built before 2026-10-07 has no such signal and is
# drained with SIGUSR1 instead, which keeps it up only while it has players:
# an empty old blue means 502 until legacy is healthy), start legacy, wait
# for healthy (bounded), nginx -> dogfight, settle, stop blue.
# Players who joined blue lose that room either way.
set -Eeuo pipefail # -E: the ERR trap also fires inside functions

die() { echo "legacy-rollback: $*" >&2; exit 1; }
say() { echo "legacy-rollback: $*"; }

HEALTH_WAIT="${HEALTH_WAIT:-60}" # seconds
SETTLE=3                         # seconds between the switch and stopping blue
dir="$(cd "$(dirname "$0")" && pwd)"
if [[ -z "${NGINX_CONTAINER:-}" || -z "${NGINX_CONF:-}" ]]; then
  [[ -f "$dir/server.env" ]] || die "missing $dir/server.env (scripts/deploy.sh writes it); or set NGINX_CONTAINER and NGINX_CONF"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^(NGINX_CONTAINER|NGINX_CONF)=([^[:space:]\'\"]*)$ ]] || die "bad line in $dir/server.env: $line"
    k="${BASH_REMATCH[1]}"
    [[ -n "${!k:-}" ]] || printf -v "$k" '%s' "${BASH_REMATCH[2]}"
  done <"$dir/server.env"
fi
NGINX="${NGINX_CONTAINER:-}"
CONF="${NGINX_CONF:-}"
[[ "$CONF" =~ ^/[A-Za-z0-9/_.-]+$ ]] || die "bad NGINX_CONF '$CONF'"
[[ "$NGINX" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ && "$HEALTH_WAIT" =~ ^[0-9]+$ ]] || die "bad NGINX_CONTAINER or HEALTH_WAIT"

exec 9>"$dir/deploy.lock"
flock -n 9 || die "another deploy, rollback or switch is running ($dir/deploy.lock); nothing changed"
export DOGFIGHT_DEPLOY_LOCK_HELD=1

state() {
  local st
  st="$(docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null)" || st=missing
  printf '%s' "${st:-missing}"
}
# upstream: the container NGINX_CONF routes dogfight to (or "?" if unreadable).
upstream() {
  local l
  l="$(grep -E '^[[:space:]]*set[[:space:]]+[$]dogfight_upstream[[:space:]]+http://dogfight(-blue|-green)?:8080;' "$CONF" 2>/dev/null || true)"
  [[ "$l" =~ http://(dogfight(-blue|-green)?):8080 ]] && printf '%s' "${BASH_REMATCH[1]}" || printf '?'
}
switch() { "$dir/switch-upstream.sh" "$CONF" "$NGINX" dogfight; }
finish() { # nginx is on legacy: blue may go
  sleep "$SETTLE" # requests nginx already sent to blue complete
  docker stop dogfight-blue >/dev/null 2>&1 || true
  docker rm -f dogfight-handoff >/dev/null 2>&1 || true
  say "live on legacy dogfight ($(docker inspect -f '{{.Config.Image}}' dogfight))"
}

blue_mode="" # how blue let go of its stats: released | drained | ""
# undo WHY: called on any failure or signal once something changed.
undo() {
  trap - ERR INT TERM HUP PIPE
  set +e
  local up
  up="$(upstream)"
  if [[ "$up" == dogfight ]]; then
    say "$1, but nginx already points at legacy: finishing the rollback"
    finish
    exit 1
  fi
  say "$1; nginx points at '$up': undoing (legacy stopped or back to draining, blue serving)"
  if [[ "$branch" == running ]]; then
    docker update --restart=no dogfight >/dev/null # back to the migration state
    docker unpause dogfight-handoff >/dev/null 2>&1
  else
    docker update --restart=no dogfight >/dev/null 2>&1
    docker stop dogfight >/dev/null 2>&1
  fi
  docker update --restart=unless-stopped dogfight-blue >/dev/null 2>&1
  if [[ "$(state dogfight-blue)" == running ]]; then
    [[ -z "$blue_mode" ]] || docker kill -s USR2 dogfight-blue >/dev/null # takes its stats back, serves
  else
    docker start dogfight-blue >/dev/null
  fi
  die "rollback undone: blue serves, nginx unchanged ($up); check with scripts/deploy.sh --doctor"
}

legacy="$(state dogfight)" helper="$(state dogfight-handoff)"
say "dogfight=$legacy dogfight-handoff=$helper dogfight-blue=$(state dogfight-blue) nginx->$(upstream)"
[[ "$(upstream)" == dogfight-blue ]] || die "nginx does not point at dogfight-blue; nothing to roll back"

case "$legacy" in
  running)
    branch=running
    trap 'undo "interrupted or a step failed"' ERR INT TERM HUP PIPE
    [[ "$helper" != running ]] || docker pause dogfight-handoff >/dev/null
    docker update --restart=unless-stopped dogfight >/dev/null
    switch
    trap - ERR INT TERM HUP PIPE
    finish
    ;;
  exited | created)
    branch=exited
    trap 'undo "interrupted or a step failed"' ERR INT TERM HUP PIPE
    [[ "$helper" == missing ]] || docker rm -f dogfight-handoff >/dev/null 2>&1 || true
    if [[ "$(state dogfight-blue)" == running ]]; then
      since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      docker update --restart=no dogfight-blue >/dev/null
      docker kill -s WINCH dogfight-blue >/dev/null
      blue_mode=released
      for _ in 1 2 3 4 5; do
        sleep 1
        docker logs --since "$since" dogfight-blue 2>&1 | grep -q 'stats handed off' && break
      done
      if ! docker logs --since "$since" dogfight-blue 2>&1 | grep -q 'stats handed off'; then
        say "blue has no stats-release signal (older build): draining it instead; if it is empty it exits and dogfight answers 502 until legacy is healthy"
        docker kill -s USR1 dogfight-blue >/dev/null
        blue_mode=drained
        sleep 2
      fi
    fi
    docker update --restart=unless-stopped dogfight >/dev/null
    docker start dogfight >/dev/null
    health="" end=$((SECONDS + HEALTH_WAIT))
    while ((SECONDS < end)); do
      health="$(docker inspect -f '{{.State.Health.Status}}' dogfight 2>/dev/null || true)"
      [[ "$health" == healthy ]] && break
      sleep 2
    done
    [[ "$health" == healthy ]] || undo "legacy dogfight is not healthy after ${HEALTH_WAIT}s (status '${health:-none}')"
    switch
    trap - ERR INT TERM HUP PIPE
    finish
    ;;
  *)
    die "no legacy dogfight container (state: $legacy); nothing changed"
    ;;
esac
