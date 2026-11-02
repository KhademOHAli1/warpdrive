import unittest

from tracking_model import TrackingError, validate


def item(ident, **values):
    return dict(id=ident, title=ident, module="operations", kind="deliverable", **values)


def manifest(items):
    return {"schema_version": 1, "repository": "owner/repo", "sources": [], "items": items}


class TrackingLimitTests(unittest.TestCase):
    def test_hierarchy_depth_limit_is_order_independent_and_accepts_eight_parent_hops(self):
        for hops in (10, 9, 1500):
            chain = [item(f"I{index}", parent=f"I{index - 1}" if index else None) for index in range(hops + 1)]
            for order_name, ordered in (("parent-first", chain), ("child-first", list(reversed(chain))), ("interleaved", chain[::2] + chain[1::2])):
                with self.subTest(hops=hops, order=order_name):
                    with self.assertRaisesRegex(TrackingError, "eight"):
                        validate(manifest(ordered))
        valid = [item(f"I{index}", parent=f"I{index - 1}" if index else None) for index in range(9)]
        self.assertEqual(len(validate(manifest(valid))), 9)
        self.assertEqual(len(validate(manifest(list(reversed(valid))))), 9)

    def test_outgoing_dependency_limit_counts_distinct_edges(self):
        leaves = [item(f"D{index}") for index in range(51)]
        dependent = item("dependent", dependencies=[leaf["id"] for leaf in leaves])
        with self.assertRaisesRegex(TrackingError, "50.*blocking dependencies"):
            validate(manifest([dependent, *leaves]))
        dependent["dependencies"] = dependent["dependencies"][:50]
        self.assertEqual(len(validate(manifest([dependent, *leaves]))), 52)
        # Reject repeated IDs separately instead of treating them as extra edges.
        dependent["dependencies"] += ["D0"] * 5
        with self.assertRaisesRegex(TrackingError, "Duplicate dependency"):
            validate(manifest([dependent, *leaves]))

    def test_incoming_dependency_limit_counts_distinct_edges(self):
        dependents = [item(f"D{index}", dependencies=["base"]) for index in range(51)]
        with self.assertRaisesRegex(TrackingError, "50.*blocked issues"):
            validate(manifest([item("base"), *dependents]))
        self.assertEqual(len(validate(manifest([item("base"), *dependents[:50]]))), 51)


if __name__ == "__main__":
    unittest.main()
