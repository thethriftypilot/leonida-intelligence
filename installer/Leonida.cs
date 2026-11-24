// Leonida Intelligence - Windows tray launcher.
//
// Starts the bundled Node.js server hidden, restarts it if it crashes, opens the map in the
// browser, downloads the map tiles, and helps people connect their other devices.
// Built with the C# compiler that ships with .NET Framework 4.x (C# 5): see installer/build.ps1.
//
// Command line:
//   Leonida.exe                 start (or, if already running, open the map)
//   Leonida.exe --background    start without opening the browser (used for "start with Windows")
//   Leonida.exe --download-map [--if-missing]   download/update the map with a progress window
//   Leonida.exe --quit          stop a running copy (used by the installer and uninstaller)
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Leonida Intelligence")]
[assembly: AssemblyProduct("Leonida Intelligence")]
[assembly: AssemblyDescription("Unofficial GTA VI map companion for your home network")]
[assembly: AssemblyCompany("TheThriftyPilot")]
[assembly: AssemblyCopyright("MIT licence")]

namespace Leonida
{
    static class Paths
    {
        public static readonly string AppDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        public static readonly string Node = Path.Combine(AppDir, "runtime", "node.exe");
        public static readonly string Root = Path.Combine(AppDir, "app");
        public static readonly string GitCmd = Path.Combine(AppDir, "git", "cmd");
        public static readonly string Tools = Path.Combine(AppDir, "tools");
        public static readonly string Home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Leonida Intelligence");
        public static readonly string Data = Path.Combine(Home, "data");
        public static readonly string Logs = Path.Combine(Home, "logs");
        public static readonly string EnvFile = Path.Combine(Data, ".env");
        public static readonly string MapCheckout = Path.Combine(Data, "sources", "gtadb");

        public static bool MapInstalled
        {
            get { return Directory.Exists(Path.Combine(MapCheckout, "maps", "tiles", "6", "day", "0")); }
        }
    }

    static class Settings
    {
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string AppKey = @"Software\Leonida Intelligence";
        const string RunValue = "Leonida Intelligence";

        public static string ReadEnv(string key)
        {
            try
            {
                if (!File.Exists(Paths.EnvFile)) return null;
                foreach (string raw in File.ReadAllLines(Paths.EnvFile))
                {
                    string line = raw.Trim();
                    if (line.Length == 0 || line.StartsWith("#")) continue;
                    int eq = line.IndexOf('=');
                    if (eq <= 0) continue;
                    if (line.Substring(0, eq).Trim() == key) return line.Substring(eq + 1).Trim().Trim('"', '\'');
                }
            }
            catch (IOException) { }
            return null;
        }

        public static int Port
        {
            get
            {
                int p;
                return int.TryParse(ReadEnv("LI_PORT"), out p) && p > 0 && p < 65536 ? p : 5180;
            }
        }

        public static string LocalUrl { get { return "http://localhost:" + Port + "/"; } }

        public static void EnsureEnvFile()
        {
            Directory.CreateDirectory(Paths.Data);
            if (File.Exists(Paths.EnvFile)) return;
            string example = Path.Combine(Paths.Root, ".env.example");
            string text = File.Exists(example) ? File.ReadAllText(example) : "";
            // The data folder is chosen by the launcher; a value here would be ignored.
            text = text.Replace("# LI_DATA_DIR=data", "# (LI_DATA_DIR is set by the Windows launcher)");
            File.WriteAllText(Paths.EnvFile, "# Leonida Intelligence settings. Restart the app after editing\r\n# (tray icon > Restart server).\r\n\r\n" + text);
        }

