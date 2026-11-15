using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace EgodactRemoteTray;

public sealed class MainForm : Form
{
    private static readonly Color Bg = Color.FromArgb(33, 33, 33);

    private readonly NotifyIcon _tray;
    private readonly ContextMenuStrip _trayMenu;
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Bg };
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly System.Windows.Forms.Timer _timer;

    private Process? _agentProcess;
    private bool _allowExit;
    private bool _busy;
    private bool _uiReady;
    private readonly Icon _appIcon;

    private string BaseDir => AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    private string DataDir => Path.Combine(BaseDir, "data");
    private string TokenPath => Path.Combine(DataDir, "token.txt");
    private string PublicUrlPath => Path.Combine(DataDir, "public-url.txt");
    private string UiPath => ResolveUiPath();

    public MainForm()
    {
        Text = "Egodact Remote";
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96F, 96F);
        MinimumSize = new Size(760, 560);
        Size = new Size(860, 640);
        BackColor = Bg;
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 10f, FontStyle.Regular);

        _appIcon = LoadAppIcon();
        Icon = _appIcon;

        Controls.Add(_web);

        _trayMenu = new ContextMenuStrip { Renderer = new ToolStripProfessionalRenderer(new DarkColors()), ShowImageMargin = false };
        _trayMenu.Items.Add(MakeMenuItem("Openen", (_, _) => ShowFromTray()));
        _trayMenu.Items.Add(MakeMenuItem("Start agent", async (_, _) => await StartAgentAsync()));
        _trayMenu.Items.Add(MakeMenuItem("Stop agent", async (_, _) => await StopAgentAsync()));
        _trayMenu.Items.Add(MakeMenuItem("Kopieer link", (_, _) => CopyBestLink()));
        _trayMenu.Items.Add(MakeMenuItem("Open link", (_, _) => OpenBestLink()));
        _trayMenu.Items.Add(new ToolStripSeparator());
        _trayMenu.Items.Add(MakeMenuItem("Afsluiten (agent stoppen)", (_, _) => ExitApp()));

        _tray = new NotifyIcon { Icon = _appIcon, Visible = true, Text = "Egodact Remote", ContextMenuStrip = _trayMenu };
        _tray.DoubleClick += (_, _) => ShowFromTray();

        _timer = new System.Windows.Forms.Timer { Interval = 3000 };
        _timer.Tick += (_, _) => RefreshStateAsync();

        Load += async (_, _) => await InitWebViewAsync();
        FormClosing += OnFormClosing;
        Resize += (_, _) => { if (WindowState == FormWindowState.Minimized) HideToTray(); };
    }

    private async Task InitWebViewAsync()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync();
            await _web.EnsureCoreWebView2Async(env);
            _web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            _web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            _web.CoreWebView2.WebMessageReceived += (_, e) => HandleWebMessage(e.TryGetWebMessageAsString());
            if (File.Exists(UiPath))
            {
                _web.Source = new Uri(UiPath);
            }
            else
            {
                _web.NavigateToString("<html><body style='background:#212121;color:#fff;font-family:Segoe UI;padding:20px'>UI-bestand (tray-ui.html) niet gevonden in " + System.Net.WebUtility.HtmlEncode(BaseDir) + "</body></html>");
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Kon WebView2 niet starten: " + ex.Message + "\n\nInstalleer de Microsoft Edge WebView2 Runtime als deze ontbreekt.", "Egodact Remote", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        _timer.Start();
        RefreshStateAsync();
    }

    private async void HandleWebMessage(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
            switch (type)
            {
                case "ready":
                    _uiReady = true;
                    await PushStateAsync();
                    break;
                case "refresh":
                    RefreshStateAsync();
                    break;
                case "toggle":
                    await ToggleAgentAsync();
                    break;
                case "open":
                    OpenBestLink();
                    break;
                case "copy":
                    if (root.TryGetProperty("text", out var txt)) CopyText(txt.GetString());
                    break;
                case "folder":
                    OpenBaseDir();
                    break;
                case "autostart":
                    if (root.TryGetProperty("value", out var v)) await SetAutoStartAsync(v.ValueKind == JsonValueKind.True || (v.ValueKind == JsonValueKind.String && bool.TryParse(v.GetString(), out var b) && b) || (v.ValueKind != JsonValueKind.False && v.ValueKind != JsonValueKind.String && v.GetBoolean()));
                    break;
            }
        }
        catch { }
    }

    private static ToolStripMenuItem MakeMenuItem(string text, EventHandler onClick)
        => new(text, null, onClick) { ForeColor = Color.White, BackColor = Color.FromArgb(43, 43, 43) };

    private Icon LoadAppIcon()
    {
        foreach (var p in new[] { Path.Combine(BaseDir, "app.ico"), Path.Combine(BaseDir, "tray-app", "app.ico") })
        {
            try
            {
                if (!File.Exists(p)) continue;
                try { return new Icon(p, new Size(32, 32)); } catch { }
                try { return new Icon(p, new Size(256, 256)); } catch { }
                return new Icon(p);
            }
            catch { }
        }
        return SystemIcons.Shield;
    }

    public void ShowFromTrayPublic()
    {
        try
        {
            if (InvokeRequired) { BeginInvoke(new Action(ShowFromTrayPublic)); return; }
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
            RefreshStateAsync();
        }
        catch { }
    }

    private void ShowFromTray() => ShowFromTrayPublic();
    private void HideToTray() { Hide(); try { _tray.ShowBalloonTip(1200, "Egodact Remote", "Draait verder op de achtergrond (systeemvak).", ToolTipIcon.Info); } catch { } }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_allowExit) return;
        if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; HideToTray(); }
    }

    private async void ExitApp()
    {
        _allowExit = true;
        await StopAgentAsync();
        _tray.Visible = false;
        Application.Exit();
    }

    private async void RefreshStateAsync() => await PushStateAsync();

    private async Task PushStateAsync()
    {
        if (_busy) { return; }
        bool running = await IsAgentRunningAsync();
        string token = ReadToken();
        string publicUrl = ReadPublicUrl();
        string localUrl = BuildLocalUrl(token);
        try { _tray.Text = running ? "Egodact Remote (actief)" : "Egodact Remote (gestopt)"; } catch { }

        if (!_uiReady || _web.CoreWebView2 == null) return;
        var state = new
        {
            running,
            token,
            publicUrl = !string.IsNullOrWhiteSpace(publicUrl) ? publicUrl : localUrl,
            localUrl,
            autostart = IsAutoStartEnabled()
        };
        var msg = JsonSerializer.Serialize(new { type = "state", state });
        try { _web.CoreWebView2.PostWebMessageAsString(msg); } catch { }
    }

    private async Task ToggleAgentAsync()
    {
        if (await IsAgentRunningAsync()) await StopAgentAsync();
        else await StartAgentAsync();
        await Task.Delay(1000);
        await PushStateAsync();
    }

    private async Task StartAgentAsync()
    {
        if (_busy) return;
        _busy = true;
        try
        {
            if (await IsAgentRunningAsync()) return;
            var (file, args, workdir) = ResolveAgentCommand("--anywhere");
            if (file == null)
            {
                MessageBox.Show(this, "Kon geen agent vinden. Plaats deze app in dezelfde map als EgodactRemote.exe of als de map met agent\\main.js.",
                    "Egodact Remote", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            var psi = new ProcessStartInfo { FileName = file, Arguments = args, WorkingDirectory = workdir, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
            _agentProcess = Process.Start(psi);
        }
        catch (Exception ex) { MessageBox.Show(this, "Starten mislukt: " + ex.Message, "Egodact Remote", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        finally { _busy = false; await PushStateAsync(); }
    }

    private async Task StopAgentAsync()
    {
        if (_busy) return;
        _busy = true;
        try
        {
            if (IsOwnedProcessAlive())
            {
                try { _agentProcess!.Kill(entireProcessTree: true); } catch { try { _agentProcess!.Kill(); } catch { } }
            }
            _agentProcess = null;
            KillPortListeners(8787);
            await Task.Delay(700);
            if (await IsAgentRunningAsync()) { KillPortListeners(8787); await Task.Delay(700); }
        }
        catch { }
        finally { _busy = false; await PushStateAsync(); }
    }

    private static void KillPortListeners(int port)
    {
        foreach (var pid in GetListeningPids(port))
        {
            try
            {
                if (pid <= 0 || pid == Environment.ProcessId) continue;
                var psi = new ProcessStartInfo("taskkill", "/PID " + pid + " /T /F") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
                using var p = Process.Start(psi);
                p?.WaitForExit(4000);
            }
            catch { }
        }
    }

    private static HashSet<int> GetListeningPids(int port)
    {
        var pids = new HashSet<int>();
        try
        {
            var psi = new ProcessStartInfo("powershell.exe", "-NoProfile -Command \"Get-NetTCPConnection -LocalPort " + port + " -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess\"")
            { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            using var p = Process.Start(psi);
            if (p != null)
            {
                string outp = p.StandardOutput.ReadToEnd();
                p.WaitForExit(4000);
                foreach (Match m in Regex.Matches(outp, "\\d+")) if (int.TryParse(m.Value, out var id)) pids.Add(id);
                if (pids.Count > 0) return pids;
            }
        }
        catch { }
        try
        {
            var psi = new ProcessStartInfo("netstat", "-ano -p tcp") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            using var p = Process.Start(psi);
            if (p != null)
            {
                string outp = p.StandardOutput.ReadToEnd();
                p.WaitForExit(4000);
                foreach (var line in outp.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    if (line.IndexOf("LISTENING", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    if (!Regex.IsMatch(line, $@":{port}\s")) continue;
                    var parts = Regex.Split(line.Trim(), "\\s+");
                    if (parts.Length > 0 && int.TryParse(parts[^1], out var id)) pids.Add(id);
                }
            }
        }
        catch { }
        return pids;
    }

    private (string? file, string args, string workdir) ResolveAgentCommand(string extraArgs)
    {
        string exe = Path.Combine(BaseDir, "EgodactRemote.exe");
        if (File.Exists(exe)) return (exe, extraArgs, BaseDir);
        string mainJs = Path.Combine(BaseDir, "agent", "main.js");
        if (File.Exists(mainJs)) return ("node", Quote(mainJs) + " " + extraArgs, BaseDir);
        string repoMain = Path.GetFullPath(Path.Combine(BaseDir, "..", "..", "..", "agent", "main.js"));
        if (File.Exists(repoMain))
        {
            var root = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(repoMain)!, ".."));
            return ("node", Quote(repoMain) + " " + extraArgs, root);
        }
        return (null, "", BaseDir);
    }

    private string ResolveUiPath()
    {
        foreach (var p in new[] { Path.Combine(BaseDir, "tray-ui.html"), Path.Combine(BaseDir, "tray-app", "tray-ui.html") })
            if (File.Exists(p)) return p;
        return Path.Combine(BaseDir, "tray-ui.html");
    }

    private static string Quote(string s) => "\"" + s + "\"";
    private bool IsOwnedProcessAlive() { try { return _agentProcess != null && !_agentProcess.HasExited; } catch { return false; } }

    private async Task<bool> IsAgentRunningAsync()
    {
        try { using var res = await _http.GetAsync("http://127.0.0.1:8787/api/ping"); return res.IsSuccessStatusCode; }
        catch { return false; }
    }

    private string ReadToken() { try { if (File.Exists(TokenPath)) return File.ReadAllText(TokenPath).Trim(); } catch { } return ""; }
    private string ReadPublicUrl() { try { if (File.Exists(PublicUrlPath)) return File.ReadAllText(PublicUrlPath).Trim(); } catch { } return ""; }

    private string BuildLocalUrl(string token)
    {
        string host = "127.0.0.1";
        try
        {
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                {
                    if (ua.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ua.Address)) { host = ua.Address.ToString(); goto found; }
                }
            }
        }
        catch { }
    found:
        string t = string.IsNullOrWhiteSpace(token) ? ReadToken() : token;
        return "http://" + host + ":8787/?t=" + t;
    }

    private string BestLink() { var pub = ReadPublicUrl(); return !string.IsNullOrWhiteSpace(pub) ? pub : BuildLocalUrl(ReadToken()); }
    private void CopyBestLink() => CopyText(BestLink());
    private void OpenBestLink() { var url = BestLink(); if (string.IsNullOrWhiteSpace(url)) return; try { Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true }); } catch { } }
    private void CopyText(string? text) { if (string.IsNullOrWhiteSpace(text)) return; try { Clipboard.SetText(text); } catch { } }
    private void OpenBaseDir() { try { Process.Start(new ProcessStartInfo { FileName = BaseDir, UseShellExecute = true }); } catch { } }

    private bool IsAutoStartEnabled()
    {
        string startup = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Egodact Remote.lnk");
        if (File.Exists(startup)) return true;
        try
        {
            var psi = new ProcessStartInfo("schtasks", "/Query /TN \"Egodact Remote\"") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            using var p = Process.Start(psi); p?.WaitForExit(3000); return p != null && p.ExitCode == 0;
        }
        catch { return false; }
    }

    private async Task SetAutoStartAsync(bool enable)
    {
        try
        {
            var (file, baseArgs, workdir) = ResolveAgentCommand("");
            if (file == null) { MessageBox.Show(this, "Agent niet gevonden; kan autostart niet instellen.", "Egodact Remote", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            string installArg = enable ? "--install-startup" : "--uninstall-startup";
            var psi = new ProcessStartInfo { FileName = file, Arguments = baseArgs.TrimEnd() + " " + installArg, WorkingDirectory = workdir, UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi); p?.WaitForExit(8000);
        }
        catch (Exception ex) { MessageBox.Show(this, "Autostart wijzigen mislukt: " + ex.Message, "Egodact Remote", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        await Task.Delay(300);
        await PushStateAsync();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { _timer.Dispose(); _tray.Dispose(); _trayMenu.Dispose(); _http.Dispose(); _appIcon.Dispose(); _web.Dispose(); }
        base.Dispose(disposing);
    }

    private sealed class DarkColors : ProfessionalColorTable
    {
        public override Color MenuItemSelected => Color.FromArgb(60, 60, 60);
        public override Color MenuItemSelectedGradientBegin => Color.FromArgb(60, 60, 60);
        public override Color MenuItemSelectedGradientEnd => Color.FromArgb(60, 60, 60);
        public override Color MenuItemBorder => Color.FromArgb(68, 68, 68);
        public override Color MenuBorder => Color.FromArgb(68, 68, 68);
        public override Color ToolStripDropDownBackground => Color.FromArgb(43, 43, 43);
        public override Color ImageMarginGradientBegin => Color.FromArgb(43, 43, 43);
        public override Color ImageMarginGradientMiddle => Color.FromArgb(43, 43, 43);
        public override Color ImageMarginGradientEnd => Color.FromArgb(43, 43, 43);
        public override Color SeparatorDark => Color.FromArgb(68, 68, 68);
        public override Color SeparatorLight => Color.FromArgb(68, 68, 68);
    }
}
