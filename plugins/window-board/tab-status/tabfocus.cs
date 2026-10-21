// tabfocus --list                 prints every Windows Terminal tab's title
// tabfocus <text> [<more text>]   switches to the tab whose title holds all the
//                                 given texts, and brings its window to the front
// Windows Terminal shows its tabs to UI Automation, which can select one.
using System;
using System.Runtime.InteropServices;
using System.Windows.Automation;

static class TabFocus
{
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);

    static int Main(string[] args)
    {
        if (args.Length < 1) return 2;
        var windows = AutomationElement.RootElement.FindAll(TreeScope.Children,
            new PropertyCondition(AutomationElement.ClassNameProperty, "CASCADIA_HOSTING_WINDOW_CLASS"));
        var isTab = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem);

        foreach (AutomationElement window in windows)
        {
            foreach (AutomationElement tab in window.FindAll(TreeScope.Descendants, isTab))
            {
                string name = tab.Current.Name ?? "";
                if (args[0] == "--list")
                {
                    Console.WriteLine(name);
                    continue;
                }
                bool all = true;
                foreach (string want in args)
                    if (want.Length > 0 && name.IndexOf(want, StringComparison.OrdinalIgnoreCase) < 0) all = false;
                if (!all) continue;

                object pattern;
                if (tab.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern))
                    ((SelectionItemPattern)pattern).Select();
                IntPtr hwnd = new IntPtr(window.Current.NativeWindowHandle);
                if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
                // A tap of Alt lets this process hand the foreground to another window.
                keybd_event(0x12, 0, 0, UIntPtr.Zero);
                keybd_event(0x12, 0, 2, UIntPtr.Zero);
                SetForegroundWindow(hwnd);
                Console.WriteLine(name);
                return 0;
            }
        }
        return args[0] == "--list" ? 0 : 1;
    }
}
