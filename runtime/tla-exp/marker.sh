#!/data/data/com.termux/files/usr/bin/bash
# Long-running marker; tag is $1, appears in ps args as tla-marker.sh TAG
TAG="${1:-TLA_NONE}"
echo "marker $TAG pid=$$ ppid=$PPID"
while true; do
  sleep 1
done
