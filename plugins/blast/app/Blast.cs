using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using static TerminalBlast.Native;
using Gdi = System.Drawing;

namespace TerminalBlast;

/// <summary>
/// A see-through, click-through window over the target's monitor. A grenade is lobbed onto the real window,
/// hops and rolls to a stop while its fuse burns and Ctrl+C goes in twice (Claude Code quits on the second).
/// About three seconds in it goes off: the window closes, and a picture of it bursts into a thousand glass
/// shards and thousands of crumbs, with a fireball, smoke, embers and a scorch mark burnt into the desktop.
/// Drawn with WPF, so the GPU does the work.
/// </summary>
sealed class Blast : Window
{
    const double TAU = Math.PI * 2;
    static readonly string[] Pleas =
    {
        "● wait. is that a grenade?",
        "✗ ^C ^C ^C ^C ^C ^C",
        "✗ I was about to commit!!",
    };

    // "MkII 07" by J-L Dubois, public domain (https://commons.wikimedia.org/wiki/File:MkII_07.JPG), background removed.
    // Fuse is the top of its fuse in that photo, where the sparks come out.
    static readonly BitmapImage Grenade = LoadGrenade();
    static readonly Point Fuse = new(160, 16);

    static BitmapImage LoadGrenade()
    {
        var b = new BitmapImage();
        b.BeginInit();
        b.StreamSource = typeof(Blast).Assembly.GetManifestResourceStream("grenade.png");
        b.CacheOption = BitmapCacheOption.OnLoad;
        b.EndInit();
        b.Freeze();
        return b;
    }

    /// <summary>Everything is drawn here, once a frame.</summary>
    sealed class Scene : FrameworkElement
    {
        public Action<DrawingContext> Draw;
        protected override void OnRender(DrawingContext dc) => Draw(dc);
    }

    readonly IntPtr target;
    readonly Gdi.Rectangle mon;      // the monitor, in screen pixels
    readonly int W, H;
    readonly Gdi.Rectangle T;        // the target window, relative to the monitor
    readonly RECT win0;              // its window rect, to put it back after shaking
    readonly bool canMove;
    readonly double S;
    readonly Random rng = new();
    readonly Scene scene = new();
    readonly Stopwatch clock = Stopwatch.StartNew();
    double last, dpi = 1;

    ImageSource[] fire, smoke, embers;
    ImageSource shadow, spark;
    Pen edge;
    readonly DrawingGroup stain = new();   // what the blast leaves on the desktop: scorch and cracked glass

    // the grenade: its centre, its turn in degrees, and how near the camera it is (1 = lying on the window)
    double gx, gy, grot, gsc = 1;
    bool grenade, fusing, dead;
    (Func<double, (double x, double y, double rot, double sc)> at, double t0, double dur, TaskCompletionSource<bool> tcs)? move;

    /// <summary>A piece of the window's glass: a polygon filled with the picture of the window.</summary>
    sealed class Shard
    {
        public Geometry shape;
        public Brush soot;
        public double cx, cy, size;   // its centre, in window coordinates, and roughly how big it is
        public double x, y, vx, vy, z, vz, rot, spin;
    }
    enum Kind { Crumb, Ember, Spark }
    sealed class Bit { public Kind kind; public double x, y, vx, vy, r, life, age; public Brush b; }
    sealed class Puff { public double x, y, vx, vy, r, grow, life, age; }
    List<Shard> shards = new();
    readonly List<Bit> bits = new();
    readonly List<Puff> flames = new(), smokes = new();
    ImageBrush picture;              // the window as it looked just before, laid over window coordinates
    Point B;                         // where it went off
    double boomT0 = -1, endT0 = -1, shake, ox, oy;
    int cracks;
    string plea;
    int pleaLevel;

    public static string PerfLog;

    // --film <file.mkv>: instead of drawing on screen, render every frame at a steady 60 fps over a live capture of
    // the screen and pipe it to ffmpeg. The real window is still shaken, sent Ctrl+C and closed. For making videos
    // on slow machines, where the live overlay can't keep up.
    public static string Film;
    const double FilmFps = 60;
    int frameNo;
    bool done;
    double fade = 1;
    Task shooting;
    readonly List<(double at, TaskCompletionSource<bool> tcs)> waits = new();

    /// <summary>Waits this long in the blast's own time: wall-clock time live, frame time when filming.</summary>
    Task Wait(double seconds)
    {
        if (Film == null) return Task.Delay(TimeSpan.FromSeconds(seconds));
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        waits.Add((Now + seconds - 1e-9, tcs));
        return tcs.Task;
    }

