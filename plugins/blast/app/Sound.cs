using System.Runtime.InteropServices;

namespace TerminalBlast;

/// <summary>The blast's sound effects, synthesised and played through waveOut, one device handle per sound
/// so they can overlap.</summary>
static class Sound
{
    const int SR = 44100;
    public static bool On = true;
    static readonly Random R = new();

    [StructLayout(LayoutKind.Sequential)]
    struct WAVEFORMATEX { public short wFormatTag, nChannels; public int nSamplesPerSec, nAvgBytesPerSec; public short nBlockAlign, wBitsPerSample, cbSize; }

    [StructLayout(LayoutKind.Sequential)]
    struct WAVEHDR { public IntPtr lpData; public uint dwBufferLength, dwBytesRecorded; public IntPtr dwUser; public uint dwFlags, dwLoops; public IntPtr lpNext, reserved; }

    [DllImport("winmm.dll")] static extern int waveOutOpen(out IntPtr h, uint dev, ref WAVEFORMATEX fmt, IntPtr cb, IntPtr inst, uint flags);
    [DllImport("winmm.dll")] static extern int waveOutPrepareHeader(IntPtr h, IntPtr hdr, int size);
    [DllImport("winmm.dll")] static extern int waveOutWrite(IntPtr h, IntPtr hdr, int size);

    // --record-audio: every sound is also kept with its start time, so a screen recording (which has no
    // sound) can get the exact track afterwards
    static readonly List<(double at, float[] s)> taken = new();
    static readonly System.Diagnostics.Stopwatch since = System.Diagnostics.Stopwatch.StartNew();
    public static bool Keep;
    public static Func<double> Clock;   // when filming, sounds are timed by the film's frames, not the wall clock

    public static void SaveWav(string path)
    {
        int n = taken.Count == 0 ? 1 : taken.Max(t => (int)(t.at * SR) + t.s.Length);
        var mix = new float[n];
        foreach (var (at, s) in taken)
            for (int i = 0, o = (int)(at * SR); i < s.Length && o + i < n; i++) mix[o + i] += s[i];
        using var w = new BinaryWriter(File.Create(path));
        w.Write("RIFF".ToCharArray()); w.Write(36 + n * 2); w.Write("WAVEfmt ".ToCharArray());
        w.Write(16); w.Write((short)1); w.Write((short)1); w.Write(SR); w.Write(SR * 2); w.Write((short)2); w.Write((short)16);
        w.Write("data".ToCharArray()); w.Write(n * 2);
        foreach (var v in mix) w.Write((short)(Math.Tanh(v * 1.2) * 30000));
    }

    /// <summary>Play mono samples (-1..1). The buffers are never freed: the app lives for a few seconds.</summary>
    static void Play(float[] s)
    {
        if (Keep) taken.Add((Clock?.Invoke() ?? since.Elapsed.TotalSeconds, s));
        if (!On) return;
        var fmt = new WAVEFORMATEX { wFormatTag = 1, nChannels = 1, nSamplesPerSec = SR, nAvgBytesPerSec = SR * 2, nBlockAlign = 2, wBitsPerSample = 16 };
        if (waveOutOpen(out var h, 0xFFFFFFFF, ref fmt, IntPtr.Zero, IntPtr.Zero, 0) != 0) return;
        var pcm = new short[s.Length];
        for (int i = 0; i < s.Length; i++) pcm[i] = (short)(Math.Tanh(s[i] * 1.2) * 30000);
        var data = Marshal.AllocHGlobal(pcm.Length * 2);
        Marshal.Copy(pcm, 0, data, pcm.Length);
        var hdr = new WAVEHDR { lpData = data, dwBufferLength = (uint)(pcm.Length * 2) };
        int size = Marshal.SizeOf<WAVEHDR>();
        var ph = Marshal.AllocHGlobal(size);
        Marshal.StructureToPtr(hdr, ph, false);
        waveOutPrepareHeader(h, ph, size);
        waveOutWrite(h, ph, size);
    }

    /// <summary>Exponential ramp from a to b between t0 and t1 (Web Audio's exponentialRampToValueAtTime).</summary>
    static double Ramp(double t, double t0, double a, double t1, double b) =>
        t <= t0 ? a : t >= t1 ? b : a * Math.Pow(b / a, (t - t0) / (t1 - t0));

    static double Env(double t, double peak, double atk, double dec) =>
        t < atk ? Ramp(t, 0, .0001, atk, peak) : Ramp(t, atk, peak, atk + dec, .0001);

    /// <summary>A band-pass filter whose centre can move every sample.</summary>
    sealed class BandPass
    {
        double x1, x2, y1, y2;
        public double Run(double x, double f, double q)
        {
            double w = 2 * Math.PI * f / SR, al = Math.Sin(w) / (2 * q), a0 = 1 + al;
            double y = (al * x - al * x2 + 2 * Math.Cos(w) * y1 - (1 - al) * y2) / a0;
            x2 = x1; x1 = x; y2 = y1; y1 = y;
            return y;
        }
    }

