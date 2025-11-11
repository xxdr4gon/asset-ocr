#!/usr/bin/env bash
set -e

CERT_DIR="/etc/nginx/certs"
CRT="${CERT_DIR}/server.crt"
KEY="${CERT_DIR}/server.key"

mkdir -p "${CERT_DIR}"

if [ ! -f "${CRT}" ] || [ ! -f "${KEY}" ]; then
  echo "Generating self-signed certificate for nginx..."
  openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
    -keyout "${KEY}" \
    -out "${CRT}" \
    -subj "/C=NA/ST=NA/L=Local/O=Local/OU=IT/CN=${NGINX_SERVER_NAME:-localhost}"
fi

echo "SSL certificate ready."


