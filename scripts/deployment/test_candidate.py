import copy
import unittest

from candidate import CandidateError, COMPONENTS, SMOKE_CHECKS, admit_capacity, create_candidate

SHA = "1" * 40


def fixture():
    inspections = {name: {"Id": "sha256:" + str(index) * 64, "Os": "linux", "Architecture": "amd64",
                          "Config": {"User": "bun", "Labels": {"org.opencontainers.image.revision": SHA}}}
                   for index, name in enumerate(COMPONENTS, 1)}
    report = {"schemaVersion": 1, "success": True, "expectedRevision": SHA,
              "cleanup": {"success": True, "errors": []},
              "checks": [{"name": name, "status": "passed"} for name in SMOKE_CHECKS],
              "limitations": ["No installation acceptance"],
              "images": {name: {"id": image["Id"], "revision": SHA, "user": "bun"}
                         for name, image in inspections.items()}}
    return report, inspections


class CandidateTests(unittest.TestCase):
    def test_passed_smoke_binds_artifact_without_authorizing_deployment(self):
        report, images = fixture()
        result = create_candidate(SHA, report, "a" * 64, images)
        self.assertEqual(result["components"]["web"]["imageId"], images["web"]["Id"])
        self.assertFalse(result["deploymentAuthorized"])
        self.assertEqual(result["compatibility"], "unassessed")
        self.assertIn("installation-and-recovery-acceptance", result["pendingGates"])

    def test_failed_missing_or_other_revision_smoke_rejected(self):
        report, images = fixture()
        for field, value in (("success", False), ("expectedRevision", "2" * 40), ("checks", []),
                             ("limitations", []), ("cleanup", {"success": False})):
            bad = {**report, field: value}
            with self.subTest(field=field), self.assertRaises(CandidateError):
                create_candidate(SHA, bad, "a" * 64, images)

    def test_wrong_image_architecture_source_user_or_id_rejected(self):
        report, images = fixture()
        mutations = [lambda im: im["web"].update(Architecture="arm64"),
                     lambda im: im["web"].update(Id="sha256:" + "f" * 64),
                     lambda im: im["web"]["Config"].update(User="root"),
                     lambda im: im["web"]["Config"]["Labels"].update({"org.opencontainers.image.revision": "f" * 40})]
        for mutate in mutations:
            bad = copy.deepcopy(images)
            mutate(bad)
            with self.assertRaises(CandidateError):
                create_candidate(SHA, report, "a" * 64, bad)

    def test_one_failed_check_blocks_entire_candidate(self):
        report, images = fixture()
        report["checks"].append({"name": "worker", "status": "failed"})
        with self.assertRaises(CandidateError):
            create_candidate(SHA, report, "a" * 64, images)

    def test_missing_component_blocks_candidate(self):
        report, images = fixture()
        del images["realtime"]
        with self.assertRaises(CandidateError):
            create_candidate(SHA, report, "a" * 64, images)

    def test_missing_unknown_or_duplicate_smoke_check_cannot_qualify(self):
        report, images = fixture()
        for name in SMOKE_CHECKS:
            partial = copy.deepcopy(report)
            partial["checks"] = [c for c in partial["checks"] if c["name"] != name]
            with self.subTest(missing=name), self.assertRaises(CandidateError):
                create_candidate(SHA, partial, "a" * 64, images)
        for checks in ([{"name": "arbitrary", "status": "passed"}],
                       report["checks"] + [report["checks"][0]],
                       report["checks"] + [{"name": "invented", "status": "passed"}]):
            with self.assertRaises(CandidateError):
                create_candidate(SHA, {**report, "checks": checks}, "a" * 64, images)

    def test_root_user_with_group_or_zero_padding_is_rejected(self):
        report, images = fixture()
        for user in ("0:1000", "root:1000", "000:1000", "root", "0", ""):
            bad = copy.deepcopy(images)
            bad["web"]["Config"]["User"] = user
            observed = copy.deepcopy(report)
            observed["images"]["web"]["user"] = user
            with self.subTest(user=user), self.assertRaises(CandidateError):
                create_candidate(SHA, observed, "a" * 64, bad)

    def test_disk_admission_includes_peak_migration_temp_and_reserve(self):
        self.assertEqual(admit_capacity(available=100, candidate=40, migration=10, temporary=10, reserve=20)["remainingBytes"], 20)
        with self.assertRaises(CandidateError):
            admit_capacity(available=79, candidate=40, migration=10, temporary=10, reserve=20)

    def test_unknown_or_invalid_capacity_is_not_admitted(self):
        for value in (None, -1, True, 1.5):
            with self.subTest(value=value), self.assertRaises(CandidateError):
                admit_capacity(available=100, candidate=value, migration=0, temporary=0, reserve=20)
        with self.assertRaises(CandidateError):
            admit_capacity(available=100, candidate=0, migration=0, temporary=0, reserve=20)


if __name__ == "__main__":
    unittest.main()
