using System;
using System.IO;
using System.Text;

namespace Compositor.Windows
{
    internal static class ImageMetadata
    {
        private static uint Crc(byte[] bytes, int start, int count)
        {
            uint crc = 0xffffffff;
            for (int i = start; i < start + count; i++) { crc ^= bytes[i]; for (int bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ ((crc & 1) != 0 ? 0xedb88320 : 0); }
            return crc ^ 0xffffffff;
        }
        private static uint Read(byte[] b, int i) => ((uint)b[i] << 24) | ((uint)b[i + 1] << 16) | ((uint)b[i + 2] << 8) | b[i + 3];
        private static void Write(byte[] b, int i, uint value) { b[i] = (byte)(value >> 24); b[i + 1] = (byte)(value >> 16); b[i + 2] = (byte)(value >> 8); b[i + 3] = (byte)value; }
        internal static byte[] WithResolution(byte[] bytes, string format, double resolution)
        {
            if (format == "png")
            {
                var chunk = new byte[21]; Write(chunk, 0, 9); Encoding.ASCII.GetBytes("pHYs").CopyTo(chunk, 4); uint ppm = (uint)Math.Round(resolution / .0254); Write(chunk, 8, ppm); Write(chunk, 12, ppm); chunk[16] = 1; Write(chunk, 17, Crc(chunk, 4, 13));
                using var stream = new MemoryStream(); stream.Write(bytes, 0, 8); int offset = 8;
                while (offset + 12 <= bytes.Length)
                {
                    var length = checked((int)Read(bytes, offset)); if (length < 0 || length > bytes.Length - offset - 12) throw new InvalidDataException("Invalid PNG export.");
                    var name = Encoding.ASCII.GetString(bytes, offset + 4, 4);
                    if (name != "pHYs") stream.Write(bytes, offset, length + 12); if (name == "IHDR") stream.Write(chunk, 0, chunk.Length); offset += length + 12;
                }
                return stream.ToArray();
            }
            int cursor = 2;
            while (cursor + 4 < bytes.Length && bytes[cursor] == 0xff)
            {
                byte marker = bytes[cursor + 1]; if (marker == 0xda || marker == 0xd9) break; int length = (bytes[cursor + 2] << 8) | bytes[cursor + 3];
                if (length < 2 || cursor + length + 2 > bytes.Length) break;
                if (marker == 0xe0 && length >= 16 && Encoding.ASCII.GetString(bytes, cursor + 4, 5) == "JFIF\0")
                {
                    int dpi = (int)Math.Round(resolution); bytes[cursor + 11] = 1; bytes[cursor + 12] = bytes[cursor + 14] = (byte)(dpi >> 8); bytes[cursor + 13] = bytes[cursor + 15] = (byte)dpi; return bytes;
                }
                cursor += length + 2;
            }
            return bytes;
        }
    }
}
