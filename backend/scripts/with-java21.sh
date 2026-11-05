#!/bin/sh
# The Firestore emulator needs Java 21+. Use it if the default java is older and a JDK 21+ is installed.
major() { "$1" -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1; }
current=$(major java)
if [ -z "$current" ] || [ "$current" -lt 21 ]; then
  for home in /opt/homebrew/opt/openjdk@21 /opt/homebrew/opt/openjdk /usr/local/opt/openjdk@21 /usr/local/opt/openjdk "$(/usr/libexec/java_home -v 21+ 2>/dev/null)"; do
    found=$(major "$home/bin/java" 2>/dev/null)
    if [ -n "$found" ] && [ "$found" -ge 21 ]; then
      export JAVA_HOME="$home" PATH="$home/bin:$PATH"
      break
    fi
  done
fi
exec "$@"
