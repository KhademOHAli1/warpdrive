"""Run an admitted Core beside credential-separated Web in owned image fixtures."""

from secrets import token_hex

from image_smoke import SmokeError, image_metadata

CORE_MEMORY_MIB = 768
CORE_READY = "if (!(await fetch('http://127.0.0.1:3010/readyz',{signal:AbortSignal.timeout(2000)})).ok) process.exit(1)"


def admit_core_image(fixture, component):
    image_id = component["imageId"]
    rows = fixture.docker.json(["image", "inspect", image_id], timeout=10)
    identity = image_metadata(rows, component["sourceRevision"])
    if (identity["id"] != image_id or identity["user"] != component["runtimeUser"]
            or rows[0].get("Os") != "linux" or rows[0].get("Architecture") != "amd64"):
        raise SmokeError("Local Core image differs from the exact tested artifact")
    fixture.env["CORE_PROXY_TOKEN"] = token_hex(32)
    return identity


def web_environment(fixture, trusted_proxy="none"):
    return {"CORE_API_ORIGIN": f"http://{fixture.prefix}-core:3010",
            "CORE_PROXY_TOKEN": fixture.env["CORE_PROXY_TOKEN"],
            "FRONTEND_TRUSTED_PROXY_HEADER": trusted_proxy,
            "NEXT_TELEMETRY_DISABLED": "1", "BUN_OPTIONS": "--no-env-file"}


def start_core(fixture, image_id, web_origin):
    core = fixture.start_container("core", image_id, [], environment={
        **fixture.env, "CORE_WEB_ORIGIN": web_origin, "RUNTIME_COMPONENT": "core-api",
    }, memory=f"{CORE_MEMORY_MIB}m", readonly=True)
    fixture.wait_for(lambda: fixture.docker.run(["exec", core, "bun", "--no-env-file", "-e", CORE_READY],
                                                check=False, timeout=5).returncode == 0,
                     "admitted Core readiness", 60, core)
    return core
