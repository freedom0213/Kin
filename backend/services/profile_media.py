"""个人资料媒体的本地存储与安全校验。"""

import os
import secrets
from pathlib import Path

import config


PUBLIC_PREFIX = "/media/profile-banners/"


def _detect_extension(content: bytes) -> str | None:
    if content.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return ".webp"
    return None


def save_profile_banner(content: bytes) -> str:
    """校验并保存背景名片，返回可公开访问的相对 URL。"""
    if not content:
        raise ValueError("请选择一张背景图片")
    if len(content) > config.MAX_PROFILE_BANNER_BYTES:
        raise ValueError("背景图片不能超过 5 MB")

    extension = _detect_extension(content)
    if not extension:
        raise ValueError("仅支持 JPEG、PNG 或 WebP 图片")

    directory = Path(config.PROFILE_BANNER_DIR)
    directory.mkdir(parents=True, exist_ok=True)
    filename = f"{secrets.token_urlsafe(24)}{extension}"
    destination = directory / filename
    destination.write_bytes(content)
    return f"{PUBLIC_PREFIX}{filename}"


def delete_profile_banner(public_url: str | None) -> None:
    """仅删除背景名片目录中由 Kin 生成的文件。"""
    if not public_url or not public_url.startswith(PUBLIC_PREFIX):
        return
    filename = public_url.removeprefix(PUBLIC_PREFIX)
    if not filename or filename != os.path.basename(filename):
        return

    directory = Path(config.PROFILE_BANNER_DIR).resolve()
    target = (directory / filename).resolve()
    if target.parent != directory:
        return
    try:
        target.unlink(missing_ok=True)
    except OSError:
        # 资料更新已经成功时，不因旧文件清理失败回滚用户操作。
        pass
