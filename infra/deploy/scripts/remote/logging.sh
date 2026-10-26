#!/usr/bin/env bash
# Scoped host logging setup. Invoked only by an explicitly authorized deployment/setup.
set -euo pipefail
ACTION="${1:?install|nginx|check}"; shift
for kv in "$@"; do export "$kv"; done
fail() { echo "Freight Chain logging: $*" >&2; exit 1; }
version="$(systemd --version | head -1 | awk '{print $2}')"
[[ "$version" =~ ^[0-9]+$ ]] && [ "$version" -ge 245 ] || fail 'systemd >=245 with journal namespaces is required'
check() {
  systemctl is-active --quiet freightchain-log-collector.service || fail 'log collector is not active; run deploy:setup'
  systemctl is-active --quiet systemd-journald@freightchain.service || fail 'journal namespace is not active'
  systemctl is-active --quiet freightchain-log-retention.timer || fail 'retention timer is not active'
  systemctl is-enabled --quiet freightchain-stack.service || fail 'project boot ordering is not enabled'
  [ -S /run/systemd/journal.freightchain/dev-log ] || fail 'namespace socket is absent'
  logger --socket-errors=on --socket /run/systemd/journal.freightchain/dev-log --tag fc-collector 'collector readiness checked'
}
case "$ACTION" in
  install)
    : "${DEPLOY_PATH:?}"
    [[ "$DEPLOY_PATH" =~ ^/srv/[A-Za-z0-9_./-]+$ ]] || fail 'deployment path needs a systemd-safe /srv path'
    source_dir="$DEPLOY_PATH/state/logging"
    install -m 644 "$source_dir/journald@freightchain.conf" /etc/systemd/journald@freightchain.conf
    for unit in freightchain-log-collector.service freightchain-log-retention.service freightchain-log-retention.timer; do
      install -m 644 "$source_dir/$unit" "/etc/systemd/system/$unit"
    done
    sed "s|__DEPLOY_PATH__|$DEPLOY_PATH|g" "$source_dir/freightchain-stack.service" > /etc/systemd/system/freightchain-stack.service
    systemctl daemon-reload
    systemctl enable freightchain-stack.service
    systemctl restart systemd-journald@freightchain.service
    systemctl enable --now freightchain-log-collector.service freightchain-log-retention.timer
    check
    ;;
  nginx)
    : "${DEPLOY_PATH:?}"
    check
    mkdir -p /etc/nginx/snippets
    backup="$(mktemp -d)"; files=()
    rollback() { for file in "${files[@]}"; do cp "$backup/$(basename "$file")" "$file"; done; }
    trap 'rm -rf "$backup"' EXIT
    snippet=/etc/nginx/snippets/freightchain-logging.conf
    if [ -e "$snippet" ]; then cp "$snippet" "$backup/snippet"; fi
    for name in freightchain freightchain-storybook freightchain-whitepaper freightchain-pitchdeck freightchain-admin freightchain-www; do
      file="/etc/nginx/sites-available/$name"; [ -f "$file" ] || continue
      # Existing custom per-location logs need explicit review, otherwise they bypass server-level retention.
      if grep -Eq '^[[:space:]]*(access_log|error_log)[[:space:]]' "$file"; then fail "$file has custom logging directives; migrate them explicitly"; fi
      grep -Eq '^[[:space:]]*server_name[^;]*;' "$file" || fail "$file has no supported one-line server_name"
    done
    install -m 644 "$DEPLOY_PATH/state/logging/nginx.conf" "$snippet"
    for name in freightchain freightchain-storybook freightchain-whitepaper freightchain-pitchdeck freightchain-admin freightchain-www; do
      file="/etc/nginx/sites-available/$name"; [ -f "$file" ] || continue
      cp "$file" "$backup/$name"; files+=("$file")
      awk '/^[[:space:]]*include \/etc\/nginx\/snippets\/freightchain-logging.conf;/ {next} {print} /^[[:space:]]*server_name[^;]*;/ {print "    include /etc/nginx/snippets/freightchain-logging.conf;"}' "$backup/$name" > "$file"
    done
    if ! nginx -t; then
      rollback
      if [ -f "$backup/snippet" ]; then cp "$backup/snippet" "$snippet"; else rm -f "$snippet"; fi
      fail 'nginx refused the logging configuration; owned files restored'
    fi
    systemctl reload nginx
    ;;
  check) check ;;
  *) fail 'expected install, nginx or check' ;;
esac
