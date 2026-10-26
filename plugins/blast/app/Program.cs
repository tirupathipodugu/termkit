using System.Windows.Forms;

namespace TerminalBlast;

static class Program
{
    /// <summary>
    /// Click it and it blows up the window on top: a grenade lands on it, Ctrl+C goes to it (twice, so Claude
    /// Code exits), then it explodes, the window closes and its picture bursts into pieces. Only terminals are
    /// touched unless started with --any. --silent turns the sound off; --hwnd <hex handle> aims at one window.
    /// </summary>
    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Sound.On = !args.Contains("--silent");
        bool any = args.Contains("--any");

        // --hwnd <handle> aims at one window (for testing without risking the terminal you are in)
        int at = Array.IndexOf(args, "--hwnd");
        // --stage with.png,without.png --rect x,y,w,h: blow up a window in a picture (for demo videos, with --film)
        int stage = Array.IndexOf(args, "--stage"), rect = Array.IndexOf(args, "--rect");
        if (stage >= 0 && rect >= 0)
        {
            Blast.Stage = args[stage + 1].Split(',');
            var n = args[rect + 1].Split(',').Select(int.Parse).ToArray();
            Blast.StageRect = new System.Drawing.Rectangle(n[0], n[1], n[2], n[3]);
        }
        var target = Blast.Stage != null ? IntPtr.Zero
                   : at >= 0 && at + 1 < args.Length ? new IntPtr(Convert.ToInt64(args[at + 1], 16))
                   : Native.TopWindow(terminalsOnly: !any);
        if (target == IntPtr.Zero && Blast.Stage == null)
        {
            MessageBox.Show(any ? "There is no window on screen to blow up."
                                : "The window on top isn't a terminal, so nothing was blown up.\n\nBring the terminal to the front and run Terminal Blast again.",
                            "Terminal Blast", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        // --record-audio <file.wav>: also write the soundtrack, aligned to the moment the app started
        // (or, when /blast starts it with no arguments, the path written in %TEMP%/TerminalBlast/record-audio.txt)
        int rec = Array.IndexOf(args, "--record-audio");
        var flag = Path.Combine(Path.GetTempPath(), "TerminalBlast", "record-audio.txt");
        string wav = rec >= 0 && rec + 1 < args.Length ? args[rec + 1] : File.Exists(flag) ? File.ReadAllText(flag).Trim() : null;
        // --film <file.mkv> (or, when /blast starts it with no arguments, the path in %TEMP%/TerminalBlast/film.txt):
        // render a smooth video instead of drawing live, and write its soundtrack next to it
        int film = Array.IndexOf(args, "--film");
        var filmFlag = Path.Combine(Path.GetTempPath(), "TerminalBlast", "film.txt");
        Blast.Film = film >= 0 && film + 1 < args.Length ? args[film + 1] : File.Exists(filmFlag) ? File.ReadAllText(filmFlag).Trim() : null;
        if (Blast.Film != null) { wav = Path.ChangeExtension(Blast.Film, ".wav"); Sound.On = false; }
        Sound.Keep = wav != null;
        int perf = Array.IndexOf(args, "--perf");
        if (perf >= 0 && perf + 1 < args.Length) Blast.PerfLog = args[perf + 1];   // frame times, for tuning
        int skip = Array.IndexOf(args, "--skip");
        if (skip >= 0 && skip + 1 < args.Length) Blast.Skip = new HashSet<string>(args[skip + 1].Split(','));
        new System.Windows.Application { ShutdownMode = System.Windows.ShutdownMode.OnMainWindowClose }.Run(new Blast(target));
        if (wav != null) Sound.SaveWav(wav);
    }
}
