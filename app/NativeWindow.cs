using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Reflection;
using System.Runtime.InteropServices;

[assembly: AssemblyTitle("YouTube Downloader")]
[assembly: AssemblyDescription("Portable Windows video and MP3 downloader")]
[assembly: AssemblyProduct("YouTube Downloader")]
[assembly: AssemblyVersion("2.0.0.0")]

internal static class Program
{
    internal static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    internal static readonly string Tools = Path.Combine(Root, ".tools");
    internal static readonly string Downloads = Path.Combine(Root, "downloads");
    internal static readonly string Logs = Path.Combine(Root, "logs");
    internal static readonly string UrlFile = Path.Combine(Tools, "app.url");

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [STAThread]
    private static void Main()
    {
        SetProcessDPIAware();
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string identity;
        using (var sha = SHA256.Create()) identity = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Root.ToLowerInvariant()))).Replace("-", "");
        bool first;
        using (var instance = new Mutex(true, "Local\\SimpleYouTubeDownloader_" + identity, out first))
        {
            if (!first) { MessageBox.Show("YouTube Downloader is already open. Find its window on your taskbar.", "YouTube Downloader"); return; }
            try
            {
                if (!File.Exists(Path.Combine(Tools, "node.exe")) || !File.Exists(Path.Combine(Root, "app", "server.js")))
                    throw new Exception("Please extract the entire ZIP before opening YouTube Downloader.exe. Keep the app and .tools folders beside it.");
                Directory.CreateDirectory(Downloads);
                using (var window = new DownloaderWindow()) Application.Run(window);
            }
            catch (Exception error)
            {
                try { File.WriteAllText(Path.Combine(Tools, "startup-error.log"), error.ToString()); } catch { }
                MessageBox.Show(error.Message, "YouTube Downloader", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally { instance.ReleaseMutex(); }
        }
    }
}

internal sealed class LocalWebClient : WebClient
{
    internal LocalWebClient() { Encoding = Encoding.UTF8; Proxy = null; }
    protected override WebRequest GetWebRequest(Uri address) { var request = base.GetWebRequest(address); request.Timeout = 15000; return request; }
}

internal sealed class DownloadList : ListView
{
    internal DownloadList() { DoubleBuffered = true; }
}

internal sealed class SoftCard : Panel
{
    internal Color BorderColor = Color.FromArgb(225, 231, 225);
    internal SoftCard() { DoubleBuffered = true; }
    internal static GraphicsPath Rounded(Rectangle bounds, int radius)
    {
        int d = radius * 2;
        var shape = new GraphicsPath();
        shape.AddArc(bounds.Left, bounds.Top, d, d, 180, 90);
        shape.AddArc(bounds.Right - d, bounds.Top, d, d, 270, 90);
        shape.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
        shape.AddArc(bounds.Left, bounds.Bottom - d, d, d, 90, 90);
        shape.CloseFigure(); return shape;
    }
    protected override void OnPaintBackground(PaintEventArgs e)
    {
        e.Graphics.Clear(Parent == null ? Color.FromArgb(246, 248, 244) : Parent.BackColor);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var shape = Rounded(new Rectangle(0, 0, Width - 1, Height - 1), 12))
        using (var fill = new SolidBrush(BackColor))
        using (var border = new Pen(BorderColor)) { e.Graphics.FillPath(fill, shape); e.Graphics.DrawPath(border, shape); }
    }
}

internal sealed class SoftButton : Button
{
    private bool hover;
    internal bool Primary;
    internal SoftButton()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        FlatStyle = FlatStyle.Flat; FlatAppearance.BorderSize = 0; UseVisualStyleBackColor = false;
    }
    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(Parent == null ? Color.White : Parent.BackColor);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var fillColor = !Enabled ? (Primary ? Color.FromArgb(187, 207, 194) : Color.FromArgb(244, 246, 242)) :
            (Primary ? (hover ? Color.FromArgb(15, 105, 72) : Color.FromArgb(22, 128, 86)) : (hover ? Color.FromArgb(234, 244, 238) : BackColor));
        using (var shape = SoftCard.Rounded(new Rectangle(0, 0, Width - 1, Height - 1), 8))
        using (var fill = new SolidBrush(fillColor))
        using (var border = new Pen(Primary ? fillColor : Color.FromArgb(216, 225, 216))) { e.Graphics.FillPath(fill, shape); e.Graphics.DrawPath(border, shape); }
        TextRenderer.DrawText(e.Graphics, Text, Font, new Rectangle(6, 0, Width - 12, Height),
            Enabled ? ForeColor : (Primary ? Color.White : Color.FromArgb(161, 172, 165)), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        if (Focused) ControlPaint.DrawFocusRectangle(e.Graphics, new Rectangle(5, 5, Width - 10, Height - 10), ForeColor, fillColor);
    }
}

internal sealed class BrandMark : Control
{
    internal BrandMark() { Size = new Size(50, 50); }
    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var shape = SoftCard.Rounded(new Rectangle(0, 0, Width - 1, Height - 1), 14))
        using (var fill = new SolidBrush(Color.FromArgb(8, 127, 100))) e.Graphics.FillPath(fill, shape);
        using (var white = new Pen(Color.White, Width / 16F)) {
            white.StartCap = white.EndCap = LineCap.Round; white.LineJoin = LineJoin.Round;
            e.Graphics.DrawLine(white, Width * .5F, Height * .21F, Width * .5F, Height * .62F);
            e.Graphics.DrawLines(white, new PointF[] { new PointF(Width * .36F, Height * .48F), new PointF(Width * .5F, Height * .62F), new PointF(Width * .64F, Height * .48F) });
            e.Graphics.DrawLines(white, new PointF[] { new PointF(Width * .25F, Height * .69F), new PointF(Width * .25F, Height * .81F), new PointF(Width * .75F, Height * .81F), new PointF(Width * .75F, Height * .69F) });
        }
    }
}

