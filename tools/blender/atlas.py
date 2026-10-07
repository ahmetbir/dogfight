"""The 256x256 texture atlas: regions, drawing primitives and a PNG writer.

Pixels are mostly white detail (panel lines, shading, stencils) that the
client multiplies by the material's role colour, so one atlas serves every
team and skin. Coordinates are pixels from the top-left corner.
"""
import struct
import zlib

SIZE = 256


class Region:
    """Maps two model-space coordinates (a across, b down) onto a pixel rectangle."""

    def __init__(self, x, y, w, h, a0, a1, b0, b1):
        self.x, self.y, self.w, self.h = x, y, w, h
        self.a0, self.a1, self.b0, self.b1 = a0, a1, b0, b1

    def px(self, a, b):
        return (self.x + (a - self.a0) / (self.a1 - self.a0) * self.w,
                self.y + (b - self.b0) / (self.b1 - self.b0) * self.h)

    def uv(self, a, b):
        x, y = self.px(a, b)
        return (x / SIZE, 1.0 - y / SIZE)


def uv_px(x, y):
    return (x / SIZE, 1.0 - y / SIZE)


class Canvas:
    def __init__(self, fill=(1.0, 1.0, 1.0)):
        self.p = [list(fill) for _ in range(SIZE * SIZE)]

    def set(self, x, y, c):
        x, y = int(x), int(y)
        if 0 <= x < SIZE and 0 <= y < SIZE:
            self.p[y * SIZE + x] = list(c)

    def get(self, x, y):
        return self.p[int(y) * SIZE + int(x)]

    def mul(self, x, y, k):
        x, y = int(x), int(y)
        if 0 <= x < SIZE and 0 <= y < SIZE:
            q = self.p[y * SIZE + x]
            for i in range(3):
                q[i] *= k[i] if isinstance(k, tuple) else k

    def rect(self, x0, y0, x1, y1, c):
        for y in range(int(round(y0)), int(round(y1))):
            for x in range(int(round(x0)), int(round(x1))):
                self.set(x, y, c)

    def rect_mul(self, x0, y0, x1, y1, k):
        for y in range(int(round(y0)), int(round(y1))):
            for x in range(int(round(x0)), int(round(x1))):
                self.mul(x, y, k)

    def line(self, x0, y0, x1, y1, k=0.62):
        """1-pixel line darkening by k (a panel line)."""
        x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        seen = set()
        while True:
            if (x0, y0) not in seen:
                seen.add((x0, y0))
                self.mul(x0, y0, k)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def box(self, x0, y0, x1, y1, k=0.62):
        self.line(x0, y0, x1, y0, k)
        self.line(x1, y0 + 1, x1, y1, k)
        self.line(x1 - 1, y1, x0, y1, k)
        self.line(x0, y1 - 1, x0, y0 + 1, k)

    def poly(self, pts, c, op="set"):
        """Fills a polygon (even-odd rule, pixel centres)."""
        ys = [p[1] for p in pts]
        for y in range(max(0, int(min(ys))), min(SIZE, int(max(ys)) + 1)):
            cy = y + 0.5
            xs = []
            for i in range(len(pts)):
                (ax, ay), (bx, by) = pts[i], pts[(i + 1) % len(pts)]
                if (ay <= cy < by) or (by <= cy < ay):
                    xs.append(ax + (cy - ay) / (by - ay) * (bx - ax))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for x in range(int(round(xs[i])), int(round(xs[i + 1]))):
                    if op == "set":
                        self.set(x, y, c)
                    else:
                        self.mul(x, y, c)

    def disc(self, cx, cy, r, c, op="set"):
        for y in range(int(cy - r - 1), int(cy + r + 2)):
            for x in range(int(cx - r - 1), int(cx + r + 2)):
                if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                    if op == "set":
                        self.set(x, y, c)
                    else:
                        self.mul(x, y, c)

    def text(self, s, x, y, k=0.25, scale=1):
        """5x7 stencil digits/letters, darkening by k."""
        for ch in s:
            rows = FONT.get(ch)
            if rows:
                for j, row in enumerate(rows):
                    for i, bit in enumerate(row):
                        if bit == "#":
                            self.rect_mul(x + i * scale, y + j * scale, x + (i + 1) * scale, y + (j + 1) * scale, k)
            x += 6 * scale

    def png(self):
        raw = bytearray()
        for y in range(SIZE):
            raw.append(0)
            for x in range(SIZE):
                raw.extend(max(0, min(255, int(round(c * 255)))) for c in self.p[y * SIZE + x])

        def chunk(tag, data):
            return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

        return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))

    def floats(self):
        """RGBA floats bottom row first (Blender image pixel order)."""
        out = []
        for y in range(SIZE - 1, -1, -1):
            for x in range(SIZE):
                out.extend(self.p[y * SIZE + x])
                out.append(1.0)
        return out


FONT = {
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
}

# Atlas regions shared by every jet (model-space ranges come from the kind).
FUSE = (0, 0, 256, 96)       # fuselage unwrap: z across, profile fraction (top 0 .. bottom 1) down
WING = (0, 96, 160, 96)      # wing + LERX from above: z across, x down
FIN = (160, 96, 96, 96)      # fin from the side: z across, y down (top first)
STAB = (0, 192, 80, 64)      # stabilators from above: z across, x down
METAL = (80, 192, 48, 64)    # nozzle: around across, z down
MISSILE = (128, 192, 32, 64)  # missile body: around across, nose (top) to tail
INSIGNIA = (160, 192, 64, 64)  # national insignia slot (stripe material)
PLAIN = (224, 192, 16, 16)    # flat white: gear and dark parts
GLASS = (240, 192, 16, 40)    # canopy: a light streak along the top, darker sides
NUMBER = (224, 232, 32, 24)   # spare slot for numbers drawn by the client later


def region(r, a0, a1, b0, b1):
    return Region(r[0], r[1], r[2], r[3], a0, a1, b0, b1)


PLAIN_UV = uv_px(PLAIN[0] + PLAIN[2] / 2, PLAIN[1] + PLAIN[3] / 2)


def draw_insignia(cv):
    """Roundel: dark rim, full (team) disc, a darker star."""
    import math
    x, y, w, h = INSIGNIA
    cx, cy, r = x + w / 2, y + h / 2, w / 2 - 1
    cv.disc(cx, cy, r, (0.2, 0.2, 0.2))
    cv.disc(cx, cy, r - 3, (1.0, 1.0, 1.0))
    star = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = (r - 8) if i % 2 == 0 else (r - 8) * 0.42
        star.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    cv.poly(star, 0.45, op="mul")


def insignia_uv(t, rad=1.0):
    """UV of the insignia slot at angle t (radians), rad 0 centre .. 1 rim."""
    import math
    x, y, w, h = INSIGNIA
    return uv_px(x + w / 2 + rad * (w / 2 - 1) * math.cos(t), y + h / 2 + rad * (h / 2 - 1) * math.sin(t))
