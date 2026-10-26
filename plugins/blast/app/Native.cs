using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace TerminalBlast;

/// <summary>Win32 calls: finding the top window, sending it keys, and drawing a see-through overlay.</summary>
static class Native
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; public int Width => Right - Left; public int Height => Bottom - Top; }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct SIZE { public int W, H; }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct BLENDFUNCTION { public byte Op, Flags, Alpha, Format; }

    [StructLayout(LayoutKind.Sequential)]
    public struct BITMAPINFOHEADER
    {
        public int biSize, biWidth, biHeight;
        public short biPlanes, biBitCount;
        public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant;
    }

    public const int GW_HWNDNEXT = 2, GWL_EXSTYLE = -20, GWL_STYLE = -16;
    public const int WS_EX_TOPMOST = 0x8, WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80, WS_EX_LAYERED = 0x80000,
                     WS_EX_NOACTIVATE = 0x8000000, WS_EX_APPWINDOW = 0x40000;
    public const uint WM_CLOSE = 0x10, SWP_NOSIZE = 0x1, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_ASYNCWINDOWPOS = 0x4000;
    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;

    [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int index, int value);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder s, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int max);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT r, int size);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int v, int size);

    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr dc);
    [DllImport("user32.dll")]
    public static extern bool UpdateLayeredWindow(IntPtr hWnd, IntPtr dst, ref POINT ptDst, ref SIZE size, IntPtr src,
                                                  ref POINT ptSrc, int key, ref BLENDFUNCTION blend, int flags);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFOHEADER bmi, uint usage, out IntPtr bits, IntPtr section, uint offset);

    static readonly string[] SkipClasses =
        { "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW", "NotifyIconOverflowWindow",
          "Windows.UI.Core.CoreWindow", "XamlExplorerHostIslandWindow", "TopLevelWindowForOverflowXamlIsland" };

    // processes that draw a terminal; only these are blown up unless --any is passed
    static readonly string[] Terminals =
        { "WindowsTerminal", "OpenConsole", "conhost", "cmd", "powershell", "pwsh", "wezterm-gui", "alacritty",
          "mintty", "Hyper", "Tabby", "warp", "ConEmu", "ConEmu64", "kitty", "Termius", "MobaXterm", "putty" };

    public static string ClassOf(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
    public static string TitleOf(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }

    public static string ProcessOf(IntPtr h)
    {
        GetWindowThreadProcessId(h, out var pid);
        try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
    }

    public static bool IsTerminal(IntPtr h)
    {
        var cls = ClassOf(h);
        if (cls is "CASCADIA_HOSTING_WINDOW_CLASS" or "ConsoleWindowClass") return true;
        var p = ProcessOf(h);
        return Terminals.Any(t => string.Equals(t, p, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The window the user sees on top: the first real app window in z-order that isn't ours.</summary>
    public static IntPtr TopWindow(bool terminalsOnly)
    {
        uint me = (uint)Process.GetCurrentProcess().Id;
        for (var h = GetTopWindow(IntPtr.Zero); h != IntPtr.Zero; h = GetWindow(h, GW_HWNDNEXT))
        {
            if (!IsWindowVisible(h) || IsIconic(h)) continue;
            GetWindowThreadProcessId(h, out var pid);
            if (pid == me) continue;
            int ex = GetWindowLong(h, GWL_EXSTYLE);
            if ((ex & (WS_EX_TRANSPARENT | WS_EX_NOACTIVATE)) != 0) continue;
            if ((ex & WS_EX_TOOLWINDOW) != 0 && (ex & WS_EX_APPWINDOW) == 0) continue;
            if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out int cloaked, 4) == 0 && cloaked != 0) continue;
            if (SkipClasses.Contains(ClassOf(h)) || TitleOf(h).Length == 0) continue;
            var r = VisibleRect(h);
            if (r.Width < 80 || r.Height < 60) continue;
            // the top real window decides: if it isn't a terminal we stop here rather than reach past it
            return !terminalsOnly || IsTerminal(h) ? h : IntPtr.Zero;
        }
        return IntPtr.Zero;
    }

    /// <summary>The window's on-screen rectangle without the invisible resize border.</summary>
    public static RECT VisibleRect(IntPtr h)
    {
        if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out RECT r, Marshal.SizeOf<RECT>()) == 0) return r;
        GetWindowRect(h, out r);
        return r;
    }

    public static void Focus(IntPtr h)
    {
        if (GetForegroundWindow() == h || SetForegroundWindow(h) && GetForegroundWindow() == h) return;
        // refused: a tap of Alt lets this process hand the foreground to another window
        keybd_event(0x12, 0, 0, IntPtr.Zero);
        keybd_event(0x12, 0, 2, IntPtr.Zero);
        SetForegroundWindow(h);
    }

    /// <summary>Press a key combo, e.g. Chord(0x11, 0x43) for Ctrl+C.</summary>
    public static void Chord(params byte[] keys)
    {
        foreach (var k in keys) keybd_event(k, 0, 0, IntPtr.Zero);
        foreach (var k in keys.Reverse()) keybd_event(k, 0, 2, IntPtr.Zero);
    }
}
