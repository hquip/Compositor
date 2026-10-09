import { zipSync, strToU8 } from 'fflate';
import { png } from './fixtures.mjs';

export function standardOpenRaster() {
  return zipSync({
    mimetype: strToU8('image/openraster'),
    'stack.xml': strToU8('<?xml version="1.0"?><image version="0.0.3" w="16" h="12"><stack><stack name="Artwork"><layer name="Blue" src="data/blue.png" x="6" y="5" opacity="1" composite-op="svg:src-over"/><layer name="Red" src="data/red.png" x="2" y="3" opacity="1" composite-op="svg:src-over"/></stack></stack></image>'),
    'data/red.png': png(4, 4, [255, 0, 0, 255]),
    'data/blue.png': png(2, 2, [0, 0, 255, 255]),
  }, { level: 0 });
}
