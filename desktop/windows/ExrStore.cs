using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Compositor.Windows
{
    internal static class ExrStore
    {
        private static void Require(bool value) { if (!value) throw new InvalidDataException("Invalid retained OpenEXR source."); }
        internal static long Inspect(byte[] bytes, Dictionary<string, object> selected)
        {
            Require(bytes.Length >= 16 && bytes.Length <= 256 * 1024 * 1024 && BitConverter.ToUInt32(bytes, 0) == 20000630);
            var flags = BitConverter.ToUInt32(bytes, 4); Require((flags & 255) == 2 && (flags & ~0x1e02u) == 0); var multipart = (flags & 0x1000) != 0;
            int at = 8, part = 0, target = (int)Json.Number(Json.Get(selected, "part")); bool matched = false;
            var maximum = (flags & 0x400) != 0 ? 255 : 31;
            string ReadString() { var start = at; while (at < bytes.Length && bytes[at] != 0) at++; Require(at < bytes.Length && at - start <= maximum); return new UTF8Encoding(false, true).GetString(bytes, start, at++ - start); }
            do
            {
                Require(part < 64); var seen = new HashSet<string>(); var channels = new HashSet<string>(); bool dataWindow = false, displayWindow = false;
                while (at < bytes.Length && bytes[at] != 0)
                {
                    Require(at < 4 * 1024 * 1024 && seen.Count < 256); var name = ReadString(); var type = ReadString(); Require(type.Length > 0 && seen.Add(name) && at + 4 <= bytes.Length); var length = BitConverter.ToInt32(bytes, at); at += 4;
                    Require(length >= 0 && length <= 1024 * 1024 && at + (long)length <= Math.Min(bytes.Length, 4 * 1024 * 1024));
                    if (name == "dataWindow" || name == "displayWindow")
                    {
                        Require(type == "box2i" && length == 16); long width = (long)BitConverter.ToInt32(bytes, at + 8) - BitConverter.ToInt32(bytes, at) + 1, height = (long)BitConverter.ToInt32(bytes, at + 12) - BitConverter.ToInt32(bytes, at + 4) + 1;
                        Require(width > 0 && height > 0 && width <= 30000 && height <= 30000 && width * height <= 16000000); if (name == "dataWindow") dataWindow = true; else displayWindow = true;
                    }
                    if (name == "channels")
                    {
                        Require(type == "chlist"); var end = at + length; int position = at;
                        while (position < end && bytes[position] != 0) { var start = position; while (position < end && bytes[position] != 0) position++; Require(position < end && position - start <= maximum && channels.Count < 64); var channel = Encoding.UTF8.GetString(bytes, start, position++ - start); Require(position + 16 <= end && channels.Add(channel)); var pixelType = BitConverter.ToInt32(bytes, position); Require(pixelType >= 0 && pixelType <= 2 && BitConverter.ToInt32(bytes, position + 8) > 0 && BitConverter.ToInt32(bytes, position + 12) > 0); position += 16; } Require(channels.Count > 0 && position + 1 == end);
                    }
                    at += length;
                }
                Require(at < bytes.Length && dataWindow && displayWindow); at++;
                if (part == target) { var group = Json.Text(selected, "group"); var prefix = group.Length == 0 ? "" : group + "."; matched = channels.Contains(prefix + "R") && channels.Contains(prefix + "G") && channels.Contains(prefix + "B") || channels.Contains(prefix + "Y") && !channels.Contains(prefix + "RY") && !channels.Contains(prefix + "BY"); }
                part++;
            } while (multipart && at < bytes.Length && bytes[at] != 0);
            if (multipart) { Require(at < bytes.Length && bytes[at] == 0); at++; } Require(matched && at + 8 <= bytes.Length); return 0;
        }
    }
}
