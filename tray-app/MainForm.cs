using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.RegularExpressions;

namespace EgodactRemoteTray;

public sealed class MainForm : Form
{
    private static readonly Color Bg = Color.FromArgb(33, 33, 33);
    private static readonly Color PanelBg = Color.FromArgb(43, 43, 43);
    private static readonly Color FieldBg = Color.FromArgb(46, 46, 46);
    private static readonly Color BorderCol = Color.FromArgb(68, 68, 68);
    private static readonly Color TextCol = Color.FromArgb(245, 245, 245);
    private static readonly Color Muted = Color.FromArgb(176, 176, 176);
    private static readonly Color Accent = Color.FromArgb(144, 202, 249);
    private static readonly Color AccentText = Color.FromArgb(13, 71, 161);
    private static readonly Color Good = Color.FromArgb(102, 187, 106);
    private static readonly Color Bad = Color.FromArgb(239, 83, 80);

    private readonly NotifyIcon _tray;
    private readonly ContextMenuStrip _trayMenu;
    private readonly Label _statusDot;
    private readonly Label _statusLabel;
    private readonly Label _detailLabel;
    private readonly TextBox _publicUrlBox;
    private readonly TextBox _localUrlBox;
    private readonly TextBox _tokenBox;
    private readonly Button _toggleButton;
    private readonly CheckBox _autoStartBox;

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly System.Windows.Forms.Timer _timer;

    private Process? _agentProcess;
    private bool _allowExit;
    private bool _suppressAutoStartEvent;
    private bool _busy;

    private string BaseDir => AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    private string DataDir => Path.Combine(BaseDir, "data");
    private string TokenPath => Path.Combine(DataDir, "token.txt");
    private string PublicUrlPath => Path.Combine(DataDir, "public-url.txt");
    private readonly Icon _appIcon;

    public MainForm()
    {
        Text = "Egodact Remote";
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96F, 96F);
        MinimumSize = new Size(720, 540);
        Size = new Size(780, 580);
        BackColor = Bg;
        ForeColor = TextCol;
        Font = new Font("Segoe UI", 10f, FontStyle.Regular);

