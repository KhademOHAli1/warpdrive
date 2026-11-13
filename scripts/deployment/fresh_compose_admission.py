"""Admit a pinned fresh Compose model and one isolated Web image change."""

import argparse
from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import time

from component_inputs import decode
from installed_web_chain import _directory, _private_bytes
from web_switch import HASH, SwitchConflict, canonical, content_hash, require


ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ("docker-compose.yml", "docker-compose.newsletters.yml", "deploy/images/compose.yml", "deploy/images/compose.fresh.yml")
IMAGES = {"WARPDRIVE_WEB_IMAGE": ("app",), "WARPDRIVE_REALTIME_IMAGE": ("ws",), "WARPDRIVE_WORKER_IMAGE": ("worker",),
          "WARPDRIVE_MIGRATOR_IMAGE": ("migrate",), "WARPDRIVE_CADDY_IMAGE": ("caddy",), "WARPDRIVE_POSTGRES_IMAGE": ("postgres",),
          "WARPDRIVE_STORAGE_IMAGE": ("minio",), "WARPDRIVE_STORAGE_INIT_IMAGE": ("createbuckets",),
          "WARPDRIVE_NEWSLETTER_IMAGE": ("newsletter-engine", "newsletter-engine-migrate")}
SERVICES = {service for entries in IMAGES.values() for service in entries}
ONE_SHOTS = {"migrate", "createbuckets", "newsletter-engine-migrate"}
PROJECT = re.compile(r"[a-z0-9][a-z0-9_-]{0,62}\Z")
IMAGE = re.compile(r"[a-z0-9]+(?:[a-z0-9._:/-]*[a-z0-9])?@sha256:[a-f0-9]{64}\Z")
IMAGE_ASSIGNMENT = re.compile(r"\s*(?:export\s+)?(WARPDRIVE_[A-Z_]+_IMAGE)\s*=\s*(\S+)\s*\Z")
VOLUME_MOUNTS = {"caddy": {"caddydata": "/data", "caddyconfig": "/config"}, "postgres": {"pgdata": "/var/lib/postgresql/data"},
                 "minio": {"miniodata": "/data"}, "newsletter-engine": {"newsletter_uploads": "/listmonk/uploads"}}
BIND_MOUNTS = {"Caddyfile": "/etc/caddy/Caddyfile", "deploy/newsletters/Caddyfile": "/etc/caddy/warpdrive-newsletters"}
GATES = {"app": {"migrate": "service_completed_successfully", "createbuckets": "service_completed_successfully"},
         "caddy": {"app": "service_healthy", "ws": "service_started"}, "createbuckets": {"minio": "service_started"},
         "migrate": {"postgres": "service_healthy"}, "ws": {"migrate": "service_completed_successfully"},
         "worker": {"migrate": "service_completed_successfully"}, "newsletter-engine": {"postgres": "service_healthy"},
         "newsletter-engine-migrate": {"postgres": "service_healthy"}}
DISABLED = {"NEWSLETTER_DELIVERY_ENABLED", "NEWSLETTER_PUBLIC_SIGNUP_ENABLED", "NEWSLETTER_SES_FEEDBACK_ENABLED"}
EMPTY = {"NEWSLETTER_TEST_RECIPIENTS", "NEWSLETTER_SES_TOPIC_ARN", "NEWSLETTER_SES_CONFIGURATION_SET", "NEWSLETTER_API_USER",
         "NEWSLETTER_API_TOKEN", "NEWSLETTER_API_TOKEN_FILE", "NEWSLETTER_BASE_URL", "LISTMONK_ADMIN_USER", "LISTMONK_ADMIN_PASSWORD"}
OWNER_FIELDS = {"MIGRATION_DATABASE_URL", "MIGRATION_DATABASE_URL_FILE", "POSTGRES_PASSWORD", "POSTGRES_PASSWORD_FILE"}
MAX_OUTPUT = 512 * 1024
TIMEOUT = 20


