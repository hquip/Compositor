using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Drawing.Imaging;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Compositor.Windows
{
    internal sealed class EditorWindow : Form
    {
        private const string Page = "https://compositor.local/index.html";
        private readonly WebView2 browser = new WebView2();
        private readonly bool test = Environment.GetEnvironmentVariable("COMPOSITOR_TEST") == "1";
        private readonly string testDirectory = Environment.GetEnvironmentVariable("COMPOSITOR_TEST_DIRECTORY");
        private string projectPath, pendingOpenPath, documentName = "Untitled";
        private bool dirty, closing, writing;
        private readonly Dictionary<string, string> projectPaths = new Dictionary<string, string>();
        private readonly HashSet<string> pendingOpenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, string> fingerprints = new Dictionary<string, string>();
        private readonly Timer watchTimer = new Timer { Interval = 1000 };
        private bool checkingChanges;
        private long saveGeneration;
        private readonly UiText ui = new UiText();
        private ToolStripMenuItem recentMenu;
        private readonly List<string> recentProjects = new List<string>();
        private static string RecentFile => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Compositor", "recent-projects.json");

        internal EditorWindow()
        {
            Text = "Compositor"; Width = 1380; Height = 900; MinimumSize = new Size(900, 620);
            StartPosition = FormStartPosition.CenterScreen; BackColor = Color.FromArgb(36, 36, 38);
            AutoScaleMode = AutoScaleMode.Dpi;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            try { if (!test && File.Exists(RecentFile)) recentProjects.AddRange(Json.Array(Json.Serializer().DeserializeObject(File.ReadAllText(RecentFile))).OfType<string>().Where(Directory.Exists).Take(20)); } catch (IOException) { } catch (ArgumentException) { }
            if (test) { ShowInTaskbar = false; Opacity = 0; }
            var menu = BuildMenu(); MainMenuStrip = menu;
            browser.Dock = DockStyle.Fill; browser.DefaultBackgroundColor = BackColor;
            Controls.Add(browser); Controls.Add(menu);
            Shown += async (_, __) => await Initialize();
            watchTimer.Tick += async (_, __) => await CheckProjectChanges(); watchTimer.Start();
            FormClosing += (_, args) =>
            {
                if (closing || !dirty) return;
                args.Cancel = true; Command("close");
            };
        }

        private MenuStrip BuildMenu()
        {
            var menu = new MenuStrip { BackColor = Color.FromArgb(44, 44, 46), ForeColor = Color.Gainsboro,
                Renderer = new ToolStripProfessionalRenderer(new EditorColors()) };
            ToolStripMenuItem Group(string name) { var item = new ToolStripMenuItem(name) { Tag = name }; menu.Items.Add(item); return item; }
            void Item(ToolStripMenuItem group, string name, string command, string shortcut = null)
            {
                var item = new ToolStripMenuItem(name) { Tag = name, ShortcutKeyDisplayString = shortcut, ForeColor = Color.Gainsboro };
                item.Click += (_, __) => Command(command); group.DropDownItems.Add(item);
            }
            var file = Group("&File");
            Item(file, "New Canvas…", "new", "Ctrl+N"); Item(file, "Open Project…", "open", "Ctrl+O"); Item(file, "Import Images…", "import", "Ctrl+I");
            recentMenu = new ToolStripMenuItem("Open Recent") { Tag = "Open Recent" }; file.DropDownItems.Add(recentMenu); RefreshRecent();
            file.DropDownItems.Add(new ToolStripSeparator()); Item(file, "Save", "save", "Ctrl+S"); Item(file, "Save As…", "save-as", "Ctrl+Shift+S");
            Item(file, "Export PNG…", "export-png", "Ctrl+Shift+E"); Item(file, "Export JPEG…", "export-jpeg", "Ctrl+Alt+Shift+S"); Item(file, "Export WebP…", "export-webp");
            Item(file, "New from Clipboard", "new-from-clipboard");
            file.DropDownItems.Add(new ToolStripSeparator()); var exit = new ToolStripMenuItem("Exit") { Tag = "Exit" }; exit.Click += (_, __) => Close(); file.DropDownItems.Add(exit);
            var edit = Group("&Edit"); Item(edit, "Undo", "undo", "Ctrl+Z"); Item(edit, "Redo", "redo", "Ctrl+Shift+Z");
            Item(edit, "Cut", "cut", "Ctrl+X"); Item(edit, "Copy", "copy", "Ctrl+C"); Item(edit, "Copy Merged", "copy-merged", "Ctrl+Shift+C"); Item(edit, "Paste", "paste", "Ctrl+V"); Item(edit, "Keyboard Shortcuts…", "keyboard-shortcuts");
            var layer = Group("&Layer"); Item(layer, "New Layer", "add-layer", "Ctrl+Shift+N"); Item(layer, "Duplicate Layer", "duplicate", "Ctrl+J");
            Item(layer, "Delete Layer", "delete-layer", "Delete"); Item(layer, "Flip Horizontal", "flip-x"); Item(layer, "Flip Vertical", "flip-y");
            var view = Group("&View"); Item(view, "Fit Canvas", "fit", "Ctrl+0"); Item(view, "Actual Pixels", "actual", "Ctrl+1");
            Item(view, "Zoom In", "zoom-in", "Ctrl++"); Item(view, "Zoom Out", "zoom-out", "Ctrl+-");
            return menu;
        }

        private async Task Initialize()
        {
            try
            {
                try { CoreWebView2Environment.GetAvailableBrowserVersionString(); }
                catch (WebView2RuntimeNotFoundException)
                {
                    if (!test && MessageBox.Show(this, "Microsoft Edge WebView2 Runtime is required. Open the Microsoft download page?", "Install WebView2",
                        MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                        Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/") { UseShellExecute = true });
                    closing = true; Close(); return;
                }
                string userData = test && !string.IsNullOrEmpty(testDirectory) ? Path.Combine(testDirectory, "profile") :
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Compositor", "WebView2");
                string arguments = null;
                if (test && int.TryParse(Environment.GetEnvironmentVariable("COMPOSITOR_TEST_PORT"), out var port) && port >= 1024 && port <= 65535)
                    arguments = "--remote-debugging-port=" + port + " --remote-debugging-address=127.0.0.1";
                var environment = await CoreWebView2Environment.CreateAsync(null, userData, new CoreWebView2EnvironmentOptions(arguments));
                await browser.EnsureCoreWebView2Async(environment);
                var core = browser.CoreWebView2;
                core.Settings.AreDefaultContextMenusEnabled = false; core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreHostObjectsAllowed = false; core.Settings.AreDevToolsEnabled = test;
                core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                core.SetVirtualHostNameToFolderMapping("compositor.local", Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "renderer"), CoreWebView2HostResourceAccessKind.DenyCors);
                core.NavigationStarting += (_, args) => { if (args.Uri != Page) args.Cancel = true; };
                core.NewWindowRequested += (_, args) => args.Handled = true;
                core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
                core.DownloadStarting += (_, args) => args.Cancel = true;
                core.WebMessageReceived += Receive;
                core.ProcessFailed += (_, args) => Program.Report(new InvalidOperationException("The image editor process stopped. " + args.ProcessFailedKind));
                core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += (_, args) =>
                {
                    var uri = new Uri(args.Request.Uri);
                    if ((uri.Scheme == "http" || uri.Scheme == "https") && uri.Host != "compositor.local")
                        args.Response = environment.CreateWebResourceResponse(new MemoryStream(), 403, "Blocked", "Content-Type: text/plain");
                };
                core.Navigate(Page);
            }
            catch (Exception error) { Program.Report(error); }
        }

        private void Command(string command) => browser.CoreWebView2?.PostWebMessageAsJson(Json.Stringify(new { command }));
        private void RefreshRecent()
        {
            if (recentMenu == null) return; recentMenu.DropDownItems.Clear();
            for (int i = 0; i < recentProjects.Count; i++) { int index = i; var item = new ToolStripMenuItem(Path.GetFileNameWithoutExtension(recentProjects[i])) { ForeColor = Color.Gainsboro }; item.Click += (_, __) => Command("open-recent:" + index); recentMenu.DropDownItems.Add(item); }
            var clear = new ToolStripMenuItem(ui.Get("Clear Recent Projects")) { Tag = "Clear Recent Projects", ForeColor = Color.Gainsboro }; clear.Click += (_, __) => { recentProjects.Clear(); PersistRecent(); RefreshRecent(); }; recentMenu.DropDownItems.Add(clear);
        }
        private void RememberRecent(string directory)
        {
            recentProjects.RemoveAll(path => path.Equals(directory, StringComparison.OrdinalIgnoreCase)); recentProjects.Insert(0, directory); if (recentProjects.Count > 20) recentProjects.RemoveRange(20, recentProjects.Count - 20); PersistRecent(); RefreshRecent();
        }
        private void PersistRecent()
        {
            if (test) return;
            try { Directory.CreateDirectory(Path.GetDirectoryName(RecentFile)); File.WriteAllText(RecentFile, Json.Stringify(recentProjects)); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }

        private static string Fingerprint(string directory)
        {
            using var hash = SHA256.Create();
            var manifest = File.ReadAllBytes(Path.Combine(directory, "manifest.json"));
            var images = Directory.Exists(Path.Combine(directory, "images")) ? Directory.GetFiles(Path.Combine(directory, "images"), "*.png").OrderBy(x => x, StringComparer.Ordinal).Select(x => Path.GetFileName(x) + ":" + new FileInfo(x).Length + ":" + File.GetLastWriteTimeUtc(x).Ticks) : Enumerable.Empty<string>();
            var suffix = Encoding.UTF8.GetBytes(string.Join("\n", images)); var bytes = new byte[manifest.Length + suffix.Length];
            Buffer.BlockCopy(manifest, 0, bytes, 0, manifest.Length); Buffer.BlockCopy(suffix, 0, bytes, manifest.Length, suffix.Length);
            return Convert.ToBase64String(hash.ComputeHash(bytes));
        }
        private async Task CheckProjectChanges()
        {
            if (checkingChanges || writing || browser.CoreWebView2 == null || closing) return; checkingChanges = true;
            try
            {
                foreach (var item in projectPaths.ToArray())
                {
                    try
                    {
                        var generation = saveGeneration;
                        var fingerprint = await Task.Run(() => Fingerprint(item.Value));
                        if (writing || generation != saveGeneration || !projectPaths.TryGetValue(item.Key, out var path) || path != item.Value) continue;
                        if (fingerprints.TryGetValue(item.Key, out var known) && known != fingerprint && !writing)
                        {
                            await Task.Run(() => ProjectStore.Read(item.Value));
                            if (writing || generation != saveGeneration || !projectPaths.ContainsKey(item.Key)) continue;
                            browser.CoreWebView2.PostWebMessageAsJson(Json.Stringify(new { command = "external-change", documentID = item.Key }));
                        }
                        fingerprints[item.Key] = fingerprint;
                    }
                    catch (IOException) { } catch (UnauthorizedAccessException) { } catch (ArgumentException) { }
                }
            }
            finally { checkingChanges = false; }
        }

        private async void Receive(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            if (args.Source != Page) return;
            Dictionary<string, object> request;
            try { request = Json.Parse(args.WebMessageAsJson); } catch { return; }
            var id = Json.Get(request, "id"); var channel = Json.Text(request, "channel");
            try
            {
                if (channel == "files:drop")
                {
                    var results = new List<object>();
                    foreach (var additional in args.AdditionalObjects)
                    {
                        if (!(additional is CoreWebView2File file) || string.IsNullOrEmpty(file.Path)) continue;
                        if (Directory.Exists(file.Path) && file.Path.EndsWith(".comp", StringComparison.OrdinalIgnoreCase))
                        {
                            var snapshot = await Task.Run(() => ProjectStore.Read(file.Path)); pendingOpenPaths.Add(file.Path);
                            results.Add(new { kind = "project", snapshot, path = file.Path, name = Path.GetFileNameWithoutExtension(file.Path) });
                        }
                        else results.Add(new { kind = "image", file = await Task.Run(() => ImageCodecs.Read(file.Path)) });
                    }
                    browser.CoreWebView2.PostWebMessageAsJson(Json.Stringify(new { id, ok = true, value = results })); return;
                }
                var values = Json.Array(Json.Get(request, "args") ?? new object[0]);
                var value = await Dispatch(channel, values);
                if (id != null && !IsDisposed) browser.CoreWebView2.PostWebMessageAsJson(Json.Stringify(new { id, ok = true, value }));
            }
            catch (Exception error)
            {
                if (id != null && !IsDisposed) browser.CoreWebView2.PostWebMessageAsJson(Json.Stringify(new { id, ok = false, error = error.Message }));
            }
        }

        private string TestPath(string key)
        {
            if (!test || string.IsNullOrEmpty(testDirectory)) return null;
            var config = Path.Combine(testDirectory, "dialogs.json");
            if (!File.Exists(config)) return null;
            var path = Json.Text(Json.Parse(File.ReadAllText(config)), key);
            if (path == null) return null;
            var full = Path.GetFullPath(path); var root = Path.GetFullPath(testDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Test dialog path is outside the test workspace.");
            return full;
        }

        private async Task<object> Dispatch(string channel, object[] values)
        {
            switch (channel)
            {
                case "settings:theme": {
                    var light = values[0] as string == "light";
                    BackColor = light ? Color.FromArgb(237, 237, 240) : Color.FromArgb(36, 36, 38);
                    browser.DefaultBackgroundColor = BackColor;
                    MainMenuStrip.BackColor = light ? Color.FromArgb(245, 245, 247) : Color.FromArgb(44, 44, 46);
                    MainMenuStrip.Renderer = new ToolStripProfessionalRenderer(new EditorColors(light));
                    void Paint(ToolStripItemCollection items) { foreach (ToolStripItem item in items) { item.ForeColor = light ? Color.FromArgb(37, 37, 41) : Color.Gainsboro; if (item is ToolStripMenuItem menu) Paint(menu.DropDownItems); } }
                    Paint(MainMenuStrip.Items); return null;
                }
                case "settings:language":
                    ui.Language = values.Length > 0 && values[0] as string == "zh-CN" ? "zh-CN" : "en";
                    ui.Apply(MainMenuStrip.Items); return null;
                case "project:close":
                {
                    var session = values[0] as string;
                    if (session != null) { projectPaths.Remove(session); fingerprints.Remove(session); }
                    return null;
                }
                case "document:limits": return new { documentPixels = ProjectStore.PixelBudget, surfacePixels = ProjectStore.SurfacePixels, maxSide = ProjectStore.MaximumSide };
                case "document:state":
                {
                    var state = Json.Map(values[0]); documentName = Json.Text(state, "name", "Untitled"); dirty = Json.True(state, "dirty");
                    var documentID = Json.Text(state, "sessionID") ?? Json.Text(state, "documentID");
                    projectPath = documentID != null && projectPaths.TryGetValue(documentID, out var existing) ? existing : null;
                    if (Json.True(state, "resetPath")) { projectPath = null; if (documentID != null) projectPaths.Remove(documentID); }
                    var opened = Json.Text(state, "openedPath");
                    if (opened != null && (opened == pendingOpenPath || pendingOpenPaths.Remove(opened))) { projectPath = opened; pendingOpenPath = null; if (documentID != null) { projectPaths[documentID] = opened; fingerprints[documentID] = await Task.Run(() => Fingerprint(opened)); } }
                    Text = (dirty ? "● " : "") + documentName + " — Compositor"; return null;
                }
                case "window:close": closing = true; Close(); return null;
                case "project:reload":
                {
                    var id = values[0] as string;
                    if (id == null || !projectPaths.TryGetValue(id, out var directory)) throw new InvalidOperationException("This project is not open.");
                    var snapshot = await Task.Run(() => ProjectStore.Read(directory)); fingerprints[id] = await Task.Run(() => Fingerprint(directory)); return snapshot;
                }
                case "clipboard:write":
                {
                    var data = values[0] as string;
                    if (data == null || !data.StartsWith("data:image/png;base64,", StringComparison.Ordinal)) throw new InvalidDataException("Invalid clipboard image.");
                    using var stream = new MemoryStream(Convert.FromBase64String(data.Substring(data.IndexOf(',') + 1)));
                    using var image = Image.FromStream(stream); using var copy = new Bitmap(image);
                    var content = new DataObject(); content.SetData(DataFormats.Bitmap, copy); content.SetData("PNG", false, stream);
                    stream.Position = 0; Clipboard.SetDataObject(content, true); return true;
                }
                case "clipboard:read":
                {
                    if (Clipboard.GetData("PNG") is MemoryStream png) return "data:image/png;base64," + Convert.ToBase64String(png.ToArray());
                    if (!Clipboard.ContainsImage()) return null;
                    using var image = Clipboard.GetImage(); using var stream = new MemoryStream(); image.Save(stream, ImageFormat.Png); return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
                }
                case "project:open":
                {
                    string directory = TestPath("open");
                    if (!test)
                    {
                        using var picker = new FolderBrowserDialog { Description = ui.Get("Select a Compositor .comp project folder"), ShowNewFolderButton = false };
                        if (picker.ShowDialog(this) != DialogResult.OK) return null; directory = picker.SelectedPath;
                    }
                    if (directory == null) return null;
                    var snapshot = await Task.Run(() => ProjectStore.Read(directory)); pendingOpenPath = directory; RememberRecent(directory);
                    return new { snapshot, path = directory, name = Path.GetFileNameWithoutExtension(directory) };
                }
                case "project:recent":
                {
                    var index = (int)Json.Number(values[0]); if (index < 0 || index >= recentProjects.Count) throw new InvalidOperationException("The recent project is no longer available.");
                    var directory = recentProjects[index]; var snapshot = await Task.Run(() => ProjectStore.Read(directory)); pendingOpenPaths.Add(directory); RememberRecent(directory);
                    return new { snapshot, path = directory, name = Path.GetFileNameWithoutExtension(directory) };
                }
                case "project:save":
                {
                    if (writing) throw new InvalidOperationException("A project is already being saved.");
                    var snapshot = Json.Map(values[0]); bool saveAs = values.Length > 1 && values[1] is bool flag && flag;
                    var id = values.Length > 2 && values[2] is string sessionID ? sessionID : Json.Text(Json.Map(Json.Get(snapshot, "manifest")), "documentID");
                    string destination = !saveAs && id != null && projectPaths.TryGetValue(id, out var savedPath) ? savedPath : null;
                    if (destination == null)
                    {
                        destination = TestPath("save");
                        if (!test)
                        {
                            using var picker = new SaveFileDialog { Title = ui.Get("Save Compositor Project"), FileName = documentName + ".comp", DefaultExt = "comp", Filter = ui.Get("Compositor project") + "|*.comp", AddExtension = true };
                            if (picker.ShowDialog(this) != DialogResult.OK) return null; destination = picker.FileName;
                        }
                    }
                    if (destination == null) return null;
                    if (!destination.EndsWith(".comp", StringComparison.OrdinalIgnoreCase)) destination += ".comp";
                    writing = true; saveGeneration++;
                    try { await Task.Run(() => ProjectStore.Write(destination, snapshot)); projectPath = destination; projectPaths[id] = destination; fingerprints[id] = await Task.Run(() => Fingerprint(destination)); }
                    finally { writing = false; saveGeneration++; }
                    RememberRecent(destination); return new { path = destination, name = Path.GetFileNameWithoutExtension(destination) };
                }
                case "images:import":
                {
                    var testFile = TestPath("open"); string[] filenames = testFile == null ? new string[0] : new[] { testFile };
                    if (!test)
                    {
                        using var picker = new OpenFileDialog { Title = ui.Get("Import Images"), Multiselect = true, Filter = ui.Get("Images and Photoshop projects") + "|*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.psd;*.psb;*.exr;*.tif;*.tiff;*.heic;*.heif;*.hif;*.svg;*.dng;*.cr2;*.cr3;*.crw;*.nef;*.nrw;*.arw;*.sr2;*.raf;*.orf;*.rw2;*.pef;*.3fr;*.fff;*.iiq;*.kdc;*.dcr;*.mos;*.mrw;*.raw;*.rwl;*.srw;*.x3f|" + ui.Get("All files") + "|*.*" };
                        if (picker.ShowDialog(this) != DialogResult.OK) return null; filenames = picker.FileNames;
                    }
                    return await Task.Run<object>(() =>
                    {
                        var images = new List<object>();
                        foreach (var filename in filenames)
                        {
                            images.Add(ImageCodecs.Read(filename));
                        }
                        return images;
                    });
                }
                case "image:export":
                {
                    var encoded = values[0] as string; var format = values[1] as string;
                    var resolution = values.Length > 2 ? Json.Number(values[2]) : 72;
                    if (resolution < 1 || resolution > 9600) throw new InvalidDataException("Invalid export resolution.");
                    if (!new[] { "png", "jpeg", "webp" }.Contains(format) || encoded == null || encoded.Length > 715827884 || !encoded.StartsWith("data:image/" + format + ";base64,", StringComparison.Ordinal))
                        throw new InvalidDataException("Invalid export image.");
                    var extension = format == "jpeg" ? "jpg" : format; var destination = TestPath("save");
                    if (!test)
                    {
                        using var picker = new SaveFileDialog { Title = ui.Get("Export Image"), FileName = documentName + "." + extension, DefaultExt = extension, Filter = extension.ToUpperInvariant() + " " + ui.Get("Image") + "|*." + extension, AddExtension = true };
                        if (picker.ShowDialog(this) != DialogResult.OK) return null; destination = picker.FileName;
                    }
                    if (destination == null) return null;
                    await Task.Run(() =>
                    {
                        var bytes = ImageMetadata.WithResolution(Convert.FromBase64String(encoded.Substring(encoded.IndexOf(',') + 1)), format, resolution);
                        var temporary = Path.Combine(Path.GetDirectoryName(destination), ".compositor-export-" + Guid.NewGuid().ToString("N"));
                        try { File.WriteAllBytes(temporary, bytes); if (File.Exists(destination)) File.Replace(temporary, destination, null); else File.Move(temporary, destination); }
                        finally { if (File.Exists(temporary)) File.Delete(temporary); }
                    });
                    return destination;
                }
                case "fonts:list": {
                    using var fonts = new System.Drawing.Text.InstalledFontCollection(); return fonts.Families.Select(font => font.Name).OrderBy(name => name, StringComparer.CurrentCultureIgnoreCase).ToArray();
                }
                case "color:profiles": {
                    var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "spool", "drivers", "color");
                    return Directory.Exists(root) ? Directory.GetFiles(root).Where(file => new[] { ".icc", ".icm" }.Contains(Path.GetExtension(file).ToLowerInvariant())).Select(file => new { id = Path.GetFileName(file), name = Path.GetFileNameWithoutExtension(file) }).ToArray() : (object)new object[0];
                }
                case "color:profile": {
                    var name = values[0] as string;
                    if (string.IsNullOrEmpty(name) || name != Path.GetFileName(name) || !new[] { ".icc", ".icm" }.Contains(Path.GetExtension(name).ToLowerInvariant())) throw new InvalidDataException("Invalid color profile name.");
                    var root = Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "spool", "drivers", "color")); var path = Path.GetFullPath(Path.Combine(root, name));
                    if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0 || new FileInfo(path).Length > 16 * 1024 * 1024) throw new InvalidDataException("Invalid color profile.");
                    return Convert.ToBase64String(await Task.Run(() => File.ReadAllBytes(path)));
                }
                case "file:export": {
                    var encoded = values[0] as string; var format = values[1] as string;
                    if (!new[] { "psd", "psb", "tiff", "exr", "icc", "zip", "ora" }.Contains(format) || encoded == null || encoded.Length > 715827884) throw new InvalidDataException("Invalid export file.");
                    var bytes = Convert.FromBase64String(encoded);
                    if (bytes.Length < 4) throw new InvalidDataException("Invalid export file.");
                    if ((format == "psd" || format == "psb") && Encoding.ASCII.GetString(bytes, 0, 4) != "8BPS") throw new InvalidDataException("Invalid Photoshop document.");
                    if (format == "exr" && (bytes.Length < 16 || BitConverter.ToUInt32(bytes, 0) != 20000630)) throw new InvalidDataException("Invalid OpenEXR document.");
                    var destination = TestPath("save");
                    if (!test) {
                        var name = values.Length > 2 ? values[2] as string : documentName;
                        foreach (var character in Path.GetInvalidFileNameChars()) name = (name ?? "Image").Replace(character, '_');
                        using var picker = new SaveFileDialog { Title = ui.Get("Export Image"), FileName = name + "." + format, DefaultExt = format, Filter = format.ToUpperInvariant() + "|*." + format, AddExtension = true };
                        if (picker.ShowDialog(this) != DialogResult.OK) return null; destination = picker.FileName;
                    }
                    if (destination == null) return null;
                    await Task.Run(() => {
                        var temporary = Path.Combine(Path.GetDirectoryName(destination), ".compositor-export-" + Guid.NewGuid().ToString("N"));
                        try { File.WriteAllBytes(temporary, bytes); if (File.Exists(destination)) File.Replace(temporary, destination, null); else File.Move(temporary, destination); }
                        finally { if (File.Exists(temporary)) File.Delete(temporary); }
                    }); return destination;
                }
                default: throw new InvalidOperationException("Unknown editor command.");
            }
        }

        [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
        protected override void OnHandleCreated(EventArgs args)
        {
            base.OnHandleCreated(args);
            int dark = 1;
            if (DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int)) != 0) DwmSetWindowAttribute(Handle, 19, ref dark, sizeof(int));
        }
        protected override void Dispose(bool disposing) { if (disposing) { watchTimer.Dispose(); browser.Dispose(); } base.Dispose(disposing); }
    }

    internal sealed class EditorColors : ProfessionalColorTable
    {
        private readonly bool light;
        internal EditorColors(bool light = false) { this.light = light; }
        private Color Panel => light ? Color.FromArgb(245, 245, 247) : Color.FromArgb(44, 44, 46);
        private Color Selected => light ? Color.FromArgb(220, 234, 255) : Color.FromArgb(70, 70, 73);
        public override Color ToolStripDropDownBackground => Panel;
        public override Color ImageMarginGradientBegin => Panel;
        public override Color ImageMarginGradientMiddle => Panel;
        public override Color ImageMarginGradientEnd => Panel;
        public override Color MenuStripGradientBegin => Panel;
        public override Color MenuStripGradientEnd => Panel;
        public override Color MenuItemSelected => Selected;
        public override Color MenuItemSelectedGradientBegin => Selected;
        public override Color MenuItemSelectedGradientEnd => Selected;
        public override Color MenuItemPressedGradientBegin => Selected;
        public override Color MenuItemPressedGradientMiddle => Selected;
        public override Color MenuItemPressedGradientEnd => Selected;
        public override Color MenuBorder => Color.FromArgb(78, 78, 82);
        public override Color MenuItemBorder => Selected;
    }
}
