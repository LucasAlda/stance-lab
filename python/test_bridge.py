import unittest

from bridge import calibrate


class CalibrationTests(unittest.TestCase):
    def test_factory_points_and_interpolation(self):
        calibration = [[1000] * 4, [2000] * 4, [3000] * 4]
        self.assertEqual(calibrate([1000, 1500, 2000, 3000], calibration), [0, 8.5, 17, 34])

    def test_negative_values_are_preserved_for_tare(self):
        self.assertAlmostEqual(calibrate([990] * 4, [[1000] * 4, [2000] * 4, [3000] * 4])[0], -0.17)

    def test_invalid_factory_calibration_is_rejected(self):
        with self.assertRaises(ValueError):
            calibrate([1000] * 4, [[1000] * 4, [1000] * 4, [3000] * 4])


if __name__ == '__main__':
    unittest.main()
