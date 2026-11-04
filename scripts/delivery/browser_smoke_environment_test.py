import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from browser_smoke_environment import validate


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.environment = {
            "DATABASE_URL": "postgres://smoke:smoke@127.0.0.1:5432/warpdrive_browser_smoke_ci",
            "BASE_URL": "https://127.0.0.1:3443", "BUN_OPTIONS": "--no-env-file",
            "AUTH_GOOGLE_ENABLED": "false", "AUTH_SMTP_HOST": "127.0.0.1",
            "AUTH_SMTP_PORT": "9", "DISABLE_TELEMETRY": "true",
            "DISABLE_UPDATE_CHECK": "true", "ALLOW_FIRST_LOGIN_ADMIN": "false",
            "NEXT_PUBLIC_WS_URL": "",
        }

    def test_disposable_local_environment(self):
        validate(self.environment)
        validate(dict(self.environment, DATABASE_URL_FILE=""))

    def test_file_override_cannot_redirect_an_admitted_raw_url(self):
        with TemporaryDirectory() as directory:
            override = Path(directory) / "database-url"
            for target in [
                "postgres://smoke:smoke@db.example:5432/customer",
                "postgres://smoke:smoke@127.0.0.1:5432/warpdrive",
            ]:
                override.write_text(target)
                with self.subTest(target=target), self.assertRaisesRegex(
                    ValueError, "DATABASE_URL_FILE"
                ):
                    validate(dict(self.environment, DATABASE_URL_FILE=str(override)))

    def test_reject_file_override_before_reading_it(self):
        with self.assertRaisesRegex(ValueError, "DATABASE_URL_FILE"):
            validate(dict(self.environment, DATABASE_URL_FILE="/missing/database-url"))

    def test_reject_remote_shared_or_parameterized_database(self):
        for url in [
            "postgres://smoke:smoke@db.example:5432/warpdrive_browser_smoke_ci",
            "postgres://smoke:smoke@127.0.0.1:5432/warpdrive",
            "postgres://smoke:smoke@127.0.0.1:5432/warpdrive_browser_smoke_ci?host=remote",
        ]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate(dict(self.environment, DATABASE_URL=url))

    def test_reject_external_effects_or_dotenv_loading(self):
        for key in ["BASE_URL", "BUN_OPTIONS", "AUTH_GOOGLE_ENABLED", "AUTH_SMTP_HOST",
                    "NEXT_PUBLIC_WS_URL"]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate(dict(self.environment, **{key: "unsafe"}))


if __name__ == "__main__":
    unittest.main()