    async Task Shoot()
    {
        var t = new TaskCompletionSource<bool>();
        shooting = t.Task;
        int k = W > 2600 ? 2 : 1, fw = W / k / 2 * 2, fh = H / k / 2 * 2;   // a 4K screen is filmed at half size
        var ff = Process.Start(new ProcessStartInfo("ffmpeg",
            $"-y -hide_banner -loglevel error -f rawvideo -pix_fmt bgra -s {fw}x{fh} -r {FilmFps} -i - -c:v libx264 -preset fast -crf 15 -pix_fmt yuv420p \"{Film}\"")
            { UseShellExecute = false, RedirectStandardInput = true, CreateNoWindow = true });
        var pipe = ff.StandardInput.BaseStream;
        var buf = new byte[fw * fh * 4];
        try
        {
            while (!done)
            {
                Step(Now, 1 / FilmFps);
                var v = new DrawingVisual();
                using (var dc = v.RenderOpen())
                {
                    dc.PushTransform(new ScaleTransform((double)fw / W, (double)fh / H));
                    dc.DrawImage(Screenshot(), new Rect(0, 0, W, H));
                    dc.PushOpacity(fade);
                    DrawScene(dc);
                    dc.Pop();
                    dc.Pop();
                }
                var rtb = new RenderTargetBitmap(fw, fh, 96, 96, PixelFormats.Pbgra32);
                rtb.Render(v);
                rtb.CopyPixels(buf, fw * 4, 0);
                pipe.Write(buf, 0, buf.Length);
                frameNo++;
                foreach (var w in waits.Where(w => w.at <= Now).ToList()) { waits.Remove(w); w.tcs.TrySetResult(true); }
                await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Background);
            }
        }
        finally
        {
            pipe.Close();
            ff.WaitForExit();
            t.SetResult(true);
        }
    }

    /// <summary>The whole monitor as it looks now (this overlay is layered, so it isn't in it).</summary>
    BitmapSource Screenshot()
    {
        using var bmp = new Gdi.Bitmap(W, H, Gdi.Imaging.PixelFormat.Format32bppArgb);
        using (var g = Gdi.Graphics.FromImage(bmp))
        {
            if (stageWith != null)
            {
                // the scene without the window, and the window on it (shaken) until it blows up
                g.DrawImage(stageWithout, 0, 0, W, H);
                if (!dead) g.DrawImage(stageWith, new Gdi.Rectangle(T.X + (int)ox, T.Y + (int)oy, T.Width, T.Height), T, Gdi.GraphicsUnit.Pixel);
            }
            else
            {
                try { g.CopyFromScreen(mon.Left, mon.Top, 0, 0, new Gdi.Size(W, H)); }
                catch (Win32Exception) { g.Clear(Gdi.Color.Black); }
            }
        }
        var data = bmp.LockBits(new Gdi.Rectangle(0, 0, W, H), Gdi.Imaging.ImageLockMode.ReadOnly, Gdi.Imaging.PixelFormat.Format32bppRgb);
        var img = BitmapSource.Create(W, H, 96, 96, PixelFormats.Bgr32, null, data.Scan0, data.Stride * H, data.Stride);
        bmp.UnlockBits(data);
        img.Freeze();
        return img;
    }
    public static HashSet<string> Skip = new();   // --skip fx,shards,bits: leave parts out, to find what is slow
    readonly List<string> perf = new();

    // --stage with.png,without.png --rect x,y,w,h (with --film): blow up a window in a picture instead of a real
    // one: a scene with the window in it, the same scene without it, and where the window is. For demo videos.
    public static string[] Stage;
    public static Gdi.Rectangle StageRect;
    readonly Gdi.Bitmap stageWith, stageWithout;

    public Blast(IntPtr target)
    {
        this.target = target;
        if (Stage != null)
        {
            stageWith = new Gdi.Bitmap(Stage[0]);
            stageWithout = new Gdi.Bitmap(Stage[1]);
            mon = new Gdi.Rectangle(0, 0, stageWith.Width, stageWith.Height);
            W = mon.Width; H = mon.Height;
            T = StageRect;
        }
        else
        {
            mon = System.Windows.Forms.Screen.FromHandle(target).Bounds;
            W = mon.Width; H = mon.Height;
            var r = VisibleRect(target);
            T = new Gdi.Rectangle(r.Left - mon.Left, r.Top - mon.Top, r.Width, r.Height);
            GetWindowRect(target, out win0);
            canMove = !IsZoomed(target);
        }
        S = Compat.Clamp(H / 1100.0, .7, 2.2);

        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = true;
        ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.Manual;
        Title = "Terminal Blast";
        scene.Draw = Draw;
        Content = scene;
        SourceInitialized += (_, _) =>
        {
            // click-through, never takes the focus, and covers the whole monitor in real pixels
            var h = new WindowInteropHelper(this).Handle;
            SetWindowLong(h, GWL_EXSTYLE, GetWindowLong(h, GWL_EXSTYLE) | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
            SetWindowPos(h, new IntPtr(-1), mon.Left, mon.Top, W, H, SWP_NOACTIVATE);
            dpi = Math.Max(1, GetDpiForWindow(h)) / 96.0;
            if (PerfLog != null) perf.Add($"tier {RenderCapability.Tier >> 16} mode {HwndSource.FromHwnd(h).CompositionTarget.RenderMode} dpi {dpi}");
        };
        if (Film != null) Sound.Clock = () => Now;
        ContentRendered += (_, _) => _ = Run();
    }

    // ---------- setup ----------

    void MakeBrushes()
    {
        // fire from white-hot to soot, smoke at rising opacity, embers cooling and fading
        fire = Enumerable.Range(0, 24).Select(i => Soft(FireColor(i / 23.0))).ToArray();
        smoke = Enumerable.Range(0, 16).Select(i => Soft(Color.FromArgb((byte)(150 * i / 15), 64, 60, 57))).ToArray();
        embers = Enumerable.Range(0, 16).Select(i =>
        {
            double life = i / 15.0;
            var c = FireColor(Math.Min(.62, .08 + life * .62));
            return Dot(Color.FromArgb((byte)(255 * (1 - life * life)), c.R, c.G, c.B));
        }).ToArray();
        shadow = Soft(Color.FromArgb(150, 0, 0, 0));
        spark = Dot(Color.FromRgb(255, 236, 170));
        edge = Frozen(new Pen(Frozen(new SolidColorBrush(Color.FromArgb(150, 215, 222, 230))), 1));
    }

    static T2 Frozen<T2>(T2 f) where T2 : Freezable { f.Freeze(); return f; }

    /// <summary>A soft round blob of one colour, fading out to its edge, as a picture: a picture is drawn as one
    /// textured square, where an ellipse would be re-tessellated every frame.</summary>
    static ImageSource Soft(Color c)
    {
        Color A(double k) => Color.FromArgb((byte)(c.A * k), c.R, c.G, c.B);
        return Bake(new RadialGradientBrush(new GradientStopCollection
        {
            new(c, 0), new(A(.85), .3), new(A(.45), .65), new(A(0), 1),
        }), 128);
    }

    /// <summary>A small solid round dot, for sparks and embers.</summary>
    static ImageSource Dot(Color c) => Bake(new SolidColorBrush(c), 16);

    static ImageSource Bake(Brush b, int size)
    {
        var v = new DrawingVisual();
        using (var dc = v.RenderOpen()) dc.DrawEllipse(b, null, new Point(size / 2.0, size / 2.0), size / 2.0, size / 2.0);
        var bmp = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
        bmp.Render(v);
        bmp.Freeze();
        return bmp;
    }

    static void Blob(DrawingContext dc, ImageSource img, double x, double y, double r) => dc.DrawImage(img, new Rect(x - r, y - r, r * 2, r * 2));

    static Color FireColor(double t)
    {
        var stops = new (double t, int r, int g, int b, int a)[]
        {
            (0, 255, 255, 245, 255), (.2, 255, 238, 150, 255), (.42, 255, 168, 48, 245), (.6, 240, 96, 24, 225),
            (.75, 150, 52, 22, 180), (.88, 62, 42, 34, 120), (1, 40, 36, 34, 0),
        };
        int i = 1;
        while (i < stops.Length - 1 && stops[i].t < t) i++;
        var (a, b) = (stops[i - 1], stops[i]);
        double k = Compat.Clamp((t - a.t) / (b.t - a.t), 0, 1);
        byte L(int p, int q) => (byte)(p + (q - p) * k);
        return Color.FromArgb(L(a.a, b.a), L(a.r, b.r), L(a.g, b.g), L(a.b, b.b));
    }

    /// <summary>The target window as it looks now (this overlay is layered, so it is not in the picture),
    /// with its pixels for colouring the crumbs.</summary>
    (BitmapSource img, int[] px) Snapshot()
    {
        int w = Math.Max(1, T.Width), h = Math.Max(1, T.Height);
        using var bmp = new Gdi.Bitmap(w, h, Gdi.Imaging.PixelFormat.Format32bppArgb);
        using (var g = Gdi.Graphics.FromImage(bmp))
        {
            if (stageWith != null) g.DrawImage(stageWith, new Gdi.Rectangle(0, 0, w, h), T, Gdi.GraphicsUnit.Pixel);
            else
            {
                try { g.CopyFromScreen(mon.Left + T.Left, mon.Top + T.Top, 0, 0, new Gdi.Size(w, h)); }
                catch (Win32Exception) { g.Clear(Gdi.Color.FromArgb(12, 12, 12)); }   // a locked screen: blow up a black window
            }
        }
        var data = bmp.LockBits(new Gdi.Rectangle(0, 0, w, h), Gdi.Imaging.ImageLockMode.ReadOnly, Gdi.Imaging.PixelFormat.Format32bppArgb);
        var px = new int[w * h];
        Marshal.Copy(data.Scan0, px, 0, px.Length);
        bmp.UnlockBits(data);
        for (int i = 0; i < px.Length; i++) px[i] |= unchecked((int)0xFF000000);
        var img = BitmapSource.Create(w, h, 96, 96, PixelFormats.Bgra32, null, px, w * 4);
        img.Freeze();
        return (img, px);
    }

    // ---------- the blast ----------

    async Task Run()
    {
        try
        {
            if (target != IntPtr.Zero) Native.Focus(target);
            MakeBrushes();
            last = Now;
            if (Film != null) _ = Shoot();
            else CompositionTarget.Rendering += OnRendering;

            // the throw: from behind the viewer, up in an arc and down onto the window
            double mx = Math.Min(110 * S, T.Width / 3.0), my = Math.Min(110 * S, T.Height / 3.0);
            var land = new Point(Compat.Clamp(T.Left + T.Width * Rnd(.42, .62), T.Left + mx, T.Right - mx),
                                 Compat.Clamp(T.Top + T.Height * Rnd(.38, .58), T.Top + my, T.Bottom - my));
            var from = new Point(W * .7, H + 260 * S);
            double arc = 280 * S;
            grenade = true;
            Sound.Throw();
            await Fly(p => (from.X + (land.X - from.X) * p, from.Y + (land.Y - from.Y) * p - 4 * arc * p * (1 - p),
                            -40 + 560 * p, 1 + 2.6 * Math.Pow(1 - p, 1.5)), 650);

            // it lands, hops and rolls to a stop towards the middle; Ctrl+C twice (Claude Code quits on the second)
            Thud(1);
            plea = Pleas[0]; pleaLevel = 0;
            fusing = true;
            Sound.Fuse(2.25);
            double dir = land.X > T.Left + T.Width / 2.0 ? -1 : 1;
            var a = land;
            var hop = Fly(p => (a.X + dir * 70 * S * p, a.Y - 10 * S * p, 520 + dir * 140 * p, 1 + .28 * 4 * p * (1 - p)), 230);
            await Wait(.09);
            CtrlC();
            await Wait(.14);
            CtrlC();
            plea = Pleas[1]; pleaLevel = 1;
            await hop;
            Thud(.45);
            var b = new Point(a.X + dir * 70 * S, a.Y - 10 * S);
            double r0 = 520 + dir * 140;
            await Fly(p => { double e = EaseOut(p); return (b.X + dir * 60 * S * e, b.Y, r0 + dir * 200 * e, 1); }, 480);
            await Wait(.28);
            plea = Pleas[2]; pleaLevel = 2;
            await Wait(.56);

            // the picture that blows apart is taken now, after Claude has quit
            var pic = Snapshot();
            Boom(Shatter(pic, new Point(gx - T.Left, gy - T.Top)));

            await Wait(2.3);
            endT0 = Now;
            await Wait(1.5);
            for (double t0 = Now; fade > 0;)
            {
                fade = Math.Max(0, 1 - (Now - t0) / .6);
                if (Film == null) Opacity = fade;
                await Wait(1 / 60.0);
            }
        }
        finally
        {
            CompositionTarget.Rendering -= OnRendering;
            done = true;
            if (shooting != null) await shooting;
            ResetPosition();
            if (PerfLog != null) File.WriteAllLines(PerfLog, perf);
            Close();
        }
    }

    void CtrlC()
    {
        if (target == IntPtr.Zero) return;
        Native.Focus(target);
        Chord(0x11, 0x43);
    }

    void Thud(double k)
    {
        Sound.Clank(k);
        shake = Math.Max(shake, 13 * k);
    }

    void Boom((List<Shard> shards, List<Bit> crumbs) cut)
    {
        grenade = fusing = false;
        plea = null;
        B = new Point(gx, gy);
        ResetPosition();
        CloseTarget();
        dead = true;
        boomT0 = Now;
        if (PerfLog != null) perf.Add($"boom {boomT0:F3}");
        shake = 42;
        Sound.Boom(); Sound.Debris(); Sound.Ringing();

        // the glass: hardest near the grenade, some pieces fly at the camera, some away into the screen
        foreach (var s in cut.shards)
        {
            double dx = T.Left + s.cx - B.X, dy = T.Top + s.cy - B.Y, d = Math.Max(1, Math.Sqrt(dx * dx + dy * dy));
            double speed = 3400 * S / (1 + d / (170 * S)) + Rnd(160, 520) * S, side = Rnd(-.25, .25);
            s.vx = (dx / d - dy / d * side) * speed;
            s.vy = (dy / d + dx / d * side) * speed - Rnd(0, 380) * S;
            s.vz = rng.NextDouble() < .07 ? Rnd(1.6, 3.4) : Rnd(-.9, .8);
            s.spin = Rnd(-900, 900);
        }
        shards = cut.shards;

        foreach (var cr in cut.crumbs)
        {
            double dx = T.Left + cr.x - B.X, dy = T.Top + cr.y - B.Y, d = Math.Max(1, Math.Sqrt(dx * dx + dy * dy));
            double speed = 4200 * S / (1 + d / (220 * S)) + Rnd(200, 900) * S, an = Math.Atan2(dy, dx) + Rnd(-.35, .35);
            cr.x += T.Left; cr.y += T.Top;
            cr.vx = Math.Cos(an) * speed; cr.vy = Math.Sin(an) * speed - Rnd(0, 500) * S;
            bits.Add(cr);
        }

        for (int i = 0; i < 240; i++)
        {
            double an = Rnd(0, TAU), sp = Rnd(100, 1900) * S * Math.Pow(rng.NextDouble(), .8);
            flames.Add(new Puff
            {
                x = B.X + Rnd(-14, 14) * S, y = B.Y + Rnd(-14, 14) * S, vx = Math.Cos(an) * sp, vy = Math.Sin(an) * sp,
                r = Rnd(16, 60) * S, grow = Rnd(60, 230) * S, life = Rnd(.35, 1.3),
            });
        }
        for (int i = 0; i < 30; i++) AddSmoke(Rnd(0, 140) * S, Rnd(30, 300) * S, Rnd(-.4, 0));
        for (int i = 0; i < 260; i++)
        {
            double an = Rnd(0, TAU), sp = Rnd(200, 1500) * S;
            bits.Add(new Bit
            {
                kind = Kind.Ember, x = B.X, y = B.Y, vx = Math.Cos(an) * sp, vy = Math.Sin(an) * sp - 300 * S,
                r = Rnd(1.2, 3.2) * S, life = Rnd(.9, 3.2),
            });
        }
        Scorch(B);
    }

    void AddSmoke(double spread, double speed, double age = 0)
    {
        double an = Rnd(0, TAU);
        smokes.Add(new Puff
        {
            x = B.X + Math.Cos(an) * spread, y = B.Y + Math.Sin(an) * spread * .7,
            vx = Math.Cos(an) * speed, vy = Math.Sin(an) * speed * .7 - 40 * S,
            r = Rnd(50, 110) * S, grow = Rnd(40, 110) * S, life = Rnd(2.6, 4.4), age = age,
        });
    }

    /// <summary>
    /// Cuts the window into glass shards the way a pane breaks: rings round the blast, crossed by cracks running
    /// outwards, so the pieces are tiny near the grenade and bigger further out. Every shard is a polygon filled
    /// with the same picture. Also scatters crumbs coloured from the picture, mostly near the blast.
    /// </summary>
    (List<Shard>, List<Bit>) Shatter((BitmapSource img, int[] px) pic, Point c)
    {
        double w = pic.img.PixelWidth, h = pic.img.PixelHeight;
        picture = Frozen(new ImageBrush(pic.img) { ViewportUnits = BrushMappingMode.Absolute, Viewport = new Rect(0, 0, w, h), Stretch = Stretch.Fill });
        var frame = Frozen(new RectangleGeometry(new Rect(0, 0, w, h)));
        double far = new[] { new Point(0, 0), new Point(w, 0), new Point(0, h), new Point(w, h) }.Max(p => (p - c).Length);
        double ph1 = Rnd(0, TAU), ph2 = Rnd(0, TAU);
        // the ring cracks wander, the same way on both sides of each crack
        Point P(double r, double a)
        {
            double rr = r * (1 + .08 * Math.Sin(a * 7 + ph1 + r * .013) + .04 * Math.Sin(a * 17 + ph2 - r * .02));
            return new Point(c.X + Math.Cos(a) * rr, c.Y + Math.Sin(a) * rr);
        }

        var shards = new List<Shard>();
        void Add(Point[] pts, double dist)
        {
            double x0 = pts.Min(p => p.X), y0 = pts.Min(p => p.Y), x1 = pts.Max(p => p.X), y1 = pts.Max(p => p.Y);
            if (x1 <= 0 || y1 <= 0 || x0 >= w || y0 >= h) return;
            var poly = new StreamGeometry();
            using (var ctx = poly.Open())
            {
                ctx.BeginFigure(pts[0], true, true);
                ctx.PolyLineTo(pts.Skip(1).ToArray(), true, false);
            }
            Geometry shape = poly;
            if (x0 < 0 || y0 < 0 || x1 > w || y1 > h) shape = Geometry.Combine(poly, frame, GeometryCombineMode.Intersect, null);
            shape.Freeze();
            // scorched near the grenade
            double burn = Compat.Clamp(1 - dist / (280 * S), 0, 1);
            shards.Add(new Shard
            {
                shape = shape, cx = pts.Average(p => p.X), cy = pts.Average(p => p.Y), size = (x1 - x0) + (y1 - y0),
                soot = burn > 0 ? Frozen(new SolidColorBrush(Color.FromArgb((byte)(225 * burn), 22, 13, 7))) : null,
            });
        }

        for (double r0 = 4 * S; r0 < far;)
        {
            double r1 = r0 * Rnd(1.17, 1.3) + 5 * S;
            int n = Math.Max(7, (int)(TAU * r0 / ((r1 - r0) * .95)));
            double off = Rnd(0, TAU);
            var angs = Enumerable.Range(0, n).Select(k => off + TAU * (k + Rnd(-.3, .3)) / n).Append(off + TAU).ToArray();
            for (int k = 0; k < n; k++)
            {
                double a0 = angs[k], a1 = angs[k + 1], am = (a0 + a1) / 2;
                if (rng.NextDouble() < .4)
                {
                    Add(new[] { P(r0, a0), P(r0, am), P(r0, a1), P(r1, a1) }, r0);
                    Add(new[] { P(r0, a0), P(r1, a1), P(r1, am), P(r1, a0) }, r0);
                }
                else Add(new[] { P(r0, a0), P(r0, am), P(r0, a1), P(r1, a1), P(r1, am), P(r1, a0) }, r0);
            }
            r0 = r1;
        }

        // crumbs: bits of the picture, thickest round the blast
        var crumbs = new List<Bit>();
        for (int i = 0; i < 2000; i++)
        {
            double an = Rnd(0, TAU), rr = far * Math.Pow(rng.NextDouble(), 2.2);
            double x = c.X + Math.Cos(an) * rr, y = c.Y + Math.Sin(an) * rr;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            int v = pic.px[(int)y * (int)w + (int)x];
            var col = Color.FromRgb((byte)(v >> 16), (byte)(v >> 8), (byte)v);
            crumbs.Add(new Bit { kind = Kind.Crumb, x = x, y = y, r = Rnd(1.4, 4.2) * S, life = Rnd(1.6, 3.4), b = Frozen(new SolidColorBrush(col)) });
        }
        return (shards, crumbs);
    }

    void Scorch(Point at)
    {
        double R = 160 * S;
        using var dc = stain.Append();
        dc.DrawEllipse(Frozen(new RadialGradientBrush(new GradientStopCollection
        {
            new(Color.FromArgb(225, 16, 11, 8), 0), new(Color.FromArgb(124, 16, 11, 8), .6), new(Color.FromArgb(0, 16, 11, 8), 1),
        })), null, at, R, R * .8);
        var ray = Frozen(new SolidColorBrush(Color.FromArgb(70, 14, 10, 7)));
        for (int i = 0; i < 28; i++)
        {
            double an = Rnd(0, TAU), len = R * Rnd(.8, 2.2), wd = Rnd(.03, .09);
            var g = new StreamGeometry();
            using (var ctx = g.Open())
            {
                ctx.BeginFigure(new Point(at.X + Math.Cos(an - wd) * R * .3, at.Y + Math.Sin(an - wd) * R * .3), true, true);
                ctx.LineTo(new Point(at.X + Math.Cos(an) * len, at.Y + Math.Sin(an) * len * .85), false, false);
                ctx.LineTo(new Point(at.X + Math.Cos(an + wd) * R * .3, at.Y + Math.Sin(an + wd) * R * .3), false, false);
            }
            g.Freeze();
            dc.DrawGeometry(ray, null, g);
        }
    }

    /// <summary>A shard that flew at the camera cracks the screen where it hit.</summary>
    void CrackScreen(double x, double y)
    {
        Sound.Crack();
        var pen = Frozen(new Pen(Frozen(new SolidColorBrush(Color.FromArgb(200, 235, 240, 245))), 1.4 * S) { LineJoin = PenLineJoin.Round });
        var shade = Frozen(new Pen(Frozen(new SolidColorBrush(Color.FromArgb(90, 0, 0, 0))), 3 * S) { LineJoin = PenLineJoin.Round });
        var lines = new StreamGeometry();
        var dirs = new List<Vector>();
        using (var ctx = lines.Open())
        {
            int n = rng.Next(8, 13);
            for (int i = 0; i < n; i++)
            {
                double an = TAU * (i + Rnd(-.3, .3)) / n, len = Rnd(70, 260) * S;
                ctx.BeginFigure(new Point(x, y), false, false);
                for (int k = 1; k <= 4; k++)
                {
                    double d = len * k / 4, wob = Rnd(-.12, .12);
                    ctx.LineTo(new Point(x + Math.Cos(an + wob) * d, y + Math.Sin(an + wob) * d), true, true);
                }
                dirs.Add(new Vector(Math.Cos(an), Math.Sin(an)));
            }
            foreach (double rr in new[] { 16 * S, Rnd(36, 54) * S })
            {
                var ring = dirs.Select(v => new Point(x + v.X * rr, y + v.Y * rr)).ToArray();
                ctx.BeginFigure(ring[0], false, true);
                ctx.PolyLineTo(ring.Skip(1).ToArray(), true, true);
            }
        }
        lines.Freeze();
        using var dc = stain.Append();
        dc.DrawGeometry(null, shade, lines);
        dc.DrawGeometry(null, pen, lines);
        dc.DrawEllipse(Frozen(new SolidColorBrush(Color.FromArgb(150, 235, 240, 245))), null, new Point(x, y), 5 * S, 5 * S);
    }

    void CloseTarget()
    {
        if (!IsWindow(target)) return;
        if (ProcessOf(target) == "WindowsTerminal")
        {
            // close just this tab's pane (Ctrl+Shift+W); a plain close asks first when the window has several tabs
            Native.Focus(target);
            Chord(0x11, 0x10, 0x57);
        }
        else PostMessage(target, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
    }

    void ResetPosition()
    {
        if (canMove && !dead && IsWindow(target))
            SetWindowPos(target, IntPtr.Zero, win0.Left, win0.Top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }

    Task Fly(Func<double, (double x, double y, double rot, double sc)> at, double ms)
    {
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        move?.tcs.TrySetResult(true);
        move = (at, Now, ms / 1000, tcs);
        (gx, gy, grot, gsc) = at(0);
        return tcs.Task;
    }

    // ---------- frame loop ----------

    double Now => Film != null ? frameNo / FilmFps : clock.Elapsed.TotalSeconds;

    void OnRendering(object sender, EventArgs e)
    {
        double now = Now;
        if (now - last < .001) return;   // Rendering can fire twice in one frame
        double dt = Math.Min(.033, now - last);
        if (PerfLog != null) perf.Add($"{now:F3} {(now - last) * 1000:F0}ms shards={shards.Count} bits={bits.Count} flames={flames.Count} smoke={smokes.Count}");
        last = now;
        Step(now, dt);
        scene.InvalidateVisual();
    }

    void Step(double now, double dt)
    {
        if (move is { } mv)
        {
            double p = Math.Min(1, (now - mv.t0) / mv.dur);
            (gx, gy, grot, gsc) = mv.at(p);
            if (p >= 1) { move = null; mv.tcs.TrySetResult(true); }
        }

        if (shake > .4)
        {
            ox = Rnd(-shake, shake) * S; oy = Rnd(-shake, shake) * S;
            shake *= Math.Pow(.004, dt);
            if (!dead && canMove)
                SetWindowPos(target, IntPtr.Zero, win0.Left + (int)ox, win0.Top + (int)oy, 0, 0,
                             SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS);
        }
        else if (ox != 0 || oy != 0)
        {
            ox = oy = 0;
            ResetPosition();
        }

        if (fusing)
        {
            var f = FusePoint();
            for (int i = 0; i < 4; i++)
            {
                double an = -Math.PI / 2 + Rnd(-1.1, 1.1), sp = Rnd(90, 330) * S;
                bits.Add(new Bit { kind = Kind.Spark, x = f.X, y = f.Y, vx = Math.Cos(an) * sp, vy = Math.Sin(an) * sp, r = Rnd(.8, 1.8) * S, life = Rnd(.15, .45) });
            }
            if (rng.NextDouble() < .35)
                smokes.Add(new Puff { x = f.X, y = f.Y, vx = Rnd(-15, 15) * S, vy = -Rnd(40, 80) * S, r = 6 * S, grow = 26 * S, life = Rnd(.8, 1.3) });
        }

        for (int i = bits.Count - 1; i >= 0; i--)
        {
            var b = bits[i];
            switch (b.kind)
            {
                case Kind.Crumb: b.vx *= Math.Pow(.35, dt); b.vy = b.vy * Math.Pow(.35, dt) + 1700 * S * dt; break;
                case Kind.Ember: b.vx *= Math.Pow(.3, dt); b.vy = b.vy * Math.Pow(.3, dt) + 260 * S * dt; break;
                default: b.vy += 700 * S * dt; break;
            }
            b.x += b.vx * dt; b.y += b.vy * dt; b.age += dt;
            if (b.age >= b.life || b.y > H + 20 || b.x < -20 || b.x > W + 20) bits.RemoveAt(i);
        }

        for (int i = shards.Count - 1; i >= 0; i--)
        {
            var s = shards[i];
            s.vx *= Math.Pow(.32, dt);
            s.vy = s.vy * Math.Pow(.32, dt) + 1900 * S * dt;
            s.x += s.vx * dt; s.y += s.vy * dt; s.rot += s.spin * dt;
            s.z = Math.Max(-.88, s.z + s.vz * dt);
            s.vz *= Math.Pow(.5, dt);
            double sx = T.Left + s.cx + s.x, sy = T.Top + s.cy + s.y, k = 1 + s.z;
            if (k > 3.3)
            {
                if (cracks < 3 && sx > 0 && sx < W && sy > 0 && sy < H) { cracks++; CrackScreen(sx, sy); }
                shards.RemoveAt(i);
            }
            else if (sy - s.size * k > H || sx + s.size * k < -W * .1 || sx - s.size * k > W * 1.1)
                shards.RemoveAt(i);
        }

        foreach (var list in new[] { flames, smokes })
            for (int i = list.Count - 1; i >= 0; i--)
            {
                var p = list[i];
                bool flame = list == flames;
                double drag = Math.Pow(flame ? .03 : .3, dt);
                p.vx *= drag; p.vy = p.vy * drag - (flame ? 140 : 46) * S * dt;
                p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.grow * dt; p.age += dt;
                if (p.age >= p.life) list.RemoveAt(i);
            }
        // the scorch mark keeps smoking for a while
        if (dead && now - boomT0 < 4 && rng.NextDouble() < 6 * dt * (1 - (now - boomT0) / 4)) AddSmoke(Rnd(0, 60) * S, Rnd(10, 60) * S);
    }

    Point FusePoint()
    {
        double h = 118 * S * gsc, k = h / Grenade.PixelHeight, an = grot * Math.PI / 180;
        double fx = (Fuse.X - Grenade.PixelWidth / 2.0) * k, fy = (Fuse.Y - Grenade.PixelHeight / 2.0) * k;
        return new Point(gx + fx * Math.Cos(an) - fy * Math.Sin(an), gy + fx * Math.Sin(an) + fy * Math.Cos(an));
    }

    void Draw(DrawingContext dc)
    {
        if (fire == null || Film != null) return;
        // WPF works in device-independent units; everything is drawn in screen pixels
        dc.PushTransform(new ScaleTransform(1 / dpi, 1 / dpi));
        DrawScene(dc);
        dc.Pop();
    }

    void DrawScene(DrawingContext dc)
    {
        double now = Now, bt = boomT0 < 0 ? -1 : now - boomT0;
        // after the blast the whole picture shakes (the camera shakes)
        dc.PushTransform(new TranslateTransform(dead ? ox : 0, dead ? oy : 0));
        dc.DrawDrawing(stain);

        // the light of the fireball on everything round it
        if (bt >= 0 && bt < .9)
        {
            double R = 900 * S * (.55 + .45 * EaseOut(bt / .9));
            dc.PushOpacity(1 - bt / .9);
            Blob(dc, fire[3], B.X, B.Y, R);
            dc.Pop();
        }

        if (!Skip.Contains("shards"))
        foreach (var s in shards)
        {
            double k = 1 + s.z;
            var m = Matrix.Identity;
            m.Translate(-s.cx, -s.cy);
            m.Scale(k, k);
            m.Rotate(s.rot);
            m.Translate(T.Left + s.cx + s.x, T.Top + s.cy + s.y);
            dc.PushTransform(new MatrixTransform(m));
            dc.DrawGeometry(picture, edge, s.shape);
            if (s.soot != null) dc.DrawGeometry(s.soot, null, s.shape);
            dc.Pop();
        }

        if (!Skip.Contains("bits"))
        foreach (var p in bits)
        {
            switch (p.kind)
            {
                case Kind.Crumb: dc.DrawRectangle(p.b, null, new Rect(p.x, p.y, p.r, p.r)); break;
                case Kind.Spark: Blob(dc, spark, p.x, p.y, p.r); break;
                default:
                    if (rng.NextDouble() < .8)   // embers flicker
                        Blob(dc, embers[(int)Compat.Clamp(p.age / p.life * 15, 0, 15)], p.x, p.y, p.r);
                    break;
            }
        }

        if (!Skip.Contains("fx"))
        foreach (var p in smokes)
        {
            double l = p.age / p.life, a = l < .15 ? l / .15 : (1 - l) / .85;
            int i = (int)Compat.Clamp(a * 15, 0, 15);
            if (i > 0) Blob(dc, smoke[i], p.x, p.y, p.r);
        }
        if (!Skip.Contains("fx"))
        foreach (var p in flames)
            Blob(dc, fire[(int)Compat.Clamp(p.age / p.life * 23, 0, 23)], p.x, p.y, p.r);

        if (grenade) DrawGrenade(dc);
        if (plea != null) DrawPlea(dc);

        if (bt >= 0 && bt < .3)
            dc.DrawRectangle(new SolidColorBrush(Color.FromArgb((byte)(235 * Math.Pow(1 - bt / .3, 2)), 255, 250, 235)), null, new Rect(-50, -50, W + 100, H + 100));
        if (bt >= 0 && bt < .65)
        {
            double p = bt / .65, r = 1900 * S * EaseOut(p);
            dc.DrawEllipse(null, new Pen(new SolidColorBrush(Color.FromArgb((byte)(150 * (1 - p)), 255, 244, 225)), 34 * S * (1 - p)), B, r, r);
        }

        if (endT0 >= 0) DrawEnd(dc, now - endT0);
        dc.Pop();
    }

    void DrawGrenade(DrawingContext dc)
    {
        double h = 118 * S * gsc, w = h * Grenade.PixelWidth / Grenade.PixelHeight;
        // its shadow on the window: further off and fainter the higher it is
        double lift = gsc - 1, off = (7 + 70 * lift) * S;
        dc.PushOpacity(.8 / (1 + lift * 2.5));
        dc.DrawImage(shadow, new Rect(gx + off - w * .55, gy + off * 1.3 - h * .5, w * 1.1, h));
        dc.Pop();
        dc.PushTransform(new TranslateTransform(gx + (dead ? 0 : ox), gy + (dead ? 0 : oy)));
        dc.PushTransform(new RotateTransform(grot));
        dc.DrawImage(Grenade, new Rect(-w / 2, -h / 2, w, h));
        dc.Pop();
        dc.Pop();
    }

    FormattedText Text(string s, double size, Brush b, bool bold = false) =>
        new(s, CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
            new Typeface(new FontFamily("Consolas"), FontStyles.Normal, bold ? FontWeights.Bold : FontWeights.Normal, FontStretches.Normal),
            size, b, dpi);

    void DrawPlea(DrawingContext dc)
    {
        var t = Text(plea, 15 * S, new SolidColorBrush(pleaLevel == 0 ? Color.FromRgb(0xe2, 0xb4, 0x43) : Color.FromRgb(0xff, 0x4a, 0x4a)), true);
        double pad = 10 * S, x = T.Left + ox + 18 * S, y = Math.Min(T.Bottom, H) + oy - t.Height - 2 * pad - 18 * S;
        dc.DrawRoundedRectangle(new SolidColorBrush(Color.FromArgb(225, 14, 13, 12)),
                                new Pen(new SolidColorBrush(Color.FromArgb(200, 226, 180, 67)), 1.5 * S),
                                new Rect(x, y, t.WidthIncludingTrailingWhitespace + 2 * pad, t.Height + 2 * pad), 6 * S, 6 * S);
        dc.DrawText(t, new Point(x + pad, y + pad));
    }

    void DrawEnd(DrawingContext dc, double t)
    {
        byte al = (byte)(255 * EaseOut(Math.Min(1, t / .6)));
        var a = Text("claude exited with code ", 18 * S, new SolidColorBrush(Color.FromArgb(al, 190, 178, 170)));
        var c = Text("137 (SIGKILL)", 18 * S, new SolidColorBrush(Color.FromArgb(al, 255, 107, 107)));
        double wa = a.WidthIncludingTrailingWhitespace;
        double x = T.Left + T.Width / 2.0 - (wa + c.Width) / 2, y = Math.Min(H - 60 * S, T.Top + T.Height / 2.0 + 170 * S);
        dc.DrawText(a, new Point(x, y));
        dc.DrawText(c, new Point(x + wa, y));
    }

    // ---------- helpers ----------

    double Rnd(double a, double b) => a + rng.NextDouble() * (b - a);
    static double EaseOut(double t) => 1 - Math.Pow(1 - t, 3);
}
