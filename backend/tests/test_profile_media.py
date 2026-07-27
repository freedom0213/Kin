"""背景名片文件校验与清理测试。"""

import os
import sys
import tempfile
import unittest

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import config  # noqa: E402
from services import profile_media  # noqa: E402


class ProfileMediaTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_directory = config.PROFILE_BANNER_DIR
        config.PROFILE_BANNER_DIR = self.temp_dir.name

    def tearDown(self):
        config.PROFILE_BANNER_DIR = self.original_directory
        self.temp_dir.cleanup()

    def test_saves_and_deletes_supported_image(self):
        public_url = profile_media.save_profile_banner(b"\xff\xd8\xff" + b"image-data")
        filename = public_url.removeprefix(profile_media.PUBLIC_PREFIX)
        target = os.path.join(self.temp_dir.name, filename)
        self.assertTrue(os.path.exists(target))

        profile_media.delete_profile_banner(public_url)
        self.assertFalse(os.path.exists(target))

    def test_rejects_unsupported_content(self):
        with self.assertRaisesRegex(ValueError, "JPEG"):
            profile_media.save_profile_banner(b"not-an-image")

    def test_does_not_delete_outside_banner_directory(self):
        profile_media.delete_profile_banner("/media/profile-banners/../kin.db")


if __name__ == "__main__":
    unittest.main()