def _pinned_images(path, expected):
    raw = _private_bytes(path, modes=(0o400, 0o600))
    require(HASH.fullmatch(expected) and sha256(raw).hexdigest() == expected, "Fresh Compose interpolation file differs from its SHA-256 pin")
    values = {}
    for line in raw.decode("utf-8", "strict").splitlines():
        match = IMAGE_ASSIGNMENT.fullmatch(line)
        if match and match[1] in IMAGES:
            variable, ref = match.groups()
            require(variable not in values and len(ref) <= 255 and IMAGE.fullmatch(ref), "Each fresh image requires one literal immutable reference")
            values[variable] = ref
    require(set(values) == set(IMAGES), "Exact independent fresh image references required")
    return {service: values[variable] for variable, names in IMAGES.items() for service in names}


def _config(docker, project, directory, env_file):
    command = [str(docker), "compose", "--project-name", project, "--project-directory", str(directory),
               "--env-file", str(env_file), "--profile", "newsletter-migrations"]
    for compose in COMPOSE:
        command.extend(("--file", str(ROOT / compose)))
    command.extend(("config", "--format", "json"))
    environment = {"PATH": os.defpath, "DOCKER_HOST": "unix:///dev/null"}
    deadline = time.monotonic() + TIMEOUT
    raw = bytearray()
    with subprocess.Popen(command, cwd=directory, env=environment, stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True) as process:
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    require(remaining > 0 and selector.select(remaining), "Fresh Compose config timed out")
                    chunk = os.read(process.stdout.fileno(), min(65536, MAX_OUTPUT - len(raw) + 1))
                    if not chunk:
                        break
                    raw.extend(chunk)
                    require(len(raw) <= MAX_OUTPUT, "Fresh Compose config output exceeded its bound")
            require(process.wait(timeout=max(0, deadline - time.monotonic())) == 0, "Fresh Compose model could not be rendered")
        finally:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except PermissionError:
                    process.kill()
    return decode(bytes(raw))


def _mounts(name, service, directory):
    named = {source: (target, "volume", False) for source, target in VOLUME_MOUNTS.get(name, {}).items()}
    if name == "caddy":
        named.update({str(directory / source): (target, "bind", True) for source, target in BIND_MOUNTS.items()})
    rows = service.get("volumes", [])
    require(type(rows) is list and len(rows) == len(named) and {
        row["source"]: (row["target"], row["type"], row.get("read_only", False)) for row in rows
    } == named, "Fresh Compose service mount scope differs")


def _service(name, service, directory, expected):
    require(service.get("image") == expected and service.get("pull_policy") == "never"
            and not {"build", "network_mode", "privileged", "volumes_from", "devices", "provider", "configs", "secrets"} & service.keys(),
            "Fresh Compose service image or isolation differs")
    require(service.get("restart") == ("no" if name in ONE_SHOTS else "unless-stopped")
            and service.get("profiles", []) == (["newsletter-migrations"] if name == "newsletter-engine-migrate" else []),
            "Fresh Compose startup profile differs")
    require(service.get("networks") in ({"default": None}, {"default": {}}), "Fresh Compose service network differs")
    dependencies = service.get("depends_on", {})
    require({dep: gate["condition"] for dep, gate in dependencies.items()} == GATES.get(name, {})
            and all(gate.get("required", True) is True and gate.get("restart", False) is False for gate in dependencies.values()),
            "Fresh Compose cold-start dependency gate differs")
    ports = service.get("ports", [])
    if name == "caddy":
        require(len(ports) == 2 and {(row["target"], str(row["published"]), row.get("protocol", "tcp")) for row in ports}
                == {(80, "80", "tcp"), (443, "443", "tcp")} and all(row.get("mode", "ingress") == "ingress" for row in ports),
                "Fresh Compose Caddy ports differ")
    else:
        require(not ports, "Only Caddy may publish ports in the fresh Compose model")
    _mounts(name, service, directory)
    environment = service.get("environment", {})
    require(type(environment) is dict and all(environment.get(key, "false") == "false" for key in DISABLED)
            and all(environment.get(key, "") == "" for key in EMPTY), "Fresh Compose newsletter delivery, provider and signup must stay disabled")
    if name in {"app", "worker", "ws"}:
        require(all(environment.get(key) == "" for key in OWNER_FIELDS), "Fresh Compose runtime inherits a database owner binding")
    if name == "newsletter-engine":
        require(environment.get("NEWSLETTER_DELIVERY_ENABLED") == "false" and service["command"][:2] == ["sh", "-ec"]
                and service["command"][-1].rstrip().endswith("exec ./listmonk --config '' --passive"), "Fresh Compose engine must start passive")
    if name == "newsletter-engine-migrate":
        require(service.get("command") == ["./listmonk", "--migrate", "--yes", "--config", ""], "Fresh Compose newsletter migration command differs")


