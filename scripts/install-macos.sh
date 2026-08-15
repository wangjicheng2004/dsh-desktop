#!/usr/bin/env bash
# Installs one pinned, hash-verified release without weakening Gatekeeper.
set -euo pipefail

readonly VERSION="1.0.4"
readonly DMG_NAME="DeepSeek Harness-${VERSION}-mac-arm64.dmg"
readonly DMG_URL="https://github.com/wangjicheng2004/dsh-desktop/releases/download/v${VERSION}/${DMG_NAME}"
readonly DMG_SHA256="328f4fe8a5221d9039df02ee8e19c08d7a2e11447a2aaa2ab0bc2ea2bbfa819f"
readonly APP_NAME="DeepSeek Harness.app"

install_dir="${DSH_INSTALL_DIR:-$HOME/Applications}"
target_app="${install_dir}/${APP_NAME}"
temp_dir=""
mount_dir=""
mounted=0

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ "$mounted" -eq 1 ]; then
    hdiutil detach "$mount_dir" -quiet 2>/dev/null || true
  fi
  if [ -n "$temp_dir" ]; then
    rm -rf "$temp_dir"
  fi
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_command curl
require_command shasum
require_command hdiutil
require_command ditto
require_command codesign
require_command sw_vers

[ "$(uname -s)" = "Darwin" ] || fail "This installer only supports macOS."
[ "$(uname -m)" = "arm64" ] || fail "This release only supports Apple Silicon Macs."

macos_major=$(sw_vers -productVersion | awk -F. '{ print $1 }')
[ "$macos_major" -ge 11 ] || fail "macOS 11 or later is required."

[ ! -e "$target_app" ] || fail "${target_app} already exists. Remove or rename it before installing."

temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/dsh-desktop.XXXXXX")
mount_dir="${temp_dir}/mount"
dmg_path="${temp_dir}/${DMG_NAME}"
trap cleanup EXIT HUP INT TERM

printf 'Downloading DeepSeek Harness %s...\n' "$VERSION"
curl --fail --location --proto '=https' --tlsv1.2 --output "$dmg_path" "$DMG_URL"

actual_sha256=$(shasum -a 256 "$dmg_path" | awk '{ print $1 }')
[ "$actual_sha256" = "$DMG_SHA256" ] || fail "DMG checksum mismatch; installation stopped."

printf 'Verifying disk image...\n'
hdiutil verify "$dmg_path" >/dev/null

mkdir -p "$mount_dir" "$install_dir"
printf 'Installing to %s...\n' "$target_app"
hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$dmg_path" >/dev/null
mounted=1

source_app="${mount_dir}/${APP_NAME}"
[ -d "$source_app" ] || fail "The disk image does not contain ${APP_NAME}."
ditto "$source_app" "$target_app"

printf 'Verifying application signature...\n'
codesign --verify --deep --strict "$target_app"

printf '\nInstalled successfully: %s\n' "$target_app"
printf 'For the first launch, hold Control, click the app, then choose Open.\n'