internal sealed class DownloaderWindow : Form
{
    private readonly Color ink = Color.FromArgb(31, 45, 38), muted = Color.FromArgb(108, 123, 113), accent = Color.FromArgb(22, 128, 86);
    private readonly TextBox links = new TextBox(), details = new TextBox();
    private readonly ComboBox format = new ComboBox(), quality = new ComboBox();
    private readonly Button download = new SoftButton(), cancel = new SoftButton(), retry = new SoftButton(), clear = new SoftButton(), openLog = new SoftButton();
    private readonly Label status = new Label(), qualityLabel = new Label(), count = new Label(), queueSummary = new Label(), pairingCode = new Label(), extensionStatus = new Label(), inputHint = new Label();
    private readonly Button copyCode = new SoftButton(), disconnect = new SoftButton(), browser = new SoftButton(), extensionGuide = new SoftButton();
    private readonly ProgressBar selectedProgress = new ProgressBar();
    private readonly RadioButton videoChoice = new RadioButton(), audioChoice = new RadioButton();
    private readonly DownloadList list = new DownloadList();
    private readonly Panel emptyQueue = new Panel();
    private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    private readonly Dictionary<string, ListViewItem> rows = new Dictionary<string, ListViewItem>();
    private readonly Dictionary<string, Dictionary<string, object>> jobs = new Dictionary<string, Dictionary<string, object>>();
    private Process server;
    private StreamWriter log;
    private string address, token, lastQueueSummary, currentPairingCode;
    private bool closing, polling, submitting, ready, lostConnection;

    internal DownloaderWindow()
    {
        Text = "YouTube Downloader";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        Size = new Size(1080, 880); MinimumSize = new Size(1000, 840);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(246, 248, 244); ForeColor = ink;
        Font = new Font("Segoe UI", 10F); AutoScaleDimensions = new SizeF(96F, 96F); AutoScaleMode = AutoScaleMode.Dpi;
        Padding = new Padding(28, 22, 28, 20); KeyPreview = true;
        var tips = new ToolTip { AutoPopDelay = 10000, InitialDelay = 500, ReshowDelay = 100 };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 7, Margin = new Padding(0) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        foreach (var height in new int[] { 80, 252, 118, 48 }) layout.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 92)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
        Controls.Add(layout);

