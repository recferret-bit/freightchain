#!/usr/bin/env bash
# npm run deploy:status | deploy:logs [-- -f] | deploy:backup | deploy:rollback [-- -y] | deploy:smoke
. "$(dirname "$0")/lib.sh"
CMD="${1:-status}"; shift || true
need_cmd ssh
load_env; refuse_placeholders; check_ssh
for a in "$@"; do case "$a" in -y|--yes) ASSUME_YES=1 ;; esac; done
args=("DEPLOY_PATH=$DEPLOY_PATH" "APP_PORT=$DEPLOY_APP_PORT" "DOMAIN=$DEPLOY_DOMAIN")
case "$CMD" in
  status|backup) rscript "$DEPLOY_DIR/scripts/remote/ctl.sh" "$CMD" "${args[@]}" ;;
  logs)
    follow=""; for a in "$@"; do [ "$a" = "-f" ] && follow="FOLLOW=1"; done
    rscript "$DEPLOY_DIR/scripts/remote/ctl.sh" logs "${args[@]}" ${follow:+"$follow"} ;;
  rollback) confirm "Roll the server back to the previous release?"; rscript "$DEPLOY_DIR/scripts/remote/ctl.sh" rollback "${args[@]}" ;;
  smoke) SMOKE_ADMIN_AUTH="${DEPLOY_ADMIN_USER:-}${DEPLOY_ADMIN_PASSWORD:+:$DEPLOY_ADMIN_PASSWORD}" node "$DEPLOY_DIR/scripts/smoke.mjs" "https://${DEPLOY_DOMAIN}" --api "https://api.${DEPLOY_DOMAIN}" --game "https://ride.${DEPLOY_DOMAIN}" --storybook "https://storybook.${DEPLOY_DOMAIN}" --whitepaper "https://whitepaper.${DEPLOY_DOMAIN}" --admin "https://admin.${DEPLOY_DOMAIN}" --treasury "$TREASURY_PUBKEY" ;;
  *) die "unknown command $CMD" ;;
esac
