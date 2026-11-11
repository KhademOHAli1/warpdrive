#!/bin/sh
set -eu
export LC_ALL=C TZ=UTC

if [ "$#" -ne 3 ]; then
    echo "Usage: build.sh SOURCE_TAR UPSTREAM_BINARY OUTPUT_DIRECTORY" >&2
    exit 2
fi
context=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
for required in 010-optin-confirmation.patch 020-dispatch.patch 025-list-consent-mode.patch \
    027-public-subscriber-update.patch 030-campaign-revision.patch 035-affirmative-optin.patch \
    040-crm-identity.patch 045-sealed-crm-audiences.patch 050-durable-delivery.patch \
    055-crm-attribution.patch 057-archive-preview.patch 058-public-list-embed.patch \
    060-ses-feedback.patch 070-readiness.patch 075-atomic-bulk-delete.patch 080-consent-revocation-events.patch; do
    if [ ! -s "$context/patches/$required" ]; then
        echo "Required Listmonk patch is missing: $required" >&2
        exit 2
    fi
done
source_tar=$(CDPATH='' cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")
upstream=$(CDPATH='' cd -- "$(dirname -- "$2")" && pwd)/$(basename -- "$2")
mkdir -p "$3"
output=$(CDPATH='' cd -- "$3" && pwd)
if [ -e "$output/listmonk" ]; then
    echo "Build output already exists: $output/listmonk" >&2
    exit 2
fi

expected=52119464c87ed71a60d46f7097ddb304967d344fc1954769388a1e2d764b659b
if command -v sha256sum >/dev/null 2>&1; then
    checksum=$(sha256sum "$source_tar")
else
    checksum=$(shasum -a 256 "$source_tar")
fi
if [ "${checksum%% *}" != "$expected" ]; then
    echo "Pinned Listmonk source checksum mismatch" >&2
    exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
mkdir "$work/source" "$work/corresponding-source"
tar -xzf "$source_tar" --strip-components 1 -C "$work/source"
cd "$work/source"
for patch_file in "$context"/patches/*.patch; do
    git apply --check "$patch_file"
    git apply "$patch_file"
done
if ! grep -Fq 'map[string]int{"consent": 2, "dispatch": 1, "listConsentMode": 1, "publicSubscriberUpdate": 1, "campaignRevision": 1, "crmIdentity": 1, "crmAudiences": 1, "durableDelivery": 1, "crmAttribution": 1, "listEmbed": 1, "sesFeedback": 1, "readiness": 1, "atomicBulk": 1, "consentEvents": 1}' cmd/handlers.go; then
    echo "The derived engine is missing a required Warpdrive capability" >&2
    exit 1
fi

go_command=${GO:-go}
CGO_ENABLED=0 GOOS='' GOARCH='' "$go_command" build -trimpath -mod=readonly \
    -o "$work/stuffbin" github.com/knadh/stuffbin/stuffbin
CGO_ENABLED=0 GOOS='' GOARCH='' "$go_command" build -trimpath -mod=readonly \
    -o "$work/build-assets" "$context/build-assets.go"
"$work/build-assets" admin "$upstream" frontend/dist

cp "$source_tar" "$work/corresponding-source/listmonk-ef0a758.tar.gz"
cp LICENSE "$work/corresponding-source/LICENSE"
cp "$context"/.dockerignore "$context"/.gitattributes "$context"/Dockerfile "$context"/README.md "$context"/build.sh \
    "$context"/build-assets.go "$work/corresponding-source/"
cp -R "$context"/patches "$work/corresponding-source/"
for directory in tests dispatch-tests durability-tests feedback-tests readiness-tests; do
    if [ -d "$context/$directory" ]; then
        cp -R "$context/$directory" "$work/corresponding-source/"
    fi
done
"$work/build-assets" source "$work/corresponding-source" \
    static/public/static/warpdrive-engine-source.tar.gz

CGO_ENABLED=0 GOOS="${TARGETOS:-}" GOARCH="${TARGETARCH:-}" "$go_command" build \
    -trimpath -buildvcs=false -mod=readonly \
    -ldflags="-s -w -X main.versionString=v6.2.0 -X main.buildString=v6.2.0+warpdrive-crm.1-ef0a758" \
    -o "$work/listmonk-base" ./cmd
find config.toml.sample schema.sql queries permissions.json static/public static/email-templates \
    frontend/dist i18n -type f -exec touch -t 198001010000.00 {} +
"$work/stuffbin" -a stuff -in "$work/listmonk-base" -out "$work/listmonk" \
    config.toml.sample schema.sql queries:/queries permissions.json \
    static/public:/public static/email-templates frontend/dist:/admin i18n:/i18n
cp LICENSE "$output/LICENSE"
cp static/public/static/warpdrive-engine-source.tar.gz "$output/warpdrive-engine-source.tar.gz"
cp "$work/listmonk" "$output/listmonk"
