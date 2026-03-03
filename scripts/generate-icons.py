#!/usr/bin/env python3
from __future__ import annotations

import math
import pathlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT / "public"


def _blend(src: tuple[int, int, int, int], dst: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    sr, sg, sb, sa = src
    dr, dg, db, da = dst
    a = sa / 255.0
    ia = 1.0 - a
    r = int(sr * a + dr * ia)
    g = int(sg * a + dg * ia)
    b = int(sb * a + db * ia)
    out_a = int(sa + da * ia)
    return r, g, b, out_a


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + chunk_type
        + data
        + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    )


def _save_png(path: pathlib.Path, width: int, height: int, pixels: list[tuple[int, int, int, int]]) -> None:
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        row_start = y * width
        for x in range(width):
            r, g, b, a = pixels[row_start + x]
            raw.extend((r, g, b, a))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)

    png = bytearray(b"\x89PNG\r\n\x1a\n")
    png.extend(_png_chunk(b"IHDR", ihdr))
    png.extend(_png_chunk(b"IDAT", idat))
    png.extend(_png_chunk(b"IEND", b""))

    path.write_bytes(png)


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _gradient(c0: tuple[int, int, int], c1: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        int(_lerp(c0[0], c1[0], t)),
        int(_lerp(c0[1], c1[1], t)),
        int(_lerp(c0[2], c1[2], t)),
    )


def _rounded_rect_mask(x: float, y: float, s: float, r: float) -> bool:
    if x < 0 or y < 0 or x > s or y > s:
        return False
    if r <= x <= s - r or r <= y <= s - r:
        return True
    corners = ((r, r), (s - r, r), (r, s - r), (s - r, s - r))
    for cx, cy in corners:
        if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
            return True
    return False


def _draw_icon(size: int) -> list[tuple[int, int, int, int]]:
    px = [(0, 0, 0, 0)] * (size * size)

    def set_pixel(x: int, y: int, color: tuple[int, int, int, int]) -> None:
        if 0 <= x < size and 0 <= y < size:
            i = y * size + x
            px[i] = _blend(color, px[i])

    # Background rounded square with diagonal gradient.
    radius = size * 0.19
    bg0 = (231, 244, 255)
    bg1 = (184, 219, 255)
    for y in range(size):
        for x in range(size):
            if _rounded_rect_mask(x, y, size - 1, radius):
                t = (x + y) / (2 * (size - 1))
                r, g, b = _gradient(bg0, bg1, t)
                set_pixel(x, y, (r, g, b, 255))

    # Database cylinder.
    cx = size * 0.5
    top_y = size * 0.30
    bottom_y = size * 0.62
    rx_db = size * 0.19
    ry_db = size * 0.06
    left = int(cx - rx_db)
    right = int(cx + rx_db)
    body_top = int(top_y)
    body_bottom = int(bottom_y)

    for y in range(body_top, body_bottom):
        t = (y - body_top) / max(1, body_bottom - body_top)
        r, g, b = _gradient((79, 121, 166), (45, 79, 115), t)
        for x in range(left, right + 1):
            set_pixel(x, y, (r, g, b, 255))

    for y in range(size):
        for x in range(size):
            top_eq = ((x - cx) / rx_db) ** 2 + ((y - top_y) / ry_db) ** 2
            if top_eq <= 1.0:
                set_pixel(x, y, (94, 138, 184, 255))

            bot_eq = ((x - cx) / rx_db) ** 2 + ((y - bottom_y) / ry_db) ** 2
            if bot_eq <= 1.0:
                set_pixel(x, y, (44, 78, 114, 255))

    stripe_ys = (size * 0.39, size * 0.47, size * 0.55)
    stripe_alpha = (180, 130, 95)
    for sy, alpha in zip(stripe_ys, stripe_alpha):
        for y in range(size):
            for x in range(size):
                eq = ((x - cx) / (rx_db * 0.72)) ** 2 + ((y - sy) / (ry_db * 0.60)) ** 2
                if eq <= 1.0:
                    set_pixel(x, y, (122, 166, 212, alpha))

    # Magnifying glass lens + rim.
    lens_cx = size * 0.63
    lens_cy = size * 0.49
    lens_r = size * 0.155
    rim = max(2, round(size * 0.038))

    for y in range(size):
        for x in range(size):
            d = math.hypot(x - lens_cx, y - lens_cy)
            if d <= lens_r:
                t = min(1.0, d / lens_r)
                r, g, b = _gradient((209, 242, 255), (123, 199, 232), t)
                set_pixel(x, y, (r, g, b, 200))
            if lens_r - rim <= d <= lens_r:
                set_pixel(x, y, (17, 58, 95, 255))

    # Handle (thick stroked segment).
    x1, y1 = size * 0.72, size * 0.60
    x2, y2 = size * 0.84, size * 0.72
    half_w = max(1.5, size * 0.025)
    vx, vy = x2 - x1, y2 - y1
    seg_len_sq = vx * vx + vy * vy

    for y in range(size):
        for x in range(size):
            wx, wy = x - x1, y - y1
            t = 0.0 if seg_len_sq == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / seg_len_sq))
            px_line = x1 + t * vx
            py_line = y1 + t * vy
            if math.hypot(x - px_line, y - py_line) <= half_w:
                set_pixel(x, y, (17, 58, 95, 255))

    # Highlight dot in lens.
    hi_cx, hi_cy = size * 0.58, size * 0.44
    hi_r = max(1.0, size * 0.02)
    for y in range(size):
        for x in range(size):
            if math.hypot(x - hi_cx, y - hi_cy) <= hi_r:
                set_pixel(x, y, (255, 255, 255, 180))

    return px


def main() -> None:
    sizes = (16, 32, 48, 128)
    for size in sizes:
        out = PUBLIC_DIR / f"indexlens-icon-{size}.png"
        _save_png(out, size, size, _draw_icon(size))
        print(f"wrote {out.relative_to(ROOT)}")

    favicon = PUBLIC_DIR / "indexlens-favicon.svg"
    favicon.write_text((ROOT / "docs/assets/indexlens-icon-source.svg").read_text(encoding="utf-8"), encoding="utf-8")
    print(f"wrote {favicon.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
