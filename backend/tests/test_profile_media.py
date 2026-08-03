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
        self.temp_root = tempfile.TemporaryDirectory()
        self.banner_dir = os.path.join(self.temp_root.name, "profile-banners")
        self.avatar_dir = os.path.join(self.temp_root.name, "avatars")
        self.original_banner_directory = config.PROFILE_BANNER_DIR
        self.original_avatar_directory = config.AVATAR_DIR
        config.PROFILE_BANNER_DIR = self.banner_dir
        config.AVATAR_DIR = self.avatar_dir

    def tearDown(self):
        config.PROFILE_BANNER_DIR = self.original_banner_directory
        config.AVATAR_DIR = self.original_avatar_directory
        self.temp_root.cleanup()

    def test_saves_and_deletes_supported_image(self):
        public_url = profile_media.save_profile_banner(b"\xff\xd8\xff" + b"image-data")
        filename = public_url.removeprefix(profile_media.PUBLIC_PREFIX)
        target = os.path.join(self.banner_dir, filename)
        self.assertTrue(os.path.exists(target))

        profile_media.delete_profile_banner(public_url)
        self.assertFalse(os.path.exists(target))

    def test_rejects_unsupported_content(self):
        with self.assertRaisesRegex(ValueError, "JPEG"):
            profile_media.save_profile_banner(b"not-an-image")

    def test_does_not_delete_outside_banner_directory(self):
        profile_media.delete_profile_banner("/media/profile-banners/../kin.db")

    def test_saves_and_deletes_avatar(self):
        public_url = profile_media.save_avatar(b"\x89PNG\r\n\x1a\n" + b"image-data")
        filename = public_url.removeprefix(profile_media.AVATAR_PUBLIC_PREFIX)
        target = os.path.join(self.avatar_dir, filename)
        self.assertTrue(os.path.exists(target))

        profile_media.delete_avatar(public_url)
        self.assertFalse(os.path.exists(target))

    def test_avatar_rejects_unsupported_content(self):
        with self.assertRaisesRegex(ValueError, "JPEG"):
            profile_media.save_avatar(b"not-an-image")

    def test_profile_media_deleters_do_not_cross_directories(self):
        avatar_url = profile_media.save_avatar(b"\xff\xd8\xff" + b"avatar")
        avatar_name = avatar_url.removeprefix(profile_media.AVATAR_PUBLIC_PREFIX)
        avatar_target = os.path.join(self.avatar_dir, avatar_name)

        banner_url = profile_media.save_profile_banner(b"\xff\xd8\xff" + b"banner")
        banner_name = banner_url.removeprefix(profile_media.PUBLIC_PREFIX)
        banner_target = os.path.join(self.banner_dir, banner_name)

        profile_media.delete_avatar(banner_url)
        profile_media.delete_profile_banner(avatar_url)

        self.assertTrue(os.path.exists(avatar_target))
        self.assertTrue(os.path.exists(banner_target))

    def test_does_not_delete_outside_avatar_directory(self):
        profile_media.delete_avatar("/media/avatars/../kin.db")


if __name__ == "__main__":
    unittest.main()
