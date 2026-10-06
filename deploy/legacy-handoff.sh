# One-time migration helper (scripts/deploy.sh, first blue/green deploy):
# the pre-blue/green container `dogfight` has no drain and no stats lock, so
# this script stands in for it. scripts/deploy.sh runs it in a busybox
# container that shares the legacy container's PID and network namespaces,
# under `flock -x /data/stats.lock` (uid 65532, the dogfight-data volume):
#   1. Until the deploy creates /tmp/go (nginx switched), it only holds the
#      stats lock, so the new color's server waits instead of writing the
#      journal next to the legacy server.
#   2. Then it drains: when the legacy server has no open WebSocket
#      (dogfight_conns 0 on its loopback metrics) or after DRAIN_MAX_S
#      seconds, it sends SIGTERM to the legacy server (PID 1 here), which
#      writes its final stats snapshot and exits. Its PID namespace ends with
#      it, this process is killed, the lock is released and the new server's
#      store opens.
# If the legacy server dies first, this script exits (lock released).
set -u
alive() { kill -0 1 2>/dev/null; }
while [ ! -f /tmp/go ]; do
  alive || exit 0
  sleep 1
done
start=$(date +%s)
max=${DRAIN_MAX_S:-1800}
echo "legacy-handoff: draining (max ${max}s)"
while alive; do
  n=$(wget -qO- http://127.0.0.1:9090/metrics 2>/dev/null | awk '$1 == "dogfight_conns" { print $2 }')
  el=$(( $(date +%s) - start ))
  if [ "${n:-x}" = 0 ] || [ "$el" -ge "$max" ]; then
    echo "legacy-handoff: stopping legacy server (conns=${n:-?}, ${el}s)"
    kill -TERM 1
    sleep 15 # the server exits within 9 s; its namespace takes this process with it
  fi
  sleep 5
done
