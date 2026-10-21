// tabmark "<text>": writes text (escape sequences) to the console of the
// claude.exe this process runs under. Hooks get a hidden console of their own,
// so writing there never reaches the tab; this attaches to Claude's instead.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

static class TabMark
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Entry
    {
        public uint size, usage, pid;
        public IntPtr heap;
        public uint module, threads, ppid;
        public int priority;
        public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string exe;
    }

    [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snap, ref Entry e);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snap, ref Entry e);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern bool FreeConsole();
    [DllImport("kernel32.dll")] static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sec, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool WriteConsoleW(IntPtr h, string text, uint count, out uint written, IntPtr reserved);
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();

    static int Main(string[] args)
    {
        if (args.Length < 1) return 2;
        var parent = new Dictionary<uint, uint>();
        var name = new Dictionary<uint, string>();
        IntPtr snap = CreateToolhelp32Snapshot(2, 0);
        var e = new Entry { size = (uint)Marshal.SizeOf(typeof(Entry)) };
        for (bool ok = Process32FirstW(snap, ref e); ok; ok = Process32NextW(snap, ref e))
        {
            parent[e.pid] = e.ppid;
            name[e.pid] = e.exe;
        }
        CloseHandle(snap);

        uint at = GetCurrentProcessId();
        for (int i = 0; i < 20 && parent.ContainsKey(at); i++)
        {
            at = parent[at];
            string exe;
            if (name.TryGetValue(at, out exe) && exe.Equals("claude.exe", StringComparison.OrdinalIgnoreCase))
            {
                FreeConsole();
                if (!AttachConsole(at)) return 3;
                IntPtr con = CreateFileW("CONOUT$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
                uint written;
                return WriteConsoleW(con, args[0], (uint)args[0].Length, out written, IntPtr.Zero) ? 0 : 4;
            }
        }
        return 1;
    }
}
