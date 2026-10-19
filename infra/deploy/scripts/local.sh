#!/usr/bin/env bash
# Local edge: the production host split, on this machine, over HTTP.
# Apex is freightchain.localhost (loopback). No ssh, no TLS, no production env.
#   npm run infra:local          render the nginx sites and start the edge on :80
#   npm run infra:local -- down  stop it
# The Nest process is still `npm run server:dev` (it reads deploy/local/dev.env). A landing change shows after `npm run landing:build`.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/../.." && pwd)"
DOMAIN="${FC_LOCAL_DOMAIN:-freightchain.localhost}"
UPSTREAM="${FC_LOCAL_UPSTREAM:-host.docker.internal:3000}"
# Dummy basic auth for admin.<apex> only. Not a production password.
LOCAL_ADMIN_USER="${FC_LOCAL_ADMIN_USER:-admin}"
LOCAL_ADMIN_PASSWORD="${FC_LOCAL_ADMIN_PASSWORD:-local-freightchain}"
OUT="$DEPLOY_DIR/local/out"
COMPOSE="$DEPLOY_DIR/docker-compose.local.yml"

if [ "${1:-}" = "down" ]; then
  docker compose -f "$COMPOSE" down
  exit 0
fi

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }
case "$DOMAIN" in
  *.localhost) ;;
  *) echo "FC_LOCAL_DOMAIN must end in .localhost (got $DOMAIN) – that name resolves to loopback" >&2; exit 1 ;;
esac

rm -rf "$OUT"
mkdir -p "$OUT/conf.d" "$OUT/snippets" "$OUT/sites"

# Same templates as production. Point the proxy at the host app, and keep the browser on http.
render() {
  local name="$1"
  sed -e "s/__ROOT__/${DOMAIN}/g" \
      -e "s#http://127.0.0.1:__PORT__#http://${UPSTREAM}#g" \
      -e "s#https://${DOMAIN}#http://${DOMAIN}#g" \
      "$DEPLOY_DIR/nginx/${name}.conf.template" > "$OUT/sites/${name}.conf"
}
render site
render storybook
render whitepaper
render pitchdeck
render admin
render www

cp "$DEPLOY_DIR/nginx/fc-limits.conf" "$OUT/conf.d/freightchain-limits.conf"
cat > "$OUT/conf.d/freightchain-media-cache.conf" <<'CONF'
proxy_cache_path /var/cache/nginx/freightchain_media levels=1:2 keys_zone=fc_media:1m max_size=64m inactive=7d use_temp_path=off;
CONF

# Locations the production setup writes on the server (deploy/scripts/remote/setup.sh). http, not https.
cat > "$OUT/snippets/freightchain-media.conf" <<CONF
# fc-audio: the game's sound effects. The first request fills the cache.
location ~* "^/audio/sfx/[\\w-]+\\.[0-9a-f]{8}\\.mp3\$" {
    proxy_pass http://${UPSTREAM};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_cache fc_media;
    proxy_cache_valid 200 30d;
    proxy_cache_lock on;
    add_header X-Cache \$upstream_cache_status;
    add_header Cache-Control "public, max-age=31536000, immutable";
    types { audio/mpeg mp3; }
}
location ~* ^/media/[\\w.-]+\\.mp4\$ {
    proxy_pass http://${UPSTREAM};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_cache fc_media;
    proxy_cache_valid 200 1d;
    proxy_cache_lock on;
    add_header X-Cache \$upstream_cache_status;
    add_header Cache-Control "public, max-age=86400";
}
# fc-seo: one public URL per page. Local scheme is http.
location = / {
    if (\$host = ride.${DOMAIN}) { return 301 http://${DOMAIN}\$request_uri; }
    proxy_pass http://${UPSTREAM};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 60s;
}
location = /whitepaper.html { return 301 http://whitepaper.${DOMAIN}/\$is_args\$args; }
location = /pitchdeck.html { return 301 http://pitchdeck.${DOMAIN}/\$is_args\$args; }
CONF

cat > "$OUT/snippets/freightchain-entities.conf" <<CONF
# fc-entities: the public 3D model bundle. ^~ so a regex location cannot take the path.
location ^~ /api/entities/ {
    limit_req zone=fc_entities burst=20 nodelay;
    limit_conn fc_conn 20;
    proxy_pass http://${UPSTREAM};
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
location ^~ /api/editor/mcp/ { return 404; }
CONF

# The official image's stock conf.d is hidden by this mount, so mime types and the http block live here.
cat > "$OUT/nginx.conf" <<'CONF'
worker_processes auto;
error_log /var/log/nginx/error.log warn;
events { worker_connections 1024; }
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  sendfile on;
  server_tokens off;
  include /etc/nginx/conf.d/*.conf;
  include /etc/nginx/sites/*.conf;
}
CONF

hash="$(printf '%s\n' "$LOCAL_ADMIN_PASSWORD" | openssl passwd -apr1 -stdin)"
printf '%s:%s\n' "$LOCAL_ADMIN_USER" "$hash" > "$OUT/htpasswd"
chmod 644 "$OUT/htpasswd"

# Fail before the container is up if the rendered sites are not valid nginx.
docker run --rm \
  -v "$OUT/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$OUT/conf.d:/etc/nginx/conf.d:ro" \
  -v "$OUT/snippets:/etc/nginx/snippets:ro" \
  -v "$OUT/sites:/etc/nginx/sites:ro" \
  -v "$OUT/htpasswd:/etc/nginx/freightchain-admin.htpasswd:ro" \
  nginx:1.27-alpine nginx -t

docker compose -f "$COMPOSE" up -d --force-recreate --wait
docker exec freightchain-edge nginx -t

echo "local edge is up (admin basic auth: ${LOCAL_ADMIN_USER} / ${LOCAL_ADMIN_PASSWORD})"
echo "  http://${DOMAIN}/"
echo "  http://ride.${DOMAIN}/play.html"
echo "  http://api.${DOMAIN}/api/health/ready"
echo "  http://storybook.${DOMAIN}/"
echo "  http://whitepaper.${DOMAIN}/"
echo "  http://pitchdeck.${DOMAIN}/"
echo "  http://admin.${DOMAIN}/"
