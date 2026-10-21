# Reproducible native icon, drawn locally; no image downloads or image libraries.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$directory = Join-Path $PSScriptRoot '../src-tauri/icons'
New-Item -ItemType Directory -Force $directory | Out-Null
$bitmap = [Drawing.Bitmap]::new(256, 256)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([Drawing.Color]::FromArgb(28, 31, 32))
$metal = [Drawing.Drawing2D.LinearGradientBrush]::new([Drawing.Point]::new(0, 0), [Drawing.Point]::new(200, 230), [Drawing.Color]::FromArgb(133, 139, 140), [Drawing.Color]::FromArgb(23, 26, 27))
$graphics.FillEllipse($metal, 21, 26, 214, 214)
$graphics.FillEllipse([Drawing.Brushes]::Black, 34, 39, 188, 188)
$graphics.FillEllipse([Drawing.Brushes]::Maroon, 44, 48, 168, 168)
$red = [Drawing.Drawing2D.LinearGradientBrush]::new([Drawing.Point]::new(80, 35), [Drawing.Point]::new(160, 220), [Drawing.Color]::FromArgb(255, 104, 83), [Drawing.Color]::FromArgb(158, 9, 6))
$graphics.FillEllipse($red, 44, 36, 168, 168)
$pen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(255, 218, 192), 11)
$pen.StartCap = $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
$graphics.DrawArc($pen, 89, 79, 78, 78, -45, 270)
$graphics.DrawLine($pen, 128, 70, 128, 118)
$stream = [IO.MemoryStream]::new()
$bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
$png = $stream.ToArray()
[IO.File]::WriteAllBytes((Join-Path $directory 'icon.png'), $png)
$icon = [IO.MemoryStream]::new()
$writer = [IO.BinaryWriter]::new($icon)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$png.Length); $writer.Write([uint32]22); $writer.Write($png)
[IO.File]::WriteAllBytes((Join-Path $directory 'icon.ico'), $icon.ToArray())
$writer.Dispose(); $icon.Dispose(); $stream.Dispose(); $pen.Dispose(); $red.Dispose(); $metal.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
