"""Read-only verification of the four generated series PNGs; no game APIs."""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERIES = ('midnight-snack', 'working-animals', 'weird-appliances', 'milk-frog')


def inspect(path, expected_size):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', f'{path}: not PNG'
    width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', data[16:29])
    assert (width, height) == (expected_size, expected_size), f'{path}: unexpected dimensions'
    assert (depth, color, compression, filtering, interlace) == (8, 6, 0, 0, 0), f'{path}: expected 8-bit RGBA PNG'
    offset, chunks = 8, []
    while offset < len(data):
        size = struct.unpack_from('>I', data, offset)[0]
        kind = data[offset + 4:offset + 8]
        if kind == b'IDAT':
            chunks.append(data[offset + 8:offset + 8 + size])
        offset += size + 12
    raw = zlib.decompress(b''.join(chunks))
    stride = width * 4
    assert len(raw) == (stride + 1) * height, f'{path}: invalid pixel data'
    previous = bytearray(stride)
    transparent = opaque = partial = 0
    for row_number in range(height):
        offset = row_number * (stride + 1)
        mode = raw[offset]
        row = bytearray(raw[offset + 1:offset + 1 + stride])
        assert mode in range(5), f'{path}: invalid PNG filter'
        for x in range(stride):
            left = row[x - 4] if x >= 4 else 0
            above = previous[x]
            corner = previous[x - 4] if x >= 4 else 0
            if mode == 1:
                predictor = left
            elif mode == 2:
                predictor = above
            elif mode == 3:
                predictor = (left + above) // 2
            elif mode == 4:
                p = left + above - corner
                a, b, c = abs(p - left), abs(p - above), abs(p - corner)
                predictor = left if a <= b and a <= c else above if b <= c else corner
            else:
                predictor = 0
            row[x] = (row[x] + predictor) & 255
        alpha = row[3::4]
        transparent += alpha.count(0)
        opaque += alpha.count(255)
        partial += len(alpha) - alpha.count(0) - alpha.count(255)
        previous = row
    assert transparent > width * height * .05 and opaque > 0, f'{path}: expected visible art and transparent surround'
    print(f'{path.relative_to(ROOT)}: {width}x{height}, RGBA, {len(data)} bytes, '
          f'alpha=0 {transparent / (width * height):.1%}, partial {partial / (width * height):.1%}')


for directory, size in [('assets/generated/series', 1254), ('web/public/series', 640)]:
    for series in SERIES:
        inspect(ROOT / directory / f'{series}.png', size)
print('All 8 original/runtime series PNGs passed. No files modified.')
