#!/bin/sh
# Usage: docker/stack-up.sh alpine|slim   (run from spike-a/). Caddy on 127.0.0.1:8088 -> Next (no published port).
set -eu
TAG=${1:-alpine}
docker network create --subnet 172.31.250.0/24 spike-a-net >/dev/null
docker run -d --name spike-a-next --network spike-a-net --ip 172.31.250.10 \
  -e NODE_OPTIONS="-r ./peer.cjs" -e SPIKE_TRUSTED_PROXIES=172.31.250.2/32 -e SPIKE_FETCH_METADATA="${FM:-0}" \
  spike-a-next:"$TAG" >/dev/null
docker run -d --name spike-a-caddy --network spike-a-net --ip 172.31.250.2 -p 127.0.0.1:8088:80 \
  -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 >/dev/null
# Action IDs come from the manifest INSIDE the image.
docker run --rm spike-a-next:"$TAG" cat .next/server/server-reference-manifest.json > "docker/manifest-$TAG.json"
for i in $(seq 1 50); do curl -fsS -o /dev/null http://127.0.0.1:8088/spike/effects && break; sleep 0.2; done
echo "up: $TAG"
