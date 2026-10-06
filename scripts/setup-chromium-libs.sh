#!/usr/bin/env bash
# Unpacks the Chromium shared libraries headless Electron needs into tools/chromium-libs, without
# root: each missing library is mapped to its Debian/Ubuntu package, downloaded with
# `apt-get download` and extracted with `dpkg-deb -x`. Repeats up to five rounds, since a library
# can need others. Ported from Fabula's scripts/setup-engine.sh (step 5).
set -uo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "Chromium libraries: not Linux, nothing to do."
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIBS="$ROOT/tools/chromium-libs"
LIB_PATH="$LIBS/usr/lib/x86_64-linux-gnu"
ELECTRON_BIN="$ROOT/node_modules/electron/dist/electron"
WORK="$ROOT/tools/.debs"

if [ ! -x "$ELECTRON_BIN" ]; then
  echo "Chromium libraries: Electron is not installed at $ELECTRON_BIN; run npm install first." >&2
  exit 1
fi

package_for() {
  case "$1" in
    libnspr4.so|libplc4.so|libplds4.so) echo "libnspr4" ;;
    libnss3.so|libnssutil3.so|libsmime3.so|libssl3.so) echo "libnss3" ;;
    libasound.so.2) echo "libasound2t64 libasound2" ;;
    libatk-1.0.so.0) echo "libatk1.0-0t64 libatk1.0-0" ;;
    libatk-bridge-2.0.so.0) echo "libatk-bridge2.0-0t64 libatk-bridge2.0-0" ;;
    libatspi.so.0) echo "libatspi2.0-0t64 libatspi2.0-0" ;;
    libcups.so.2) echo "libcups2t64 libcups2" ;;
    libdrm.so.2) echo "libdrm2" ;;
    libgbm.so.1) echo "libgbm1" ;;
    libgtk-3.so.0|libgdk-3.so.0) echo "libgtk-3-0t64 libgtk-3-0" ;;
    libpango-1.0.so.0|libpangocairo-1.0.so.0|libpangoft2-1.0.so.0) echo "libpango-1.0-0 libpangocairo-1.0-0" ;;
    libcairo.so.2|libcairo-gobject.so.2) echo "libcairo2 libcairo-gobject2" ;;
    libxkbcommon.so.0) echo "libxkbcommon0" ;;
    libXcomposite.so.1) echo "libxcomposite1" ;;
    libXdamage.so.1) echo "libxdamage1" ;;
    libXfixes.so.3) echo "libxfixes3" ;;
    libXrandr.so.2) echo "libxrandr2" ;;
    libX11.so.6) echo "libx11-6" ;;
    libxcb.so.1) echo "libxcb1" ;;
    libXext.so.6) echo "libxext6" ;;
    libexpat.so.1) echo "libexpat1" ;;
    libdbus-1.so.3) echo "libdbus-1-3" ;;
    libglib-2.0.so.0|libgobject-2.0.so.0|libgio-2.0.so.0|libgmodule-2.0.so.0) echo "libglib2.0-0t64 libglib2.0-0" ;;
    libudev.so.1) echo "libudev1" ;;
    libxshmfence.so.1) echo "libxshmfence1" ;;
    libwayland-client.so.0|libwayland-server.so.0) echo "libwayland-client0 libwayland-server0" ;;
    libgdk_pixbuf-2.0.so.0) echo "libgdk-pixbuf-2.0-0 libgdk-pixbuf2.0-0" ;;
    libepoxy.so.0) echo "libepoxy0" ;;
    libfontconfig.so.1) echo "libfontconfig1" ;;
    libfreetype.so.6) echo "libfreetype6" ;;
    libharfbuzz.so.0) echo "libharfbuzz0b" ;;
    libfribidi.so.0) echo "libfribidi0" ;;
    libthai.so.0) echo "libthai0" ;;
    libpixman-1.so.0) echo "libpixman-1-0" ;;
    libpng16.so.16) echo "libpng16-16t64 libpng16-16" ;;
    libXi.so.6) echo "libxi6" ;;
    libXrender.so.1) echo "libxrender1" ;;
    libXcursor.so.1) echo "libxcursor1" ;;
    libXinerama.so.1) echo "libxinerama1" ;;
    libxcb-render.so.0) echo "libxcb-render0" ;;
    libxcb-shm.so.0) echo "libxcb-shm0" ;;
    libXau.so.6) echo "libxau6" ;;
    libXdmcp.so.6) echo "libxdmcp6" ;;
    libavahi-client.so.3|libavahi-common.so.3) echo "libavahi-client3 libavahi-common3" ;;
    libgnutls.so.30) echo "libgnutls30t64 libgnutls30" ;;
    *) echo "" ;;
  esac
}

missing_libs() {
  LD_LIBRARY_PATH="$LIB_PATH${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ldd "$ELECTRON_BIN" 2>/dev/null | awk '/not found/ {print $1}' | sort -u
}

if [ -z "$(missing_libs)" ]; then
  echo "Chromium libraries: nothing missing."
  exit 0
fi
if ! command -v apt-get >/dev/null 2>&1 || ! command -v dpkg-deb >/dev/null 2>&1; then
  echo "Chromium libraries: missing $(echo $(missing_libs)), and apt-get/dpkg-deb are not available here." >&2
  exit 1
fi

mkdir -p "$LIBS" "$WORK"
trap 'rm -rf "$WORK"' EXIT
for round in 1 2 3 4 5; do
  missing="$(missing_libs)"
  [ -z "$missing" ] && break
  echo "round $round, missing: $(echo $missing)"
  wanted=""
  for lib in $missing; do wanted="$wanted $(package_for "$lib")"; done
  wanted="$(printf "%s\n" $wanted | sort -u)"
  rm -f "$WORK"/*.deb
  (
    cd "$WORK" || exit 1
    for pkg in $wanted; do
      # The first name the archive knows wins (24.04 renamed several to *t64).
      if apt-cache show "$pkg" >/dev/null 2>&1 && apt-get download "$pkg" >/dev/null 2>&1; then echo "fetched $pkg"; fi
    done
  )
  fetched=0
  for deb in "$WORK"/*.deb; do
    [ -e "$deb" ] || continue
    dpkg-deb -x "$deb" "$LIBS" && fetched=1
    rm -f "$deb"
  done
  if [ "$fetched" = 0 ]; then
    echo "could not fetch packages for: $(echo $missing)" >&2
    echo "install them yourself (sudo apt-get install ...) or point IMAGO_CHROMIUM_LIBS at a folder of them." >&2
    exit 1
  fi
done
left="$(missing_libs)"
if [ -n "$left" ]; then
  echo "still missing after five rounds: $(echo $left)" >&2
  exit 1
fi
echo "Chromium libraries ready in $LIB_PATH"
