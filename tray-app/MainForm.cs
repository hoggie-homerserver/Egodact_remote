using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;

namespace EgodactRemoteTray;

public sealed class MainForm : Form
{
    private readonly NotifyIcon _tray;
    private readonly ContextMenuStrip _trayMenu;
    private readonly Label _statusLabel;
    private readonly Label _detailLabel;
    private readonly TextBox _publicUrlBox;
    private readonly TextBox _localUrlBox;
    private readonly TextBox _tokenBox;
    private readonly Button _toggleButton;
    private readonly Button _refreshButton;
    private readonly CheckBox _autoStartBox;

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly System.Windows.Forms.Timer _timer;

    private Process? _agentProcess;
    private bool _allowExit;
    private bool _suppressAutoStartEvent;

    private string BaseDir => AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    private string DataDir => Path.Combine(BaseDir, "data");
    private string TokenPath => Path.Combine(DataDir, "token.txt");
    private string PublicUrlPath => Path.Combine(DataDir, "public-url.txt");
    private string AgentLogPath => Path.Combine(DataDir, "agent.log");

    public MainForm()
    {
        Text = "Egodact Remote";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(640, 420);
        Size = new Size(700, 460);
        Icon = SystemIcons.Application;

        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 6,
            Padding = new Padding(14),
        };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        _statusLabel = new Label { AutoSize = true, Font = new Font(SystemFonts.DefaultFont, FontStyle.Bold), Text = "Status: controleren..." };
        _detailLabel = new Label { AutoSize = true, ForeColor = SystemColors.GrayText, Text = " " , MaximumSize = new Size(640, 0)};

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, WrapContents = true };
        _toggleButton = new Button { Text = "Start", AutoSize = true, Width = 120, Height = 34 };
        _toggleButton.Click += (_, _) => ToggleAgent();
        _refreshButton = new Button { Text = "Vernieuwen", AutoSize = true, Width = 120, Height = 34 };
        _refreshButton.Click += (_, _) => RefreshStateAsync();
        var openBtn = new Button { Text = "Open link", AutoSize = true, Width = 120, Height = 34 };
        openBtn.Click += (_, _) => OpenBestLink();
        var copyBtn = new Button { Text = "Kopieer link", AutoSize = true, Width = 120, Height = 34 };
        copyBtn.Click += (_, _) => CopyBestLink();
        var logBtn = new Button { Text = "Open map", AutoSize = true, Width = 120, Height = 34 };
        logBtn.Click += (_, _) => OpenBaseDir();
        _autoStartBox = new CheckBox { Text = "Automatisch starten bij Windows-login", AutoSize = true, Padding = new Padding(8, 8, 0, 0) };
        _autoStartBox.CheckedChanged += (_, _) => OnAutoStartChanged();
        buttons.Controls.AddRange(new Control[] { _toggleButton, _refreshButton, openBtn, copyBtn, logBtn, _autoStartBox });

        _publicUrlBox = MakeUrlRow("Publieke/lokale link (plak in telefoon/app):", out var publicRow, out var copyPubBtn);
        copyPubBtn.Click += (_, _) => CopyText(_publicUrlBox.Text);
        _localUrlBox = MakeUrlRow("Lokale link:", out var localRow, out var copyLocalBtn);
        copyLocalBtn.Click += (_, _) => CopyText(_localUrlBox.Text);
        _tokenBox = MakeUrlRow("Token:", out var tokenRow, out var copyTokenBtn);
        copyTokenBtn.Click += (_, _) => CopyText(_tokenBox.Text);

        var hint = new Label
        {
            Dock = DockStyle.Fill,
            AutoSize = false,
            ForeColor = SystemColors.GrayText,
            Text = "Sluiten = verbergen naar systeemvak (agent blijft draaien). Gebruik 'Stop' om de agent uit te zetten, of 'Afsluiten' in het tray-menu om alles te stoppen. " +
                   "Voor altijd dezelfde link: Tailscale Serve gebruiken (tailscale serve --bg --https=443 http://127.0.0.1:8787). " +
                   "Companion-extensie moet in Chrome geladen zijn met dezelfde token."
        };

        root.Controls.Add(Wrap(_statusLabel), 0, 0);
        root.Controls.Add(Wrap(_detailLabel), 0, 1);
        root.Controls.Add(buttons, 0, 2);
        root.Controls.Add(publicRow, 0, 3);
        root.Controls.Add(localRow, 0, 4);

        var bottom = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
        bottom.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        bottom.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        bottom.Controls.Add(tokenRow, 0, 0);
        bottom.Controls.Add(hint, 0, 1);
        root.Controls.Add(bottom, 0, 5);

        Controls.Add(root);

        _trayMenu = new ContextMenuStrip();
        _trayMenu.Items.Add("Openen", null, (_, _) => ShowFromTray());
        _trayMenu.Items.Add("Start agent", null, (_, _) => StartAgent());
        _trayMenu.Items.Add("Stop agent", null, (_, _) => StopAgent());
        _trayMenu.Items.Add("Kopieer link", null, (_, _) => CopyBestLink());
        _trayMenu.Items.Add("Open link", null, (_, _) => OpenBestLink());
        _trayMenu.Items.Add(new ToolStripSeparator());
        _trayMenu.Items.Add("Afsluiten", null, (_, _) => ExitApp());

        _tray = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Visible = true,
            Text = "Egodact Remote",
            ContextMenuStrip = _trayMenu
        };
        _tray.DoubleClick += (_, _) => ShowFromTray();

        _timer = new System.Windows.Forms.Timer { Interval = 4000 };
        _timer.Tick += (_, _) => RefreshStateAsync();
        _timer.Start();

        Load += (_, _) => RefreshStateAsync();
        FormClosing += OnFormClosing;
        Resize += (_, _) => { if (WindowState == FormWindowState.Minimized) HideToTray(); };
    }

    private static Control Wrap(Control c)
    {
        var p = new Panel { Dock = DockStyle.Top, AutoSize = true };
        p.Controls.Add(c);
        return p;
    }

    private static TextBox MakeUrlRow(string label, out TableLayoutPanel row, out Button copyBtn)
    {
        row = new TableLayoutPanel { Dock = DockStyle.Top, ColumnCount = 3, AutoSize = true };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 280));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var lbl = new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left, Padding = new Padding(0, 8, 0, 0) };
        var box = new TextBox { Dock = DockStyle.Fill, ReadOnly = true };
        copyBtn = new Button { Text = "Kopieer", AutoSize = true };
        row.Controls.Add(lbl, 0, 0);
        row.Controls.Add(box, 1, 0);
        row.Controls.Add(copyBtn, 2, 0);
        return box;
    }

    private void ShowFromTray()
    {
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
        RefreshStateAsync();
    }

    private void HideToTray()
    {
        Hide();
        _tray.ShowBalloonTip(1500, "Egodact Remote", "Draait verder op de achtergrond. Open via het systeemvak.", ToolTipIcon.Info);
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_allowExit) return;
        if (e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            HideToTray();
        }
    }

    private void ExitApp()
    {
        _allowExit = true;
        try { StopAgent(); } catch { }
        _tray.Visible = false;
        Application.Exit();
    }

    private async void RefreshStateAsync()
    {
        bool running = await IsAgentRunningAsync();
        string token = ReadToken();
        string publicUrl = ReadPublicUrl();
        string localUrl = BuildLocalUrl(token);

        _statusLabel.Text = running ? "Status: actief" : "Status: gestopt";
        _detailLabel.Text = running
            ? "De agent luistert op poort 8787. Gebruik de link in je telefoon/app."
            : "Klik op Start om de agent te starten.";

        _toggleButton.Text = running ? "Stop" : "Start";
        _publicUrlBox.Text = !string.IsNullOrWhiteSpace(publicUrl) ? publicUrl : localUrl;
        _localUrlBox.Text = localUrl;
        _tokenBox.Text = token;

        _suppressAutoStartEvent = true;
        try { _autoStartBox.Checked = IsAutoStartEnabled(); }
        finally { _suppressAutoStartEvent = false; }

        _tray.Text = running ? "Egodact Remote (actief)" : "Egodact Remote (gestopt)";
    }

    private async void ToggleAgent()
    {
        if (await IsAgentRunningAsync()) StopAgent();
        else StartAgent();
        await Task.Delay(800);
        RefreshStateAsync();
    }

    private void StartAgent()
    {
        try
        {
            if (IsOwnedProcessAlive()) return;
            var (file, args, workdir) = ResolveAgentCommand("--anywhere");
            if (file == null)
            {
                MessageBox.Show(this,
                    "Kon geen agent vinden. Plaats EgodactRemote.exe of (node + agent\\main.js) in dezelfde map als deze app.",
                    "Egodact Remote", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            var psi = new ProcessStartInfo
            {
                FileName = file,
                Arguments = args,
                WorkingDirectory = workdir,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            _agentProcess = Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Starten mislukt: " + ex.Message, "Egodact Remote", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void StopAgent()
    {
        try
        {
            if (IsOwnedProcessAlive())
            {
                try { _agentProcess!.Kill(entireProcessTree: true); } catch { try { _agentProcess!.Kill(); } catch { } }
            }
            _agentProcess = null;
        }
        catch { }
        RefreshStateAsync();
    }

    private (string? file, string args, string workdir) ResolveAgentCommand(string extraArgs)
    {
        string exe = Path.Combine(BaseDir, "EgodactRemote.exe");
        if (File.Exists(exe)) return (exe, extraArgs, BaseDir);

        string mainJs = Path.Combine(BaseDir, "agent", "main.js");
        if (File.Exists(mainJs)) return ("node", Quote(mainJs) + " " + extraArgs, BaseDir);

        // dev: tray-app\bin\...\ relative to repo root
        string repoMain = Path.GetFullPath(Path.Combine(BaseDir, "..", "..", "..", "agent", "main.js"));
        if (File.Exists(repoMain))
            return ("node", Quote(repoMain) + " " + extraArgs, Path.GetDirectoryName(repoMain)! + "\\..");

        return (null, "", BaseDir);
    }

    private static string Quote(string s) => "\"" + s.Replace("\"", "\\\"") + "\"";

    private bool IsOwnedProcessAlive()
    {
        try { return _agentProcess != null && !_agentProcess.HasExited; }
        catch { return false; }
    }

    private async Task<bool> IsAgentRunningAsync()
    {
        try
        {
            using var res = await _http.GetAsync("http://127.0.0.1:8787/api/ping");
            return res.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    private string ReadToken()
    {
        try { if (File.Exists(TokenPath)) return File.ReadAllText(TokenPath).Trim(); } catch { }
        return "";
    }

    private string ReadPublicUrl()
    {
        try { if (File.Exists(PublicUrlPath)) return File.ReadAllText(PublicUrlPath).Trim(); } catch { }
        return "";
    }

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
                    if (ua.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ua.Address))
                    { host = ua.Address.ToString(); goto found; }
                }
            }
        }
        catch { }
    found:
        string t = string.IsNullOrWhiteSpace(token) ? ReadToken() : token;
        return "http://" + host + ":8787/?t=" + t;
    }

    private string BestLink()
    {
        var pub = ReadPublicUrl();
        if (!string.IsNullOrWhiteSpace(pub)) return pub;
        return _publicUrlBox.Text;
    }

    private void CopyBestLink() => CopyText(BestLink());

    private void OpenBestLink()
    {
        var url = BestLink();
        if (string.IsNullOrWhiteSpace(url)) return;
        try { Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true }); } catch { }
    }

    private void CopyText(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        try { Clipboard.SetText(text); } catch { }
    }

    private void OpenBaseDir()
    {
        try { Process.Start(new ProcessStartInfo { FileName = BaseDir, UseShellExecute = true }); } catch { }
    }

    private bool IsAutoStartEnabled()
    {
        string startup = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Egodact Remote.lnk");
        if (File.Exists(startup)) return true;
        try
        {
            var psi = new ProcessStartInfo("schtasks", "/Query /TN \"Egodact Remote\"") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            using var p = Process.Start(psi);
            p?.WaitForExit(3000);
            return p != null && p.ExitCode == 0;
        }
        catch { return false; }
    }

    private void OnAutoStartChanged()
    {
        if (_suppressAutoStartEvent) return;
        try
        {
            var (file, baseArgs, workdir) = ResolveAgentCommand("");
            if (file == null)
            {
                MessageBox.Show(this, "Agent niet gevonden; kan autostart niet instellen.", "Egodact Remote", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            string installArg = _autoStartBox.Checked ? "--install-startup" : "--uninstall-startup";
            var psi = new ProcessStartInfo
            {
                FileName = file,
                Arguments = baseArgs.TrimEnd() + " " + installArg,
                WorkingDirectory = workdir,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var p = Process.Start(psi);
            p?.WaitForExit(8000);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Autostart wijzigen mislukt: " + ex.Message, "Egodact Remote", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        RefreshStateAsync();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _timer.Dispose();
            _tray.Dispose();
            _trayMenu.Dispose();
            _http.Dispose();
        }
        base.Dispose(disposing);
    }
}
