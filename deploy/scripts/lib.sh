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
# APP_DOMAIN / APP_ORIGIN (in the wallet's sign-in message = the page the rider signs in on), COOKIE_DOMAIN (the session cookie is shared by all subdomains), CORS_ORIGINS (who may call the API).
app_env() {
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | grep -v '^DEPLOY_' || true
  printf 'APP_DOMAIN=%s\nAPP_ORIGIN=https://%s\nAPP_PORT=%s\nCOOKIE_DOMAIN=%s\nCORS_ORIGINS=https://%s,https://ride.%s\n' "$DEPLOY_DOMAIN" "$DEPLOY_DOMAIN" "$DEPLOY_APP_PORT" "$DEPLOY_DOMAIN" "$DEPLOY_DOMAIN" "$DEPLOY_DOMAIN"
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
