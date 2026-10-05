#!/usr/bin/env bash
# Writes ~/.ssh/deploy_key and ~/.ssh/known_hosts from the SSH_PRIVATE_KEY / SSH_KNOWN_HOSTS secrets.
# Tolerates the usual copy/paste damage (lost or extra line breaks, CRLF, indentation, line breaks turned
# into spaces) and also accepts the key as a single base64 line (`base64 -w0 key`), then validates it.
set -euo pipefail
: "${SSH_PRIVATE_KEY:?}" "${SSH_KNOWN_HOSTS:?}"

key=$(printf '%s' "$SSH_PRIVATE_KEY" | tr -d '\r')
if ! grep -q -- '-----BEGIN' <<<"$key"; then
  # Not PEM: treat as base64 of the whole key file.
  key=$(printf '%s' "$key" | tr -d ' \t\n' | base64 -d 2>/dev/null | tr -d '\r') || key=""
fi
header=$(grep -o -- '-----BEGIN [A-Z ]*KEY-----' <<<"$key" | head -1 || true)
footer=$(grep -o -- '-----END [A-Z ]*KEY-----' <<<"$key" | head -1 || true)
if [ -z "$header" ] || [ -z "$footer" ]; then
  echo "::error::SSH_PRIVATE_KEY is not a private key: it must contain the -----BEGIN … KEY----- and -----END … KEY----- lines (or be the output of: base64 -w0 <keyfile>)"
  exit 1
fi
# Rebuild the key: header, base64 body re-wrapped at 70 columns, footer.
body=${key#*"$header"}
body=${body%%"$footer"*}
body=$(printf '%s' "$body" | tr -d ' \t\n')

install -m 700 -d ~/.ssh
umask 077
{ printf '%s\n' "$header"; printf '%s' "$body" | fold -w 70; printf '\n%s\n' "$footer"; } > ~/.ssh/deploy_key
if ! ssh-keygen -y -f ~/.ssh/deploy_key >/dev/null 2>&1; then
  rm -f ~/.ssh/deploy_key
  echo "::error::SSH_PRIVATE_KEY could not be loaded (truncated or passphrase-protected?). Recreate it on the server and paste the output of: base64 -w0 ~/.ssh/github_deploy"
  exit 1
fi
printf '%s\n' "$SSH_KNOWN_HOSTS" | tr -d '\r' > ~/.ssh/known_hosts
chmod 644 ~/.ssh/known_hosts
echo "Deploy key OK ($(ssh-keygen -l -f ~/.ssh/deploy_key | awk '{print $1, $2, $NF}'))"
