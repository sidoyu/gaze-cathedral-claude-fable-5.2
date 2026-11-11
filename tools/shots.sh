#!/bin/bash
# usage: tools/shots.sh <prefix> "<common args>" "name:args" "name:args" ...
cd "$(dirname "$0")/.."
prefix=$1; common=$2; shift 2
for item in "$@"; do
  name=${item%%:*}; args=${item#*:}
  node tools/shot.mjs "shots/${prefix}${name}.png" $common $args 2>&1 | grep -v "^$" | tail -4
done
