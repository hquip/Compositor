import sys
from pathlib import Path
import struct
from psd_tools import PSDImage

root = Path(sys.argv[1])
for path in sorted(root.glob('rgb-*')):
    psd = PSDImage.open(path)
    assert psd.size == (2, 1), (path, psd.size)
    layer = next(iter(psd))
    depth = psd.depth
    planes = {}
    for info, channel in zip(layer._record.channel_info, layer._channels):
        raw = channel.get_data(2, 1, depth, psd._record.header.version)
        planes[int(info.id)] = struct.unpack('>2H' if depth == 16 else '>2f', raw)
    expected = 12345 if depth == 16 else 1.25
    assert abs(planes[0][0] - expected) < 0.00001, (path, planes)
    expected_blue = 43210 if depth == 16 else 0.00123
    assert abs(planes[2][1] - expected_blue) < 0.00001, (path, planes)
    print(path.name, 'accepted independently', depth, planes)
