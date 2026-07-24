#!/usr/bin/env bash
# Clidable server installer.
#
#   curl -fsSL https://raw.githubusercontent.com/openclide/clidable/main/install.sh | bash
#
# Downloads the clidable-server binary for this OS/arch from GitHub Releases,
# verifies its SHA-256 against the release's SHA256SUMS, and installs it to
# ~/.local/bin AS `clidable` (override the dir with CLIDABLE_INSTALL) — the
# download artifact is named clidable-server-* to stay distinguishable from
# the desktop installers, but the command you type is just `clidable`. curl
# downloads carry no macOS quarantine attribute, so the binary runs without
# Gatekeeper prompts.
#
#   CLIDABLE_VERSION=v0.1.0 …     install a specific tagged release
#   CLIDABLE_INSTALL=/usr/local/bin …   install elsewhere
set -euo pipefail

REPO="openclide/clidable"
INSTALL_DIR="${CLIDABLE_INSTALL:-$HOME/.local/bin}"
VERSION="${CLIDABLE_VERSION:-latest}"
# Test seam: point at any server that mirrors the release layout.
BASE_URL="${CLIDABLE_DOWNLOAD_BASE:-}"

say()  { printf '\033[1;35m[clidable]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[clidable]\033[0m %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is required"

# -- pick the artifact for this machine --------------------------------------
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) os_slug="darwin" ;;
  Linux)  os_slug="linux" ;;
  MINGW*|MSYS*|CYGWIN*)
    fail "on Windows, download clidable-server-windows-x64.exe (or -windows-arm64.exe on ARM) from https://github.com/$REPO/releases" ;;
  *) fail "unsupported OS: $os" ;;
esac
case "$arch" in
  arm64|aarch64)  arch_slug="arm64" ;;
  x86_64|amd64)   arch_slug="x64" ;;
  *) fail "unsupported architecture: $arch" ;;
esac
artifact="clidable-server-${os_slug}-${arch_slug}"

if [ -z "$BASE_URL" ]; then
  if [ "$VERSION" = "latest" ]; then
    BASE_URL="https://github.com/$REPO/releases/latest/download"
  else
    BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
  fi
fi

# -- download binary + checksums into a scratch dir ---------------------------
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

say "downloading $artifact ($VERSION)…"
curl -fSL --progress-bar "$BASE_URL/$artifact" -o "$tmp/$artifact" ||
  fail "download failed — is a release published yet? https://github.com/$REPO/releases"
curl -fsSL "$BASE_URL/SHA256SUMS" -o "$tmp/SHA256SUMS" ||
  fail "could not fetch SHA256SUMS from the release"

# -- verify -------------------------------------------------------------------
expected="$(awk -v f="$artifact" '$2 == f || $2 == "*"f {print $1}' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || fail "SHA256SUMS has no entry for $artifact"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$artifact" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$tmp/$artifact" | awk '{print $1}')"
fi
[ "$actual" = "$expected" ] || fail "checksum mismatch for $artifact
  expected: $expected
  actual:   $actual"
say "checksum verified"

# -- install ------------------------------------------------------------------
mkdir -p "$INSTALL_DIR"
install -m 755 "$tmp/$artifact" "$INSTALL_DIR/clidable"
# Earlier versions installed under the artifact name; replace with a pointer
# so both names keep working for anyone who scripted against the old one.
# `-n`: don't dereference if the old entry is a symlink to a directory (ln
# would otherwise drop the new link INSIDE it). Relative target: resolves
# against the symlink's own dir, so it survives the dir being moved and a
# relative CLIDABLE_INSTALL (an absolute target dangles in both cases).
# Non-fatal: on symlink-less filesystems (Linux vfat/CIFS) a failure here
# must not make set -e report a completed install as failed.
if [ -e "$INSTALL_DIR/clidable-server" ] || [ -L "$INSTALL_DIR/clidable-server" ]; then
  ln -sfn clidable "$INSTALL_DIR/clidable-server" ||
    say "note: could not create the clidable-server compat symlink (non-fatal — clidable installed fine)"
fi
say "installed $INSTALL_DIR/clidable"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) say "note: $INSTALL_DIR is not on your PATH — add it to your shell profile:
    export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
esac

say "run it:  clidable   →  http://127.0.0.1:7878"