        var heading = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1, Margin = new Padding(0) };
        heading.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        heading.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 64));
        heading.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        heading.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 275));
        heading.Controls.Add(new BrandMark { Margin = new Padding(0, 5, 14, 0) }, 0, 0);
        var intro = new Panel { Dock = DockStyle.Fill, Margin = new Padding(0) };
        intro.Controls.Add(new Label { Text = "YouTube Downloader", Location = new Point(0, 0), AutoSize = true, Font = new Font("Segoe UI", 23F, FontStyle.Bold) });
        intro.Controls.Add(new Label { Text = "Your favourite videos and audio, ready for offline.", Location = new Point(1, 44), AutoSize = true, ForeColor = muted, Font = new Font("Segoe UI", 9.5F) });
        heading.Controls.Add(intro, 1, 0);
        var shortcuts = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Padding = new Padding(0, 12, 0, 30), Margin = new Padding(0) };
        shortcuts.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        shortcuts.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 48)); shortcuts.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 52));
        StyleButton(browser, false); browser.Text = "Browser view"; browser.Dock = DockStyle.Fill; browser.Margin = new Padding(0, 0, 8, 0); browser.Enabled = false;
        browser.Click += delegate { OpenBrowser(""); };
        var desktop = MakeButton("Desktop shortcut", false); desktop.Dock = DockStyle.Fill; desktop.Margin = new Padding(0);
        desktop.Click += delegate { RevealShortcut(); };
        tips.SetToolTip(desktop, "Find the shortcut file, then drag or copy it to your desktop.");
        shortcuts.Controls.Add(browser, 0, 0); shortcuts.Controls.Add(desktop, 1, 0); heading.Controls.Add(shortcuts, 2, 0); layout.Controls.Add(heading, 0, 0);

        var composer = new SoftCard { Dock = DockStyle.Fill, BackColor = Color.White, Padding = new Padding(20, 14, 20, 16), Margin = new Padding(0, 0, 0, 0) };
        var composerLayout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, Margin = new Padding(0), BackColor = Color.White };
        composerLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        composerLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 39)); composerLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        composerLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 29)); composerLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 65));
        var inputHeader = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = new Padding(0) };
        inputHeader.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        inputHeader.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); inputHeader.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 138));
        inputHeader.Controls.Add(new Label { Text = "1   Add your YouTube links", AutoSize = true, Font = new Font("Segoe UI", 12F, FontStyle.Bold), Margin = new Padding(0, 7, 0, 0) }, 0, 0);
        var paste = MakeButton("Paste from clipboard", false); paste.Dock = DockStyle.Fill; paste.Margin = new Padding(0, 0, 0, 5);
        paste.Click += delegate {
            try { if (Clipboard.ContainsText()) links.AppendText((links.TextLength > 0 ? Environment.NewLine : "") + Clipboard.GetText().Trim()); }
            catch { SetStatus("Click in the link box and press Ctrl+V to paste.", true); } links.Focus();
        };
        inputHeader.Controls.Add(paste, 1, 0); composerLayout.Controls.Add(inputHeader, 0, 0);
        var inputFrame = new SoftCard { Dock = DockStyle.Fill, BackColor = Color.FromArgb(248, 250, 247), Padding = new Padding(12, 8, 12, 8), Margin = new Padding(0) };
        links.Multiline = true; links.ScrollBars = ScrollBars.Vertical; links.Dock = DockStyle.Fill;
        links.BorderStyle = BorderStyle.None; links.BackColor = inputFrame.BackColor; links.Font = new Font("Segoe UI", 10.5F); links.AccessibleName = "YouTube links"; links.TabIndex = 0;
        inputFrame.Controls.Add(links); composerLayout.Controls.Add(inputFrame, 0, 1);
        inputHint.Text = "Paste a video or Shorts link. One link per line, up to 20 at once."; inputHint.ForeColor = muted; inputHint.Dock = DockStyle.Fill;
        inputHint.Margin = new Padding(0, 5, 0, 0); inputHint.Font = new Font("Segoe UI", 9F);
        links.TextChanged += delegate {
            var number = Regex.Matches(links.Text.Trim(), @"\S+").Count;
            inputHint.Text = number == 0 ? "Paste a video or Shorts link. One link per line, up to 20 at once." : number + (number == 1 ? " link ready" : " links ready") + "  ·  Ctrl+Enter to download";
            inputHint.ForeColor = number > 20 ? Color.FromArgb(178, 64, 48) : muted;
        };
        composerLayout.Controls.Add(inputHint, 0, 2);
        var options = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 2, Margin = new Padding(0) };
        options.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 39)); options.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 32)); options.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 29));
        options.RowStyles.Add(new RowStyle(SizeType.Absolute, 25)); options.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        options.Controls.Add(new Label { Text = "2   Save as", AutoSize = true, ForeColor = muted, Font = new Font("Segoe UI", 9F, FontStyle.Bold) }, 0, 0);
        qualityLabel.Text = "Video quality"; qualityLabel.AutoSize = true; qualityLabel.ForeColor = muted; qualityLabel.Font = new Font("Segoe UI", 9F, FontStyle.Bold); qualityLabel.Margin = new Padding(12, 0, 0, 0); options.Controls.Add(qualityLabel, 1, 0);
        options.Controls.Add(new Label { Text = "3   Save to your computer", AutoSize = true, ForeColor = muted, Font = new Font("Segoe UI", 9F, FontStyle.Bold), Margin = new Padding(15, 0, 0, 0) }, 2, 0);
        format.Items.AddRange(new object[] { "Video", "MP3 audio" }); format.SelectedIndex = 0;
        var formats = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = new Padding(0) };
        formats.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        formats.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50)); formats.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        StyleFormatChoice(videoChoice, "Video", true); StyleFormatChoice(audioChoice, "MP3 audio", false);
        videoChoice.Margin = new Padding(0, 0, 6, 0); audioChoice.Margin = new Padding(0);
        videoChoice.CheckedChanged += delegate { if (videoChoice.Checked) format.SelectedIndex = 0; UpdateFormatChoices(); };
        audioChoice.CheckedChanged += delegate { if (audioChoice.Checked) format.SelectedIndex = 1; UpdateFormatChoices(); };
        formats.Controls.Add(videoChoice, 0, 0); formats.Controls.Add(audioChoice, 1, 0); options.Controls.Add(formats, 0, 1);
        quality.DropDownStyle = ComboBoxStyle.DropDownList; quality.Dock = DockStyle.Fill; quality.AccessibleName = "Quality"; quality.Margin = new Padding(12, 5, 0, 0); quality.Font = new Font("Segoe UI", 10F);
        SetVideoQualities();
        format.SelectedIndexChanged += delegate {
            quality.Items.Clear();
            if (format.SelectedIndex == 1) { quality.Items.Add("192 kbps MP3"); quality.SelectedIndex = 0; quality.Enabled = false; qualityLabel.Text = "Audio quality"; download.Text = "Download MP3"; }
            else { SetVideoQualities(); quality.Enabled = true; qualityLabel.Text = "Video quality"; download.Text = "Download videos"; }
        };
        options.Controls.Add(quality, 1, 1);
        StyleButton(download, true); download.Text = "Download videos"; download.Dock = DockStyle.Fill; download.Margin = new Padding(15, 0, 0, 0); download.Enabled = false;
        download.Click += async delegate { await AddDownloads(); }; options.Controls.Add(download, 2, 1);
        composerLayout.Controls.Add(options, 0, 3); composer.Controls.Add(composerLayout); layout.Controls.Add(composer, 0, 1);

        var extension = new SoftCard { Dock = DockStyle.Fill, BackColor = Color.FromArgb(236, 246, 239), BorderColor = Color.FromArgb(214, 234, 220), Padding = new Padding(18, 14, 18, 12), Margin = new Padding(0, 14, 0, 0) };
        var pairing = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1, Margin = new Padding(0), BackColor = extension.BackColor };
        pairing.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        pairing.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 46)); pairing.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 30)); pairing.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 24));
        var extensionIntro = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Margin = new Padding(0) };
        extensionIntro.RowStyles.Add(new RowStyle(SizeType.Absolute, 23)); extensionIntro.RowStyles.Add(new RowStyle(SizeType.Absolute, 24)); extensionIntro.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        extensionIntro.Controls.Add(new Label { Text = "Chrome companion", AutoSize = true, Font = new Font("Segoe UI", 11F, FontStyle.Bold), ForeColor = accent, Margin = new Padding(0) }, 0, 0);
        extensionIntro.Controls.Add(new Label { Text = "Send the video you're watching to this app.", AutoSize = true, ForeColor = muted, Font = new Font("Segoe UI", 9F), Margin = new Padding(0) }, 0, 1);
        extensionStatus.Text = "Starting connection…"; extensionStatus.AutoSize = true; extensionStatus.ForeColor = muted; extensionStatus.Font = new Font("Segoe UI", 9F); extensionStatus.Margin = new Padding(0, 3, 0, 0); extensionIntro.Controls.Add(extensionStatus, 0, 2); pairing.Controls.Add(extensionIntro, 0, 0);
        var codeLayout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 2, Margin = new Padding(8, 0, 12, 0) };
        codeLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); codeLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 84));
        codeLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 25)); codeLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        codeLayout.Controls.Add(new Label { Text = "PAIRING CODE", AutoSize = true, ForeColor = muted, Font = new Font("Segoe UI", 8F, FontStyle.Bold), Margin = new Padding(0, 4, 0, 0) }, 0, 0); codeLayout.SetColumnSpan(codeLayout.GetControlFromPosition(0, 0), 2);
        pairingCode.Text = "--------"; pairingCode.Font = new Font("Consolas", 15F, FontStyle.Bold); pairingCode.ForeColor = accent; pairingCode.Dock = DockStyle.Fill; pairingCode.TextAlign = ContentAlignment.MiddleLeft; pairingCode.Margin = new Padding(0); pairingCode.AccessibleName = "Chrome extension pairing code";
        StyleButton(copyCode, false); copyCode.Text = "Copy code"; copyCode.Dock = DockStyle.Fill; copyCode.Enabled = false; copyCode.Margin = new Padding(3, 6, 0, 5);
        copyCode.Click += delegate { try { if (!String.IsNullOrEmpty(currentPairingCode)) { Clipboard.SetText(currentPairingCode); SetStatus("Pairing code copied. Paste it into the Chrome extension.", false); } } catch { SetStatus("Select and copy the code from Browser view.", true); } };
        codeLayout.Controls.Add(pairingCode, 0, 1); codeLayout.Controls.Add(copyCode, 1, 1); pairing.Controls.Add(codeLayout, 1, 0);
        var extensionActions = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Margin = new Padding(0) };
        extensionActions.RowStyles.Add(new RowStyle(SizeType.Percent, 50)); extensionActions.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
        StyleButton(extensionGuide, false); extensionGuide.Text = "Install Chrome extension"; extensionGuide.Dock = DockStyle.Fill; extensionGuide.Enabled = false; extensionGuide.Margin = new Padding(0, 0, 0, 6); extensionGuide.Click += delegate { OpenBrowser("/#extension"); };
        StyleButton(disconnect, false); disconnect.Text = "Disconnect extension"; disconnect.Dock = DockStyle.Fill; disconnect.Enabled = false; disconnect.Margin = new Padding(0);
        disconnect.Click += async delegate { try { await Api("extension/disconnect", new Dictionary<string, object>()); await RefreshQueue(); SetStatus("Extension disconnected. Use the new code to reconnect.", false); } catch (Exception ex) { SetStatus(ex.Message, true); } };
        extensionActions.Controls.Add(extensionGuide, 0, 0); extensionActions.Controls.Add(disconnect, 0, 1); pairing.Controls.Add(extensionActions, 2, 0); extension.Controls.Add(pairing); layout.Controls.Add(extension, 0, 2);

        var queueHeader = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1, Margin = new Padding(0), Padding = new Padding(0, 10, 0, 4) };
        queueHeader.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        queueHeader.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 164)); queueHeader.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); queueHeader.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 196));
        count.Text = "Your downloads"; count.Font = new Font("Segoe UI", 12F, FontStyle.Bold); count.AutoSize = true; count.Margin = new Padding(0, 4, 0, 0); queueHeader.Controls.Add(count, 0, 0);
        queueSummary.Text = "0 saved  ·  0 in progress"; queueSummary.ForeColor = muted; queueSummary.Dock = DockStyle.Fill; queueSummary.TextAlign = ContentAlignment.MiddleLeft; queueSummary.Font = new Font("Segoe UI", 9F); queueHeader.Controls.Add(queueSummary, 1, 0);
        var folder = MakeButton("Open downloads folder", false); folder.Dock = DockStyle.Fill; folder.Margin = new Padding(0);
        folder.Click += delegate { try { Directory.CreateDirectory(Program.Downloads); Process.Start("explorer.exe", "\"" + Program.Downloads + "\""); } catch (Exception ex) { SetStatus(ex.Message, true); } };
        tips.SetToolTip(folder, "All files are saved in the downloads folder beside this app."); queueHeader.Controls.Add(folder, 2, 0); layout.Controls.Add(queueHeader, 0, 3);

        list.Dock = DockStyle.Fill; list.View = View.Details; list.FullRowSelect = true; list.MultiSelect = false; list.HideSelection = false; list.BorderStyle = BorderStyle.None;
        list.BackColor = Color.White; list.Font = new Font("Segoe UI", 9.5F); list.HeaderStyle = ColumnHeaderStyle.Nonclickable;
        list.Columns.Add("Video / audio", 250); list.Columns.Add("Format", 110); list.Columns.Add("Status", 112); list.Columns.Add("Progress", 78); list.Columns.Add("Details", 200); list.Columns.Add("Attempt", 62); list.Columns.Add("Log", 78);
        list.AccessibleName = "Download queue"; list.ShowItemToolTips = true;
        list.Resize += delegate { ResizeQueueColumns(); };
        var rowHeight = new ImageList { ImageSize = new Size(1, 37), ColorDepth = ColorDepth.Depth32Bit }; list.SmallImageList = rowHeight;
        list.MouseClick += delegate(object sender, MouseEventArgs e) {
            var hit = list.HitTest(e.Location);
            if (hit.Item != null && hit.SubItem == hit.Item.SubItems[6]) {
                Dictionary<string, object> job;
                if (jobs.TryGetValue((string)hit.Item.Tag, out job)) OpenJobLog(job);
            }
        };
        list.DoubleClick += delegate { var job = SelectedJob(); if (job != null && Value(job, "status") == "completed") RevealDownload(job); };
        list.SelectedIndexChanged += delegate { UpdateSelection(); };
        var queueCard = new SoftCard { Dock = DockStyle.Fill, BackColor = Color.White, Padding = new Padding(9, 7, 9, 8), Margin = new Padding(0) }; queueCard.Controls.Add(list);
        emptyQueue.Dock = DockStyle.Fill; emptyQueue.BackColor = Color.White;
        var emptyContent = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, BackColor = Color.White };
        emptyContent.RowStyles.Add(new RowStyle(SizeType.Percent, 50)); emptyContent.RowStyles.Add(new RowStyle(SizeType.Absolute, 32)); emptyContent.RowStyles.Add(new RowStyle(SizeType.Absolute, 26)); emptyContent.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
        emptyContent.Controls.Add(new Label { Text = "Your downloads will appear here", Dock = DockStyle.Fill, Font = new Font("Segoe UI", 13F, FontStyle.Bold), TextAlign = ContentAlignment.MiddleCenter, ForeColor = ink, Margin = new Padding(0) }, 0, 1);
        emptyContent.Controls.Add(new Label { Text = "Paste a link above to save your first video or MP3.", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, ForeColor = muted, Font = new Font("Segoe UI", 9.5F), Margin = new Padding(0) }, 0, 2);
        emptyQueue.Controls.Add(emptyContent); queueCard.Controls.Add(emptyQueue); emptyQueue.BringToFront(); layout.Controls.Add(queueCard, 0, 4);
        var bottom = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Margin = new Padding(0), Padding = new Padding(0, 7, 0, 0) };
        bottom.RowStyles.Add(new RowStyle(SizeType.Absolute, 8)); bottom.RowStyles.Add(new RowStyle(SizeType.Absolute, 33)); bottom.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        selectedProgress.Dock = DockStyle.Fill; selectedProgress.Maximum = 100; selectedProgress.Style = ProgressBarStyle.Continuous; selectedProgress.Margin = new Padding(0); selectedProgress.Visible = false; bottom.Controls.Add(selectedProgress, 0, 0);
        details.ReadOnly = true; details.Multiline = true; details.Dock = DockStyle.Fill; details.BorderStyle = BorderStyle.None; details.BackColor = BackColor; details.ForeColor = muted; details.Font = new Font("Segoe UI", 9F);
        details.Text = "Your queue is empty. Paste a YouTube link above to begin."; details.Margin = new Padding(0, 5, 0, 0); bottom.Controls.Add(details, 0, 1);
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, Margin = new Padding(0) };
        StyleButton(cancel, false); cancel.Text = "Cancel selected"; cancel.Width = 136; cancel.Enabled = false;
        StyleButton(retry, false); retry.Text = "Retry selected"; retry.Width = 130; retry.Enabled = false;
        StyleButton(clear, false); clear.Text = "Clear finished"; clear.Width = 126; clear.Enabled = false;
        StyleButton(openLog, false); openLog.Text = "Open log"; openLog.Width = 103; openLog.Enabled = false;
        openLog.Click += delegate { OpenJobLog(SelectedJob()); };
        var logFolder = MakeButton("Open logs folder", false); logFolder.Width = 142;
        logFolder.Click += delegate { try { Directory.CreateDirectory(Program.Logs); Process.Start("explorer.exe", "\"" + Program.Logs + "\""); } catch (Exception ex) { SetStatus(ex.Message, true); } };
        cancel.Click += async delegate { await CancelSelected(); }; retry.Click += async delegate { await RetrySelected(); };
        clear.Click += async delegate { try { await Api("clear", new Dictionary<string, object>()); await RefreshQueue(); } catch (Exception ex) { SetStatus(ex.Message, true); } };
        actions.Controls.AddRange(new Control[] { cancel, retry, openLog, clear, logFolder }); bottom.Controls.Add(actions, 0, 2); layout.Controls.Add(bottom, 0, 5);
        status.Text = "Starting downloader…"; status.ForeColor = muted; status.Dock = DockStyle.Fill; status.TextAlign = ContentAlignment.MiddleLeft; status.AutoEllipsis = true; status.Font = new Font("Segoe UI", 9F); status.Margin = new Padding(0); layout.Controls.Add(status, 0, 6);
        timer.Interval = 750; timer.Tick += async delegate { await RefreshQueue(); };
        KeyDown += async delegate(object sender, KeyEventArgs e) {
            if (e.Control && e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; await AddDownloads(); }
            if (e.Control && e.KeyCode == Keys.L) { e.SuppressKeyPress = true; links.Focus(); }
        };
        UpdateFormatChoices();
        Shown += delegate { StartBackend(); links.Focus(); }; FormClosed += delegate { Shutdown(); tips.Dispose(); rowHeight.Dispose(); };
    }

    private void SetVideoQualities() { quality.Items.Clear(); quality.Items.AddRange(new object[] { "1080p - Full HD", "720p - Smaller file", "480p - Smallest file", "Best available" }); quality.SelectedIndex = 0; }
    private Button MakeButton(string text, bool primary) { var button = new SoftButton { Text = text }; StyleButton(button, primary); return button; }
    private void StyleButton(Button button, bool primary) {
        button.Height = 35; button.FlatStyle = FlatStyle.Flat; button.FlatAppearance.BorderSize = 0;
        button.BackColor = primary ? accent : Color.White; button.ForeColor = primary ? Color.White : ink;
        button.Font = new Font("Segoe UI", primary ? 10F : 9F, primary ? FontStyle.Bold : FontStyle.Regular); button.Cursor = Cursors.Hand; button.Margin = new Padding(0, 0, 8, 0);
        var soft = button as SoftButton; if (soft != null) soft.Primary = primary;
    }
    private void StyleFormatChoice(RadioButton choice, string text, bool selected) {
        choice.Text = text; choice.Appearance = Appearance.Button; choice.FlatStyle = FlatStyle.Flat; choice.Dock = DockStyle.Fill;
        choice.TextAlign = ContentAlignment.MiddleCenter; choice.Font = new Font("Segoe UI", 10F, FontStyle.Bold); choice.Cursor = Cursors.Hand;
        choice.Checked = selected; choice.AccessibleName = "Save as " + text;
    }
    private void UpdateFormatChoices() {
        foreach (var choice in new RadioButton[] { videoChoice, audioChoice }) {
            choice.BackColor = choice.Checked ? Color.FromArgb(233, 246, 238) : Color.FromArgb(247, 249, 245);
            choice.ForeColor = choice.Checked ? accent : muted;
            choice.FlatAppearance.BorderColor = choice.Checked ? accent : Color.FromArgb(223, 230, 222);
            choice.FlatAppearance.CheckedBackColor = Color.FromArgb(233, 246, 238);
        }
    }
    private void ResizeQueueColumns() {
        if (list.Columns.Count < 7) return;
        double scale; using (var canvas = list.CreateGraphics()) scale = canvas.DpiX / 96.0;
        int formatWidth = (int)(110 * scale), stateWidth = (int)(112 * scale), progressWidth = (int)(78 * scale), attemptWidth = (int)(62 * scale), logWidth = (int)(78 * scale);
        int flexible = Math.Max((int)(300 * scale), list.ClientSize.Width - formatWidth - stateWidth - progressWidth - attemptWidth - logWidth - 4);
        list.Columns[0].Width = (int)(flexible * .54); list.Columns[1].Width = formatWidth; list.Columns[2].Width = stateWidth;
        list.Columns[3].Width = progressWidth; list.Columns[4].Width = flexible - list.Columns[0].Width;
        list.Columns[5].Width = attemptWidth; list.Columns[6].Width = logWidth;
    }
    private void OpenBrowser(string suffix) {
        if (!ready || String.IsNullOrEmpty(address)) { SetStatus("The app is still starting. Try again in a moment.", false); return; }
        try { Process.Start(new ProcessStartInfo(address + suffix) { UseShellExecute = true }); } catch (Exception ex) { SetStatus(ex.Message, true); }
    }
    private void RevealShortcut() {
        try {
            var shortcut = Path.Combine(Program.Root, "YouTube Downloader.lnk");
            object shell = null, link = null;
            try {
                var shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType != null) {
                    shell = Activator.CreateInstance(shellType);
                    link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcut });
                    var linkType = link.GetType();
                    linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { Application.ExecutablePath });
                    linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { Program.Root });
                    var iconFile = Path.Combine(Program.Tools, "app-icon.ico");
                    linkType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { (File.Exists(iconFile) ? iconFile : Application.ExecutablePath) + ",0" });
                    linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "Open YouTube Downloader" });
                    linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, new object[0]);
                }
            } finally { if (link != null) Marshal.FinalReleaseComObject(link); if (shell != null) Marshal.FinalReleaseComObject(shell); }
            if (File.Exists(shortcut)) { Process.Start("explorer.exe", "/select,\"" + shortcut + "\""); SetStatus("Drag or copy the selected shortcut file to your desktop.", false); }
            else { Process.Start("explorer.exe", "/select,\"" + Application.ExecutablePath + "\""); SetStatus("Right-click the selected app, then choose Send to > Desktop (create shortcut).", false); }
        } catch (Exception ex) { SetStatus(ex.Message, true); }
    }
    private void RevealDownload(Dictionary<string, object> job) {
        try {
            var name = Value(job, "filename"); if (String.IsNullOrEmpty(name) || Path.GetFileName(name) != name) return;
            var file = Path.Combine(Program.Downloads, name); if (File.Exists(file)) Process.Start("explorer.exe", "/select,\"" + file + "\"");
        } catch (Exception ex) { SetStatus(ex.Message, true); }
    }
    private void UpdateExtension(Dictionary<string, object> state) {
        object raw;
        var extension = state.TryGetValue("extension", out raw) ? raw as Dictionary<string, object> : null;
        if (extension == null) return;
        currentPairingCode = Value(extension, "pairingCode"); pairingCode.Text = String.IsNullOrEmpty(currentPairingCode) ? "--------" : currentPairingCode;
        object value; bool connected = extension.TryGetValue("connected", out value) && value is bool && (bool)value;
        copyCode.Enabled = currentPairingCode.Length > 0; disconnect.Enabled = connected;
        extensionStatus.Text = connected ? "Connected  ·  Ready to receive videos" : "Not connected  ·  Pair using this code";
        extensionStatus.ForeColor = connected ? accent : muted;
    }
    private static string Value(Dictionary<string, object> item, string key) { object value; return item.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : ""; }
    private static bool Active(string state) { return state == "queued" || state == "starting" || state == "downloading" || state == "merging" || state == "retrying"; }
    private void SetStatus(string text, bool error) { status.Text = text; status.ForeColor = error ? Color.FromArgb(177, 62, 43) : muted; }
    private void OnUi(Action action) { if (!closing && IsHandleCreated && !IsDisposed) try { BeginInvoke(action); } catch (InvalidOperationException) { } }

    private void StartBackend()
    {
        try {
            log = new StreamWriter(Path.Combine(Program.Tools, "app.log"), false, Encoding.UTF8) { AutoFlush = true }; log.WriteLine("Starting native Windows downloader.");
            var info = new ProcessStartInfo {
                FileName = Path.Combine(Program.Tools, "node.exe"), Arguments = "\"" + Path.Combine(Program.Root, "app", "server.js") + "\" --no-open --portable",
                WorkingDirectory = Program.Root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true
            };
            server = new Process { StartInfo = info, EnableRaisingEvents = true }; server.OutputDataReceived += BackendOutput; server.ErrorDataReceived += BackendOutput;
            server.Exited += delegate { OnUi(delegate { ready = false; download.Enabled = browser.Enabled = extensionGuide.Enabled = copyCode.Enabled = disconnect.Enabled = false; extensionStatus.Text = "Downloader is offline"; timer.Stop(); SetStatus("Downloader stopped. Close and reopen this window to restart.", true); }); };
            server.Start(); server.BeginOutputReadLine(); server.BeginErrorReadLine();
        } catch (Exception ex) { SetStatus(ex.Message, true); }
    }
    private void BackendOutput(object sender, DataReceivedEventArgs args)
    {
        if (args.Data == null || closing) return;
        lock (log) { if (!closing) log.WriteLine(args.Data); }
        const string prefix = "YouTube Downloader is ready: ";
        if (!args.Data.StartsWith(prefix, StringComparison.Ordinal)) return;
        address = args.Data.Substring(prefix.Length).Trim();
        if (!Regex.IsMatch(address, @"^http://127\.0\.0\.1:\d{1,5}$")) return;
        File.WriteAllText(Program.UrlFile, address);
        OnUi(async delegate {
            try {
                var html = await Task.Run(delegate { using (var client = new LocalWebClient()) return client.DownloadString(address); });
                token = Regex.Match(html, "name=\"app-token\" content=\"([a-f0-9]+)\"").Groups[1].Value;
                if (token.Length != 64) throw new Exception("Could not connect to the downloader. Please restart the app.");
                ready = true; download.Enabled = browser.Enabled = extensionGuide.Enabled = true; SetStatus("Ready  ·  Files save in the downloads folder beside this app  ·  Ctrl+Enter to download", false); timer.Start(); await RefreshQueue();
                lock (log) { if (!closing) log.WriteLine("Native window connected and ready."); }
            } catch (Exception ex) { if (!closing) SetStatus(ex.Message, true); }
        });
    }
    private async Task<Dictionary<string, object>> Api(string route, Dictionary<string, object> body)
    {
        return await Task.Run(delegate {
            using (var client = new LocalWebClient()) {
                client.Headers[HttpRequestHeader.Authorization] = "Bearer " + token;
                var json = new JavaScriptSerializer();
                try {
                    string response;
                    if (body == null) response = client.DownloadString(address + "/api/" + route);
                    else { client.Headers[HttpRequestHeader.ContentType] = "application/json"; response = client.UploadString(address + "/api/" + route, json.Serialize(body)); }
                    return (Dictionary<string, object>)json.DeserializeObject(response);
                } catch (WebException ex) {
                    string message = "Could not reach the downloader. Please reopen the app.";
                    if (ex.Response != null) using (var reader = new StreamReader(ex.Response.GetResponseStream())) { try { message = Value((Dictionary<string, object>)json.DeserializeObject(reader.ReadToEnd()), "error"); } catch { } }
                    throw new Exception(message);
                }
            }
        });
    }
    private async Task AddDownloads()
    {
        if (!ready || submitting) return;
        submitting = true; download.Enabled = false;
        try {
            var mode = format.SelectedIndex == 1 ? "mp3" : "video";
            var resolution = mode == "mp3" ? "192" : new string[] { "1080", "720", "480", "best" }[quality.SelectedIndex];
            var result = await Api("download", new Dictionary<string, object> { { "links", links.Text }, { "quality", resolution }, { "format", mode } });
            var ids = (object[])result["ids"]; if (ids.Length > 0) links.Clear();
            SetStatus(ids.Length > 0 ? ids.Length + " download(s) added to your queue." : "These downloads are already in the queue.", false); await RefreshQueue();
        } catch (Exception ex) { if (!closing) SetStatus(ex.Message, true); }
        finally { submitting = false; if (!closing) download.Enabled = ready; }
    }
    private async Task RefreshQueue()
    {
        if (!ready || polling || closing) return;
        polling = true;
        try {
            var state = await Api("state", null); if (closing) return; UpdateExtension(state);
            var items = (object[])state["jobs"]; var seen = new HashSet<string>(); int saved = 0, working = 0;
            list.BeginUpdate();
            try {
                foreach (Dictionary<string, object> job in items) {
                    var id = Value(job, "id"); seen.Add(id); jobs[id] = job; ListViewItem row;
                    if (!rows.TryGetValue(id, out row)) { row = new ListViewItem(new string[] { "", "", "", "", "", "", "" }) { Tag = id }; rows[id] = row; list.Items.Add(row); }
                    var stateName = Value(job, "status"); row.Text = Value(job, "title");
                    row.SubItems[1].Text = Value(job, "format") == "mp3" ? "MP3 - 192 kbps" : (Value(job, "quality") == "best" ? "Best video" : Value(job, "quality") + "p video");
                    row.SubItems[2].Text = stateName == "completed" ? "Saved" : stateName == "merging" ? "Finishing" : stateName == "starting" ? "Getting ready" : stateName.Length == 0 ? "Waiting" : char.ToUpper(stateName[0]) + stateName.Substring(1);
                    object progress; job.TryGetValue("progress", out progress); row.SubItems[3].Text = progress == null ? "…" : Math.Round(Convert.ToDouble(progress)) + "%";
                    row.SubItems[4].Text = stateName == "completed" ? Value(job, "filename") : Value(job, "message");
                    row.SubItems[5].Text = Value(job, "attempt") + "/" + Value(job, "maxAttempts");
                    row.SubItems[6].Text = "Open log";
                    row.UseItemStyleForSubItems = false;
                    row.SubItems[6].ForeColor = accent;
                    row.ForeColor = stateName == "failed" ? Color.FromArgb(171, 61, 44) : stateName == "completed" ? accent : ink;
                    row.BackColor = stateName == "failed" ? Color.FromArgb(255, 247, 244) : stateName == "completed" ? Color.FromArgb(245, 251, 247) : Color.White;
                    foreach (ListViewItem.ListViewSubItem cell in row.SubItems) { cell.ForeColor = row.ForeColor; cell.BackColor = row.BackColor; }
                    row.SubItems[6].ForeColor = accent;
                    row.ToolTipText = Value(job, "title") + Environment.NewLine + (stateName == "completed" ? Value(job, "filename") : Value(job, "message"));
                    if (stateName == "completed") saved++; if (Active(stateName)) working++;
                }
                foreach (var id in new List<string>(rows.Keys)) if (!seen.Contains(id)) { list.Items.Remove(rows[id]); rows.Remove(id); jobs.Remove(id); }
            } finally { list.EndUpdate(); }
            count.Text = "Your downloads"; queueSummary.Text = items.Length + " total  ·  " + saved + " saved  ·  " + working + " in progress"; clear.Enabled = items.Length > working;
            emptyQueue.Visible = items.Length == 0; list.Visible = items.Length > 0; if (items.Length > 0) ResizeQueueColumns();
            var summary = items.Length + " items, " + saved + " saved, " + working + " active";
            if (summary != lastQueueSummary) { lastQueueSummary = summary; lock (log) { if (!closing) log.WriteLine("Native queue updated: " + summary); } }
            if (lostConnection) SetStatus("Connected. Ready to download.", false); lostConnection = false; UpdateSelection();
        } catch (Exception ex) { if (!closing) { lostConnection = true; SetStatus(ex.Message, true); } }
        finally { polling = false; }
    }
    private Dictionary<string, object> SelectedJob() { if (list.SelectedItems.Count == 0) return null; Dictionary<string, object> job; return jobs.TryGetValue((string)list.SelectedItems[0].Tag, out job) ? job : null; }
    private void UpdateSelection() {
        var job = SelectedJob(); cancel.Enabled = job != null && Active(Value(job, "status")); retry.Enabled = job != null && (Value(job, "status") == "failed" || Value(job, "status") == "cancelled");
        openLog.Enabled = job != null && Value(job, "logFilename") != "";
        details.Text = job == null ? (jobs.Count == 0 ? "Nothing here yet. Paste a link above, choose Video or MP3, then download." : "Select a download to cancel, retry or view its log. Double-click a saved item to find the file.") : (Value(job, "logError") != "" ? Value(job, "logError") : (Value(job, "status") == "completed" ? "Saved to " + Path.Combine(Program.Downloads, Value(job, "filename")) : Value(job, "message")));
        selectedProgress.Visible = job != null && (Active(Value(job, "status")) || Value(job, "status") == "completed");
        object progress;
        selectedProgress.Value = job != null && job.TryGetValue("progress", out progress) && progress != null ? Math.Max(0, Math.Min(100, (int)Math.Round(Convert.ToDouble(progress)))) : 0;
    }
    private void OpenJobLog(Dictionary<string, object> job) {
        if (job == null) return;
        try {
            var name = Value(job, "logFilename");
            if (name == "" || Path.GetFileName(name) != name || Path.GetExtension(name) != ".log") throw new Exception("No log is available for this download.");
            var file = Path.Combine(Program.Logs, name);
            if (!File.Exists(file)) throw new Exception("This download's log file could not be found.");
            Process.Start("notepad.exe", "\"" + file + "\"");
        } catch (Exception ex) { SetStatus(ex.Message, true); }
    }
    private async Task CancelSelected() { var job = SelectedJob(); if (job == null) return; try { await Api("cancel", new Dictionary<string, object> { { "id", Value(job, "id") } }); await RefreshQueue(); } catch (Exception ex) { SetStatus(ex.Message, true); } }
    private async Task RetrySelected() { var job = SelectedJob(); if (job == null) return; try { await Api("download", new Dictionary<string, object> { { "links", Value(job, "url") }, { "quality", Value(job, "quality") }, { "format", Value(job, "format") } }); await RefreshQueue(); } catch (Exception ex) { SetStatus(ex.Message, true); } }
    private void Shutdown() {
        if (closing) return; closing = true; timer.Stop(); timer.Dispose();
        try { server.StandardInput.Close(); if (!server.WaitForExit(4000)) server.Kill(); server.Dispose(); } catch { }
        try { File.Delete(Program.UrlFile); } catch { }
        if (log != null) lock (log) log.Dispose();
    }
}
