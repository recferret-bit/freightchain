#!/usr/bin/env bash
# npm run deploy:setup — first-time server setup (idempotent): /srv/freightchain folders, nginx sites for the seven names (apex, ride., api., storybook., whitepaper., pitchdeck., admin.), one Let's Encrypt certificate.
# `npm run deploy` runs it by itself the first time.
. "$(dirname "$0")/lib.sh"
need_cmd ssh
load_env; refuse_placeholders
[ "${1:-}" = "--from-deploy" ] || { check_ssh; confirm "Set up ${DEPLOY_PATH} + nginx + TLS for ${DEPLOY_DOMAIN}, ride.${DEPLOY_DOMAIN}, api.${DEPLOY_DOMAIN}, storybook.${DEPLOY_DOMAIN}, whitepaper.${DEPLOY_DOMAIN}, pitchdeck.${DEPLOY_DOMAIN}, admin.${DEPLOY_DOMAIN} on ${DEPLOY_HOST}?"; }
info "uploading the nginx templates"
rsh "mkdir -p '$DEPLOY_PATH/state'" && rsh "cat > '$DEPLOY_PATH/state/site.conf.template'" < "$DEPLOY_DIR/nginx/site.conf.template"
rsh "cat > '$DEPLOY_PATH/state/storybook.conf.template'" < "$DEPLOY_DIR/nginx/storybook.conf.template"
rsh "cat > '$DEPLOY_PATH/state/whitepaper.conf.template'" < "$DEPLOY_DIR/nginx/whitepaper.conf.template"
rsh "cat > '$DEPLOY_PATH/state/pitchdeck.conf.template'" < "$DEPLOY_DIR/nginx/pitchdeck.conf.template"
rsh "cat > '$DEPLOY_PATH/state/admin.conf.template'" < "$DEPLOY_DIR/nginx/admin.conf.template"
rsh "cat > '$DEPLOY_PATH/state/www.conf.template'" < "$DEPLOY_DIR/nginx/www.conf.template"
info "writing the admin page's basic-auth password file"; push_admin_auth
info "setting up the server"
rscript "$DEPLOY_DIR/scripts/remote/setup.sh" "DEPLOY_PATH=$DEPLOY_PATH" "DOMAIN=$DEPLOY_DOMAIN" "APP_PORT=$DEPLOY_APP_PORT" "EMAIL=$DEPLOY_LETSENCRYPT_EMAIL" "HOST_IP=$DEPLOY_HOST" \
  || die "server setup did not finish (see above); fix it and run: npm run deploy:setup"
ok "server is set up"