        public static bool StartWithWindows
        {
            get
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey))
                    return k != null && k.GetValue(RunValue) != null;
            }
            set
            {
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(RunKey))
                {
                    if (value) k.SetValue(RunValue, "\"" + Assembly.GetExecutingAssembly().Location + "\" --background");
                    else k.DeleteValue(RunValue, false);
                }
            }
        }

        public static bool GetFlag(string name)
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(AppKey))
                return k != null && (k.GetValue(name) as int? ?? 0) == 1;
        }

        public static void SetFlag(string name)
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(AppKey))
                k.SetValue(name, 1, RegistryValueKind.DWord);
        }
    }

    static class Util
    {
        public static Icon AppIcon(Size size)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Leonida.ico"))
                return s == null ? SystemIcons.Application : new Icon(s, size);
        }

        public static Font UiFont(float size, FontStyle style)
        {
            return new Font("Segoe UI", size, style);
        }

        public static ProcessStartInfo NodeStartInfo(string arguments)
        {
            ProcessStartInfo psi = new ProcessStartInfo(Paths.Node, arguments);
            psi.WorkingDirectory = Paths.Root;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            string path = psi.EnvironmentVariables["PATH"] ?? "";
            psi.EnvironmentVariables["PATH"] = Paths.GitCmd + ";" + path;
            psi.EnvironmentVariables["LI_DATA_DIR"] = Paths.Data;
            psi.EnvironmentVariables["GIT_TERMINAL_PROMPT"] = "0";
            return psi;
        }

        public static void KillTree(Process p)
        {
            try
            {
                if (p == null || p.HasExited) return;
                ProcessStartInfo psi = new ProcessStartInfo("taskkill.exe", "/T /F /PID " + p.Id);
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                using (Process k = Process.Start(psi)) k.WaitForExit(10000);
            }
            catch (Exception) { }
        }

        public static void Open(string target)
        {
            try { Process.Start(target); }
            catch (Exception e) { MessageBox.Show("Couldn't open " + target + "\n\n" + e.Message, "Leonida Intelligence", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        }

        public static bool Healthy(int port)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/health");
                req.Timeout = 1500;
                req.Proxy = null;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                    return res.StatusCode == HttpStatusCode.OK;
            }
            catch (Exception) { return false; }
        }

        /// <summary>Runs a hidden PowerShell command and returns its output (empty on failure).</summary>
        public static string PowerShell(string command)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"" + command.Replace("\"", "\\\"") + "\"");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.StandardOutputEncoding = Encoding.UTF8;
                using (Process p = Process.Start(psi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(20000);
                    return output;
                }
            }
            catch (Exception) { return ""; }
        }

        /// <summary>Runs a script from the tools folder with administrator rights (one UAC prompt).</summary>
        public static bool RunElevatedTool(string script, string arguments)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe",
                    "-NoProfile -ExecutionPolicy Bypass -File \"" + Path.Combine(Paths.Tools, script) + "\" " + arguments);
                psi.Verb = "runas";
                psi.UseShellExecute = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                using (Process p = Process.Start(psi))
                {
                    p.WaitForExit(60000);
                    return p.ExitCode == 0;
                }
            }
            catch (Win32Exception) { return false; } // the person chose "No" at the UAC prompt
        }

        public static string FormatMb(long bytes)
        {
            return (bytes / 1048576.0).ToString("0") + " MB";
        }
    }

    /// <summary>Appends server output to logs\server.log, starting a fresh file when it gets large.</summary>
    sealed class LogFile : IDisposable
    {
        readonly object gate = new object();
        StreamWriter writer;
        public readonly string FilePath = Path.Combine(Paths.Logs, "server.log");

        public LogFile()
        {
            Directory.CreateDirectory(Paths.Logs);
            try
            {
                FileInfo fi = new FileInfo(FilePath);
                if (fi.Exists && fi.Length > 5 * 1048576)
                {
                    string old = Path.Combine(Paths.Logs, "server.previous.log");
                    if (File.Exists(old)) File.Delete(old);
                    File.Move(FilePath, old);
                }
            }
            catch (IOException) { }
            writer = new StreamWriter(new FileStream(FilePath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite), new UTF8Encoding(true));
            writer.AutoFlush = true;
        }

        public void Write(string line)
        {
            lock (gate)
            {
                if (writer == null) return;
                try { writer.WriteLine(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + line); } catch (IOException) { }
            }
        }

        public void Dispose()
        {
            lock (gate) { if (writer != null) { writer.Dispose(); writer = null; } }
        }
    }

    enum ServerState { Stopped, Starting, Running, Failed }

    /// <summary>Owns the node.exe server process.</summary>
    sealed class ServerHost
    {
        readonly LogFile log;
        readonly object gate = new object();
        Process proc;
        bool stopping;
        int rapidFailures;
        DateTime startedAt;
        int generation;

        public ServerState State { get; private set; }
        public event Action StateChanged;

        public ServerHost(LogFile log) { this.log = log; State = ServerState.Stopped; }

        void SetState(ServerState s)
        {
            State = s;
            Action h = StateChanged;
            if (h != null) h();
        }

        public void Start()
        {
            lock (gate)
            {
                if (proc != null) return;
                stopping = false;
                generation++;
                int myGeneration = generation;
                ProcessStartInfo psi = Util.NodeStartInfo("--disable-warning=ExperimentalWarning server\\main.ts");
                psi.RedirectStandardInput = true;
                psi.EnvironmentVariables["LI_EXIT_ON_STDIN_CLOSE"] = "1";
                Process p = new Process();
                p.StartInfo = psi;
                p.EnableRaisingEvents = true;
                p.OutputDataReceived += delegate (object s, DataReceivedEventArgs e) { if (e.Data != null) log.Write(e.Data); };
                p.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { if (e.Data != null) log.Write(e.Data); };
                p.Exited += delegate { OnExited(p, myGeneration); };
                log.Write("[launcher] starting server (port " + Settings.Port + ")");
                try
                {
                    p.Start();
                }
                catch (Exception e)
                {
                    log.Write("[launcher] could not start node.exe: " + e.Message);
                    SetState(ServerState.Failed);
                    return;
                }
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                proc = p;
                startedAt = DateTime.Now;
                SetState(ServerState.Starting);
                ThreadPool.QueueUserWorkItem(delegate { WaitUntilReady(p, myGeneration); });
            }
        }

        void WaitUntilReady(Process p, int myGeneration)
        {
            int port = Settings.Port;
            DateTime until = DateTime.Now.AddSeconds(120);
            while (DateTime.Now < until)
            {
                lock (gate) { if (myGeneration != generation || p.HasExited) return; }
                if (Util.Healthy(port))
                {
                    lock (gate) { if (myGeneration != generation) return; }
                    log.Write("[launcher] server is ready");
                    SetState(ServerState.Running);
                    return;
                }
                Thread.Sleep(500);
            }
        }

        void OnExited(Process p, int myGeneration)
        {
            int code = -1;
            try { code = p.ExitCode; } catch (Exception) { }
            bool restart;
            lock (gate)
            {
                if (myGeneration != generation) return;
                proc = null;
                log.Write("[launcher] server exited with code " + code);
                if (stopping) { SetState(ServerState.Stopped); return; }
                bool rapid = (DateTime.Now - startedAt).TotalSeconds < 30;
                rapidFailures = rapid ? rapidFailures + 1 : 0;
                restart = rapidFailures < 3;
            }
            if (!restart)
            {
                log.Write("[launcher] server failed to start three times in a row; giving up until restarted");
                SetState(ServerState.Failed);
                return;
            }
            SetState(ServerState.Starting);
            ThreadPool.QueueUserWorkItem(delegate
            {
                Thread.Sleep(3000);
                lock (gate) { if (stopping || myGeneration != generation) return; }
                Start();
            });
        }

        public void Stop(int waitMs)
        {
            Process p;
            lock (gate)
            {
                stopping = true;
                generation++;
                p = proc;
                proc = null;
            }
            if (p != null)
            {
                log.Write("[launcher] stopping server");
                try { p.StandardInput.Close(); } catch (Exception) { }
                bool exited = false;
                try { exited = p.WaitForExit(waitMs); } catch (Exception) { }
                if (!exited) Util.KillTree(p);
            }
            SetState(ServerState.Stopped);
        }

        public void Restart()
        {
            Stop(10000);
            lock (gate) { rapidFailures = 0; }
            Start();
        }
    }

    /// <summary>The notification-area icon and its menu.</summary>
    sealed class TrayApp : ApplicationContext
    {
        readonly NotifyIcon icon;
        readonly ServerHost server;
        readonly LogFile log;
        readonly Control ui;
        readonly ToolStripMenuItem statusItem, autostartItem, mapItem;
        bool openWhenReady;
        bool failureShown;
        bool quitting;

        public TrayApp(bool openBrowser, EventWaitHandle quitEvent, EventWaitHandle openEvent)
        {
            ui = new Control();
            ui.CreateControl();
            log = new LogFile();
            server = new ServerHost(log);
            server.StateChanged += delegate { Ui(OnStateChanged); };

            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Font = Util.UiFont(9f, FontStyle.Regular);
            statusItem = new ToolStripMenuItem("Starting...");
            statusItem.Enabled = false;
            ToolStripMenuItem openItem = new ToolStripMenuItem("Open the map", null, delegate { OpenMap(); });
            openItem.Font = Util.UiFont(9f, FontStyle.Bold);
            ToolStripMenuItem devicesItem = new ToolStripMenuItem("Open on my phone or tablet...", null, delegate { ShowDevices(); });
            mapItem = new ToolStripMenuItem("Download the map", null, delegate { DownloadMap(); });
            autostartItem = new ToolStripMenuItem("Start with Windows", null, delegate
            {
                Settings.StartWithWindows = !Settings.StartWithWindows;
                autostartItem.Checked = Settings.StartWithWindows;
            });
            ToolStripMenuItem more = new ToolStripMenuItem("More");
            more.DropDownItems.Add(new ToolStripMenuItem("Restart server", null, delegate { RestartServer(); }));
            more.DropDownItems.Add(new ToolStripMenuItem("Edit settings (port, PIN...)", null, delegate
            {
                Settings.EnsureEnvFile();
                try { Process.Start("notepad.exe", "\"" + Paths.EnvFile + "\""); } catch (Exception) { }
            }));
            more.DropDownItems.Add(new ToolStripMenuItem("Open data folder", null, delegate { Directory.CreateDirectory(Paths.Home); Util.Open(Paths.Home); }));
            more.DropDownItems.Add(new ToolStripMenuItem("View server log", null, delegate
            {
                try { Process.Start("notepad.exe", "\"" + log.FilePath + "\""); } catch (Exception) { }
            }));
            more.DropDownItems.Add(new ToolStripMenuItem("Project page on GitHub", null, delegate { Util.Open("https://github.com/thethriftypilot/leonida-intelligence"); }));
            ToolStripMenuItem quitItem = new ToolStripMenuItem("Quit Leonida Intelligence", null, delegate { Quit(); });

            menu.Items.AddRange(new ToolStripItem[] {
                statusItem, new ToolStripSeparator(), openItem, devicesItem, new ToolStripSeparator(),
                mapItem, autostartItem, more, new ToolStripSeparator(), quitItem });
            menu.Opening += delegate
            {
                autostartItem.Checked = Settings.StartWithWindows;
                mapItem.Text = Paths.MapInstalled ? "Update the map" : "Download the map";
            };

            icon = new NotifyIcon();
            icon.Icon = Util.AppIcon(SystemInformation.SmallIconSize);
            icon.Text = "Leonida Intelligence";
            icon.ContextMenuStrip = menu;
            icon.MouseClick += delegate (object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) OpenMap(); };
            icon.BalloonTipClicked += delegate { if (server.State == ServerState.Failed) Process.Start("notepad.exe", "\"" + log.FilePath + "\""); };
            icon.Visible = true;

            Thread signals = new Thread(delegate ()
            {
                WaitHandle[] handles = { quitEvent, openEvent };
                while (true)
                {
                    int i = WaitHandle.WaitAny(handles);
                    if (i == 0) { Ui(Quit); return; }
                    Ui(OpenMap);
                }
            });
            signals.IsBackground = true;
            signals.Start();

            openWhenReady = openBrowser;
            server.Start();
            OnStateChanged();

            if (!Settings.GetFlag("TrayTipShown"))
            {
                Settings.SetFlag("TrayTipShown");
                icon.ShowBalloonTip(8000, "Leonida Intelligence is running",
                    "It lives here in the notification area. Click the icon to open the map, or right-click for more options.", ToolTipIcon.Info);
            }
        }

        void Ui(Action a)
        {
            if (quitting && a != (Action)Quit) return;
            try { ui.BeginInvoke(a); } catch (Exception) { }
        }

        void OnStateChanged()
        {
            int port = Settings.Port;
            string text;
            switch (server.State)
            {
                case ServerState.Running: text = "Running on port " + port; break;
                case ServerState.Starting: text = "Starting..."; break;
                case ServerState.Failed: text = "Not running (see More > View server log)"; break;
                default: text = "Stopped"; break;
            }
            statusItem.Text = text;
            string tip = "Leonida Intelligence - " + text;
            icon.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;

            if (server.State == ServerState.Running)
            {
                failureShown = false;
                if (openWhenReady) { openWhenReady = false; Util.Open(Settings.LocalUrl); }
            }
            else if (server.State == ServerState.Failed && !failureShown)
            {
                failureShown = true;
                openWhenReady = false;
                icon.ShowBalloonTip(10000, "Leonida Intelligence couldn't start",
                    "Another program may be using port " + port + ". Click here to see the log, or change the port with More > Edit settings.",
                    ToolTipIcon.Error);
            }
        }

        void OpenMap()
        {
            if (server.State == ServerState.Running) { Util.Open(Settings.LocalUrl); return; }
            openWhenReady = true;
            if (server.State == ServerState.Failed || server.State == ServerState.Stopped) server.Restart();
            icon.ShowBalloonTip(3000, "Leonida Intelligence", "Starting up; the map will open in a moment.", ToolTipIcon.Info);
        }

        void RestartServer()
        {
            ThreadPool.QueueUserWorkItem(delegate { server.Restart(); });
        }

        void ShowDevices()
        {
            foreach (Form f in Application.OpenForms) if (f is DevicesForm) { f.Activate(); return; }
            new DevicesForm().Show();
        }

        void DownloadMap()
        {
            foreach (Form f in Application.OpenForms) if (f is MapDownloadForm) { f.Activate(); return; }
            MapDownloadForm form = new MapDownloadForm();
            form.FormClosed += delegate
            {
                // The server only picks up newly downloaded tiles when it starts.
                if (form.Succeeded) RestartServer();
            };
            form.Show();
        }

        void Quit()
        {
            if (quitting) return;
            quitting = true;
            icon.Visible = false;
            List<Form> open = new List<Form>();
            foreach (Form f in Application.OpenForms) open.Add(f);
            foreach (Form f in open) f.Close();
            server.Stop(10000);
            log.Write("[launcher] quit");
            log.Dispose();
            icon.Dispose();
            ExitThread();
        }
    }

    /// <summary>Runs scripts/fetch-data.ts (a sparse git checkout of GTADB) with a progress window.</summary>
    sealed class MapDownloadForm : Form
    {
        // Approximate size on disk of the default download (game map z0-5, community map, landmarks,
        // and git's own copy). Only used to draw the progress bar.
        const long ExpectedBytes = 135L * 1048576;

        readonly Label headline, detail;
        readonly ProgressBar bar;
        readonly TextBox output;
        readonly Button button;
        readonly System.Windows.Forms.Timer timer;
        Process proc;
        DateTime started;
        long sizeNow;
        bool measuring, finished, cancelled;
        public bool Succeeded { get; private set; }

        public MapDownloadForm()
        {
            Text = "Leonida Intelligence - map download";
            Icon = Util.AppIcon(new Size(32, 32));
            Font = Util.UiFont(9f, FontStyle.Regular);
            AutoScaleMode = AutoScaleMode.Font;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(560, 360);

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.Padding = new Padding(16);
            layout.ColumnCount = 1;
            layout.RowCount = 5;
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

            headline = new Label();
            headline.AutoSize = true;
            headline.Font = Util.UiFont(12f, FontStyle.Bold);
            headline.Text = "Downloading the map of Leonida";
            headline.Margin = new Padding(0, 0, 0, 6);

            detail = new Label();
            detail.AutoSize = true;
            detail.MaximumSize = new Size(520, 0);
            detail.Text = "Map tiles and landmarks come from the GTADB community project (CC BY 4.0). It needs about 130 MB of disk space and usually takes a minute or two.";
            detail.Margin = new Padding(0, 0, 0, 10);

            bar = new ProgressBar();
            bar.Dock = DockStyle.Top;
            bar.Height = 20;
            bar.Maximum = 1000;
            bar.Margin = new Padding(0, 0, 0, 10);

            output = new TextBox();
            output.Multiline = true;
            output.ReadOnly = true;
            output.ScrollBars = ScrollBars.Vertical;
            output.Dock = DockStyle.Fill;
            output.Font = new Font("Consolas", 8.5f);
            output.BackColor = SystemColors.Window;

            button = new Button();
            button.Text = "Cancel";
            button.AutoSize = true;
            button.Anchor = AnchorStyles.Right;
            button.Margin = new Padding(0, 10, 0, 0);
            button.Click += delegate { OnButton(); };

            layout.Controls.Add(headline, 0, 0);
            layout.Controls.Add(detail, 0, 1);
            layout.Controls.Add(bar, 0, 2);
            layout.Controls.Add(output, 0, 3);
            layout.Controls.Add(button, 0, 4);
            Controls.Add(layout);
            CancelButton = button;

            timer = new System.Windows.Forms.Timer();
            timer.Interval = 1000;
            timer.Tick += delegate { Tick(); };

            Shown += delegate { Activate(); StartDownload(); };
            FormClosing += delegate (object s, FormClosingEventArgs e)
            {
                if (!finished)
                {
                    if (!ConfirmCancel()) { e.Cancel = true; return; }
                }
                timer.Stop();
            };
        }

        void Append(string line)
        {
            if (IsDisposed) return;
            output.AppendText(line + Environment.NewLine);
        }

        void StartDownload()
        {
            Directory.CreateDirectory(Paths.Data);
            ProcessStartInfo psi = Util.NodeStartInfo("--disable-warning=ExperimentalWarning scripts\\fetch-data.ts");
            proc = new Process();
            proc.StartInfo = psi;
            proc.EnableRaisingEvents = true;
            DataReceivedEventHandler onLine = delegate (object s, DataReceivedEventArgs e)
            {
                if (e.Data == null || e.Data.Trim().Length == 0) return;
                string line = e.Data;
                try { BeginInvoke((Action)delegate { Append(line); }); } catch (Exception) { }
            };
            proc.OutputDataReceived += onLine;
            proc.ErrorDataReceived += onLine;
            proc.Exited += delegate
            {
                try { BeginInvoke((Action)Finished); } catch (Exception) { }
            };
            started = DateTime.Now;
            try
            {
                proc.Start();
            }
            catch (Exception e)
            {
                Append("Could not start the download: " + e.Message);
                finished = true;
                button.Text = "Close";
                return;
            }
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
            timer.Start();
            Tick();
        }

        void Tick()
        {
            if (!measuring)
            {
                measuring = true;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    sizeNow = FolderSize(Paths.MapCheckout);
                    measuring = false;
                });
            }
            TimeSpan t = DateTime.Now - started;
            string elapsed = ((int)t.TotalMinutes) + ":" + t.Seconds.ToString("00");
            bar.Value = (int)Math.Min(990, sizeNow * 1000 / ExpectedBytes);
            headline.Text = "Downloading the map of Leonida  (" + Util.FormatMb(sizeNow) + ", " + elapsed + ")";
        }

        static long FolderSize(string dir)
        {
            long total = 0;
            try
            {
                if (!Directory.Exists(dir)) return 0;
                foreach (string f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
                {
                    try { total += new FileInfo(f).Length; } catch (Exception) { }
                }
            }
            catch (Exception) { }
            return total;
        }

        void Finished()
        {
            if (finished) return;
            finished = true;
            timer.Stop();
            int code = -1;
            try { code = proc.ExitCode; } catch (Exception) { }
            Succeeded = code == 0 && !cancelled && Paths.MapInstalled;
            if (Succeeded)
            {
                bar.Value = 1000;
                headline.Text = "The map is ready";
                detail.Text = "Downloaded " + Util.FormatMb(FolderSize(Paths.MapCheckout)) + ". It's kept up to date automatically.";
                // Close on its own so the installer can carry on.
                int remaining = 5;
                System.Windows.Forms.Timer closer = new System.Windows.Forms.Timer();
                closer.Interval = 1000;
                closer.Tick += delegate
                {
                    remaining--;
                    if (remaining <= 0) { closer.Stop(); Close(); }
                    else button.Text = "Close (" + remaining + ")";
                };
                button.Text = "Close (" + remaining + ")";
                AcceptButton = button;
                closer.Start();
                return;
            }
            else
            {
                headline.Text = cancelled ? "Map download cancelled" : "The map couldn't be downloaded";
                detail.Text = "Leonida Intelligence still works, but the background map will be blank. Check your internet connection, then try again from the tray icon: right-click > Download the map.";
            }
            button.Text = "Close";
            AcceptButton = button;
        }

        bool ConfirmCancel()
        {
            if (finished) return true;
            DialogResult r = MessageBox.Show(this, "Stop downloading the map? You can download it later from the tray icon.",
                "Leonida Intelligence", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
            if (r != DialogResult.Yes) return false;
            cancelled = true;
            Util.KillTree(proc);
            finished = true;
            return true;
        }

        void OnButton()
        {
            if (finished) { Close(); return; }
            if (ConfirmCancel()) Close();
        }

        public static int RunStandalone()
        {
            MapDownloadForm form = new MapDownloadForm();
            Application.Run(form);
            return form.Succeeded ? 0 : 1;
        }
    }

    /// <summary>Shows the address to use on other devices and fixes the usual Windows blockers.</summary>
    sealed class DevicesForm : Form
    {
        readonly FlowLayoutPanel checks;
        readonly Label checking;

        public DevicesForm()
        {
            Text = "Open Leonida Intelligence on another device";
            Icon = Util.AppIcon(new Size(32, 32));
            Font = Util.UiFont(9.5f, FontStyle.Regular);
            AutoScaleMode = AutoScaleMode.Font;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;

            FlowLayoutPanel root = new FlowLayoutPanel();
            root.FlowDirection = FlowDirection.TopDown;
            root.WrapContents = false;
            root.AutoSize = true;
            root.Padding = new Padding(18);
            root.MaximumSize = new Size(560, 0);

            root.Controls.Add(Para("On your phone, tablet or laptop, connect to the same Wi-Fi as this PC, then open this address in its web browser:", false));

            int port = Settings.Port;
            List<string> addresses = LanAddresses();
            if (addresses.Count == 0)
                root.Controls.Add(Para("This PC doesn't seem to be connected to a network right now.", true));
            foreach (string ip in addresses)
            {
                string url = "http://" + ip + ":" + port;
                FlowLayoutPanel row = new FlowLayoutPanel();
                row.AutoSize = true;
                row.WrapContents = false;
                row.Margin = new Padding(0, 6, 0, 6);
                TextBox box = new TextBox();
                box.Text = url;
                box.ReadOnly = true;
                box.BorderStyle = BorderStyle.None;
                box.BackColor = BackColor;
                box.Font = Util.UiFont(16f, FontStyle.Bold);
                box.Width = TextRenderer.MeasureText(url, box.Font).Width + 12;
                box.Margin = new Padding(0, 4, 8, 0);
                Button copy = new Button();
                copy.Text = "Copy";
                copy.AutoSize = true;
                copy.Click += delegate { Clipboard.SetText(url); copy.Text = "Copied"; };
                row.Controls.Add(box);
                row.Controls.Add(copy);
                root.Controls.Add(row);
            }
            root.Controls.Add(Para("Type it exactly, starting with http:// (not https). Tip: use \"Add to Home Screen\" in your phone's browser menu so it opens like an app. This PC needs to be on, with Leonida Intelligence running.", false));

            checking = Para("Checking Windows network settings...", false);
            checking.ForeColor = SystemColors.GrayText;
            root.Controls.Add(checking);
            checks = new FlowLayoutPanel();
            checks.FlowDirection = FlowDirection.TopDown;
            checks.WrapContents = false;
            checks.AutoSize = true;
            root.Controls.Add(checks);

            Button close = new Button();
            close.Text = "Close";
            close.AutoSize = true;
            close.Margin = new Padding(0, 12, 0, 0);
            close.Click += delegate { Close(); };
            root.Controls.Add(close);
            CancelButton = close;
            Controls.Add(root);

            Shown += delegate { RunChecks(); };
        }

        static Label Para(string text, bool warn)
        {
            Label l = new Label();
            l.Text = text;
            l.AutoSize = true;
            l.MaximumSize = new Size(520, 0);
            l.Margin = new Padding(0, 4, 0, 6);
            if (warn) l.ForeColor = Color.FromArgb(176, 72, 0);
            return l;
        }

        /// <summary>IPv4 addresses of adapters that have a default gateway (real networks, not VM adapters).</summary>
        public static List<string> LanAddresses()
        {
            return Addresses(null);
        }

        static List<string> Addresses(List<int> indexesOut)
        {
            List<string> result = new List<string>();
            foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                IPInterfaceProperties props = ni.GetIPProperties();
                bool hasGateway = false;
                foreach (GatewayIPAddressInformation g in props.GatewayAddresses)
                    if (g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any)) hasGateway = true;
                if (!hasGateway) continue;
                foreach (UnicastIPAddressInformation ua in props.UnicastAddresses)
                {
                    if (ua.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    string s = ua.Address.ToString();
                    if (s.StartsWith("169.254.")) continue;
                    result.Add(s);
                }
                if (indexesOut != null)
                {
                    try { indexesOut.Add(props.GetIPv4Properties().Index); } catch (Exception) { }
                }
            }
            return result;
        }

        void RunChecks()
        {
            checks.Controls.Clear();
            checking.Visible = true;
            List<int> indexes = new List<int>();
            Addresses(indexes);
            ThreadPool.QueueUserWorkItem(delegate
            {
                string output = Util.PowerShell(
                    "$ErrorActionPreference='SilentlyContinue'; " +
                    "Get-NetConnectionProfile | ForEach-Object { 'NET|' + $_.InterfaceIndex + '|' + $_.NetworkCategory + '|' + $_.Name }; " +
                    "if (Get-NetFirewallRule -Group 'Leonida Intelligence') { 'FW|yes' } else { 'FW|no' }");
                try { BeginInvoke((Action)delegate { ShowChecks(output, indexes); }); } catch (Exception) { }
            });
        }

        void ShowChecks(string output, List<int> indexes)
        {
            if (IsDisposed) return;
            checking.Visible = false;
            checks.Controls.Clear();
            bool firewallKnown = false, firewallOk = false, allGood = true;
            foreach (string raw in output.Split('\n'))
            {
                string[] parts = raw.Trim().Split(new[] { '|' }, 4);
                if (parts[0] == "FW" && parts.Length >= 2) { firewallKnown = true; firewallOk = parts[1] == "yes"; }
                if (parts[0] != "NET" || parts.Length < 4) continue;
                int index;
                if (!int.TryParse(parts[1], out index) || !indexes.Contains(index)) continue;
                string category = parts[2], name = parts[3];
                if (category == "Public")
                {
                    allGood = false;
                    checks.Controls.Add(Para("Windows is treating the network \"" + name + "\" as a Public network, so it blocks other devices from connecting. If this is your home network, make it Private.", true));
                    int captured = index;
                    checks.Controls.Add(ActionButton("Make \"" + name + "\" a Private network (asks for admin permission)", delegate
                    {
                        if (!Util.RunElevatedTool("network.ps1", "-MakePrivate " + captured))
                            MessageBox.Show(this, "That didn't work. You can change it yourself in Settings > Network & internet > Wi-Fi (or Ethernet) > your network > Network profile type > Private.", Text);
                        RunChecks();
                    }));
                }
                else
                {
                    checks.Controls.Add(Para("✔ \"" + name + "\" is a " + category + " network.", false));
                }
            }
            if (firewallKnown && !firewallOk)
            {
                allGood = false;
                checks.Controls.Add(Para("Windows Firewall hasn't been told to allow Leonida Intelligence yet.", true));
                checks.Controls.Add(ActionButton("Allow it on Private networks (asks for admin permission)", delegate
                {
                    if (!Util.RunElevatedTool("network.ps1", "-AddFirewall -Program \"" + Paths.Node + "\""))
                        MessageBox.Show(this, "The firewall rule wasn't added.", Text);
                    RunChecks();
                }));
            }
            else if (firewallOk)
            {
                checks.Controls.Add(Para("✔ Windows Firewall allows it on Private networks.", false));
            }
            if (allGood)
                checks.Controls.Add(Para("Still can't connect? Make sure the other device isn't on a guest network, mobile data or a VPN.", false));
        }

        static Button ActionButton(string text, EventHandler onClick)
        {
            Button b = new Button();
            b.Text = text;
            b.AutoSize = true;
            b.Margin = new Padding(0, 0, 0, 8);
            b.Click += onClick;
            return b;
        }
    }

    static class Program
    {
        const string MutexName = @"Local\LeonidaIntelligence.Tray";
        const string QuitEventName = @"Local\LeonidaIntelligence.Quit";
        const string OpenEventName = @"Local\LeonidaIntelligence.Open";

        [STAThread]
        static int Main(string[] args)
        {
            HashSet<string> a = new HashSet<string>(args, StringComparer.OrdinalIgnoreCase);
            if (a.Contains("--quit")) return QuitRunning();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (!File.Exists(Paths.Node))
            {
                MessageBox.Show("Leonida Intelligence is missing some of its files. Please reinstall it.", "Leonida Intelligence", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 2;
            }

            if (a.Contains("--download-map"))
            {
                if (a.Contains("--if-missing") && Paths.MapInstalled) return 0;
                return MapDownloadForm.RunStandalone();
            }

            bool created;
            using (Mutex mutex = new Mutex(true, MutexName, out created))
            {
                if (!created)
                {
                    // Already running: ask that copy to open the map (unless this is the autostart).
                    if (!a.Contains("--background"))
                    {
                        try { EventWaitHandle.OpenExisting(OpenEventName).Set(); } catch (Exception) { }
                    }
                    return 0;
                }
                using (EventWaitHandle quitEvent = new EventWaitHandle(false, EventResetMode.AutoReset, QuitEventName))
                using (EventWaitHandle openEvent = new EventWaitHandle(false, EventResetMode.AutoReset, OpenEventName))
                {
                    Settings.EnsureEnvFile();
                    Application.Run(new TrayApp(!a.Contains("--background"), quitEvent, openEvent));
                }
                mutex.ReleaseMutex();
            }
            return 0;
        }

        /// <summary>Asks a running copy to shut down and waits until it has.</summary>
        static int QuitRunning()
        {
            EventWaitHandle ev;
            try { ev = EventWaitHandle.OpenExisting(QuitEventName); }
            catch (WaitHandleCannotBeOpenedException) { return 0; }
            using (ev) ev.Set();
            try
            {
                using (Mutex m = Mutex.OpenExisting(MutexName))
                {
                    try { if (m.WaitOne(30000)) m.ReleaseMutex(); }
                    catch (AbandonedMutexException) { }
                }
            }
            catch (WaitHandleCannotBeOpenedException) { }
            return 0;
        }
    }
}
