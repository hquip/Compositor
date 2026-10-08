"""Reference fixtures and export acceptance using the official OpenEXR 3.4.4 wheel.

Generate: python openexr-reference.py generate desktop/tests/fixtures/openexr
Inspect:  python openexr-reference.py inspect image.exr
The reference library is a development dependency, never an app runtime asset.
"""
import json
import sys
from pathlib import Path
import numpy as np
import OpenEXR


def generate(directory):
    directory.mkdir(parents=True, exist_ok=True)
    height, width = 19, 5
    straight = np.zeros((height, width, 4), dtype=np.float32)
    for y in range(height):
        for x in range(width):
            straight[y, x] = [4 + x, (y + 1) / 8, -0.125, 0.5 if x % 2 else 1]
    straight[0, 0] = [0, 0, 0, 0]
    premultiplied = straight.copy()
    premultiplied[:, :, :3] *= premultiplied[:, :, 3:]
    for bits in [16, 32]:
        for name, compression in [('none', OpenEXR.NO_COMPRESSION), ('zips', OpenEXR.ZIPS_COMPRESSION), ('zip', OpenEXR.ZIP_COMPRESSION)]:
            dtype = np.float16 if bits == 16 else np.float32
            header = {'type': OpenEXR.scanlineimage, 'compression': compression, 'colorInteropID': 'lin_rec709_scene',
                      'dataWindow': (np.array([-2, 3], dtype=np.int32), np.array([2, 21], dtype=np.int32)),
                      'displayWindow': (np.array([-4, 1], dtype=np.int32), np.array([4, 23], dtype=np.int32))}
            with OpenEXR.File(header, {'RGBA': premultiplied.astype(dtype)}) as file:
                file.write(str(directory / f'rgba-{bits}-{name}.exr'))
    with OpenEXR.File({'compression': OpenEXR.ZIP_COMPRESSION, 'type': OpenEXR.scanlineimage,
                      'chromaticities': (0.713, 0.293, 0.165, 0.83, 0.128, 0.044, 0.32168, 0.33767)},
                     {'beauty.R': premultiplied[:, :, 0].copy(), 'beauty.G': premultiplied[:, :, 1].copy(),
                      'beauty.B': premultiplied[:, :, 2].copy(), 'beauty.A': premultiplied[:, :, 3].copy(),
                      'Z': np.full((height, width), 12, dtype=np.float32),
                      'ID': np.full((height, width), 7, dtype=np.uint32)}) as file:
        file.write(str(directory / 'beauty-acescg.exr'))
    for name, channels, header in [
        ('gray', {'Y': np.full((2, 3), 8, dtype=np.float16)}, {'colorInteropID': 'lin_rec709_scene'}),
        ('untagged', {'RGBA': premultiplied}, {}),
        ('piz', {'RGBA': premultiplied}, {'compression': OpenEXR.PIZ_COMPRESSION}),
        ('straight', {'RGBA': straight}, {'colorInteropID': 'lin_rec709_scene'}),
        ('emissive', {'RGBA': np.array([[[4, 0, 0, 0]]], dtype=np.float32)}, {'colorInteropID': 'lin_rec709_scene'}),
    ]:
        with OpenEXR.File({'type': OpenEXR.scanlineimage, 'compression': OpenEXR.ZIP_COMPRESSION, **header}, channels) as file:
            file.write(str(directory / f'{name}.exr'))
    (directory / 'expected.json').write_text(json.dumps({'width': width, 'height': height, 'data': straight.flatten().tolist()}))
    tile = OpenEXR.TileDescription()
    tile.xSize = 3
    tile.ySize = 4
    for compression_name, compression in [('piz', OpenEXR.PIZ_COMPRESSION), ('zip', OpenEXR.ZIP_COMPRESSION)]:
        with OpenEXR.File({'type': OpenEXR.tiledimage, 'tiles': tile, 'compression': compression, 'colorInteropID': 'lin_rec709_scene'}, {'RGBA': premultiplied}) as file:
            file.write(str(directory / f'tiled-{compression_name}.exr'))
    with OpenEXR.File([
        OpenEXR.Part({'type': OpenEXR.scanlineimage, 'compression': OpenEXR.PIZ_COMPRESSION, 'colorInteropID': 'lin_rec709_scene'}, {'RGBA': premultiplied}, 'beauty'),
        OpenEXR.Part({'type': OpenEXR.tiledimage, 'tiles': tile, 'compression': OpenEXR.ZIP_COMPRESSION, 'colorInteropID': 'lin_rec709_scene'}, {'RGBA': premultiplied * np.array([2, 1, 1, 1], dtype=np.float32)}, 'light'),
    ]) as file:
        file.write(str(directory / 'multipart.exr'))
    deep = {}
    for name, values in {'R': [4, 1], 'G': [0, 2], 'B': [1, 0], 'A': [.5, .5], 'Z': [2, 1], 'ZBack': [2, 1]}.items():
        pixels = np.empty((2, 2), dtype=object)
        for y in range(2):
            for x in range(2):
                pixels[y, x] = np.array(values if x + y else [], dtype=np.float32)
        deep[name] = pixels
    for name, storage in [('deep-scanline', OpenEXR.deepscanline)]:
        bounds = (np.array([0, 0], dtype=np.int32), np.array([1, 1], dtype=np.int32))
        header = {'type': storage, 'compression': OpenEXR.ZIPS_COMPRESSION, 'colorInteropID': 'lin_rec709_scene', 'dataWindow': bounds, 'displayWindow': bounds}
        if storage == OpenEXR.deeptile:
            header['tiles'] = tile
        with OpenEXR.File(header, deep) as file:
            file.write(str(directory / f'{name}.exr'))
    print(f'Generated independent fixtures with OpenEXR {OpenEXR.__version__}.')


def inspect(filename):
    with OpenEXR.File(filename, separate_channels=True) as file:
        channels = file.channels()
        rgba = np.stack([channels[c].pixels.astype(np.float32) for c in 'RGBA'], axis=-1)
        print(json.dumps({'width': rgba.shape[1], 'height': rgba.shape[0], 'data': rgba.flatten().tolist(),
                          'colorInteropID': file.header().get('colorInteropID'), 'bits': 16 if channels['R'].pixels.dtype == np.float16 else 32}))


if sys.argv[1] == 'generate':
    generate(Path(sys.argv[2]))
else:
    inspect(sys.argv[2])