def _validate(model, project, directory, images):
    require(type(model) is dict and model.get("name") == project and set(model["services"]) == SERVICES,
            "Fresh Compose project or service inventory differs")
    networks = model["networks"]
    require(set(networks) == {"default"} and networks["default"].get("name") == project + "_default"
            and set(networks["default"]) <= {"name", "ipam", "driver"} and not networks["default"].get("ipam")
            and networks["default"].get("driver", "bridge") == "bridge", "One project-scoped default bridge is required")
    volumes = model["volumes"]
    names = set().union(*VOLUME_MOUNTS.values())
    require(set(volumes) == names and all(value.get("name") == f"{project}_{name}"
            and set(value) <= {"name", "driver"} and value.get("driver", "local") == "local" for name, value in volumes.items()),
            "Five project-scoped local storage volumes are required")
    for name, service in model["services"].items():
        _service(name, service, directory, images[name])


def admit(*, docker, project, directory, baseline_env, baseline_pin, candidate_env, candidate_pin):
    require(PROJECT.fullmatch(project) and directory != ROOT and not ROOT.is_relative_to(directory),
            "A dedicated fresh Compose project directory is required")
    _directory(directory)
    service_env = directory / ".env"
    service_bytes = _private_bytes(service_env, modes=(0o400, 0o600))
    images = _pinned_images(baseline_env, baseline_pin)
    candidate_images = _pinned_images(candidate_env, candidate_pin)
    require(candidate_images["app"].rsplit("@", 1)[1] != images["app"].rsplit("@", 1)[1]
            and {**candidate_images, "app": images["app"]} == images, "Fresh candidate must change only the Web image")
    baseline, candidate = (_config(docker, project, directory, path) for path in (baseline_env, candidate_env))
    require(_private_bytes(service_env, modes=(0o400, 0o600)) == service_bytes
            and _pinned_images(baseline_env, baseline_pin) == images
            and _pinned_images(candidate_env, candidate_pin) == candidate_images, "Fresh Compose configuration changed during admission")
    _validate(baseline, project, directory, images)
    _validate(candidate, project, directory, candidate_images)
    normalized = deepcopy(candidate)
    normalized["services"]["app"]["image"] = images["app"]
    require(canonical(normalized) == canonical(baseline), "Fresh candidate changes another rendered Compose setting")
    return {"schemaVersion": 1, "kind": "warpdrive-fresh-compose-admission", "project": project, "state": "admitted",
            "baselineModelSha256": content_hash(baseline), "candidateModelSha256": content_hash(candidate),
            "baselineImages": images, "candidateWebImage": candidate_images["app"], "deploymentAuthorized": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    for name in ("project-directory", "baseline-env", "candidate-env"):
        parser.add_argument("--" + name, required=True, type=Path)
    for name in ("baseline-env-sha256", "candidate-env-sha256"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--docker", type=Path)
    args = parser.parse_args(argv)
    try:
        docker = args.docker if args.docker is not None else shutil.which("docker")
        require(docker is not None and Path(docker).is_absolute(), "An absolute Docker CLI is required")
        docker = Path(docker).resolve(strict=True)
        require(stat.S_ISREG(docker.stat().st_mode) and os.access(docker, os.X_OK), "An executable Docker CLI is required")
        result = admit(docker=docker, project=args.project, directory=args.project_directory, baseline_env=args.baseline_env,
                       baseline_pin=args.baseline_env_sha256, candidate_env=args.candidate_env, candidate_pin=args.candidate_env_sha256)
        print(json.dumps(result, sort_keys=True))
    except (OSError, ValueError, TypeError, AttributeError, KeyError, SwitchConflict, subprocess.SubprocessError) as error:
        print(json.dumps({"state": "held", "errorType": type(error).__name__}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
