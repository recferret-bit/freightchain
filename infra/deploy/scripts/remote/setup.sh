#!/usr/bin/env bash
# Runs ON THE SERVER (piped over ssh by deploy/scripts/setup.sh). First-time, idempotent:
#   /srv/freightchain/{releases,backups,state}  ·  nginx sites for the names (apex, ride., api. | storybook. | whitepaper. | pitchdeck. | admin.)  ·  a Let's Encrypt certificate.
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
bash "$DEPLOY_PATH/state/logging.sh" install "DEPLOY_PATH=$DEPLOY_PATH"

# The landing's hero loop (/media/hero-preview.mp4, ~2.2 MB, fetched lazily after `load`) and the game's sound effects (/audio/sfx/*.mp3, ~75 kB, fetched in the background): nginx caches them and answers Range requests itself, so the app is hit once per release.
# The same snippet carries the two search redirects (marker fc-seo): ride.<apex>/ → the apex, <apex>/whitepaper.html → whitepaper.<apex>/, <apex>/pitchdeck.html → pitchdeck.<apex>/.
# Two managed files (rewritten on every setup) + ONE include line in the apex/ride. server blocks – added to an already installed site too (certbot's 443 copy included), idempotent, undone if nginx -t fails.
mkdir -p /var/cache/nginx/freightchain_media /etc/nginx/snippets /etc/nginx/conf.d
cat > /etc/nginx/conf.d/freightchain-media.conf <<'CONF'
proxy_cache_path /var/cache/nginx/freightchain_media levels=1:2 keys_zone=fc_media:1m max_size=64m inactive=7d use_temp_path=off;
CONF
[ -f /etc/nginx/snippets/freightchain-media.conf ] && cp /etc/nginx/snippets/freightchain-media.conf /etc/nginx/snippets/freightchain-media.conf.bak
cat > /etc/nginx/snippets/freightchain-media.conf <<CONF
# fc-audio: the game's sound effects (/audio/sfx/<id>.<hash>.mp3, ~75 kB in all, immutable names) – the first request fills the cache, every later one is answered by nginx
location ~* "^/audio/sfx/[\\w-]+\\.[0-9a-f]{8}\\.mp3\$" {   # quoted: nginx reads a bare { in a regex as a block
    proxy_pass http://127.0.0.1:$APP_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;   # every proxy to the app names the client (the app 404s its internal MCP callbacks when these are set)
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_cache fc_media;
    proxy_cache_valid 200 30d;
    proxy_cache_lock on;
    add_header X-Cache \$upstream_cache_status;
    add_header Cache-Control "public, max-age=31536000, immutable";
    types { audio/mpeg mp3; }
}
location ~* ^/media/[\\w.-]+\\.mp4\$ {
    proxy_pass http://127.0.0.1:$APP_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;   # every proxy to the app names the client (the app 404s its internal MCP callbacks when these are set)
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_cache fc_media;
    proxy_cache_valid 200 1d;
    proxy_cache_lock on;
    add_header X-Cache \$upstream_cache_status;
    add_header Cache-Control "public, max-age=86400";
}
# fc-seo: one public URL per page for search engines – the game host's / is the landing (301 to the apex, query kept), the apex's /whitepaper.html is the whitepaper host's /
location = / {
    if (\$host = ride.$DOMAIN) { return 301 https://$DOMAIN\$request_uri; }
    proxy_pass http://127.0.0.1:$APP_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 60s;
}
location = /whitepaper.html { return 301 https://whitepaper.$DOMAIN/\$is_args\$args; }
location = /pitchdeck.html { return 301 https://pitchdeck.$DOMAIN/\$is_args\$args; }
CONF
if nginx -t 2>/dev/null; then systemctl reload nginx; rm -f /etc/nginx/snippets/freightchain-media.conf.bak; say "media cache + snippet written (mp4 loop + game sound effects), nginx reloaded"
else
  if [ -f /etc/nginx/snippets/freightchain-media.conf.bak ]; then mv /etc/nginx/snippets/freightchain-media.conf.bak /etc/nginx/snippets/freightchain-media.conf; else rm -f /etc/nginx/snippets/freightchain-media.conf; fi
  nginx -t || true; fail "nginx rejected the media snippet – restored the old one; nothing changed"
fi

# The 3D model API (docs/spec/platform_services.md): http-level zones (rate limits, a connection cap, the bundle's microcache) + the /api/entities/ location snippet,
# included by api.<apex> and storybook.<apex>. Both managed files are rewritten on every setup; undone if nginx -t fails.
mkdir -p /var/cache/nginx/freightchain_entities
[ -f "$DEPLOY_PATH/state/fc-limits.conf" ] || fail "the nginx limits file (deploy/nginx/fc-limits.conf) was not uploaded"
for f in /etc/nginx/conf.d/freightchain-limits.conf /etc/nginx/snippets/freightchain-entities.conf; do [ -f "$f" ] && cp "$f" "$f.bak"; done
cp "$DEPLOY_PATH/state/fc-limits.conf" /etc/nginx/conf.d/freightchain-limits.conf
cat > /etc/nginx/snippets/freightchain-entities.conf <<CONF
# fc-entities: GET /api/entities/bundle – the 3D models every page loads (public): per-IP limits + a microcache (lifetime = the app's Cache-Control, 60 s).
# ^~: no regex location (\.html\$, media) can take these paths over (nginx normalises %2E%2E before matching, then proxies the raw URI)
location ^~ /api/entities/ {
    limit_req zone=fc_entities burst=20 nodelay;
    limit_conn fc_conn 20;
    proxy_pass http://127.0.0.1:$APP_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_cache fc_entities_cache;
    proxy_cache_valid 200 30s;
    proxy_cache_lock on;
    proxy_cache_use_stale updating error timeout http_500 http_502 http_503 http_504;
    proxy_cache_methods GET HEAD;
    add_header X-Cache \$upstream_cache_status;
    proxy_read_timeout 30s;
}
# the MCP's job callbacks are for the internal network only (mcp → app:3000) – never through nginx (McpJobGuard also 404s a proxied request)
location ^~ /api/editor/mcp/ { return 404; }
CONF
if nginx -t 2>/dev/null; then systemctl reload nginx; rm -f /etc/nginx/conf.d/freightchain-limits.conf.bak /etc/nginx/snippets/freightchain-entities.conf.bak; say "3D model API limits + bundle cache written, nginx reloaded"
else
  for f in /etc/nginx/conf.d/freightchain-limits.conf /etc/nginx/snippets/freightchain-entities.conf; do if [ -f "$f.bak" ]; then mv "$f.bak" "$f"; else rm -f "$f"; fi; done
  nginx -t || true; fail "nginx rejected the 3D model API limits – restored the old files; nothing changed"
fi

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

# An existing site predates the /api/entities/ snippet: add it after every `server_name api.<apex>;` (the :80 block and certbot's :443 copy).
if [ -f "$SITE" ] && ! grep -q 'snippets/freightchain-entities.conf' "$SITE"; then
  cp "$SITE" "$SITE.bak-entities"
  awk -v pat="^[[:space:]]*server_name api\\.$DOMAIN;" '{ print } $0 ~ pat { print "    include /etc/nginx/snippets/freightchain-entities.conf;" }' "$SITE.bak-entities" > "$SITE"
  if grep -q 'snippets/freightchain-entities.conf' "$SITE" && nginx -t 2>/dev/null; then
    systemctl reload nginx; rm -f "$SITE.bak-entities"; say "3D model API include added to $SITE and nginx reloaded"
  else
    mv "$SITE.bak-entities" "$SITE"; nginx -t || true; fail "could not add the 3D model API include to $SITE – restored it; nothing changed"
  fi
fi

# storybook.<apex> (the model viewer) is its own site file, so it can be added to a server that already has the main site; certbot --expand below adds its TLS block.
SB=/etc/nginx/sites-available/freightchain-storybook
if [ -f "$SB" ]; then
  if grep -q 'zone=fc_editor' "$SB"; then
    say "nginx site $SB exists – left as it is"
  else
    cp "$SB" "$SB.bak-editor"
    awk '{ print } /location[[:space:]]+\^~[[:space:]]+\/api\/editor\/[[:space:]]*\{/ { print "        limit_req zone=fc_editor burst=40 nodelay;"; print "        limit_conn fc_conn 20;" }' "$SB.bak-editor" > "$SB"
    if grep -q 'zone=fc_editor' "$SB" && nginx -t 2>/dev/null; then
      systemctl reload nginx; rm -f "$SB.bak-editor"; say "editor per-IP rate limit added to $SB and nginx reloaded"
    else
      mv "$SB.bak-editor" "$SB"; nginx -t || true
      fail "storybook vhost has no fc_editor limit and it could not be inserted – its location ^~ /api/editor/ block is missing. Rewrite $SB from deploy/nginx/storybook.conf.template (docs/agents/deploy.md) and re-run setup"
    fi
  fi
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

# pitchdeck.<apex> (the pitch deck page) is its own site file too; same pattern.
PD=/etc/nginx/sites-available/freightchain-pitchdeck
if [ -f "$PD" ]; then
  say "nginx site $PD exists – left as it is"
else
  [ -f "$DEPLOY_PATH/state/pitchdeck.conf.template" ] || fail "the pitchdeck nginx template was not uploaded"
  sed -e "s/__ROOT__/$DOMAIN/g" -e "s/__PORT__/$APP_PORT/g" "$DEPLOY_PATH/state/pitchdeck.conf.template" > "$PD"
  ln -sfn "$PD" /etc/nginx/sites-enabled/freightchain-pitchdeck
  if ! nginx -t 2>/dev/null; then rm -f /etc/nginx/sites-enabled/freightchain-pitchdeck "$PD"; nginx -t || true; fail "nginx rejected the pitchdeck site – removed it again; nothing changed"; fi
  systemctl reload nginx
  say "nginx site for pitchdeck.$DOMAIN installed and reloaded"
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

# www.<apex> → the apex (301), optional: only once its DNS points here, because the certificate below must be able to cover it. Never fails the setup.
WWW=/etc/nginx/sites-available/freightchain-www WWW_NAME=""
WWW_RESOLVED="$(getent ahostsv4 "www.$DOMAIN" | awk 'NR==1{print $1}' || true)"
if [ "$WWW_RESOLVED" != "$HOST_IP" ]; then
  say "www.$DOMAIN resolves to '${WWW_RESOLVED:-nothing}', not $HOST_IP – no www redirect (point its A record here, then: npm run deploy:setup)"
elif [ -f "$WWW" ]; then
  say "nginx site $WWW exists – left as it is"; WWW_NAME="www.$DOMAIN"
elif [ -f "$DEPLOY_PATH/state/www.conf.template" ]; then
  sed -e "s/__ROOT__/$DOMAIN/g" "$DEPLOY_PATH/state/www.conf.template" > "$WWW"
  ln -sfn "$WWW" /etc/nginx/sites-enabled/freightchain-www
  if nginx -t 2>/dev/null; then systemctl reload nginx; WWW_NAME="www.$DOMAIN"; say "nginx site for www.$DOMAIN (301 → $DOMAIN) installed and reloaded"
  else rm -f /etc/nginx/sites-enabled/freightchain-www "$WWW"; nginx -t || true; say "WARNING: nginx rejected the www site – removed it again; no www redirect"; fi
else
  say "WARNING: the www nginx template was not uploaded – no www redirect"
fi

NAMES="$DOMAIN ride.$DOMAIN api.$DOMAIN storybook.$DOMAIN whitepaper.$DOMAIN pitchdeck.$DOMAIN admin.$DOMAIN${WWW_NAME:+ $WWW_NAME}"
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
bash "$DEPLOY_PATH/state/logging.sh" nginx "DEPLOY_PATH=$DEPLOY_PATH"
touch "$DEPLOY_PATH/state/setup-done"
say "setup complete"
