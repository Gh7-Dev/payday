#!/bin/bash
cd ~/gh7-dev/payday || { echo "folder: MISSING"; exit 1; }
if [ "$1" = "test" ]; then
  if anchor test >/tmp/test.log 2>&1; then echo "test: OK"; else echo "test: FAIL"; grep -E "panicked|FAILED|^error" -A4 /tmp/test.log | head -n 25; fi
else
  if anchor build >/tmp/build.log 2>&1; then echo "build: OK"; else echo "build: FAIL"; grep -E "^error" -A8 /tmp/build.log | head -n 25; fi
fi
