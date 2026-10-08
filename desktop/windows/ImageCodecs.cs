using System.Drawing;
using System.Drawing.Imaging;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace Compositor.Windows
{
    internal static class ImageCodecs
    {
        internal static readonly string[] RawExtensions = { ".dng", ".cr2", ".cr3", ".crw", ".nef", ".nrw", ".arw", ".sr2", ".srf", ".raf", ".orf", ".rw2", ".pef", ".3fr", ".fff", ".iiq", ".kdc", ".dcr", ".mos", ".mrw", ".raw", ".rwl", ".srw", ".x3f" };
        internal static object Read(string filename)
        {
            var extension = Path.GetExtension(filename).ToLowerInvariant();
            var name = Path.GetFileNameWithoutExtension(filename);
            var info = new FileInfo(filename);
            if (info.Length > 1024L * 1024 * 1024) throw new InvalidDataException("The selected image exceeds the 1 GiB file limit.");
            if (extension == ".exr" && info.Length > 256L * 1024 * 1024) throw new InvalidDataException("The HDR source file is too large.");
            var kind = extension == ".exr" ? "openexr" : extension == ".psd" || extension == ".psb" ? "photoshop" : extension == ".heic" || extension == ".heif" || extension == ".hif" ? "heif" : RawExtensions.Contains(extension) ? "raw" : null;
            if (kind != null) return new { name, kind, data = Convert.ToBase64String(File.ReadAllBytes(filename)) };
            var native = new Dictionary<string, string> { [".png"] = "image/png", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".webp"] = "image/webp", [".bmp"] = "image/bmp" };
            if (native.TryGetValue(extension, out var mime)) return new { name, kind = "image", data = "data:" + mime + ";base64," + Convert.ToBase64String(File.ReadAllBytes(filename)) };
            if (extension == ".svg") return new { name, kind = "image", data = "data:image/svg+xml;base64," + Convert.ToBase64String(File.ReadAllBytes(filename)) };
            if (extension != ".tif" && extension != ".tiff") throw new InvalidDataException("This image format is not supported.");
            using var image = Image.FromFile(filename, true);
            if (image.Width > ProjectStore.MaximumSide || image.Height > ProjectStore.MaximumSide || (long)image.Width * image.Height > ProjectStore.SurfacePixels)
                throw new InvalidDataException("The image dimensions exceed the document limit.");
            if (image.PropertyIdList.Contains(0x112))
            {
                var orientation = BitConverter.ToUInt16(image.GetPropertyItem(0x112).Value, 0);
                var flips = new[] { RotateFlipType.RotateNoneFlipNone, RotateFlipType.RotateNoneFlipNone, RotateFlipType.RotateNoneFlipX, RotateFlipType.Rotate180FlipNone, RotateFlipType.Rotate180FlipX, RotateFlipType.Rotate90FlipX, RotateFlipType.Rotate90FlipNone, RotateFlipType.Rotate270FlipX, RotateFlipType.Rotate270FlipNone };
                if (orientation < flips.Length) image.RotateFlip(flips[orientation]);
            }
            using var output = new MemoryStream(); image.Save(output, ImageFormat.Png);
            return new { name, kind = "image", data = "data:image/png;base64," + Convert.ToBase64String(output.ToArray()) };
        }
    }
}
