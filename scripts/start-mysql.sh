#!/bin/bash
# Start MySQL Docker container for testing

docker compose up -d mysql

container="mysql-live-select-mysql-1"
echo -n "Waiting for mysql..."
for i in $(seq 1 30); do
  if docker exec "$container" mysqladmin ping -u root -psecret --silent 2>/dev/null; then
    echo " ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo " timed out"
    exit 1
  fi
  sleep 2
done
