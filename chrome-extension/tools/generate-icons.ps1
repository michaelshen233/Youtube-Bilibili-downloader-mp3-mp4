Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path $PSScriptRoot '..\icons'
[System.IO.Directory]::CreateDirectory($iconDirectory) | Out-Null
foreach ($iconSize in @(16, 32, 48, 128)) {
    $scale = 4
    $canvasSize = $iconSize * $scale
    $bitmap = New-Object System.Drawing.Bitmap($canvasSize, $canvasSize)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($canvasSize / 128.0, $canvasSize / 128.0)
    $rounded = New-Object System.Drawing.Drawing2D.GraphicsPath
    $rounded.AddArc(2, 2, 42, 42, 180, 90)
    $rounded.AddArc(84, 2, 42, 42, 270, 90)
    $rounded.AddArc(84, 84, 42, 42, 0, 90)
    $rounded.AddArc(2, 84, 42, 42, 90, 90)
    $rounded.CloseFigure()
    $fill = New-Object System.Drawing.Drawing2D.LinearGradientBrush([System.Drawing.Point]::new(0, 0), [System.Drawing.Point]::new(128, 128), [System.Drawing.ColorTranslator]::FromHtml('#237F5C'), [System.Drawing.ColorTranslator]::FromHtml('#14543E'))
    $graphics.FillPath($fill, $rounded)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 9)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawLine($pen, 64, 29, 64, 76)
    $graphics.DrawLines($pen, [System.Drawing.Point[]]@([System.Drawing.Point]::new(45, 59), [System.Drawing.Point]::new(64, 78), [System.Drawing.Point]::new(83, 59)))
    $graphics.DrawLines($pen, [System.Drawing.Point[]]@([System.Drawing.Point]::new(34, 84), [System.Drawing.Point]::new(34, 98), [System.Drawing.Point]::new(94, 98), [System.Drawing.Point]::new(94, 84)))
    $graphics.Dispose()
    $small = New-Object System.Drawing.Bitmap($iconSize, $iconSize)
    $smallGraphics = [System.Drawing.Graphics]::FromImage($small)
    $smallGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $smallGraphics.DrawImage($bitmap, 0, 0, $iconSize, $iconSize)
    $small.Save((Join-Path $iconDirectory "icon$iconSize.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $smallGraphics.Dispose()
    $small.Dispose()
    $bitmap.Dispose()
    $fill.Dispose()
    $pen.Dispose()
    $rounded.Dispose()
}