    static float[] Make(double dur, Func<double, double> f)
    {
        var s = new float[(int)(dur * SR)];
        for (int i = 0; i < s.Length; i++) s[i] = (float)f((double)i / SR);
        return s;
    }

    static double Noise() => R.NextDouble() * 2 - 1;

    sealed class LowPass
    {
        double x1, x2, y1, y2;
        public double Run(double x, double f, double q = .707)
        {
            double w = 2 * Math.PI * f / SR, al = Math.Sin(w) / (2 * q), cw = Math.Cos(w), a0 = 1 + al;
            double y = ((1 - cw) / 2 * (x + x2) + (1 - cw) * x1 + 2 * cw * y1 - (1 - al) * y2) / a0;
            x2 = x1; x1 = x; y2 = y1; y1 = y;
            return y;
        }
    }

    /// <summary>The grenade leaving a hand and tumbling through the air.</summary>
    public static void Throw()
    {
        var bp = new BandPass();
        Play(Make(.75, t => bp.Run(Noise(), Ramp(t, 0, 1100, .7, 240), 1.6) * Env(t, .45, .1, .6) * (1 + .5 * Math.Sin(2 * Math.PI * 9 * t)) * 2));
    }

    /// <summary>Cast iron landing on glass: a thump and a short metallic ring.</summary>
    public static void Clank(double k)
    {
        double[] fr = { 523, 1391, 2833, 4410 }, amp = { .5, .36, .22, .12 };
        double ph = 0;
        Play(Make(.6, t =>
        {
            double ring = 0;
            for (int i = 0; i < fr.Length; i++) ring += Math.Sin(2 * Math.PI * fr[i] * t + i) * amp[i] * Math.Exp(-t * (10 + i * 6));
            ph += 2 * Math.PI * Ramp(t, 0, 150, .12, 55) / SR;
            double click = t < .006 ? Noise() * (1 - t / .006) : 0;
            return (ring * .8 + Math.Sin(ph) * Math.Exp(-t * 20) + click * .7) * k;
        }));
    }

    /// <summary>The fuse burning: a hiss with crackles.</summary>
    public static void Fuse(double dur)
    {
        var bp = new BandPass();
        double pop = 0;
        Play(Make(dur, t =>
        {
            if (R.NextDouble() < 30.0 / SR) pop = .4 + R.NextDouble() * .6;
            pop *= .993;
            double g = Math.Min(1, t / .06) * Math.Min(1, (dur - t) / .03) * (1 + .3 * Math.Sin(2 * Math.PI * 13 * t));
            return (bp.Run(Noise(), 4300, 1.1) * .7 + Noise() * pop * .35) * g * .55;
        }));
    }

    /// <summary>The explosion: a crack, a roar falling from bright to dull, a sub-bass drop and a long rumble.</summary>
    public static void Boom()
    {
        double ph = 0;
        var lp = new LowPass();
        var lp2 = new LowPass();
        Play(Make(5, t =>
        {
            double crack = t < .035 ? Noise() * (1 - t / .035) * 1.8 : 0;
            double roar = lp.Run(Noise(), Ramp(t, 0, 3600, 1.6, 90), .8) * Env(t, 2.6, .004, 2.8);
            ph += 2 * Math.PI * Ramp(t, 0, 90, 1.4, 26) / SR;
            double sub = Math.Sin(ph) * Env(t, 1.4, .006, 2.4);
            double rumble = lp2.Run(Noise(), 65, .9) * Env(t, 9, .25, 4.5);
            return crack + roar + sub + rumble;
        }));
    }

    /// <summary>Glass and bits raining down for a few seconds after the blast.</summary>
    public static void Debris()
    {
        var s = new float[(int)(3.6 * SR)];
        for (int e = 0; e < 110; e++)
        {
            double at = .08 + 3.1 * Math.Pow(R.NextDouble(), 1.8), f = 2400 + R.NextDouble() * 5200;
            double a = (.12 + .2 * R.NextDouble()) * (1 - at / 3.4), decay = 40 + R.NextDouble() * 60;
            int o = (int)(at * SR);
            for (int i = 0; i < SR * .12 && o + i < s.Length; i++)
            {
                double t = (double)i / SR;
                s[o + i] += (float)((Math.Sin(2 * Math.PI * f * t) + .5 * Math.Sin(2 * Math.PI * f * 1.53 * t)) * a * Math.Exp(-t * decay));
            }
        }
        Play(s);
    }

    /// <summary>The ringing in your ears afterwards.</summary>
    public static void Ringing()
    {
        Play(Make(4.4, t => Math.Sin(2 * Math.PI * 3900 * t) * (t < .5 ? Ramp(t, 0, .0001, .5, .06) : Ramp(t, .5, .06, 4.4, .0001))));
    }

    /// <summary>A shard hitting the screen.</summary>
    public static void Crack()
    {
        var bp = new BandPass();
        Play(Make(.35, t => bp.Run(Noise(), 5200, .8) * Env(t, 1.4, .002, .2) + Math.Sin(2 * Math.PI * 6100 * t) * Env(t, .15, .002, .3)));
    }
}
