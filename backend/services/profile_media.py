"""个人资料媒体的本地存储与安全校验。"""

import os
import secrets
from pathlib import Path

import config


AVATAR_PUBLIC_PREFIX = "/media/avatars/"
PUBLIC_PREFIX = "/media/profile-banners/"


def _detect_extension(content: bytes) -> str | None:
    if content.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return ".webp"
    return None


def _save_profile_image(
    content: bytes,
    *,
    directory_path: str,
    public_prefix: str,
    max_bytes: int,
    empty_message: str,
    size_message: str,
) -> str:
    if not content:
        raise ValueError(empty_message)
    if len(content) > max_bytes:
        raise ValueError(size_message)

    extension = _detect_extension(content)
    if not extension:
        raise ValueError("仅支持 JPEG、PNG 或 WebP 图片")

    directory = Path(directory_path)
    directory.mkdir(parents=True, exist_ok=True)
    filename = f"{secrets.token_urlsafe(24)}{extension}"
    destination = directory / filename
    destination.write_bytes(content)
    return f"{public_prefix}{filename}"


def _delete_profile_image(
    public_url: str | None,
    *,
    directory_path: str,
    public_prefix: str,
) -> None:
    if not public_url or not public_url.startswith(public_prefix):
        return
    filename = public_url.removeprefix(public_prefix)
    if not filename or filename != os.path.basename(filename):
        return

    directory = Path(directory_path).resolve()
    target = (directory / filename).resolve()
    if target.parent != directory:
        return
    try:
        target.unlink(missing_ok=True)
    except OSError:
        # 资料更新已经成功时，不因旧文件清理失败回滚用户操作。
        pass


def save_avatar(content: bytes) -> str:
    """校验并保存头像，返回可公开访问的相对 URL。"""
    return _save_profile_image(
        content,
        directory_path=config.AVATAR_DIR,
        public_prefix=AVATAR_PUBLIC_PREFIX,
        max_bytes=config.MAX_AVATAR_BYTES,
        empty_message="请选择一张头像图片",
        size_message="头像图片不能超过 5 MB",
    )


def delete_avatar(public_url: str | None) -> None:
    """仅删除头像目录中由 Kin 生成的文件。"""
    _delete_profile_image(
        public_url,
        directory_path=config.AVATAR_DIR,
        public_prefix=AVATAR_PUBLIC_PREFIX,
    )


def save_profile_banner(content: bytes) -> str:
    """校验并保存背景名片，返回可公开访问的相对 URL。"""
    return _save_profile_image(
        content,
        directory_path=config.PROFILE_BANNER_DIR,
        public_prefix=PUBLIC_PREFIX,
        max_bytes=config.MAX_PROFILE_BANNER_BYTES,
        empty_message="请选择一张背景图片",
        size_message="背景图片不能超过 5 MB",
    )


def delete_profile_banner(public_url: str | None) -> None:
    """仅删除背景名片目录中由 Kin 生成的文件。"""
    _delete_profile_image(
        public_url,
        directory_path=config.PROFILE_BANNER_DIR,
        public_prefix=PUBLIC_PREFIX,
    )
