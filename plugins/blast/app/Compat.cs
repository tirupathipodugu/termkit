namespace TerminalBlast;

// .NET Framework 4.8 (built into every Windows 10/11) lacks a few newer helpers; these stand in for them.
static class MathF
{
    public const float PI = (float)Math.PI;
    public static float Sin(float x) => (float)Math.Sin(x);
    public static float Cos(float x) => (float)Math.Cos(x);
    public static float Pow(float x, float y) => (float)Math.Pow(x, y);
    public static float Sqrt(float x) => (float)Math.Sqrt(x);
    public static float Max(float a, float b) => Math.Max(a, b);
    public static float Atan2(float y, float x) => (float)Math.Atan2(y, x);
}

static class Compat
{
    public static readonly Random Rng = new();
    public static float NextSingle() => (float)Rng.NextDouble();
    public static double Clamp(double v, double lo, double hi) => v < lo ? lo : v > hi ? hi : v;
    public static float Clamp(float v, float lo, float hi) => v < lo ? lo : v > hi ? hi : v;
}
