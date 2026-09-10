#!/data/data/com.termux/files/usr/bin/bash
# Foreground terminal session that hosts the runsvdir loop. The session is
# attached to the Termux app (PPID app, STAT Ss+), so the platform spares it
# while it kills detached/orphan service processes.
exec /data/data/com.termux/files/home/tla-runsvdir-loop.sh
