using System;
using System.IO;
using System.Windows.Forms;

namespace Compositor.Windows
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length >= 2 && args[0] == "--validate-project")
            {
                try { ProjectStore.Read(args[1]); return 0; }
                catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (_, eventArgs) => Report(eventArgs.Exception);
            try { Application.Run(new EditorWindow()); return 0; }
            catch (Exception error) { Report(error); return 1; }
        }

        internal static void Report(Exception error)
        {
            var text = error.ToString();
            if (Environment.GetEnvironmentVariable("COMPOSITOR_TEST") == "1")
            {
                var directory = Environment.GetEnvironmentVariable("COMPOSITOR_TEST_DIRECTORY");
                if (!string.IsNullOrEmpty(directory)) File.AppendAllText(Path.Combine(directory, "host-error.log"), text + Environment.NewLine);
                Application.Exit();
            }
            else MessageBox.Show(error.Message, "Compositor", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
