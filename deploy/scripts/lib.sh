#!/usr/bin/env bash
# Shared helpers of the deploy scripts. Sourced, not run. Written for bash 3.2 (macOS) as well as Linux: no mapfile, no ${var,,}, no GNU-only flags.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-$DEPLOY_DIR/.env}"

if [ -t 1 ]; then C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BOLD=$'\033[1m'; C_OFF=$'\033[0m'; else C_RED=''; C_GREEN=''; C_YELLOW=''; C_BOLD=''; C_OFF=''; fi
info() { printf '%s\n' "${C_BOLD}▸${C_OFF} $*"; }
ok()   { printf '%s\n' "${C_GREEN}✔${C_OFF} $*"; }
warn() { printf '%s\n' "${C_YELLOW}!${C_OFF} $*" >&2; }
die()  { printf '%s\n' "${C_RED}✘ $*${C_OFF}" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "'$1' is required on this machine${2:+ ($2)}"; }

# Load deploy/.env (DEPLOY_* settings + the production environment) and check what every command needs.
load_env() {
  [ -f "$ENV_FILE" ] || die "$ENV_FILE not found – run: npm run deploy:init"
  set -a; # shellcheck disable=SC1090
  . "$ENV_FILE"; set +a
  local k
  for k in DEPLOY_HOST DEPLOY_USER DEPLOY_PATH DEPLOY_DOMAIN DEPLOY_APP_PORT; do
    [ -n "${!k:-}" ] || die "$k is empty in $ENV_FILE"
  done
  case "$DEPLOY_DOMAIN" in *://*|*/*|ride.*|api.*|www.*) die "DEPLOY_DOMAIN must be the bare apex domain (e.g. freightchain.fun) – ride.* and api.* are added automatically (got '$DEPLOY_DOMAIN')" ;; esac
  case "$DEPLOY_PATH" in /srv/?*) ;; *) die "DEPLOY_PATH must be an absolute path under /srv (got '$DEPLOY_PATH')" ;; esac
  DEPLOY_KEEP_RELEASES="${DEPLOY_KEEP_RELEASES:-3}"
  DEPLOY_KEEP_BACKUPS="${DEPLOY_KEEP_BACKUPS:-7}"
}

# Refuse to continue while a placeholder is left (values starting with CHANGE_ME).
refuse_placeholders() {
  local left
  left="$(grep -nE '^[A-Za-z_]+=CHANGE_ME' "$ENV_FILE" | cut -d= -f1 | tr '\n' ' ' || true)"
  [ -z "$left" ] || die "$ENV_FILE still has placeholders (lines: $left). Set real values for: $(grep -E '^[A-Za-z_]+=CHANGE_ME' "$ENV_FILE" | cut -d= -f1 | tr '\n' ' ')"
}

# The environment the containers get (stdout): every key of deploy/.env except the local-only DEPLOY_* ones, plus the values derived from the domain.
# DEPLOY_DOMAIN is the APEX (landing + lobby); the game is ride.<apex>, the API api.<apex>. Everything that has to agree with those names is DERIVED, never typed twice:
# APP_DOMAIN / APP_ORIGIN (in the wallet's sign-in message = the page the rider signs in on), COOKIE_DOMAIN (the apex the admin host and the game host derive from; the PLAYER session cookie is host-only on api.* since audit H7-B), CORS_ORIGINS (who may call the API).
# whitepaper.<apex> and pitchdeck.<apex> are in that list for analytics only (web vitals / page views to POST /api/telemetry; the deck sends them without credentials). storybook. and admin. are not: the model viewer calls nothing, and the admin page calls the API on its own host.
app_env() {
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | grep -v '^DEPLOY_' || true
  printf 'APP_DOMAIN=%s\nAPP_ORIGIN=https://%s\nAPP_PORT=%s\nCOOKIE_DOMAIN=%s\nCORS_ORIGINS=https://%s,https://ride.%s,https://whitepaper.%s,https://pitchdeck.%s\n' "$DEPLOY_DOMAIN" "$DEPLOY_DOMAIN" "$DEPLOY_APP_PORT" "$DEPLOY_DOMAIN" "$DEPLOY_DOMAIN" "$DEPLOY_DOMAIN" "$DEPLOY_DOMAIN" "$DEPLOY_DOMAIN"
}

# admin.<apex>'s basic auth: DEPLOY_ADMIN_USER / DEPLOY_ADMIN_PASSWORD (local only) → an apr1 hash in /etc/nginx/freightchain-admin.htpasswd on the server.
# Hashed here and sent over stdin, so the password is on no command line, here or there. Rewritten on every deploy (a changed password applies; nginx reads it per request).
ADMIN_HTPASSWD=/etc/nginx/freightchain-admin.htpasswd
check_admin_auth() {
  [ -n "${DEPLOY_ADMIN_USER:-}" ] && [ -n "${DEPLOY_ADMIN_PASSWORD:-}" ] || die "DEPLOY_ADMIN_USER / DEPLOY_ADMIN_PASSWORD are empty in $ENV_FILE (the basic auth of admin.${DEPLOY_DOMAIN}) – see deploy/.env.example"
  case "$DEPLOY_ADMIN_USER" in *:*|*' '*) die "DEPLOY_ADMIN_USER must not contain ':' or spaces" ;; esac
  [ "${#DEPLOY_ADMIN_PASSWORD}" -ge 16 ] || die "DEPLOY_ADMIN_PASSWORD must be at least 16 characters"
  need_cmd openssl
}
push_admin_auth() {
  check_admin_auth
  local hash
  hash="$(printf '%s\n' "$DEPLOY_ADMIN_PASSWORD" | openssl passwd -apr1 -stdin)" || die "openssl could not hash the admin password"
  # readable by the nginx workers (group www-data on Debian / Ubuntu; elsewhere world-readable – it is only a hash); swapped in atomically
  printf '%s:%s\n' "$DEPLOY_ADMIN_USER" "$hash" \
    | rsh "f='$ADMIN_HTPASSWD'; umask 077; cat > \"\$f.new\" && { { chgrp www-data \"\$f.new\" 2>/dev/null && chmod 640 \"\$f.new\"; } || chmod 644 \"\$f.new\"; } && mv \"\$f.new\" \"\$f\"" \
    || die "could not write $ADMIN_HTPASSWD on the server"
}

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15)
# run a command on the server
rsh() { ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "$@"; }
# run a LOCAL script on the server (over stdin – nothing is copied there); the remaining args are passed to it as KEY=VALUE pairs
rscript() {
  local script="$1"; shift
  ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "bash -s -- $(printf '%q ' "$@")" < "$script"
}

check_ssh() {
  rsh 'true' 2>/dev/null || die "cannot ssh to ${DEPLOY_USER}@${DEPLOY_HOST} (key login, no password prompt) – check DEPLOY_HOST / DEPLOY_USER and your ssh key"
}

# ask for confirmation unless -y / DEPLOY_YES=1
confirm() {
  [ "${ASSUME_YES:-${DEPLOY_YES:-0}}" = "1" ] && return 0
  [ -t 0 ] || die "not a terminal – pass -y to confirm non-interactively"
  local answer; printf '%s ' "$1 [y/N]"; read -r answer
  case "$answer" in y|Y|yes|YES) return 0 ;; *) die "aborted" ;; esac
}
