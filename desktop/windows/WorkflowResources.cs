using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Compositor.Windows
{
    internal static class WorkflowResources
    {
        private static readonly Regex Name = new Regex(@"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.resource\.bin$", RegexOptions.IgnoreCase);
        private static void Check(bool value, string message) { if (!value) throw new InvalidDataException(message); }
        internal static void Metadata(object value, int depth = 0)
        {
            Check(depth <= 64, "Workflow metadata is nested too deeply.");
            if (value == null || value is bool) return;
            if (value is string text) { Check(text.Length <= 1000000, "Workflow text is too large."); return; }
            if (value is Dictionary<string, object> map) { Check(map.Count <= 10000, "Workflow metadata contains too many entries."); foreach (var pair in map) { Check(pair.Key != "__proto__" && pair.Key != "constructor" && pair.Key != "prototype", "Invalid workflow key."); Metadata(pair.Value, depth + 1); } return; }
            if (value is object[] array) { Check(array.Length <= 10000, "Workflow metadata contains too many entries."); foreach (var item in array) Metadata(item, depth + 1); return; }
            Json.Number(value);
        }
        internal static Dictionary<string, object>[] List(Dictionary<string, object> manifest)
        {
            var items = Json.Get(manifest, "resources") == null ? new object[0] : Json.Array(manifest["resources"]); Check(items.Length <= 1024, "Invalid workflow resource list.");
            if (items.Length > 0 || Json.Get(manifest, "workflow") != null) Check(Json.Number(manifest["version"]) >= 17, "Workflow resources require project version 17.");
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase); var result = new List<Dictionary<string, object>>();
            foreach (var item in items) { var value = Json.Map(item); var file = Json.Text(value, "file"); Check(file != null && Name.IsMatch(file) && seen.Add(file), "Invalid workflow filename."); Check(Array.IndexOf(new[] { "icc", "channels", "lookup", "photoshop", "plugin" }, Json.Text(value, "kind")) >= 0, "Invalid workflow resource kind."); result.Add(value); }
            Metadata(Json.Get(manifest, "workflow"));
            foreach (var item in Json.Array(manifest["layers"])) { var layer = Json.Map(item); Metadata(Json.Get(layer, "workflow")); if (Json.Get(layer, "workflow") != null || Json.Get(layer, "fillOpacity") != null) Check(Json.Number(manifest["version"]) >= 17, "Layer workflows require project version 17."); if (Json.Get(layer, "fillOpacity") != null) { var fill = Json.Number(layer["fillOpacity"]); Check(fill >= 0 && fill <= 1, "Invalid Fill opacity."); } }
            return result.ToArray();
        }
        internal static long Inspect(byte[] bytes, string kind)
        {
            Check(bytes.Length > 0 && bytes.Length <= 512 * 1024 * 1024, "Invalid workflow resource size.");
            if (kind == "icc") Check(bytes.Length >= 132 && bytes.Length <= 16 * 1024 * 1024 && Encoding.ASCII.GetString(bytes, 36, 4) == "acsp", "Invalid ICC resource.");
            if (kind == "photoshop") Check(bytes.Length >= 26 && Encoding.ASCII.GetString(bytes, 0, 4) == "8BPS", "Invalid Photoshop source resource.");
            if (kind == "lookup") Check(bytes.Length <= 32 * 1024 * 1024, "Lookup resource is too large.");
            if (kind != "channels") return 0;
            Check(bytes.Length >= 32 && Encoding.ASCII.GetString(bytes, 0, 8) == "CCHN0001", "Invalid channel header.");
            long w = BitConverter.ToUInt32(bytes, 8), h = BitConverter.ToUInt32(bytes, 12), mode = BitConverter.ToUInt32(bytes, 16), bits = BitConverter.ToUInt32(bytes, 20), channels = BitConverter.ToUInt32(bytes, 24);
            Check(w >= 1 && h >= 1 && w <= 30000 && h <= 30000 && w * h <= 16000000 && mode <= 2 && (bits == 8 || bits == 16 || bits == 32) && channels == (mode == 1 ? 5 : 4) && bytes.Length == 32 + w * h * channels * bits / 8, "Invalid channel dimensions or samples.");
            if (bits == 32) for (int i = 32; i < bytes.Length; i += 4) { var value = BitConverter.ToSingle(bytes, i); Check(!float.IsNaN(value) && !float.IsInfinity(value) && Math.Abs(value) <= 1000000 && ((i - 32) / 4 % channels != channels - 1 || value >= 0 && value <= 1), "Invalid floating channel sample."); }
            return w * h * channels * bits / 32;
        }
    }
}
