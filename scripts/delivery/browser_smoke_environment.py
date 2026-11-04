"""Refuse accidental use of a shared database or nonlocal browser target in CI."""
import os
from urllib.parse import urlsplit


def validate(environment):
    # The application resolves DATABASE_URL_FILE before opening its pool. Refuse the override
    # rather than admitting the raw URL and later connecting to a different, file-supplied URL.
    if environment.get("DATABASE_URL_FILE", ""):
        raise ValueError("Browser smoke forbids DATABASE_URL_FILE overrides")
    database = urlsplit(environment.get("DATABASE_URL", ""))
    if (database.scheme not in {"postgres", "postgresql"}
            or database.hostname != "127.0.0.1" or database.port != 5432
            or not database.path.startswith("/warpdrive_browser_smoke_")
            or database.query or database.fragment):
        raise ValueError("Browser smoke requires its disposable prefixed loopback PostgreSQL database")
    required = {
        "BASE_URL": "https://127.0.0.1:3443",
        "BUN_OPTIONS": "--no-env-file",
        "AUTH_GOOGLE_ENABLED": "false",
        "AUTH_SMTP_HOST": "127.0.0.1",
        "AUTH_SMTP_PORT": "9",
        "DISABLE_TELEMETRY": "true",
        "DISABLE_UPDATE_CHECK": "true",
        "ALLOW_FIRST_LOGIN_ADMIN": "false",
        "NEXT_PUBLIC_WS_URL": "",
    }
    if any(environment.get(key) != value for key, value in required.items()):
        raise ValueError("Browser smoke requires isolated endpoints and disabled external effects")


if __name__ == "__main__":
    validate(os.environ)
    print("Disposable browser smoke environment admitted")
