using System.Runtime.InteropServices;

namespace EgodactRemoteTray;

static class Program
{
    private const string MutexName = "Local\\EgodactRemoteTray.Singleton";
    private const string ShowEventName = "Local\\EgodactRemoteTray.Show";

    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);

    [STAThread]
    static void Main()
    {
        using var mutex = new Mutex(true, MutexName, out bool createdNew);
        if (!createdNew)
        {
            try
            {
                using var ev = EventWaitHandle.OpenExisting(ShowEventName);
                ev.Set();
            }
            catch
            {
                // fallback: try to find and show existing window
                foreach (var p in System.Diagnostics.Process.GetProcessesByName("EgodactRemoteTray"))
                {
                    if (p.Id == Environment.ProcessId) continue;
                    try
                    {
                        var h = p.MainWindowHandle;
                        if (h != IntPtr.Zero)
                        {
                            if (IsIconic(h)) ShowWindow(h, 9);
                            ShowWindow(h, 5);
                            SetForegroundWindow(h);
                        }
                    }
                    catch { }
                }
            }
            return;
        }

        using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        ApplicationConfiguration.Initialize();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);

        var form = new MainForm();
        StartShowListener(showEvent, form);
        Application.Run(form);
    }

    private static void StartShowListener(EventWaitHandle ev, MainForm form)
    {
        var thread = new Thread(() =>
        {
            while (true)
            {
                try
                {
                    ev.WaitOne();
                    if (form.IsDisposed) break;
                    try { form.BeginInvoke(new Action(form.ShowFromTrayPublic)); } catch { break; }
                }
                catch { break; }
            }
        }) { IsBackground = true };
        thread.Start();
    }
}
