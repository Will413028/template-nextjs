#!/bin/sh
docker rm -f spike-a-caddy spike-a-next >/dev/null 2>&1
docker network rm spike-a-net >/dev/null 2>&1
echo down
