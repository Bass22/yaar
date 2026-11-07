"""Makes the application icons from the brand icon (packages/design-system/brand/yaar-icon.png).

The brand icon is a rounded green square on black corners, without transparency. A phone wants
a full square — iOS and Android round it themselves — and Android crops a maskable icon to a
circle: the black corners are replaced by the icon's own green gradient, and the maskable
variant shrinks the drawing into the safe zone.

    python3 packages/design-system/tools/make-app-icons.py

Needs Pillow; run by hand when the brand icon changes, the outputs are committed.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'packages/design-system/brand/yaar-icon.png'
PUBLIC = ROOT / 'apps/web/public'
# The rounded square inside the source, found by reading its pixels, and its corner radius.
BOX = (81, 77, 1173, 1169)
CORNER_RADIUS = 168
# Cropped just inside the rounded square: no corner, no dark rim left — a full square, as phones want.
INSET = 54
# Share of the size the drawing keeps in the maskable variant: the 80 % safe zone of Android.
MASKABLE_SCALE = 0.8
# Fewer colours, a lighter file: the icon is precached by the service worker.
COLOURS = 256


def full_square(source):
    """The drawing, cropped inside the rounded square of the brand icon."""
    left, top, right, bottom = BOX
    return source.crop((left + INSET, top + INSET, right - INSET, bottom - INSET))


def maskable(source, size):
    """The whole rounded square, shrunk and cut to a soft circle on the icon's green: Android crops
    a maskable icon to a circle, and the drawing — corn grains and leaves included — stays inside."""
    square = source.crop(BOX)
    pixels = list(full_square(source).getdata())
    green = tuple(sum(channel) // len(pixels) for channel in zip(*[p for p in pixels if sum(p) < 120]))
    canvas = Image.new('RGB', (size, size), green)
    inner_size = round(size * MASKABLE_SCALE)
    inner = square.resize((inner_size, inner_size), Image.LANCZOS)
    feather = round(inner_size * 0.02)
    mask = Image.new('L', inner.size, 0)
    ImageDraw.Draw(mask).ellipse([feather, feather, inner_size - 1 - feather, inner_size - 1 - feather], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather))
    offset = (size - inner_size) // 2
    canvas.paste(inner, (offset, offset), mask)
    return canvas


def simplified_mark(size):
    """The favicon (brand/favicon.svg, drawn again here): the Y and three corn grains on the brand
    green, without the animals, which are unreadable at 32 px. Drawn large, then reduced."""
    k = size / 32
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=7 * k, fill='#054612')
    for cx, cy, angle in ((10, 7.5, -30), (16, 5.5, 0), (22, 7.5, 30)):
        grain = Image.new('RGBA', (round(6 * k), round(8 * k)), (0, 0, 0, 0))
        ImageDraw.Draw(grain).ellipse([0, 0, grain.width - 1, grain.height - 1], fill='#F9AF03')
        grain = grain.rotate(-angle, expand=True, resample=Image.BICUBIC)
        image.alpha_composite(grain, (round(cx * k - grain.width / 2), round(cy * k - grain.height / 2)))
    width = round(4.2 * k)
    for start, end in (((8.5, 12), (16, 20)), ((23.5, 12), (16, 20)), ((16, 20), (16, 28))):
        draw.line([(start[0] * k, start[1] * k), (end[0] * k, end[1] * k)], fill='#FCEDC4', width=width)
        for x, y in (start, end):
            draw.ellipse([x * k - width / 2, y * k - width / 2, x * k + width / 2, y * k + width / 2], fill='#FCEDC4')
    return image


def save(image, path):
    image.quantize(colors=COLOURS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(path, optimize=True)


def main():
    source = Image.open(SOURCE).convert('RGB')
    square = full_square(source)
    icons = PUBLIC / 'icons'
    icons.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        save(square.resize((size, size), Image.LANCZOS), icons / f'app-icon-{size}.png')
        save(maskable(source, size), icons / f'app-icon-maskable-{size}.png')
    save(square.resize((180, 180), Image.LANCZOS), icons / 'apple-touch-icon.png')
    simplified_mark(256).save(PUBLIC / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])


if __name__ == '__main__':
    main()
