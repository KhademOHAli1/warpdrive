#!/bin/sh
set -eu

# Keep Listmonk's file-backed environment contract without mutating users,
# groups or ownership of an existing installation or uploads volume.
fail_secret() {
    echo "Newsletter secret file is missing, unreadable or invalid" >&2
    exit 1
}

for variable in $(env | sed -n 's/^\(LISTMONK_.*_FILE\)=.*/\1/p'); do
    case "$variable" in
        LISTMONK_*_FILE) ;;
        *) fail_secret ;;
    esac
    case "$variable" in
        *[!A-Za-z0-9_]*) fail_secret ;;
    esac
    # The marker preserves trailing newlines so an invalid path cannot silently
    # become a different file. No eval or secret value enters a command string.
    if path_with_marker=$(printenv "$variable" && printf '.'); then
        secret_path=${path_with_marker%.}
        # printenv appends one delimiter newline, separate from the value.
        secret_path=${secret_path%'
'}
    else
        fail_secret
    fi
    case "$secret_path" in
        *'
'*) fail_secret ;;
    esac
    [ -f "$secret_path" ] && [ -r "$secret_path" ] || fail_secret
    if secret_value=$(cat -- "$secret_path" 2>/dev/null); then
        export "${variable%_FILE}=$secret_value"
    else
        fail_secret
    fi
done

exec "$@"
