using System;
using System.Collections.Generic;
using System.IO;
using System.Windows.Forms;

namespace Compositor.Windows
{
    internal sealed class UiText
    {
        private readonly Dictionary<string, string> chinese = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        internal string Language { get; set; } = "en";

        internal UiText()
        {
            var filename = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "renderer", "locales", "zh-CN.json");
            foreach (var entry in Json.Parse(File.ReadAllText(filename))) if (entry.Value is string value) chinese[entry.Key] = value;
        }

        internal string Get(string text)
        {
            if (Language != "zh-CN" || text == null) return text;
            var key = text.Replace("&", "").TrimEnd('…');
            if (chinese.TryGetValue(key, out var translated)) return translated + (text.EndsWith("…", StringComparison.Ordinal) ? "…" : "");
            return text;
        }

        internal void Apply(ToolStripItemCollection items)
        {
            foreach (ToolStripItem item in items)
            {
                if (item.Tag is string source) item.Text = Get(source);
                if (item is ToolStripMenuItem menu) Apply(menu.DropDownItems);
            }
        }
    }
}
