#!/bin/bash
# Generate RSA-2048 key pair for api-backend JWT signing
# Run once per deployment; mount keys/ as a volume in Docker

KEYS_DIR="${1:-./infra/docker-compose/keys}"
mkdir -p "$KEYS_DIR"

openssl genrsa -out "$KEYS_DIR/private.pem" 2048
openssl rsa -in "$KEYS_DIR/private.pem" -pubout -out "$KEYS_DIR/public.pem"

echo "Keys generated in $KEYS_DIR"
echo "  private.pem — keep secret, never commit"
echo "  public.pem  — can be shared for token verification"
