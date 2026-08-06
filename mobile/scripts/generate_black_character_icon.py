"""从用户提供的白底插画生成不重绘主体的 Kin 图标资产。"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


def connected_white_background(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    barrier = Image.new("L", rgb.size, 0)
    barrier_pixels = barrier.load()

    for y in range(height):
        for x in range(width):
            red, green, blue = pixels[x, y]
            background_like = (
                min(red, green, blue) >= 248
                and max(red, green, blue) - min(red, green, blue) <= 8
            )
            barrier_pixels[x, y] = 0 if background_like else 255

    # 只用闭运算封住线稿中的细小断点；随后仍使用原始像素，不重绘人物。
    barrier = barrier.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.MinFilter(11))
    barrier_pixels = barrier.load()
    background = Image.new("L", rgb.size, 0)
    background_pixels = background.load()
    queue: deque[tuple[int, int]] = deque()

    def seed(x: int, y: int) -> None:
        if background_pixels[x, y] or barrier_pixels[x, y]:
            return
        background_pixels[x, y] = 255
        queue.append((x, y))

    for x in range(width):
        seed(x, 0)
        seed(x, height - 1)
    for y in range(height):
        seed(0, y)
        seed(width - 1, y)

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                seed(nx, ny)

    alpha = background.point(lambda value: 0 if value else 255)
    subject = image.convert("RGBA")
    subject.putalpha(alpha)
    return subject


def contain_subject(subject: Image.Image, size: int, coverage: float, background: tuple[int, int, int, int]) -> Image.Image:
    bbox = subject.getbbox()
    if not bbox:
        raise ValueError("未识别到人物主体")
    cropped = subject.crop(bbox)
    max_side = round(size * coverage)
    scale = min(max_side / cropped.width, max_side / cropped.height)
    resized = cropped.resize(
        (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), background)
    x = (size - resized.width) // 2
    y = (size - resized.height) // 2
    canvas.alpha_composite(resized, (x, y))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("assets", type=Path)
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGBA")
    subject = connected_white_background(source)
    args.assets.mkdir(parents=True, exist_ok=True)

    subject.save(args.assets / "icon-character-cutout.png", optimize=True)
    contain_subject(subject, 1260, 0.92, (0, 0, 0, 255)).convert("RGB").save(
        args.assets / "icon-source-black.png", optimize=True
    )
    contain_subject(subject, 1024, 0.88, (0, 0, 0, 255)).convert("RGB").save(
        args.assets / "icon.png", optimize=True
    )
    contain_subject(subject, 1024, 0.64, (0, 0, 0, 0)).save(
        args.assets / "android-icon-foreground.png", optimize=True
    )


if __name__ == "__main__":
    main()
