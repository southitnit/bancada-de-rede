#!/bin/sh
# Junta engine-src/*.js em public/engine.js
cd "$(dirname "$0")/.." && cat engine-src/*.js > public/engine.js && echo "public/engine.js gerado ($(wc -c < public/engine.js) bytes)"
