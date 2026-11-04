import unittest

from browser_smoke_environment import validate


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.environment = {
            "DATABASE_URL": "postgres://smoke:smoke@127.0.0.1:5432/warpdrive_browser_smoke_ci",
            "BASE_URL": "https://127.0.0.1:3443", "BUN_OPTIONS": "--no-env-file",
            "AUTH_GOOGLE_ENABLED": "false", "AUTH_SMTP_HOST": "127.0.0.1",
            "AUTH_SMTP_PORT": "9", "DISABLE_TELEMETRY": "true",
            "DISABLE_UPDATE_CHECK": "true", "ALLOW_FIRST_LOGIN_ADMIN": "false",
        }

    def test_disposable_local_environment(self):
        validate(self.environment)

    def test_reject_remote_shared_or_parameterized_database(self):
        for url in [
            "postgres://smoke:smoke@db.example:5432/warpdrive_browser_smoke_ci",
            "postgres://smoke:smoke@127.0.0.1:5432/warpdrive",
            "postgres://smoke:smoke@127.0.0.1:5432/warpdrive_browser_smoke_ci?host=remote",
        ]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate(dict(self.environment, DATABASE_URL=url))

    def test_reject_external_effects_or_dotenv_loading(self):
        for key in ["BASE_URL", "BUN_OPTIONS", "AUTH_GOOGLE_ENABLED", "AUTH_SMTP_HOST"]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate(dict(self.environment, **{key: "unsafe"}))


if __name__ == "__main__":
    unittest.main()
