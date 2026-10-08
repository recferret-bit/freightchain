#!/usr/bin/env bash
# Runs ON THE SERVER (piped over ssh by deploy/scripts/setup.sh). First-time, idempotent:
#   /srv/freightchain/{releases,backups,state}  ·  nginx sites for the names (apex, ride., api. | storybook. | whitepaper. | admin.)  ·  a Let's Encrypt certificate.
# Touches nothing else: other nginx sites, ufw and the other containers are left as they are.
set -euo pipefail
for kv in "$@"; do export "$kv"; done
: "${DEPLOY_PATH:?}" "${DOMAIN:?}" "${APP_PORT:?}" "${EMAIL:?}" "${HOST_IP:?}"
say() { printf '  [server] %s\n' "$*"; }
fail() { printf '  [server] ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null && docker compose version >/dev/null 2>&1 || fail "docker + the compose plugin are required"
command -v nginx >/dev/null || fail "nginx is required"
command -v certbot >/dev/null || fail "certbot is required (apt install certbot python3-certbot-nginx)"

mkdir -p "$DEPLOY_PATH/releases" "$DEPLOY_PATH/backups" "$DEPLOY_PATH/state"
chmod 700 "$DEPLOY_PATH/backups" "$DEPLOY_PATH/state"
say "folders ready under $DEPLOY_PATH"

# The landing's hero loop (/media/hero-preview.mp4, ~2.2 MB, fetched lazily after `load`): nginx caches it and answers Range requests itself, so the app is hit once per release.
# Two managed files (rewritten on every setup) + ONE include line in the apex/ride. server blocks – added to an already installed site too (certbot's 443 copy included), idempotent, undone if nginx -t fails.
mkdir -p /var/cache/nginx/freightchain_media /etc/nginx/snippets /etc/nginx/conf.d
cat > /etc/nginx/conf.d/freightchain-media.conf <<'CONF'
proxy_cache_path /var/cache/nginx/freightchain_media levels=1:2 keys_zone=fc_media:1m max_size=64m inactive=7d use_temp_path=off;
CONF
cat > /etc/nginx/snippets/freightchain-media.conf <<CONF
location ~* ^/media/[\\w.-]+\\.mp4\$ {
    proxy_pass http://127.0.0.1:$APP_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_cache fc_media;
    proxy_cache_valid 200 1d;
    proxy_cache_lock on;
    add_header X-Cache \$upstream_cache_status;
    add_header Cache-Control "public, max-age=86400";
}
CONF
say "media cache + snippet written"

SITE=/etc/nginx/sites-available/freightchain
if [ -f "$SITE" ]; then
  say "nginx site $SITE exists – left as it is (certbot's TLS block lives in it)"
else
  [ -f "$DEPLOY_PATH/state/site.conf.template" ] || fail "the nginx template was not uploaded"
  sed -e "s/__ROOT__/$DOMAIN/g" -e "s/__PORT__/$APP_PORT/g" "$DEPLOY_PATH/state/site.conf.template" > "$SITE"
  ln -sfn "$SITE" /etc/nginx/sites-enabled/freightchain
  if ! nginx -t 2>/dev/null; then rm -f /etc/nginx/sites-enabled/freightchain "$SITE"; nginx -t || true; fail "nginx rejected the new site – removed it again; nothing changed"; fi
  systemctl reload nginx
  say "nginx site for $DOMAIN, ride.$DOMAIN, api.$DOMAIN installed and reloaded (the default site is untouched)"
fi

# An existing site predates the include: add it after every `server_name <apex> ride.<apex>;` (the :80 block and certbot's :443 copy).
if [ -f "$SITE" ] && ! grep -q 'snippets/freightchain-media.conf' "$SITE"; then
  cp "$SITE" "$SITE.bak-media"
  awk -v pat="^[[:space:]]*server_name $DOMAIN ride\\.$DOMAIN;" '{ print } $0 ~ pat { print "    include /etc/nginx/snippets/freightchain-media.conf;" }' "$SITE.bak-media" > "$SITE"
  if grep -q 'snippets/freightchain-media.conf' "$SITE" && nginx -t 2>/dev/null; then
    systemctl reload nginx; rm -f "$SITE.bak-media"; say "media cache include added to $SITE and nginx reloaded"
  else
    mv "$SITE.bak-media" "$SITE"; nginx -t || true; fail "could not add the media include to $SITE – restored it; nothing changed"
  fi
fi

# storybook.<apex> (the model viewer) is its own site file, so it can be added to a server that already has the main site; certbot --expand below adds its TLS block.
SB=/etc/nginx/sites-available/freightchain-storybook
if [ -f "$SB" ]; then
  say "nginx site $SB exists – left as it is"
else
  [ -f "$DEPLOY_PATH/state/storybook.conf.template" ] || fail "the storybook nginx template was not uploaded"
  sed -e "s/__ROOT__/$DOMAIN/g" -e "s/__PORT__/$APP_PORT/g" "$DEPLOY_PATH/state/storybook.conf.template" > "$SB"
  ln -sfn "$SB" /etc/nginx/sites-enabled/freightchain-storybook
  if ! nginx -t 2>/dev/null; then rm -f /etc/nginx/sites-enabled/freightchain-storybook "$SB"; nginx -t || true; fail "nginx rejected the storybook site – removed it again; nothing changed"; fi
  systemctl reload nginx
  say "nginx site for storybook.$DOMAIN installed and reloaded"
fi

# whitepaper.<apex> (the whitepaper page) is its own site file too; same pattern as storybook.
WP=/etc/nginx/sites-available/freightchain-whitepaper
if [ -f "$WP" ]; then
  say "nginx site $WP exists – left as it is"
else
  [ -f "$DEPLOY_PATH/state/whitepaper.conf.template" ] || fail "the whitepaper nginx template was not uploaded"
  sed -e "s/__ROOT__/$DOMAIN/g" -e "s/__PORT__/$APP_PORT/g" "$DEPLOY_PATH/state/whitepaper.conf.template" > "$WP"
  ln -sfn "$WP" /etc/nginx/sites-enabled/freightchain-whitepaper
  if ! nginx -t 2>/dev/null; then rm -f /etc/nginx/sites-enabled/freightchain-whitepaper "$WP"; nginx -t || true; fail "nginx rejected the whitepaper site – removed it again; nothing changed"; fi
  systemctl reload nginx
  say "nginx site for whitepaper.$DOMAIN installed and reloaded"
fi

# admin.<apex> (the admin page, basic auth) is its own site file too; the deploy writes its password file before this runs (nginx would answer 500 without it).
AD=/etc/nginx/sites-available/freightchain-admin
if [ -f "$AD" ]; then
  say "nginx site $AD exists – left as it is"
else
  [ -f "$DEPLOY_PATH/state/admin.conf.template" ] || fail "the admin nginx template was not uploaded"
  [ -s /etc/nginx/freightchain-admin.htpasswd ] || fail "/etc/nginx/freightchain-admin.htpasswd is missing – set DEPLOY_ADMIN_USER / DEPLOY_ADMIN_PASSWORD in deploy/.env and run the deploy again"
  sed -e "s/__ROOT__/$DOMAIN/g" -e "s/__PORT__/$APP_PORT/g" "$DEPLOY_PATH/state/admin.conf.template" > "$AD"
  ln -sfn "$AD" /etc/nginx/sites-enabled/freightchain-admin
  if ! nginx -t 2>/dev/null; then rm -f /etc/nginx/sites-enabled/freightchain-admin "$AD"; nginx -t || true; fail "nginx rejected the admin site – removed it again; nothing changed"; fi
  systemctl reload nginx
  say "nginx site for admin.$DOMAIN installed and reloaded (basic auth)"
fi

NAMES="$DOMAIN ride.$DOMAIN api.$DOMAIN storybook.$DOMAIN whitepaper.$DOMAIN admin.$DOMAIN"
COVERED=1
if [ -f "/etc/letsencrypt/live/$DOMAIN/cert.pem" ]; then
  for n in $NAMES; do openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/cert.pem" -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:$n\b" || COVERED=0; done
else
  COVERED=0
fi
if [ "$COVERED" = 1 ]; then
  say "the certificate already covers $NAMES"
else
  for n in $NAMES; do
    RESOLVED="$(getent ahostsv4 "$n" | awk 'NR==1{print $1}' || true)"
    if [ "$RESOLVED" != "$HOST_IP" ]; then
      echo "  [server] DNS: $n resolves to '${RESOLVED:-nothing}', not to $HOST_IP." >&2
      echo "  [server] Point the A records of $NAMES at $HOST_IP, wait for them to propagate, then run: npm run deploy:setup" >&2
      exit 3
    fi
  done
  certbot --nginx $(for n in $NAMES; do printf -- '-d %s ' "$n"; done) --expand -m "$EMAIL" --agree-tos --no-eff-email --non-interactive --redirect
  say "certificate issued for $NAMES; http now redirects to https"
fi
systemctl is-active --quiet certbot.timer && say "automatic renewal: certbot.timer is active" || say "WARNING: certbot.timer is not active – renew manually (certbot renew)"
nginx -t 2>/dev/null && say "nginx config OK"
touch "$DEPLOY_PATH/state/setup-done"
say "setup complete"
