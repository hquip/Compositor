using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace Compositor.Windows
{
    internal static class HdrStore
    {
        private static void Require(bool value) { if (!value) throw new InvalidDataException("Invalid embedded float32 HDR TIFF."); }
        internal static long Inspect(byte[] bytes, Dictionary<string, object> smart = null, bool wide = false)
        {
            Require(bytes.Length >= 8 && bytes.Length <= 512 * 1024 * 1024 && bytes[0] == 73 && bytes[1] == 73 && BitConverter.ToUInt16(bytes, 2) == 42);
            var start = (long)BitConverter.ToUInt32(bytes, 4); Require(start >= 8 && start + 2 <= bytes.Length); int count = BitConverter.ToUInt16(bytes, (int)start); long end = start + 2 + count * 12;
            Require(count <= 1000 && end + 4 <= bytes.Length && BitConverter.ToUInt32(bytes, (int)end) == 0); var tags = new Dictionary<int, uint[]>(); string description = null;
            for (int i = 0; i < count; i++) {
                int at = (int)start + 2 + i * 12, id = BitConverter.ToUInt16(bytes, at), type = BitConverter.ToUInt16(bytes, at + 2); long length = BitConverter.ToUInt32(bytes, at + 4), size = type == 3 ? 2 : type == 4 ? 4 : type == 5 ? 8 : type == 1 || type == 2 || type == 7 ? 1 : 0;
                Require(size > 0 && length <= 16000000); long offset = length * size <= 4 ? at + 8 : BitConverter.ToUInt32(bytes, at + 8); Require(offset >= 0 && offset + length * size <= bytes.Length);
                if (type == 3 || type == 4) { Require(!tags.ContainsKey(id)); tags[id] = Enumerable.Range(0, (int)length).Select(n => type == 3 ? (uint)BitConverter.ToUInt16(bytes, (int)offset + n * 2) : BitConverter.ToUInt32(bytes, (int)offset + n * 4)).ToArray(); }
                if (id == 270) { Require(type == 2); description = Encoding.UTF8.GetString(bytes, (int)offset, (int)length); }
            }
            Func<int, uint> scalar = id => { Require(tags.ContainsKey(id) && tags[id].Length == 1); return tags[id][0]; };
            var width = scalar(256); var height = scalar(257); long pixels = (long)width * height;
            if (smart != null) Require(Json.Number(Json.Get(smart, "width")) == width && Json.Number(Json.Get(smart, "height")) == height);
            var spaces = wide ? new[] { "linear sRGB", "Linear Rec.2020", "Linear P3-D65", "ACEScg", "ACES2065-1" } : new[] { "linear sRGB" };
            Require(width > 0 && height > 0 && width <= 30000 && height <= 30000 && pixels <= 16000000 && scalar(259) == 1 && scalar(262) == 2 && scalar(277) == 4 && scalar(278) == height && scalar(284) == 1 && scalar(338) == 2 && spaces.Any(space => description == "Compositor " + space + " float32\0"));
            Require(tags.ContainsKey(258) && tags[258].Length == 4 && tags[258].All(n => n == 32) && tags.ContainsKey(339) && tags[339].Length == 4 && tags[339].All(n => n == 3));
            var data = scalar(273); var lengthBytes = scalar(279); Require(data >= end + 4 && lengthBytes == pixels * 16 && data + (long)lengthBytes <= bytes.Length);
            for (long i = 0; i < pixels * 4; i++) { var value = BitConverter.ToSingle(bytes, (int)(data + i * 4)); Require(!float.IsNaN(value) && !float.IsInfinity(value) && (i % 4 == 3 ? value >= 0 && value <= 1 : Math.Abs(value) <= 1000000)); }
            return pixels * 4;
        }
    }
}
