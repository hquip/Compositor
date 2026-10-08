using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

namespace Compositor.Windows
{
    internal static class Json
    {
        internal static JavaScriptSerializer Serializer() => new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 512 };
        internal static Dictionary<string, object> Parse(string value) => Map(Serializer().DeserializeObject(value));
        internal static string Stringify(object value) => Serializer().Serialize(value);
        internal static Dictionary<string, object> Map(object value) => value as Dictionary<string, object> ?? throw new InvalidDataException("Invalid project record.");
        internal static object Get(Dictionary<string, object> value, string key) => value.TryGetValue(key, out var found) ? found : null;
        internal static string Text(Dictionary<string, object> value, string key, string fallback = null) => Get(value, key) as string ?? fallback;
        internal static object[] Array(object value) => value as object[] ?? throw new InvalidDataException("Invalid project list.");
        internal static double Number(object value)
        {
            if (!(value is int || value is long || value is double || value is float || value is decimal)) throw new InvalidDataException("Invalid numeric value.");
            var number = Convert.ToDouble(value);
            if (double.IsNaN(number) || double.IsInfinity(number)) throw new InvalidDataException("Invalid numeric value.");
            return number;
        }
        internal static bool True(Dictionary<string, object> value, string key) => Get(value, key) is bool flag && flag;
    }

    internal static class ProjectStore
    {
        internal const int MaximumSide = 30000;
        internal const long SurfacePixels = 200000000;
        private const int MetadataBytes = 4 * 1024 * 1024;
        private const int AssetBytes = 512 * 1024 * 1024;
        internal static readonly long PixelBudget = CalculateBudget();
        private static readonly HashSet<string> Blends = new HashSet<string>(new[] {
            "Normal", "Darken", "Multiply", "Color Burn", "Linear Burn", "Lighten", "Screen", "Color Dodge", "Linear Dodge (Add)",
            "Overlay", "Soft Light", "Hard Light", "Vivid Light", "Linear Light", "Pin Light", "Hard Mix", "Difference", "Exclusion",
            "Subtract", "Divide", "Hue", "Saturation", "Color", "Luminosity" });

        [StructLayout(LayoutKind.Sequential)] private struct MemoryStatus
        {
            public uint Length, Load;
            public ulong TotalPhysical, AvailablePhysical, TotalPageFile, AvailablePageFile, TotalVirtual, AvailableVirtual, AvailableExtended;
        }
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);
        private static long CalculateBudget()
        {
            var status = new MemoryStatus { Length = (uint)Marshal.SizeOf(typeof(MemoryStatus)) };
            return GlobalMemoryStatusEx(ref status) ? Math.Min(800000000L, Math.Max(SurfacePixels, (long)(status.TotalPhysical / 16))) : SurfacePixels;
        }
        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidDataException(message);
        }
        private static bool IsID(string id) => id != null && Guid.TryParseExact(id, "D", out _);
        private static bool Present(Dictionary<string, object> item, string key) => Json.Get(item, key) != null;
        private static double Number(Dictionary<string, object> item, string key, double fallback) => Present(item, key) ? Json.Number(item[key]) : fallback;
        private static void Transform(object value)
        {
            var transform = Json.Map(value);
            var origin = Json.Array(Json.Get(transform, "origin")); var size = Json.Array(Json.Get(transform, "size"));
            Require(origin.Length == 2 && size.Length == 2, "Invalid layer transform.");
            Require(origin.All(n => Math.Abs(Json.Number(n)) <= 1000000) && size.All(n => Json.Number(n) >= 1 && Json.Number(n) <= 300000), "Layer geometry exceeds the supported limits.");
            Json.Number(Json.Get(transform, "rotation"));
            Require(Json.Get(transform, "flipX") is bool && Json.Get(transform, "flipY") is bool &&
                new[] { "Nearest", "Smooth", "High quality" }.Contains(Json.Text(transform, "sampling")), "Invalid layer sampling or flips.");
        }

        internal static void Validate(Dictionary<string, object> manifest)
        {
            Require(Json.Text(manifest, "format") == "com.compositor.project", "This is not a Compositor project.");
            var version = Number(manifest, "version", 0);
            Require(version >= 1 && version <= 17 && version % 1 == 0, "This client supports Compositor project versions 1–17.");
            Require(Json.Text(manifest, "colorSpace") == "sRGB" && IsID(Json.Text(manifest, "documentID")), "Invalid document metadata.");
            var width = Number(manifest, "width", 0); var height = Number(manifest, "height", 0);
            Require(width >= 1 && height >= 1 && width <= MaximumSide && height <= MaximumSide && width % 1 == 0 && height % 1 == 0 &&
                width * height <= SurfacePixels, "Canvas exceeds the 200-megapixel or 30,000-pixel limit.");
            var resolution = Number(manifest, "resolution", 72);
            Require(resolution >= 1 && resolution <= 9600, "Invalid document resolution.");
            var layers = Json.Array(Json.Get(manifest, "layers"));
            WorkflowResources.List(manifest);
            Require(layers.Length <= 10000, "Too many layers.");
            var byID = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
            foreach (var value in layers)
            {
                var layer = Json.Map(value); var id = Json.Text(layer, "id");
                Require(IsID(id) && !byID.ContainsKey(id), "Invalid or duplicate layer ID."); byID.Add(id, layer);
                var name = Json.Text(layer, "name");
                Require(!string.IsNullOrWhiteSpace(name) && Encoding.UTF8.GetByteCount(name) <= 16384 && Json.Get(layer, "isVisible") is bool, "Invalid layer name or visibility.");
                Require(!Present(layer, "isGroup") || layer["isGroup"] is bool, "Invalid folder flag.");
                Transform(Json.Get(layer, "transform"));
                Require(!Present(layer, "imageFile") || Json.Text(layer, "imageFile") == id.ToUpperInvariant() + ".png", "Unsafe image filename.");
                Require(!Present(layer, "maskFile") || Json.Text(layer, "maskFile") == id.ToUpperInvariant() + ".mask.png", "Unsafe mask filename.");
                if (Present(layer, "filters") || Present(layer, "filterSourceFile")) {
                    Require(version >= 12 && Present(layer, "imageFile") && !Json.True(layer, "isGroup") && !Present(layer, "adjustment") && !Present(layer, "text") && !Present(layer, "shape"), "Editable filters require a version 12 pixel layer.");
                    Require(Present(layer, "hdrSourceFile") || Json.Text(layer, "filterSourceFile") == id.ToUpperInvariant() + ".source.png", "Unsafe filter source filename.");
                    Require(!Present(layer, "filterWorkingSpace") || new[] { "sRGB", "Adobe RGB (1998)", "Display P3", "ProPhoto RGB" }.Contains(Json.Text(layer, "filterWorkingSpace")), "Invalid filter working space.");
                    var filters = Json.Array(Json.Get(layer, "filters")); Require(filters.Length > 0 && filters.Length <= 32, "Invalid editable filter list."); var filterIDs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var item in filters) { var filter = Json.Map(item); Require(IsID(Json.Text(filter, "id")) && filterIDs.Add(Json.Text(filter, "id")) && Json.Get(filter, "enabled") is bool, "Invalid editable filter.");
                        if (Present(filter, "maskFile") || Present(filter, "maskEnabled") || Present(filter, "opacity")) {
                            Require(version >= 14, "Filter masks and opacity require format version 14.");
                            Require(!Present(filter, "maskFile") || Json.Text(filter, "maskFile") == id.ToUpperInvariant() + "." + Json.Text(filter, "id").ToUpperInvariant() + ".filter-mask.png", "Unsafe filter mask filename.");
                            Require(!Present(filter, "maskEnabled") || Present(filter, "maskFile") && Json.Get(filter, "maskEnabled") is bool, "Invalid filter mask visibility.");
                            if (Present(filter, "opacity")) { var amount = Json.Number(Json.Get(filter, "opacity")); Require(amount >= 0 && amount <= 1, "Invalid filter opacity."); }
                        }
                        Require(Json.Get(filter, "adjustment") is Dictionary<string, object>, "Invalid editable filter settings."); LayerMetadata.Validate(new Dictionary<string, object> { ["adjustment"] = filter["adjustment"] }, 12); }
                }
                var opacity = Number(layer, "opacity", 1); var blend = Json.Text(layer, "blendMode", "Normal");
                Require(opacity >= 0 && opacity <= 1 && Blends.Contains(blend), "Invalid layer appearance.");
                var group = Json.True(layer, "isGroup");
                Require(!group || (!Present(layer, "imageFile") && blend == "Normal"), "Invalid folder image or blend mode.");
                Require(!Present(layer, "maskEnabled") || (Present(layer, "maskFile") && layer["maskEnabled"] is bool), "Invalid mask metadata.");
                Require(!Present(layer, "maskLinked") || (Present(layer, "maskFile") && layer["maskLinked"] is bool), "Invalid mask link.");
                if (Present(layer, "maskPlacement")) { Require(Present(layer, "maskFile"), "Missing mask."); Transform(layer["maskPlacement"]); }
                Require(!Present(layer, "adjustment") || (version >= 7 && !group && !Present(layer, "imageFile") && !Present(layer, "text")), "Invalid adjustment layer.");
                Require(!Present(layer, "text") || (Present(layer, "imageFile") && !group && !Present(layer, "adjustment")), "Invalid text layer.");
                Require(version >= 2 || (!Present(layer, "parentID") && !group), "Folders require format version 2.");
                Require(version >= 3 || (opacity == 1 && blend == "Normal"), "Layer appearance requires format version 3.");
                Require(!Present(layer, "maskFile") || version >= (group ? 6 : 4), "Mask format version is too old.");
                Require(version >= 5 || !Present(layer, "maskSourceID"), "Clipping masks require format version 5.");
                Require(!group || version >= 8 || opacity == 1, "Folder opacity requires format version 8.");
                LayerMetadata.Validate(layer, (int)version);
                if (Present(layer, "hdrSourceFile")) Require(version >= 15 && Json.Text(layer, "hdrSourceFile") == id.ToUpperInvariant() + ".hdr-source.tif" && Present(layer, "imageFile") && Present(layer, "filters") && !Present(layer, "filterSourceFile") && !group && !Present(layer, "text") && !Present(layer, "shape") && !Present(layer, "vectorPath") && !Present(layer, "adjustment"), "Invalid HDR layer.");
                if (Present(layer, "exrSourceFile")) {
                    var sourceName = Json.Text(layer, "exrSourceFile"); var view = Json.Map(Json.Get(layer, "exrView")); var channelGroup = Json.Text(view, "group"); var part = Number(view, "part", -1);
                    Require(!Present(view, "encoding") || new[] { "Linear sRGB", "Linear Rec.2020", "Linear P3-D65", "ACEScg", "ACES2065-1", "File color metadata" }.Contains(Json.Text(view, "encoding")), "Invalid EXR input color space.");
                    Require(version >= 16 && Present(layer, "hdrSourceFile") && sourceName.EndsWith(".exr-source.exr", StringComparison.Ordinal) && IsID(sourceName.Substring(0, sourceName.Length - 15)) && channelGroup != null && channelGroup.Length <= 255 && !channelGroup.Any(c => c < 32) && part >= 0 && part < 64 && part % 1 == 0, "Invalid retained OpenEXR source.");
                    foreach (var key in new[] { "levelX", "levelY" }) { var level = Number(view, key, -1); Require(level >= 0 && level <= 30 && level % 1 == 0, "Invalid OpenEXR level."); }
                    if (Present(view, "depthRange")) { var range = Json.Array(view["depthRange"]); Require(range.Length == 2 && range.All(v => Math.Abs(Json.Number(v)) <= 1e12) && Json.Number(range[0]) <= Json.Number(range[1]), "Invalid deep depth range."); }
                } else Require(!Present(layer, "exrView"), "OpenEXR view requires an embedded source.");
                if (Present(layer, "smartObject")) {
                    var smart = Json.Map(Json.Get(layer, "smartObject")); Require(version >= 15 && IsID(Json.Text(smart, "id")) && Present(layer, "imageFile") && (Present(layer, "filterSourceFile") || Present(layer, "hdrSourceFile")) && !group && !Present(layer, "text") && !Present(layer, "shape") && !Present(layer, "vectorPath") && !Present(layer, "adjustment"), "Invalid smart object.");
                    var w = Number(smart, "width", 0); var h = Number(smart, "height", 0); Require(w >= 1 && h >= 1 && w <= MaximumSide && h <= MaximumSide && w % 1 == 0 && h % 1 == 0 && w * h <= SurfacePixels, "Invalid smart object dimensions."); Transform(Json.Get(smart, "baseTransform"));
                }
            }
            foreach (var value in layers)
            {
                var layer = Json.Map(value); var id = Json.Text(layer, "id");
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { id };
                var parent = Json.Text(layer, "parentID");
                Require(!Present(layer, "parentID") || IsID(parent), "Invalid parent ID.");
                while (parent != null)
                {
                    Require(byID.TryGetValue(parent, out var node) && Json.True(node, "isGroup") && seen.Add(parent) && seen.Count <= 65, "Invalid folder hierarchy.");
                    parent = Json.Text(node, "parentID");
                }
                var source = Json.Text(layer, "maskSourceID"); seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { id };
                Require(!Present(layer, "maskSourceID") || IsID(source), "Invalid clipping source ID.");
                while (source != null)
                {
                    Require(!Json.True(layer, "isGroup") && byID.TryGetValue(source, out var node) && !Json.True(node, "isGroup") && !Present(node, "adjustment") && seen.Add(source) && seen.Count <= 257, "Invalid clipping mask chain.");
                    source = Json.Text(byID[source], "maskSourceID");
                }
            }
            var active = Json.Text(manifest, "activeLayerID");
            Require(!Present(manifest, "activeLayerID") || (active != null && byID.ContainsKey(active)), "The active layer is missing.");
            var guides = Present(manifest, "guides") ? Json.Array(manifest["guides"]) : new object[0];
            if (Present(manifest, "hdrWorkingSpace")) Require(version >= 16 && new[] { "Linear sRGB", "Linear Rec.2020", "Linear P3-D65", "ACEScg", "ACES2065-1" }.Contains(Json.Text(manifest, "hdrWorkingSpace")), "Invalid HDR working space.");
            if (Present(manifest, "hdrView")) { var view = Json.Map(Json.Get(manifest, "hdrView")); var exposure = Number(view, "exposure", 0); Require(version >= 15 && exposure >= -20 && exposure <= 20 && new[] { "Reinhard", "Clip" }.Contains(Json.Text(view, "toneMap")) && (!Present(view, "displayMode") || version >= 16 && new[] { "Auto", "HDR", "SDR" }.Contains(Json.Text(view, "displayMode"))), "Invalid HDR preview settings."); }
            Require(guides.Length <= 1000 && (version >= 8 || guides.Length == 0), "Invalid guides.");
            var guideIDs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var value in guides)
            {
                var guide = Json.Map(value); var id = Json.Text(guide, "id");
                Require(IsID(id) && guideIDs.Add(id) && new[] { "horizontal", "vertical" }.Contains(Json.Text(guide, "axis")) &&
                    Math.Abs(Json.Number(Json.Get(guide, "position"))) <= 1000000, "Invalid guide metadata.");
            }
        }

        private static byte[] ReadResource(string root, string relative, int maximum)
        {
            var canonical = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var filename = Path.GetFullPath(Path.Combine(root, relative));
            Require(filename.StartsWith(canonical, StringComparison.OrdinalIgnoreCase), "Unsafe project resource.");
            var current = filename;
            while (current.Length >= canonical.TrimEnd(Path.DirectorySeparatorChar).Length)
            {
                Require((File.GetAttributes(current) & FileAttributes.ReparsePoint) == 0, "Linked project resources are unsupported.");
                current = Path.GetDirectoryName(current);
                if (current == null) break;
            }
            var info = new FileInfo(filename);
            Require(info.Length <= maximum, "Project resource exceeds the file-size limit.");
            return File.ReadAllBytes(filename);
        }

        private static uint BigEndian(byte[] bytes, int offset) => ((uint)bytes[offset] << 24) | ((uint)bytes[offset + 1] << 16) | ((uint)bytes[offset + 2] << 8) | bytes[offset + 3];
        private static long InspectPNG(byte[] bytes, bool mask, bool source = false, Dictionary<string, object> smart = null)
        {
            Require(bytes.Length >= 33 && bytes.Length <= AssetBytes && bytes.Take(8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) &&
                Encoding.ASCII.GetString(bytes, 12, 4) == "IHDR", "Missing, oversized, or invalid PNG asset.");
            var width = BigEndian(bytes, 16); var height = BigEndian(bytes, 20);
            if (smart != null) Require(Json.Number(Json.Get(smart, "width")) == width && Json.Number(Json.Get(smart, "height")) == height, "Smart object dimensions do not match its embedded source.");
            Require(width > 0 && height > 0 && width <= MaximumSide && height <= MaximumSide && (new byte[] { 1, 2, 4, 8 }.Contains(bytes[24]) || source && bytes[24] == 16), "Invalid PNG dimensions or bit depth.");
            Require(!mask || (bytes[24] == 8 && bytes[25] == 0), "Masks must be 8-bit grayscale PNGs.");
            return (long)width * height * (bytes[24] == 16 ? 2 : 1);
        }

        private static IEnumerable<KeyValuePair<string, bool>> Resources(Dictionary<string, object> layer)
        {
            foreach (var key in new[] { "imageFile", "maskFile", "filterSourceFile", "hdrSourceFile", "exrSourceFile" }) { var name = Json.Text(layer, key); if (name != null) yield return new KeyValuePair<string, bool>(name, key == "maskFile"); }
            if (Json.Get(layer, "filters") != null) foreach (var item in Json.Array(Json.Get(layer, "filters"))) { var name = Json.Text(Json.Map(item), "maskFile"); if (name != null) yield return new KeyValuePair<string, bool>(name, true); }
        }

        internal static Dictionary<string, object> Read(string directory)
        {
            var manifest = Json.Parse(Encoding.UTF8.GetString(ReadResource(directory, "manifest.json", MetadataBytes)));
            Validate(manifest);
            manifest["documentID"] = Json.Text(manifest, "documentID").ToUpperInvariant();
            if (Present(manifest, "activeLayerID")) manifest["activeLayerID"] = Json.Text(manifest, "activeLayerID").ToUpperInvariant();
            var assets = new Dictionary<string, object>(); long used = 0;
            foreach (var value in Json.Array(manifest["layers"]))
            {
                var layer = Json.Map(value);
                foreach (var key in new[] { "id", "parentID", "maskSourceID" }) if (Present(layer, key)) layer[key] = Json.Text(layer, key).ToUpperInvariant();
                foreach (var resource in Resources(layer))
                {
                    var filename = resource.Key;
                    var bytes = ReadResource(directory, Path.Combine("images", filename), AssetBytes);
                    used += filename == Json.Text(layer, "hdrSourceFile") ? HdrStore.Inspect(bytes, Json.Get(layer, "smartObject") as Dictionary<string, object>, Number(manifest, "version", 0) >= 16) : filename == Json.Text(layer, "exrSourceFile") ? ExrStore.Inspect(bytes, Json.Map(Json.Get(layer, "exrView"))) : InspectPNG(bytes, resource.Value, filename == Json.Text(layer, "filterSourceFile"), filename == Json.Text(layer, "filterSourceFile") ? Json.Get(layer, "smartObject") as Dictionary<string, object> : null); Require(used <= PixelBudget, "This project exceeds the document memory budget.");
                    assets[filename] = Convert.ToBase64String(bytes);
                }
            }
            foreach (var resource in WorkflowResources.List(manifest)) {
                var file = Json.Text(resource, "file"); var bytes = ReadResource(directory, Path.Combine("images", file), AssetBytes);
                used += WorkflowResources.Inspect(bytes, Json.Text(resource, "kind")); Require(used <= PixelBudget, "This project exceeds the document memory budget."); assets[file] = Convert.ToBase64String(bytes);
            }
            return new Dictionary<string, object> { ["manifest"] = manifest, ["assets"] = assets };
        }

        internal static void Write(string directory, Dictionary<string, object> snapshot)
        {
            var manifest = Json.Map(Json.Get(snapshot, "manifest")); Validate(manifest);
            var metadata = Encoding.UTF8.GetBytes(Json.Stringify(manifest)); Require(metadata.Length <= MetadataBytes, "The manifest is too large.");
            var sources = Json.Map(Json.Get(snapshot, "assets")); var assets = new Dictionary<string, byte[]>(); long used = 0;
            foreach (var value in Json.Array(manifest["layers"])) foreach (var resource in Resources(Json.Map(value)))
            {
                var filename = resource.Key;
                var encoded = Json.Text(sources, filename);
                Require(encoded != null && encoded.Length <= ((long)AssetBytes + 2) / 3 * 4, "A project image is missing or too large.");
                var bytes = Convert.FromBase64String(encoded);
                used += filename == Json.Text(Json.Map(value), "hdrSourceFile") ? HdrStore.Inspect(bytes, Json.Get(Json.Map(value), "smartObject") as Dictionary<string, object>, Number(manifest, "version", 0) >= 16) : filename == Json.Text(Json.Map(value), "exrSourceFile") ? ExrStore.Inspect(bytes, Json.Map(Json.Get(Json.Map(value), "exrView"))) : InspectPNG(bytes, resource.Value, filename == Json.Text(Json.Map(value), "filterSourceFile"), filename == Json.Text(Json.Map(value), "filterSourceFile") ? Json.Get(Json.Map(value), "smartObject") as Dictionary<string, object> : null); Require(used <= PixelBudget, "This project exceeds the document memory budget."); assets[filename] = bytes;
            }
            foreach (var resource in WorkflowResources.List(manifest)) {
                var file = Json.Text(resource, "file"); var encoded = Json.Text(sources, file); Require(encoded != null && encoded.Length <= ((long)AssetBytes + 2) / 3 * 4, "Missing or oversized workflow resource.");
                var bytes = Convert.FromBase64String(encoded); used += WorkflowResources.Inspect(bytes, Json.Text(resource, "kind")); Require(used <= PixelBudget, "This project exceeds the document memory budget."); assets[file] = bytes;
            }
            var target = Path.GetFullPath(directory); var parent = Path.GetDirectoryName(target);
            Require(parent != null && Path.GetExtension(target).Equals(".comp", StringComparison.OrdinalIgnoreCase), "Save to a folder ending in .comp.");
            Require(!File.Exists(target), "The destination is a file, not a project folder.");
            bool existing = Directory.Exists(target);
            if (existing)
            {
                var previous = ReadResource(target, "manifest.json", MetadataBytes);
                Require(Json.Text(Json.Parse(Encoding.UTF8.GetString(previous)), "format") == "com.compositor.project", "The destination is not a Compositor project.");
            }
            Directory.CreateDirectory(parent);
            var staging = Path.Combine(parent, ".compositor-save-" + Guid.NewGuid().ToString("N"));
            var backup = Path.Combine(parent, ".compositor-backup-" + Guid.NewGuid().ToString("N"));
            bool moved = false, installed = false;
            try
            {
                Directory.CreateDirectory(Path.Combine(staging, "images"));
                foreach (var asset in assets) File.WriteAllBytes(Path.Combine(staging, "images", asset.Key), asset.Value);
                File.WriteAllBytes(Path.Combine(staging, "manifest.json"), metadata);
                if (existing) { Directory.Move(target, backup); moved = true; }
                Directory.Move(staging, target); installed = true;
            }
            catch { if (moved && !installed) Directory.Move(backup, target); throw; }
            finally
            {
                if (Directory.Exists(staging)) Directory.Delete(staging, true);
                if (installed && moved) { try { Directory.Delete(backup, true); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
            }
        }
    }
}
