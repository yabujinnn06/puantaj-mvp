from __future__ import annotations

import unittest

from app.services.location import distance_m, haversine_distance_m


class LocationServiceTests(unittest.TestCase):
    def test_distance_m_zero_for_same_point(self) -> None:
        value = distance_m(41.0, 29.0, 41.0, 29.0)
        self.assertAlmostEqual(value, 0.0, places=6)

    def test_distance_m_known_reference(self) -> None:
        # Approximate distance for 1 degree longitude on equator.
        value = distance_m(0.0, 0.0, 0.0, 1.0)
        self.assertAlmostEqual(value, 111_195, delta=300)

    def test_haversine_alias_matches_distance_m(self) -> None:
        v1 = distance_m(41.0082, 28.9784, 39.9334, 32.8597)
        v2 = haversine_distance_m(41.0082, 28.9784, 39.9334, 32.8597)
        self.assertAlmostEqual(v1, v2, places=9)


if __name__ == "__main__":
    unittest.main()

