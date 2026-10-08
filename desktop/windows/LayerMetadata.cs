using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace Compositor.Windows
{
    internal static class LayerMetadata
    {
        private static void Require(bool condition, string message) { if (!condition) throw new InvalidDataException(message); }
        private static double Range(Dictionary<string, object> value, string key, double min, double max, double fallback = 0)
        {
            var entry = Json.Get(value, key); var number = entry == null ? fallback : Json.Number(entry); Require(number >= min && number <= max, "Invalid " + key + " value."); return number;
        }
        private static void Color(Dictionary<string, object> value) { foreach (var channel in new[] { "red", "green", "blue" }) Range(value, channel, 0, 1); }
        private static void Required(Dictionary<string, object> value, params string[] keys) { Require(keys.All(key => Json.Get(value, key) != null), "Required layer metadata is missing."); }
        private static void Vector(Dictionary<string, object> style, bool mask)
        {
            Require(new[] { "evenodd", "nonzero" }.Contains(Json.Text(style, "fillRule")), "Invalid vector fill rule.");
            var contours = Json.Array(Json.Get(style, "contours")); Require(contours.Length > 0 && contours.Length <= 64, "Invalid vector contours."); int count = 0;
            foreach (var value in contours) {
                var contour = Json.Map(value); Require(Json.Get(contour, "closed") is bool && (!mask || Json.True(contour, "closed")), "Invalid vector contour.");
                var nodes = Json.Array(Json.Get(contour, "nodes")); count += nodes.Length; Require(nodes.Length >= (Json.True(contour, "closed") ? 3 : 2) && count <= 4096, "Invalid vector point count.");
                foreach (var item in nodes) { var node = Json.Map(item); Require(Json.Get(node, "point") != null && node.Keys.All(key => new[] { "point", "incoming", "outgoing" }.Contains(key)), "Invalid vector node.");
                    foreach (var entry in node.Values) { var point = Json.Array(entry); Require(point.Length == 2 && point.All(n => Math.Abs(Json.Number(n)) <= 4), "Invalid vector coordinates."); }
                }
            }
            foreach (var key in new[] { "fill", "stroke" }) if (Json.Get(style, key) != null) { var color = Json.Map(Json.Get(style, key)); Required(color, "red", "green", "blue"); Color(color); }
            Required(style, "strokeWidth"); var width = Range(style, "strokeWidth", 0, 1); Require(Json.Get(style, "fill") != null || Json.Get(style, "stroke") != null && width > 0, "Invalid vector stroke or fill.");
            if (mask) { var fill = Json.Map(Json.Get(style, "fill")); Require(width == 0 && Json.Get(style, "stroke") == null && new[] { "red", "green", "blue" }.All(key => Json.Number(Json.Get(fill, key)) == 1), "Invalid vector mask style."); }
        }

        internal static void Validate(Dictionary<string, object> layer, int version)
        {
            if (Json.Get(layer, "vectorPath") != null) {
                Require(version >= 13 && Json.Get(layer, "imageFile") != null && !Json.True(layer, "isGroup") && new[] { "text", "shape", "adjustment", "filters", "filterSourceFile" }.All(key => Json.Get(layer, key) == null), "Invalid vector path layer or format version.");
                Vector(Json.Map(Json.Get(layer, "vectorPath")), false);
            }
            if (Json.Get(layer, "vectorMask") != null) { Require(version >= 13 && Json.Get(layer, "maskFile") != null, "A vector mask requires a version 13 raster mask cache."); Vector(Json.Map(Json.Get(layer, "vectorMask")), true); }
            if (Json.Get(layer, "effects") is Dictionary<string, object> effects)
            {
                foreach (var pair in effects)
                {
                    if (pair.Value == null) continue; var effect = Json.Map(pair.Value); Color(effect); Range(effect, "opacity", 0, 1, 1);
                    if (Json.Get(effect, "enabled") != null) Require(Json.Get(effect, "enabled") is bool, "Invalid effect visibility.");
                    if (pair.Key == "stroke" || pair.Key == "outerGlow" || pair.Key == "innerGlow") Range(effect, "size", 0, 500);
                    if (pair.Key == "shadow" || pair.Key == "innerShadow") { Range(effect, "angle", -360, 360); Range(effect, "distance", 0, 5000); Range(effect, "blur", 0, 500); }
                }
            }
            if (Json.Get(layer, "text") is Dictionary<string, object> text)
            {
                var content = Json.Text(text, "content"); Require(content != null && content.Length <= 100000, "Invalid text content.");
                Required(text, "content", "fontName", "fontSize", "red", "green", "blue", "alignment", "tracking", "leading");
                Require(!string.IsNullOrEmpty(Json.Text(text, "fontName")), "A text layer must have a font name.");
                Color(text); Range(text, "fontSize", 1, 2000, 72); Range(text, "tracking", -100, 1000); Range(text, "leading", 0, 5000);
                Require(new[] { "Left", "Center", "Right" }.Contains(Json.Text(text, "alignment", "Left")), "Invalid text alignment.");
                if (Json.Get(text, "boxSize") != null) { var size = Json.Array(text["boxSize"]); Require(size.Length == 2 && size.All(value => Json.Number(value) >= 16 && Json.Number(value) <= 30000) && Json.Number(size[0]) * Json.Number(size[1]) <= ProjectStore.SurfacePixels, "Invalid paragraph bounds."); }
                foreach (var key in new[] { "colorRuns", "fontRuns" })
                {
                    if (Json.Get(text, key) == null) continue; Require(version >= (key == "colorRuns" ? 10 : 11), "Text run metadata requires a newer format version.");
                    var runs = Json.Array(text[key]); Require(runs.Length > 0, "Text run lists must not be empty."); double end = 0;
                    foreach (var item in runs) { var run = Json.Map(item); var start = Range(run, "location", 0, content.Length); var length = Range(run, "length", 1, content.Length); Require(start % 1 == 0 && length % 1 == 0 && start >= end && start + length <= content.Length, "Invalid text run range."); end = start + length;
                        if (key == "colorRuns") Color(run); else { var name = Json.Text(run, "fontName"); Require(!string.IsNullOrEmpty(name) && name.Length <= 200 && !name.Contains('\n') && !name.Contains('\r'), "Invalid text run font."); }
                    }
                }
            }
            if (!(Json.Get(layer, "adjustment") is Dictionary<string, object> adjustment)) return;
            Required(adjustment, "kind", "hue", "saturation", "lightness", "colorize", "levels", "curves");
            var kind = Json.Text(adjustment, "kind");
            Require(new[] { "Hue/Saturation", "Levels", "Curves", "Exposure", "Gradient Map", "Grain", "Invert", "Black & White", "Color Balance", "Gaussian Blur", "Motion Blur", "Add Noise" }.Contains(kind), "Unknown adjustment kind.");
            if (new[] { "Gaussian Blur", "Motion Blur", "Add Noise" }.Contains(kind)) Require(version >= 9, "This adjustment requires format version 9.");
            Range(adjustment, "hue", -360, 360); Range(adjustment, "saturation", -100, 100); Range(adjustment, "lightness", -100, 100);
            Require(Json.Get(adjustment, "colorize") is bool, "Invalid colorize setting.");
            Range(adjustment, "blurRadius", .1, 250, 10); Range(adjustment, "motionAngle", -90, 90); Range(adjustment, "motionDistance", 1, 2000, 10); Range(adjustment, "noiseAmount", .1, 400, 10);
            var seed = Range(adjustment, "noiseSeed", 0, uint.MaxValue); Require(seed % 1 == 0, "Noise seeds must be whole numbers.");
            foreach (var key in new[] { "noiseGaussian", "noiseMonochromatic" }) if (Json.Get(adjustment, key) != null) Require(adjustment[key] is bool, "Invalid noise setting.");
            if (Json.Get(adjustment, "exposureSettings") != null) {
                var s = Json.Map(adjustment["exposureSettings"]); Required(s, "exposure", "offset", "gamma"); Range(s, "exposure", -20, 20); Range(s, "offset", -.5, .5); Range(s, "gamma", .01, 9.99, 1);
            }
            if (Json.Get(adjustment, "gradientMapSettings") != null) {
                var s = Json.Map(adjustment["gradientMapSettings"]); Required(s, "shadows", "highlights", "reversed"); Color(Json.Map(s["shadows"])); Color(Json.Map(s["highlights"])); Require(s["reversed"] is bool, "Invalid gradient reversal.");
            }
            if (Json.Get(adjustment, "grainSettings") != null) {
                var s = Json.Map(adjustment["grainSettings"]); Required(s, "amount", "size", "roughness"); Range(s, "amount", 0, 100); Range(s, "size", .5, 20, 1.5); Range(s, "roughness", 0, 100); var n = Range(s, "seed", 0, uint.MaxValue); Require(n % 1 == 0, "Invalid grain seed.");
            }
            if (Json.Get(adjustment, "blackWhiteSettings") != null) {
                var s = Json.Map(adjustment["blackWhiteSettings"]); foreach (var key in new[] { "reds", "yellows", "greens", "cyans", "blues", "magentas" }) { Required(s, key); Range(s, key, -200, 300); }
                Range(s, "tintHue", 0, 360, 40); Range(s, "tintSaturation", 0, 100, 20); if (Json.Get(s, "tint") != null) Require(s["tint"] is bool, "Invalid tint setting.");
            }
            if (Json.Get(adjustment, "colorBalanceSettings") != null) {
                var s = Json.Map(adjustment["colorBalanceSettings"]); foreach (var band in new[] { "shadow", "mid", "highlight" }) foreach (var channel in new[] { "CyanRed", "MagentaGreen", "YellowBlue" }) Range(s, band + channel, -100, 100);
                if (Json.Get(s, "preserveLuminosity") != null) Require(s["preserveLuminosity"] is bool, "Invalid luminosity setting.");
            }
            if (Json.Get(adjustment, "hsvSettings") != null) {
                var s = Json.Map(adjustment["hsvSettings"]); var names = new[] { "Master", "Reds", "Yellows", "Greens", "Cyans", "Blues", "Magentas" }; Required(s, "range", "colorize", "invertRange", "adjustments", "bands");
                Require(names.Contains(Json.Text(s, "range")) && s["colorize"] is bool && s["invertRange"] is bool, "Invalid hue settings.");
                foreach (var key in new[] { "adjustments", "bands" }) {
                    var dictionary = new Dictionary<string, object>();
                    if (s[key] is Dictionary<string, object> map) dictionary = map;
                    else { var pairs = Json.Array(s[key]); Require(pairs.Length % 2 == 0 && pairs.Length <= 14, "Invalid hue dictionary."); for (var i = 0; i < pairs.Length; i += 2) { var name = pairs[i] as string; Require(name != null && !dictionary.ContainsKey(name), "Invalid hue range name."); dictionary.Add(name, pairs[i + 1]); } }
                    foreach (var pair in dictionary) { Require(names.Contains(pair.Key), "Invalid hue range name."); var item = Json.Map(pair.Value);
                        if (key == "adjustments") { Required(item, "hue", "saturation", "lightness"); Range(item, "hue", -360, 360); Range(item, "saturation", -100, 100); Range(item, "lightness", -100, 100); }
                        else foreach (var field in new[] { "falloffStart", "rangeStart", "rangeEnd", "falloffEnd" }) { Required(item, field); Json.Number(item[field]); }
                    }
                }
            }
            if (Json.Get(adjustment, "levels") is Dictionary<string, object> levels)
            {
                var ranges = Json.Array(Json.Get(levels, "ranges")); Require(ranges.Length == 4, "Levels needs four channels.");
                foreach (var value in ranges) { var range = Json.Map(value); double black = Range(range, "black", 0, 254); Range(range, "white", black + 1, 255, 255); Range(range, "gamma", .1, 9.99, 1); Range(range, "outputBlack", 0, 255); Range(range, "outputWhite", 0, 255, 255); }
            }
            if (Json.Get(adjustment, "curves") is Dictionary<string, object> curves)
            {
                var channels = Json.Array(Json.Get(curves, "channels")); Require(channels.Length == 4, "Curves needs four channels.");
                foreach (var value in channels) { var points = Json.Array(value); Require(points.Length >= 2 && points.Length <= 32, "Invalid curve point count."); double last = -1; foreach (var item in points) { var point = Json.Map(item); var x = Range(point, "x", 0, 255); Range(point, "y", 0, 255); Require(x > last, "Curve points must be ordered."); last = x; } Require(Json.Number(Json.Map(points[0])["x"]) == 0 && last == 255, "Curves must start at 0 and end at 255."); }
            }
        }
    }
}
