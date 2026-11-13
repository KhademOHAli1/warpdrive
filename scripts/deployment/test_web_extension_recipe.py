"""Pin the Web SDK overlay to the qualified dependency and runtime stages."""

from pathlib import Path
import re
import unittest

from web_extension_inputs import dependency_policy, json_object, lock_object


ROOT = Path(__file__).resolve().parents[2]
IMAGES = ROOT / "deploy/images"
EXTENSION = ROOT / "tools/web-ui"
SDK_COPY = [
    "COPY --from=ui-deps /web-ui/node_modules/@ui-sdk/core ./node_modules/@ui-sdk/core",
    "COPY --from=ui-deps /web-ui/node_modules/@ui-sdk/react ./node_modules/@ui-sdk/react",
]


def recipe(path):
    # The qualified recipes use named FROM stages and ordinary line
    # continuations. Preserve every instruction byte while removing comments.
    stages = {}
    stage = None
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"FROM (\S+) AS ([a-z-]+)", line)
        if match:
            base, stage = match.groups()
            if stage in stages:
                raise ValueError("Duplicate Dockerfile stage")
            stages[stage] = (base, [])
        elif stage is None:
            raise ValueError("Instruction precedes a Dockerfile stage")
        else:
            stages[stage][1].append(line)
    return stages


class WebExtensionRecipeTests(unittest.TestCase):
    def test_exact_sidecar_lock_keeps_all_shared_runtime_resolutions(self):
        actual = dependency_policy(json_object((ROOT / "package.json").read_bytes()),
                                   lock_object((ROOT / "bun.lock").read_bytes()),
                                   json_object((EXTENSION / "package.json").read_bytes()),
                                   lock_object((EXTENSION / "bun.lock").read_bytes()))
        self.assertEqual(actual, {"next": "16.4.6", "react": "19.3.1", "react-dom": "19.3.1", "scheduler": "0.28.0"})

    def test_sdk_recipe_changes_only_the_two_web_dependency_trees(self):
        qualified = recipe(IMAGES / "Dockerfile")
        web = recipe(IMAGES / "Web.Dockerfile")
        self.assertEqual(set(web), {"base", "deps", "prod-deps", "ui-deps", "source", "web-build", "runtime-base", "web"})
        for stage in ("base", "deps", "prod-deps", "web-build", "web"):
            with self.subTest(stage=stage):
                self.assertEqual(web[stage], qualified[stage])
        self.assertEqual(web["ui-deps"], ("base", [
            "WORKDIR /web-ui",
            "COPY tools/web-ui/package.json tools/web-ui/bun.lock ./",
            "RUN bun --no-env-file install --frozen-lockfile --ignore-scripts --linker=hoisted --backend=copyfile",
            "RUN test -f node_modules/@ui-sdk/core/dist/index.js \\",
            "    && test -f node_modules/@ui-sdk/react/dist/primitive.js \\",
            '    && test -z "$(find node_modules/@ui-sdk -name node_modules -print)"',
        ]))
        self.assertEqual(web["source"], ("deps", ["COPY . .", *SDK_COPY]))
        base, lines = qualified["runtime-base"]
        index = lines.index("COPY --from=prod-deps /app/node_modules ./node_modules") + 1
        self.assertEqual(web["runtime-base"], (base, [*lines[:index], *SDK_COPY, *lines[index:]]))
        self.assertFalse(any("ui-deps" in line or "tools/web-ui" in line
                             for _, instructions in qualified.values() for line in instructions))


if __name__ == "__main__":
    unittest.main()