        _appIcon = LoadAppIcon();
        Icon = _appIcon;

        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 5,
            Padding = new Padding(20),
            BackColor = Bg,
        };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var header = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 3, BackColor = Bg, Margin = new Padding(0, 0, 0, 14) };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _statusDot = new Label { Text = "\u25CF", AutoSize = true, Font = new Font("Segoe UI", 14f), ForeColor = Muted, Margin = new Padding(0, 2, 8, 0) };
        var titleStack = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false, Margin = new Padding(0) };
        var title = new Label { Text = "Egodact Remote", AutoSize = true, Font = new Font("Segoe UI Semibold", 16f), ForeColor = TextCol, Margin = new Padding(0) };
        _statusLabel = new Label { Text = "Status controleren...", AutoSize = true, ForeColor = Muted, Margin = new Padding(0, 2, 0, 0) };
        titleStack.Controls.Add(title);
        titleStack.Controls.Add(_statusLabel);
        var version = new Label { Text = "v1.1.0", AutoSize = true, ForeColor = Muted, Anchor = AnchorStyles.Right, Margin = new Padding(0, 6, 0, 0) };
        header.Controls.Add(_statusDot, 0, 0);
        header.Controls.Add(titleStack, 1, 0);
        header.Controls.Add(version, 2, 0);

        _detailLabel = new Label { Dock = DockStyle.Top, AutoSize = true, ForeColor = Muted, Margin = new Padding(0, 0, 0, 12), MaximumSize = new Size(700, 0), Text = " " };

        var actionsCard = MakeCard();
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, WrapContents = true, BackColor = PanelBg, Padding = new Padding(4) };
        _toggleButton = MakePrimaryButton("Starten");
        _toggleButton.Click += async (_, _) => await ToggleAgentAsync();
        var refreshBtn = MakeSecondaryButton("Vernieuwen");
        refreshBtn.Click += (_, _) => RefreshStateAsync();
        var openBtn = MakeSecondaryButton("Open link");
        openBtn.Click += (_, _) => OpenBestLink();
        var copyBtn = MakeSecondaryButton("Kopieer link");
        copyBtn.Click += (_, _) => CopyBestLink();
        var folderBtn = MakeSecondaryButton("Open map");
        folderBtn.Click += (_, _) => OpenBaseDir();
        _autoStartBox = new CheckBox { Text = "Automatisch starten bij Windows-login", AutoSize = true, ForeColor = TextCol, BackColor = PanelBg, Margin = new Padding(10, 10, 0, 0) };
        _autoStartBox.CheckedChanged += (_, _) => OnAutoStartChanged();
        actions.Controls.AddRange(new Control[] { _toggleButton, refreshBtn, openBtn, copyBtn, folderBtn, _autoStartBox });
        actionsCard.Controls.Add(actions);

        var linksCard = MakeCard();
        var links = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, ColumnCount = 1, BackColor = PanelBg, Padding = new Padding(4) };
        _publicUrlBox = MakeFieldRow("Telefoon-link (plak in app of open op telefoon)", out var publicRow);
        _localUrlBox = MakeFieldRow("Lokale link (zelfde netwerk)", out var localRow);
        _tokenBox = MakeFieldRow("Token / companion", out var tokenRow);
        links.Controls.Add(publicRow);
        links.Controls.Add(localRow);
        links.Controls.Add(tokenRow);
        linksCard.Controls.Add(links);

        var hint = new Label
        {
            Dock = DockStyle.Fill,
            AutoSize = false,
            ForeColor = Muted,
            Padding = new Padding(2, 10, 2, 0),
            Text = "Sluiten verbergt naar het systeemvak (verborgen pictogrammen) - agent blijft draaien. " +
                   "Stop zet de agent uit. Vaste Tailscale-link: " +
                   "https://desktop-8smivkr.tailef0899.ts.net/?t=<token> " +
                   "(tailscale serve --bg --https=443 http://127.0.0.1:8787). " +
                   "Companion-extensie in Chrome moet dezelfde token hebben."
        };

        root.Controls.Add(header, 0, 0);
        root.Controls.Add(_detailLabel, 0, 1);
        root.Controls.Add(actionsCard, 0, 2);
        root.Controls.Add(linksCard, 0, 3);
        root.Controls.Add(hint, 0, 4);
        Controls.Add(root);

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
        _timer.Start();

        Load += (_, _) => RefreshStateAsync();
        FormClosing += OnFormClosing;
        Resize += (_, _) => { if (WindowState == FormWindowState.Minimized) HideToTray(); };
    }

    private static ToolStripMenuItem MakeMenuItem(string text, EventHandler onClick)
    {
        return new ToolStripMenuItem(text, null, onClick) { ForeColor = TextCol, BackColor = PanelBg };
    }

    private Icon LoadAppIcon()
    {
        foreach (var p in new[] { Path.Combine(BaseDir, "app.ico"), Path.Combine(BaseDir, "tray-app", "app.ico") })
        {
            try
            {
                if (!File.Exists(p)) continue;
                try { return new Icon(p, new Size(32, 32)); } catch { }
                return new Icon(p);
            }
            catch { }
        }
        return SystemIcons.Shield;
    }
    private static Panel MakeCard()
    {
        var p = new Panel { Dock = DockStyle.Top, AutoSize = true, BackColor = PanelBg, Padding = new Padding(12), Margin = new Padding(0, 0, 0, 12) };
        p.Paint += (_, e) => { using var pen = new Pen(BorderCol); e.Graphics.DrawRectangle(pen, 0, 0, p.Width - 1, p.Height - 1); };
        return p;
    }

    private static Button MakePrimaryButton(string text)
    {
        var b = new Button { Text = text, AutoSize = true, MinimumSize = new Size(120, 36), FlatStyle = FlatStyle.Flat, BackColor = Accent, ForeColor = AccentText, Margin = new Padding(4), Cursor = Cursors.Hand };
        b.FlatAppearance.BorderSize = 0;
        b.Font = new Font("Segoe UI Semibold", 9.5f);
        return b;
    }

    private static Button MakeSecondaryButton(string text)
    {
        var b = new Button { Text = text, AutoSize = true, MinimumSize = new Size(110, 36), FlatStyle = FlatStyle.Flat, BackColor = FieldBg, ForeColor = TextCol, Margin = new Padding(4), Cursor = Cursors.Hand };
        b.FlatAppearance.BorderColor = BorderCol;
        b.FlatAppearance.BorderSize = 1;
        return b;
    }

    private TextBox MakeFieldRow(string label, out TableLayoutPanel row)
    {
        row = new TableLayoutPanel { Dock = DockStyle.Top, ColumnCount = 3, AutoSize = true, BackColor = PanelBg, Margin = new Padding(0, 4, 0, 4) };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 300));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var lbl = new Label { Text = label, AutoSize = true, ForeColor = Muted, Anchor = AnchorStyles.Left, Margin = new Padding(0, 8, 8, 0) };
        var box = new TextBox { Dock = DockStyle.Fill, ReadOnly = true, BackColor = FieldBg, ForeColor = TextCol, BorderStyle = BorderStyle.FixedSingle };
        var copy = MakeSecondaryButton("Kopieer");
        copy.MinimumSize = new Size(90, 32);
        copy.Margin = new Padding(6, 0, 0, 0);
        copy.Click += (_, _) => CopyText(box.Text);
        row.Controls.Add(lbl, 0, 0);
        row.Controls.Add(box, 1, 0);
        row.Controls.Add(copy, 2, 0);
        return box;
    }

    public void ShowFromTrayPublic() { try { if (InvokeRequired) { BeginInvoke(new Action(ShowFromTrayPublic)); return; } Show(); WindowState = FormWindowState.Normal; Activate(); RefreshStateAsync(); } catch { } }
    private void ShowFromTray() { ShowFromTrayPublic(); }
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

    private async void RefreshStateAsync()
    {
        if (_busy) return;
        bool running = await IsAgentRunningAsync();
        string token = ReadToken();
        string publicUrl = ReadPublicUrl();
        string localUrl = BuildLocalUrl(token);

        _statusDot.ForeColor = running ? Good : Bad;
        _statusLabel.Text = running ? "Actief - bereikbaar" : "Gestopt";
        _statusLabel.ForeColor = running ? Good : Bad;
        _detailLabel.Text = running
            ? "Agent luistert op poort 8787. Open de link op je telefoon (zelfde wifi of via Tailscale)."
            : "Agent draait niet. Klik op Starten om hem te activeren.";

        _toggleButton.Text = running ? "Stoppen" : "Starten";
        _toggleButton.BackColor = running ? Color.FromArgb(120, 40, 40) : Accent;
        _toggleButton.ForeColor = running ? TextCol : AccentText;

        _publicUrlBox.Text = !string.IsNullOrWhiteSpace(publicUrl) ? publicUrl : localUrl;
        _localUrlBox.Text = localUrl;
        _tokenBox.Text = token;

        _suppressAutoStartEvent = true;
        try { _autoStartBox.Checked = IsAutoStartEnabled(); } finally { _suppressAutoStartEvent = false; }
        try { _tray.Text = running ? "Egodact Remote (actief)" : "Egodact Remote (gestopt)"; } catch { }
    }

    private async Task ToggleAgentAsync()
    {
        if (await IsAgentRunningAsync()) await StopAgentAsync();
        else await StartAgentAsync();
        await Task.Delay(1000);
        RefreshStateAsync();
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
            _statusLabel.Text = "Starten..."; _statusLabel.ForeColor = Muted;
        }
        catch (Exception ex) { MessageBox.Show(this, "Starten mislukt: " + ex.Message, "Egodact Remote", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        finally { _busy = false; }
    }

    private async Task StopAgentAsync()
    {
        if (_busy) return;
        _busy = true;
        try
        {
            _statusLabel.Text = "Stoppen..."; _statusLabel.ForeColor = Muted;
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
        finally { _busy = false; RefreshStateAsync(); }
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

    private string BestLink() { var pub = ReadPublicUrl(); return !string.IsNullOrWhiteSpace(pub) ? pub : _publicUrlBox.Text; }
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

    private async void OnAutoStartChanged()
    {
        if (_suppressAutoStartEvent) return;
        try
        {
            var (file, baseArgs, workdir) = ResolveAgentCommand("");
            if (file == null) { MessageBox.Show(this, "Agent niet gevonden; kan autostart niet instellen.", "Egodact Remote", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            string installArg = _autoStartBox.Checked ? "--install-startup" : "--uninstall-startup";
            var psi = new ProcessStartInfo { FileName = file, Arguments = baseArgs.TrimEnd() + " " + installArg, WorkingDirectory = workdir, UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi); p?.WaitForExit(8000);
        }
        catch (Exception ex) { MessageBox.Show(this, "Autostart wijzigen mislukt: " + ex.Message, "Egodact Remote", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        await Task.Delay(300); RefreshStateAsync();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { _timer.Dispose(); _tray.Dispose(); _trayMenu.Dispose(); _http.Dispose(); _appIcon.Dispose(); }
        base.Dispose(disposing);
    }

    private sealed class DarkColors : ProfessionalColorTable
    {
        public override Color MenuItemSelected => Color.FromArgb(60, 60, 60);
        public override Color MenuItemSelectedGradientBegin => Color.FromArgb(60, 60, 60);
        public override Color MenuItemSelectedGradientEnd => Color.FromArgb(60, 60, 60);
        public override Color MenuItemBorder => BorderCol;
        public override Color MenuBorder => BorderCol;
        public override Color ToolStripDropDownBackground => PanelBg;
        public override Color ImageMarginGradientBegin => PanelBg;
        public override Color ImageMarginGradientMiddle => PanelBg;
        public override Color ImageMarginGradientEnd => PanelBg;
        public override Color SeparatorDark => BorderCol;
        public override Color SeparatorLight => BorderCol;
    }
}