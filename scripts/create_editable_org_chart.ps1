param(
    [string]$SourcePath = "C:\Users\canor\OneDrive\Masaüstü\Book1.xlsx",
    [string]$OutputPath = "C:\Users\canor\OneDrive\Masaüstü\Book1_kurumsal_duzenlenebilir.xlsx"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-RgbValue {
    param([Parameter(Mandatory = $true)][string]$Hex)

    $clean = $Hex.TrimStart("#")
    $r = [Convert]::ToInt32($clean.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($clean.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($clean.Substring(4, 2), 16)
    return ($r + (256 * $g) + (65536 * $b))
}

function Release-ComObject {
    param([object]$ComObject)

    if ($null -ne $ComObject) {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($ComObject)
    }
}

function Merge-AndStyleRange {
    param(
        [Parameter(Mandatory = $true)]$Sheet,
        [Parameter(Mandatory = $true)][string]$Address,
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$FillHex,
        [Parameter(Mandatory = $true)][string]$FontHex,
        [int]$FontSize = 11,
        [switch]$Bold,
        [ValidateSet("Center", "Left", "Right")][string]$Horizontal = "Center",
        [int]$RowHeight = 0
    )

    $range = $Sheet.Range($Address)
    $range.Merge()
    $range.Value2 = $Value
    $range.WrapText = $true
    $range.Interior.Color = Get-RgbValue $FillHex
    $range.Font.Name = "Segoe UI"
    $range.Font.Size = $FontSize
    $range.Font.Bold = [bool]$Bold
    $range.Font.Color = Get-RgbValue $FontHex
    $range.VerticalAlignment = -4108
    switch ($Horizontal) {
        "Left" { $range.HorizontalAlignment = -4131 }
        "Right" { $range.HorizontalAlignment = -4152 }
        default { $range.HorizontalAlignment = -4108 }
    }
    if ($RowHeight -gt 0) {
        $range.Rows.RowHeight = $RowHeight
    }
    return $range
}

function Get-RangeRect {
    param(
        [Parameter(Mandatory = $true)]$Sheet,
        [Parameter(Mandatory = $true)][string]$Address
    )

    $range = $Sheet.Range($Address)
    return [pscustomobject]@{
        Address  = $Address
        Left     = [double]$range.Left
        Top      = [double]$range.Top
        Width    = [double]$range.Width
        Height   = [double]$range.Height
        Right    = [double]($range.Left + $range.Width)
        Bottom   = [double]($range.Top + $range.Height)
        CenterX  = [double]($range.Left + ($range.Width / 2))
        CenterY  = [double]($range.Top + ($range.Height / 2))
    }
}

function Add-LineSegment {
    param(
        [Parameter(Mandatory = $true)]$Sheet,
        [Parameter(Mandatory = $true)][double]$X1,
        [Parameter(Mandatory = $true)][double]$Y1,
        [Parameter(Mandatory = $true)][double]$X2,
        [Parameter(Mandatory = $true)][double]$Y2,
        [Parameter(Mandatory = $true)][string]$ColorHex,
        [double]$Weight = 2.25,
        [int]$DashStyle = 1,
        [double]$Transparency = 0
    )

    $line = $Sheet.Shapes.AddLine($X1, $Y1, $X2, $Y2)
    $line.Line.ForeColor.RGB = Get-RgbValue $ColorHex
    $line.Line.Weight = $Weight
    $line.Line.DashStyle = $DashStyle
    $line.Line.Transparency = $Transparency
    $line.Placement = 1
    return $line
}

function Add-RoundedBox {
    param(
        [Parameter(Mandatory = $true)]$Sheet,
        [string]$Address,
        $Rect,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string[]]$Lines,
        [Parameter(Mandatory = $true)][string]$FillHex,
        [Parameter(Mandatory = $true)][string]$LineHex,
        [string]$TitleHex = "#102A43",
        [string]$SecondaryHex = "#5B7083",
        [string]$BodyHex = "#6B7C93",
        [double]$LineWeight = 1.5
    )

    if ($PSBoundParameters.ContainsKey("Address")) {
        $targetRect = Get-RangeRect -Sheet $Sheet -Address $Address
    } elseif ($PSBoundParameters.ContainsKey("Rect")) {
        $targetRect = $Rect
    } else {
        throw "Add-RoundedBox icin Address veya Rect verilmelidir."
    }

    $shape = $Sheet.Shapes.AddShape(5, $targetRect.Left, $targetRect.Top, $targetRect.Width, $targetRect.Height)
    $shape.Name = $Name
    $shape.Placement = 1
    $shape.Fill.Visible = -1
    $shape.Fill.ForeColor.RGB = Get-RgbValue $FillHex
    $shape.Fill.Transparency = 0
    $shape.Line.Visible = -1
    $shape.Line.ForeColor.RGB = Get-RgbValue $LineHex
    $shape.Line.Weight = $LineWeight
    $shape.Line.Transparency = 0

    try {
        $shape.Adjustments.Item(1) = 0.12
    } catch {
    }

    try {
        $shape.Shadow.Visible = -1
        $shape.Shadow.ForeColor.RGB = Get-RgbValue "#9BA9B6"
        $shape.Shadow.Transparency = 0.78
        $shape.Shadow.OffsetX = 2
        $shape.Shadow.OffsetY = 2
        $shape.Shadow.Blur = 6
    } catch {
    }

    $shape.TextFrame.HorizontalAlignment = -4108
    $shape.TextFrame.VerticalAlignment = -4108
    $shape.TextFrame2.WordWrap = -1
    $shape.TextFrame2.MarginLeft = 10
    $shape.TextFrame2.MarginRight = 10
    $shape.TextFrame2.MarginTop = 8
    $shape.TextFrame2.MarginBottom = 8

    $text = ($Lines -join "`n")
    $shape.TextFrame.Characters().Text = $text
    $shape.TextFrame.Characters().Font.Name = "Segoe UI"
    $shape.TextFrame.Characters().Font.Color = Get-RgbValue $BodyHex
    $shape.TextFrame.Characters().Font.Size = 9.5
    $shape.TextFrame.Characters().Font.Bold = $false

    $start = 1
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        $lineText = $Lines[$i]
        if ($lineText.Length -gt 0) {
            $chars = $shape.TextFrame.Characters($start, $lineText.Length)
            switch ($i) {
                0 {
                    $chars.Font.Name = "Segoe UI Semibold"
                    $chars.Font.Size = 11.5
                    $chars.Font.Bold = $true
                    $chars.Font.Color = Get-RgbValue $TitleHex
                }
                1 {
                    $chars.Font.Name = "Segoe UI"
                    $chars.Font.Size = 10
                    $chars.Font.Bold = $false
                    $chars.Font.Color = Get-RgbValue $SecondaryHex
                }
                default {
                    $chars.Font.Name = "Segoe UI"
                    $chars.Font.Size = 9
                    $chars.Font.Bold = $false
                    $chars.Font.Color = Get-RgbValue $BodyHex
                }
            }
        }
        $start += ($lineText.Length + 1)
    }

    return $shape
}

function Test-FileLocked {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return $false
    }

    try {
        $fileStream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        $fileStream.Close()
        return $false
    } catch {
        return $true
    }
}

function Resolve-AvailableOutputPath {
    param([Parameter(Mandatory = $true)][string]$PreferredPath)

    $directory = Split-Path -Parent $PreferredPath
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($PreferredPath)
    $extension = [System.IO.Path]::GetExtension($PreferredPath)

    if (-not (Test-Path -LiteralPath $PreferredPath)) {
        return $PreferredPath
    }

    if (-not (Test-FileLocked -Path $PreferredPath)) {
        Remove-Item -LiteralPath $PreferredPath -Force
        return $PreferredPath
    }

    $sequence = 1
    do {
        $candidatePath = Join-Path $directory ("{0}_{1}{2}" -f $baseName, $sequence, $extension)
        $sequence++
    } while ((Test-Path -LiteralPath $candidatePath) -and (Test-FileLocked -Path $candidatePath))

    if (Test-Path -LiteralPath $candidatePath) {
        Remove-Item -LiteralPath $candidatePath -Force
    }

    return $candidatePath
}

function New-RectObject {
    param(
        [Parameter(Mandatory = $true)][double]$Left,
        [Parameter(Mandatory = $true)][double]$Top,
        [Parameter(Mandatory = $true)][double]$Width,
        [Parameter(Mandatory = $true)][double]$Height
    )

    return [pscustomobject]@{
        Left    = $Left
        Top     = $Top
        Width   = $Width
        Height  = $Height
        Right   = [double]($Left + $Width)
        Bottom  = [double]($Top + $Height)
        CenterX = [double]($Left + ($Width / 2))
        CenterY = [double]($Top + ($Height / 2))
    }
}

function Add-LabelBand {
    param(
        [Parameter(Mandatory = $true)]$Sheet,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)]$Rect,
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$FillHex,
        [Parameter(Mandatory = $true)][string]$FontHex,
        [string]$LineHex = "#FFFFFF",
        [double]$FontSize = 9.5
    )

    $shape = $Sheet.Shapes.AddShape(1, $Rect.Left, $Rect.Top, $Rect.Width, $Rect.Height)
    $shape.Name = $Name
    $shape.Placement = 1
    $shape.Fill.Visible = -1
    $shape.Fill.ForeColor.RGB = Get-RgbValue $FillHex
    $shape.Line.Visible = -1
    $shape.Line.ForeColor.RGB = Get-RgbValue $LineHex
    $shape.Line.Weight = 1
    $shape.TextFrame.HorizontalAlignment = -4108
    $shape.TextFrame.VerticalAlignment = -4108
    $shape.TextFrame2.WordWrap = -1
    $shape.TextFrame.Characters().Text = $Text
    $shape.TextFrame.Characters().Font.Name = "Segoe UI"
    $shape.TextFrame.Characters().Font.Size = $FontSize
    $shape.TextFrame.Characters().Font.Bold = $true
    $shape.TextFrame.Characters().Font.Color = Get-RgbValue $FontHex
    return $shape
}

function Add-FunctionalLink {
    param(
        [Parameter(Mandatory = $true)]$Sheet,
        [Parameter(Mandatory = $true)]$ParentRect,
        [Parameter(Mandatory = $true)]$ChildRect,
        [Parameter(Mandatory = $true)][double]$CorridorX,
        [ValidateSet("Left", "Right")][string]$ParentSide = "Left",
        [ValidateSet("Left", "Right")][string]$ChildSide = "Left",
        [string]$ColorHex = "#C47A2C",
        [double]$Weight = 2.25,
        [int]$DashStyle = 5
    )

    $startX = if ($ParentSide -eq "Left") { $ParentRect.Left } else { $ParentRect.Right }
    $startY = [double]$ParentRect.CenterY
    $endX = if ($ChildSide -eq "Left") { $ChildRect.Left } else { $ChildRect.Right }
    $endY = [double]$ChildRect.CenterY

    return @(
        $(Add-LineSegment -Sheet $Sheet -X1 $startX -Y1 $startY -X2 $CorridorX -Y2 $startY -ColorHex $ColorHex -Weight $Weight -DashStyle $DashStyle -Transparency 0),
        $(Add-LineSegment -Sheet $Sheet -X1 $CorridorX -Y1 $startY -X2 $CorridorX -Y2 $endY -ColorHex $ColorHex -Weight $Weight -DashStyle $DashStyle -Transparency 0),
        $(Add-LineSegment -Sheet $Sheet -X1 $CorridorX -Y1 $endY -X2 $endX -Y2 $endY -ColorHex $ColorHex -Weight $Weight -DashStyle $DashStyle -Transparency 0)
    )
}

function Set-TableBorder {
    param(
        [Parameter(Mandatory = $true)]$Range,
        [string]$ColorHex = "#D6DEE6"
    )

    $range.Borders.LineStyle = 1
    $range.Borders.Color = Get-RgbValue $ColorHex
    $range.Borders.Weight = 2
}

function Get-LevelModel {
    param([Parameter(Mandatory = $true)][array]$Nodes)

    $nodeMap = @{}
    foreach ($node in $Nodes) {
        $nodeMap[$node.Id] = $node
    }

    $levelMap = @{}
    $pendingIds = @($Nodes | Sort-Object Order | ForEach-Object { $_.Id })

    while ($pendingIds.Count -gt 0) {
        $resolvedInPass = @()
        foreach ($nodeId in $pendingIds) {
            $node = $nodeMap[$nodeId]
            if ($null -ne $node.LevelOverride) {
                $levelMap[$nodeId] = [int]$node.LevelOverride
                $resolvedInPass += $nodeId
                continue
            }

            if ([string]::IsNullOrWhiteSpace([string]$node.ParentId)) {
                $levelMap[$nodeId] = 0
                $resolvedInPass += $nodeId
                continue
            }

            if ($levelMap.ContainsKey($node.ParentId)) {
                $levelMap[$nodeId] = [int]($levelMap[$node.ParentId] + 1)
                $resolvedInPass += $nodeId
            }
        }

        if ($resolvedInPass.Count -eq 0) {
            throw "Node level modeli cozumlenemedi."
        }

        $pendingIds = @($pendingIds | Where-Object { $_ -notin $resolvedInPass })
    }

    $maxLevel = ($levelMap.Values | Measure-Object -Maximum).Maximum
    $levelGroups = @()
    for ($level = 0; $level -le $maxLevel; $level++) {
        $levelGroups += ,@(
            $Nodes |
                Where-Object { $levelMap[$_.Id] -eq $level } |
                Sort-Object Order |
                ForEach-Object { $_.Id }
        )
    }

    $childrenByParent = @{}
    foreach ($node in $Nodes) {
        if (-not [string]::IsNullOrWhiteSpace([string]$node.ParentId)) {
            if (-not $childrenByParent.ContainsKey($node.ParentId)) {
                $childrenByParent[$node.ParentId] = @()
            }
            $childrenByParent[$node.ParentId] += $node.Id
        }
    }

    return [pscustomobject]@{
        NodeMap          = $nodeMap
        LevelMap         = $levelMap
        LevelGroups      = $levelGroups
        ChildrenByParent = $childrenByParent
    }
}

function level_based_layout {
    param(
        [Parameter(Mandatory = $true)]$WorkspaceRect,
        [Parameter(Mandatory = $true)][array]$LevelGroups,
        [double]$TopPadding = 12,
        [double]$BottomPadding = 12,
        [double]$PreferredBoxWidth = 270,
        [double]$MinBoxWidth = 235,
        [double]$PreferredBoxHeight = 118,
        [double]$MinHorizontalGap = 34,
        [double]$VerticalGap = 90
    )

    $layout = @{}
    $levelMetrics = @{}
    $widestLevel = 0
    $widestRequiredWidth = 0
    $currentTop = [double]($WorkspaceRect.Top + $TopPadding)
    $globalCenterX = [double]($WorkspaceRect.Left + ($WorkspaceRect.Width / 2))

    for ($levelIndex = 0; $levelIndex -lt $LevelGroups.Count; $levelIndex++) {
        $levelNodeCount = @($LevelGroups[$levelIndex]).Count
        if ($levelNodeCount -eq 0) {
            continue
        }

        $levelRequiredWidth = ($levelNodeCount * $PreferredBoxWidth) + (($levelNodeCount - 1) * $MinHorizontalGap)
        if ($levelRequiredWidth -gt $widestRequiredWidth) {
            $widestRequiredWidth = $levelRequiredWidth
            $widestLevel = $levelIndex
        }
    }

    for ($level = 0; $level -lt $LevelGroups.Count; $level++) {
        $nodeIds = @($LevelGroups[$level])
        if ($nodeIds.Count -eq 0) {
            continue
        }

        $nodeCount = $nodeIds.Count
        $boxWidth = $PreferredBoxWidth
        if ($nodeCount -gt 1) {
            $maxWidthAtMinGap = [math]::Floor(($WorkspaceRect.Width - (($nodeCount - 1) * $MinHorizontalGap)) / $nodeCount)
            $boxWidth = [math]::Min($PreferredBoxWidth, $maxWidthAtMinGap)
        }
        if ($boxWidth -lt $MinBoxWidth) {
            throw "Sayfa genisligi level $level icin yetersiz. Min kutu genisligi saglanamadi."
        }

        if ($nodeCount -eq 1) {
            $gap = 0
        } else {
            $requiredWidth = ($nodeCount * $boxWidth) + (($nodeCount - 1) * $MinHorizontalGap)
            $fillRatio = switch ($nodeCount) {
                2 { 0.60 }
                3 { 0.72 }
                4 { 0.82 }
                default { 0.90 }
            }
            $targetWidth = [math]::Min($WorkspaceRect.Width, [math]::Max($requiredWidth, ($WorkspaceRect.Width * $fillRatio)))
            $gap = [math]::Floor(($targetWidth - ($nodeCount * $boxWidth)) / ($nodeCount - 1))
            $gap = [math]::Max($MinHorizontalGap, $gap)
        }

        $totalWidth = ($nodeCount * $boxWidth) + (($nodeCount - 1) * $gap)
        $startLeft = [double]($globalCenterX - ($totalWidth / 2))

        for ($index = 0; $index -lt $nodeIds.Count; $index++) {
            $left = [double]($startLeft + ($index * ($boxWidth + $gap)))
            $layout[$nodeIds[$index]] = New-RectObject -Left $left -Top $currentTop -Width $boxWidth -Height $PreferredBoxHeight
        }

        $levelMetrics[$level] = [pscustomobject]@{
            NodeCount = $nodeCount
            BoxWidth  = $boxWidth
            Gap       = $gap
            TotalWidth = $totalWidth
            Top       = $currentTop
            Bottom    = [double]($currentTop + $PreferredBoxHeight)
        }

        $currentTop += ($PreferredBoxHeight + $VerticalGap)
    }

    $usedBottom = if ($levelMetrics.Count -gt 0) {
        ($levelMetrics.GetEnumerator() | ForEach-Object { $_.Value.Bottom } | Measure-Object -Maximum).Maximum
    } else {
        $WorkspaceRect.Top
    }

    return [pscustomobject]@{
        Rects              = $layout
        LevelMetrics       = $levelMetrics
        UsedBottom         = [double]($usedBottom + $BottomPadding)
        WidestLevel        = $widestLevel
        WidestRequiredWidth = $widestRequiredWidth
        GlobalCenterX      = $globalCenterX
    }
}

function Set-GroupedLayout {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Rects,
        [Parameter(Mandatory = $true)][array]$Groups,
        [Parameter(Mandatory = $true)]$WorkspaceRect,
        [Parameter(Mandatory = $true)][double]$Top,
        [Parameter(Mandatory = $true)][double]$BoxWidth,
        [Parameter(Mandatory = $true)][double]$BoxHeight,
        [Parameter(Mandatory = $true)][double]$InnerGap,
        [double]$GroupGap = 70
    )

    $orderedGroups = @($Groups | Sort-Object CenterX)
    $groupRects = @()
    $nextAvailableLeft = [double]$WorkspaceRect.Left

    foreach ($group in $orderedGroups) {
        $nodeCount = $group.NodeIds.Count
        $groupWidth = [double](($nodeCount * $BoxWidth) + (($nodeCount - 1) * $InnerGap))
        $preferredLeft = [double]($group.CenterX - ($groupWidth / 2))
        $left = [double]([math]::Max($preferredLeft, $nextAvailableLeft))
        $groupRects += [pscustomobject]@{
            ParentId   = $group.ParentId
            NodeIds    = $group.NodeIds
            Left       = $left
            Width      = $groupWidth
            Preferred  = $preferredLeft
            Right      = [double]($left + $groupWidth)
        }
        $nextAvailableLeft = [double]($left + $groupWidth + $GroupGap)
    }

    $overflow = [double](($groupRects | Select-Object -Last 1).Right - $WorkspaceRect.Right)
    if ($overflow -gt 0) {
        for ($index = $groupRects.Count - 1; $index -ge 0; $index--) {
            $current = $groupRects[$index]
            $minLeft = if ($index -eq 0) { [double]$WorkspaceRect.Left } else { [double]($groupRects[$index - 1].Right + $GroupGap) }
            $availableShift = [double]($current.Left - $minLeft)
            $shift = [double]([math]::Min($availableShift, $overflow))
            $newLeft = [double]($current.Left - $shift)
            $groupRects[$index] = [pscustomobject]@{
                ParentId   = $current.ParentId
                NodeIds    = $current.NodeIds
                Left       = $newLeft
                Width      = $current.Width
                Preferred  = $current.Preferred
                Right      = [double]($newLeft + $current.Width)
            }
            $overflow -= $shift
        }
    }

    foreach ($groupRect in $groupRects) {
        for ($nodeIndex = 0; $nodeIndex -lt $groupRect.NodeIds.Count; $nodeIndex++) {
            $nodeLeft = [double]($groupRect.Left + ($nodeIndex * ($BoxWidth + $InnerGap)))
            $Rects[$groupRect.NodeIds[$nodeIndex]] = New-RectObject -Left $nodeLeft -Top $Top -Width $BoxWidth -Height $BoxHeight
        }
    }

    return $Rects
}

$colors = @{
    Navy        = "#1F3A5F"
    Navy2       = "#1F3A5F"
    Blue        = "#355C7D"
    Gold        = "#C47A2C"
    GoldSoft    = "#D9E4EF"
    White       = "#FFFFFF"
    Text        = "#1F2933"
    Muted       = "#6B7C93"
    Line        = "#7C93A8"
    Border      = "#1F3A5F"
    CellLabel   = "#EAF0F6"
    LightPanel  = "#F7FAFD"
    LightBox    = "#FFFFFF"
    SupportBg   = "#FFFFFF"
    SupportLine = "#1F3A5F"
    Stripe      = "#FCFDFE"
    ManagerFill = "#F4F6F9"
    UnitFill    = "#FFFFFF"
    Functional  = "#C47A2C"
}

$roleRows = @(
    @("Genel Müdür", "Yönetim", "Şirket Üst Yönetimi", "Kurumun stratejik yönünü belirler, icra yapısını yönetir ve tüm fonksiyonların hedef uyumunu sağlar.", "Strateji, bütçe, performans ve kurumsal temsil kararlarını sahiplenir.", "Şemanın en üst karar ve onay mercii olarak konumlandırılmıştır."),
    @("İnsan Kaynakları Müdürü", "Yönetim", "Genel Müdür Yardımcısı", "İşe alım, organizasyonel yapılanma ve çalışan deneyimi süreçlerini yönetir.", "Yetenek kazanımı, politika uygulamaları, performans sistemleri ve çalışan ilişkilerini koordine eder.", "Genel Müdür Yardımcısına doğrudan bağlı destek-yönetim fonksiyonu olarak konumlandırılmıştır."),
    @("Eğitim Yönetmeni", "Ticari", "Satış Müdürü", "Satış organizasyonunun yetkinlik gelişimi ve kurumsal eğitim planlamasını yönetir.", "Eğitim ihtiyaç analizi, yıllık eğitim planı, saha gelişim programları ve uygulama takibini yürütür.", "Satış Müdürüne bağlı gelişim fonksiyonu olarak konumlandırılmıştır."),
    @("Genel Müdür Yardımcısı", "Yönetim", "Genel Müdür", "Saha ve merkez operasyonlarının eşgüdümünü sağlar; bağlı müdürlüklerin hedef, süreç ve çıktılarını takip eder.", "Satış, operasyon, demobank, teknik servis ile satın alma ve lojistik tarafında günlük icra disiplinini güçlendirir.", "Üst yönetim ile müdürlükler arasındaki ana koordinasyon rolüdür."),
    @("Muhasebe Müdürü", "Finans", "Genel Müdür", "Finansal kayıt düzeni, mali uygunluk, raporlama ve iç kontrol süreçlerini yönetir.", "Muhasebe kapanışları, vergi ve uyum süreçleri ile finansal görünürlüğü destekler.", "Şemada Genel Müdüre doğrudan bağlı ve sağ blokta konumlandırılmış bağımsız fonksiyondur."),
    @("Satış Müdürü", "Ticari", "Genel Müdür Yardımcısı", "Gelir hedefleri, kanal verimliliği ve satış ekibi performansından sorumludur.", "Bölgesel satış yapısı ile kurumsal satış gelişimini tek çatı altında yönetir.", "Ticari büyüme odağını temsil eder."),
    @("Operasyon Müdürü", "Operasyon", "Genel Müdür Yardımcısı", "Hizmet sürekliliği, süreç verimliliği ve merkez operasyon kalitesini yönetir.", "CRM, data, demobank ve çağrı merkezi yapılarını yönlendirir; iyileştirme aksiyonlarını koordine eder.", "Operasyonel omurganın ana sahibidir; bağlı ekiplerin koordinasyonunu yürütür."),
    @("Demobank Yönetmeni", "Operasyon", "Operasyon Müdürü", "Demo, uygulama ve deneyim süreçlerinin planlı, ölçülebilir ve bağımsız yönetimini sağlar.", "Demobank faaliyetlerinin hedef, kaynak ve operasyon planlamasını sahiplenir; operasyon yapısıyla koordineli çalışır.", "Operasyon Müdürüne bağlı özel yapı olarak konumlandırılmıştır."),
    @("Teknik Servis Müdürü", "Teknik Hizmet", "Genel Müdür Yardımcısı", "Teknik servis kalitesi, saha hizmet standardı ve SLA performansını yönetir.", "Arıza, bakım, teknik planlama ve servis koordinasyonunun liderliğini üstlenir.", "Fonksiyonel destek yapısıyla yakın çalışır."),
    @("Satın Alma ve Lojistik Müdürü", "Tedarik Zinciri", "Genel Müdür Yardımcısı", "Tedarik, stok, lojistik akış ve maliyet disiplini süreçlerini yönetir.", "Satın alma planlaması, sevkiyat koordinasyonu ve filo takibini denetler.", "Operasyon sürekliliği için kritik destek fonksiyonudur."),
    @("Bölge Satış Yönetmenleri", "Ticari", "Satış Müdürü", "Saha satış performansını bölgesel bazda yönetir ve hedeflerin yerel kırılımını takip eder.", "Bölgesel ekip yönetimi, müşteri ilişkileri ve satış dönüşümlerinden sorumludur.", "Ticari saha yönetimini temsil eden bağlı yapı olarak gösterilmiştir."),
    @("Kurumsal Satış Yönetmeni", "Ticari", "Satış Müdürü", "Kurumsal müşteri portföyünü geliştirir, büyük hesap yönetimini yürütür.", "Teklif, ilişki yönetimi ve sözleşme bazlı satış süreçlerini koordine eder.", "Anahtar hesap odağı nedeniyle satış yapısında ayrı vurgulanmıştır."),
    @("CRM / Data Yönetmeni", "Operasyon", "Operasyon Müdürü", "Müşteri verisi, raporlama disiplini ve analitik görünürlüğü yönetir.", "Veri doğruluğu, segmentasyon ve karar destek çıktıları üretir.", "Operasyonel karar kalitesini artıran destek ekiplerinden biridir."),
    @("Çağrı Merkezi", "Operasyon", "Operasyon Müdürü", "Müşteri taleplerinin ilk temas noktası olarak kayıt, yönlendirme ve geri bildirim akışını yönetir.", "Çağrı karşılama, kayıt açma, çözüm takibi ve memnuniyet iletişimini yürütür.", "Müşteri deneyimini doğrudan etkileyen ön hat ekiplerinden biridir."),
    @("Filo Operasyon Sorumlusu", "Destek", "Satın Alma ve Lojistik Müdürü", "Araç filosu ve zimmet süreçlerinin düzenli, güvenli ve planlı yönetimini sağlar.", "Bakım, sigorta, kullanım planı ve araç kayıt takibini yürütür.", "Lojistik yönetiminin saha destek rolüdür."),
    @("Bölge İdari İşler Destek Personeli", "Destek", "Teknik Servis Müdürü / Muhasebe Müdürü", "İdari ve operasyonel destek süreçlerinde iki ana fonksiyona eş zamanlı hizmet sağlar.", "Evrak akışı, koordinasyon, takip ve saha/merkez arası idari destek süreçlerini üstlenir.", "Görselde kesik çizgi ile gösterilerek Teknik Servis ve Muhasebe tarafına matris destek verdiği vurgulanmıştır.")
)

$excel = $null
$workbook = $null
$chartSheet = $null
$descSheet = $null

try {
    if (-not (Test-Path -LiteralPath $SourcePath)) {
        throw "Kaynak dosya bulunamadi: $SourcePath"
    }

    $outputDirectory = Split-Path -Parent $OutputPath
    if (-not (Test-Path -LiteralPath $outputDirectory)) {
        throw "Cikti klasoru bulunamadi: $outputDirectory"
    }
    $resolvedOutputPath = Resolve-AvailableOutputPath -PreferredPath $OutputPath

    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.ScreenUpdating = $false

    $workbook = $excel.Workbooks.Add()
    while ($workbook.Worksheets.Count -lt 2) {
        [void]$workbook.Worksheets.Add()
    }
    while ($workbook.Worksheets.Count -gt 2) {
        $workbook.Worksheets.Item($workbook.Worksheets.Count).Delete()
    }

    $chartSheet = $workbook.Worksheets.Item(1)
    $descSheet = $workbook.Worksheets.Item(2)
    $chartSheet.Name = "Organizasyon Şeması"
    $descSheet.Name = "Rol Açıklamaları"

    $chartSheet.Cells.Font.Name = "Segoe UI"
    $chartSheet.Cells.Font.Size = 10
    $chartSheet.Application.ActiveWindow.DisplayGridlines = $false
    $chartSheet.Application.ActiveWindow.Zoom = 85

    $nodeDefinitions = @(
        [pscustomobject]@{ Id = "gm"; Name = "box_genel_mudur"; ParentId = $null; LevelOverride = $null; Order = 1; Fill = $colors.Navy2; Line = $colors.Border; Title = $colors.White; Secondary = "#D9E4EF"; Body = "#D9E4EF"; Lines = @("GENEL MÜDÜR", "Ad Soyad", "Strateji, yönetişim ve genel icra") },
        [pscustomobject]@{ Id = "gmy"; Name = "box_gmy"; ParentId = "gm"; LevelOverride = $null; Order = 2; Fill = $colors.Blue; Line = $colors.Border; Title = $colors.White; Secondary = "#E7EEF5"; Body = "#E7EEF5"; Lines = @("GENEL MÜDÜR YARDIMCISI", "Ad Soyad", "Operasyonel koordinasyon ve saha yönetimi") },
        [pscustomobject]@{ Id = "acc"; Name = "box_muhasebe"; ParentId = "gm"; LevelOverride = $null; Order = 3; Fill = $colors.ManagerFill; Line = $colors.Border; Title = $colors.Navy; Secondary = $colors.Muted; Body = $colors.Muted; Lines = @("MUHASEBE MÜDÜRÜ", "Ad Soyad", "Finansal raporlama, mali kontrol ve uygunluk") },
        [pscustomobject]@{ Id = "sales"; Name = "box_satis"; ParentId = "gmy"; LevelOverride = $null; Order = 4; Fill = $colors.ManagerFill; Line = $colors.Border; Title = $colors.Navy; Secondary = $colors.Muted; Body = $colors.Muted; Lines = @("SATIŞ MÜDÜRÜ", "Ad Soyad", "Gelir büyümesi ve satış performansı") },
        [pscustomobject]@{ Id = "ops"; Name = "box_operasyon"; ParentId = "gmy"; LevelOverride = $null; Order = 5; Fill = $colors.ManagerFill; Line = $colors.Border; Title = $colors.Navy; Secondary = $colors.Muted; Body = $colors.Muted; Lines = @("OPERASYON MÜDÜRÜ", "Ad Soyad", "Süreç verimliliği ve hizmet sürekliliği") },
        [pscustomobject]@{ Id = "tech"; Name = "box_teknik"; ParentId = "gmy"; LevelOverride = $null; Order = 6; Fill = $colors.ManagerFill; Line = $colors.Border; Title = $colors.Navy; Secondary = $colors.Muted; Body = $colors.Muted; Lines = @("TEKNİK SERVİS MÜDÜRÜ", "Ad Soyad", "Teknik kalite, SLA ve saha koordinasyonu") },
        [pscustomobject]@{ Id = "proc"; Name = "box_satin_alma"; ParentId = "gmy"; LevelOverride = $null; Order = 7; Fill = $colors.ManagerFill; Line = $colors.Border; Title = $colors.Navy; Secondary = $colors.Muted; Body = $colors.Muted; Lines = @("SATIN ALMA VE LOJİSTİK MÜDÜRÜ", "Ad Soyad", "Tedarik, stok ve sevkiyat disiplini") },
        [pscustomobject]@{ Id = "hr"; Name = "box_ik"; ParentId = "gmy"; LevelOverride = $null; Order = 8; Fill = $colors.ManagerFill; Line = $colors.Border; Title = $colors.Navy; Secondary = $colors.Muted; Body = $colors.Muted; Lines = @("İNSAN KAYNAKLARI MÜDÜRÜ", "Ad Soyad", "İşe alım, organizasyon gelişimi ve çalışan deneyimi") },
        [pscustomobject]@{ Id = "region_sales"; Name = "box_bolge_satis"; ParentId = "sales"; LevelOverride = $null; Order = 9; Fill = $colors.ManagerFill; Line = $colors.Border; Title = $colors.Navy; Secondary = $colors.Muted; Body = $colors.Muted; Lines = @("BÖLGE SATIŞ YÖNETMENLERİ", "Saha satış ve bölgesel hedef yönetimi") },
        [pscustomobject]@{ Id = "corp_sales"; Name = "box_kurumsal_satis"; ParentId = "sales"; LevelOverride = $null; Order = 10; Fill = $colors.ManagerFill; Line = $colors.Border; Title = $colors.Navy; Secondary = $colors.Muted; Body = $colors.Muted; Lines = @("KURUMSAL SATIŞ YÖNETMENİ", "Anahtar müşteri ve büyük hesap yönetimi") },
        [pscustomobject]@{ Id = "edu"; Name = "box_egitim"; ParentId = "sales"; LevelOverride = $null; Order = 11; Fill = $colors.ManagerFill; Line = $colors.Border; Title = $colors.Navy; Secondary = $colors.Muted; Body = $colors.Muted; Lines = @("EĞİTİM YÖNETMENİ", "Ad Soyad", "Yetkinlik, eğitim planı ve gelişim programları") },
        [pscustomobject]@{ Id = "demo_mgr"; Name = "box_demobank_mudur"; ParentId = "ops"; LevelOverride = $null; Order = 12; Fill = $colors.ManagerFill; Line = $colors.Border; Title = $colors.Navy; Secondary = $colors.Muted; Body = $colors.Muted; Lines = @("DEMOBANK YÖNETMENİ", "Ad Soyad", "Demo, uygulama ve deneyim süreçlerinin ana sahibi") },
        [pscustomobject]@{ Id = "crm"; Name = "box_crm"; ParentId = "ops"; LevelOverride = $null; Order = 13; Fill = $colors.UnitFill; Line = $colors.Border; Title = $colors.Navy; Secondary = $colors.Muted; Body = $colors.Muted; Lines = @("CRM / DATA YÖNETMENİ", "Veri kalitesi, raporlama ve analitik görünürlük") },
        [pscustomobject]@{ Id = "call"; Name = "box_cagri"; ParentId = "ops"; LevelOverride = $null; Order = 14; Fill = $colors.UnitFill; Line = $colors.Border; Title = $colors.Navy; Secondary = $colors.Muted; Body = $colors.Muted; Lines = @("ÇAĞRI MERKEZİ", "Talep karşılama ve müşteri iletişimi") },
        [pscustomobject]@{ Id = "fleet"; Name = "box_arac"; ParentId = "proc"; LevelOverride = $null; Order = 15; Fill = $colors.UnitFill; Line = $colors.Border; Title = $colors.Navy; Secondary = $colors.Muted; Body = $colors.Muted; Lines = @("FİLO OPERASYON SORUMLUSU", "Filo, zimmet ve araç operasyon planlaması") },
        [pscustomobject]@{ Id = "support"; Name = "box_destek"; ParentId = $null; LevelOverride = 4; Order = 16; Fill = $colors.UnitFill; Line = $colors.Border; Title = $colors.Navy; Secondary = $colors.Muted; Body = $colors.Text; Lines = @("BÖLGE İDARİ İŞLER DESTEK PERSONELİ", "Matris / fonksiyonel destek rolü", "Teknik Servis Müdürü ve Muhasebe Müdürüne bağlı idari takip, evrak ve koordinasyon desteği sağlar.") }
    )

    $layoutModel = Get-LevelModel -Nodes $nodeDefinitions

    foreach ($column in 1..52) {
        $chartSheet.Columns.Item($column).ColumnWidth = 8.9
    }
    foreach ($row in 1..60) {
        $chartSheet.Rows.Item($row).RowHeight = 22
    }
    foreach ($row in 1..4) {
        $chartSheet.Rows.Item($row).RowHeight = 30
    }
    foreach ($row in 56..60) {
        $chartSheet.Rows.Item($row).RowHeight = 24
    }

    $chartSheet.Range("A1:AZ60").Interior.Color = Get-RgbValue $colors.White

    [void](Merge-AndStyleRange -Sheet $chartSheet -Address "A1:AO2" -Value "ORGANİZASYON ŞEMASI" -FillHex $colors.Navy -FontHex $colors.White -FontSize 20 -Bold -Horizontal Left)
    [void](Merge-AndStyleRange -Sheet $chartSheet -Address "A3:AO4" -Value "Tree layout algoritması ile en geniş level referans alınır, şema global merkez eksenine yerleştirilir ve bağlantılar kutuların çevresinden okunabilir şekilde dolaştırılır." -FillHex $colors.Navy -FontHex $colors.GoldSoft -FontSize 10 -Horizontal Left)
    [void](Merge-AndStyleRange -Sheet $chartSheet -Address "AP1:AZ4" -Value "Tam çizgi: Doğrudan raporlama`nKesik çizgi: Matris / fonksiyonel bağlılık`nKutular gerçek Excel şekilleridir; çift tıklayarak düzenleyebilirsiniz." -FillHex $colors.Navy2 -FontHex $colors.White -FontSize 10)

    $workspaceRect = Get-RangeRect -Sheet $chartSheet -Address "B8:AY53"
    $baseCellWidth = [double]$chartSheet.Range("B8").Width
    $baseRowHeight = [double]$chartSheet.Rows.Item(8).Height
    $widestNodeCount = ($layoutModel.LevelGroups | ForEach-Object { @($_).Count } | Measure-Object -Maximum).Maximum
    $preferredBoxWidth = [math]::Round($baseCellWidth * 3.95, 1)
    $minBoxWidth = [math]::Round($baseCellWidth * 3.70, 1)
    $minHorizontalGap = [math]::Round($baseCellWidth * 2.60, 1)
    $verticalGap = [math]::Round($baseRowHeight * 4.00, 1)
    $preferredBoxHeight = [math]::Round($baseRowHeight * 4.85, 1)
    $requiredWorkspaceWidth = ($widestNodeCount * $preferredBoxWidth) + (($widestNodeCount - 1) * $minHorizontalGap) + ($baseCellWidth * 4)
    if ($workspaceRect.Width -lt $requiredWorkspaceWidth) {
        $scaleFactor = $requiredWorkspaceWidth / $workspaceRect.Width
        $scaledColumnWidth = [math]::Round(($chartSheet.Columns.Item(2).ColumnWidth * $scaleFactor), 1)
        foreach ($column in 1..52) {
            $chartSheet.Columns.Item($column).ColumnWidth = $scaledColumnWidth
        }
        $workspaceRect = Get-RangeRect -Sheet $chartSheet -Address "B8:AY53"
        $baseCellWidth = [double]$chartSheet.Range("B8").Width
        $preferredBoxWidth = [math]::Round($baseCellWidth * 3.95, 1)
        $minBoxWidth = [math]::Round($baseCellWidth * 3.70, 1)
        $minHorizontalGap = [math]::Round($baseCellWidth * 2.60, 1)
    }
    $layout = level_based_layout -WorkspaceRect $workspaceRect -LevelGroups $layoutModel.LevelGroups -TopPadding 18 -BottomPadding 24 -PreferredBoxWidth $preferredBoxWidth -MinBoxWidth $minBoxWidth -PreferredBoxHeight $preferredBoxHeight -MinHorizontalGap $minHorizontalGap -VerticalGap $verticalGap
    $rects = $layout.Rects

    $childBoxWidth = [math]::Round($baseCellWidth * 3.15, 1)
    $childBoxHeight = [math]::Round($baseRowHeight * 4.35, 1)
    $childInnerGap = [math]::Round($baseCellWidth * 1.10, 1)
    $childGroupGap = [math]::Round($baseCellWidth * 1.35, 1)
    $groupedChildTop = [double]$rects["region_sales"].Top
    $rects = Set-GroupedLayout -Rects $rects -Groups @(
        [pscustomobject]@{ ParentId = "sales"; CenterX = $rects["sales"].CenterX; NodeIds = @("region_sales", "corp_sales", "edu") },
        [pscustomobject]@{ ParentId = "ops"; CenterX = $rects["ops"].CenterX; NodeIds = @("crm", "demo_mgr", "call") },
        [pscustomobject]@{ ParentId = "proc"; CenterX = $rects["proc"].CenterX; NodeIds = @("fleet") }
    ) -WorkspaceRect $workspaceRect -Top $groupedChildTop -BoxWidth $childBoxWidth -BoxHeight $childBoxHeight -InnerGap $childInnerGap -GroupGap $childGroupGap
    $supportWidth = [math]::Round($baseCellWidth * 4.05, 1)
    $supportHeight = [math]::Round($baseRowHeight * 4.75, 1)
    $supportCenterX = [double](($rects["tech"].CenterX + $rects["acc"].CenterX) / 2)
    $rects["support"] = New-RectObject -Left ($supportCenterX - ($supportWidth / 2)) -Top $rects["support"].Top -Width $supportWidth -Height $supportHeight

    $labelShapes = @()
    $labelShapes += Add-LabelBand -Sheet $chartSheet -Name "band_yonetim" -Rect (New-RectObject -Left $workspaceRect.Left -Top ($rects["gm"].Top - 30) -Width 180 -Height 20) -Text "YÖNETİM" -FillHex $colors.CellLabel -FontHex $colors.Navy
    $mainSpanLeft = ($rects["sales"].Left, $rects["ops"].Left, $rects["tech"].Left, $rects["proc"].Left, $rects["hr"].Left | Measure-Object -Minimum).Minimum
    $mainSpanRight = ($rects["sales"].Right, $rects["ops"].Right, $rects["tech"].Right, $rects["proc"].Right, $rects["hr"].Right | Measure-Object -Maximum).Maximum
    $labelShapes += Add-LabelBand -Sheet $chartSheet -Name "band_main_directors" -Rect (New-RectObject -Left $mainSpanLeft -Top ($rects["sales"].Top - 30) -Width ($mainSpanRight - $mainSpanLeft) -Height 20) -Text "ANA MÜDÜRLÜKLER" -FillHex $colors.CellLabel -FontHex $colors.Navy

    $salesChildIds = @("region_sales", "corp_sales", "edu")
    $opsChildIds = @("crm", "demo_mgr", "call")
    $procChildIds = @("fleet")

    $salesSpanLeft = ($salesChildIds | ForEach-Object { $rects[$_].Left } | Measure-Object -Minimum).Minimum
    $salesSpanRight = ($salesChildIds | ForEach-Object { $rects[$_].Right } | Measure-Object -Maximum).Maximum
    $labelShapes += Add-LabelBand -Sheet $chartSheet -Name "band_sales_children" -Rect (New-RectObject -Left $salesSpanLeft -Top ($rects["region_sales"].Top - 26) -Width ($salesSpanRight - $salesSpanLeft) -Height 18) -Text "SATIŞ MÜDÜRÜNE BAĞLI YAPILAR" -FillHex $colors.LightPanel -FontHex $colors.Muted -FontSize 9

    $opsSpanLeft = ($opsChildIds | ForEach-Object { $rects[$_].Left } | Measure-Object -Minimum).Minimum
    $opsSpanRight = ($opsChildIds | ForEach-Object { $rects[$_].Right } | Measure-Object -Maximum).Maximum
    $labelShapes += Add-LabelBand -Sheet $chartSheet -Name "band_ops_children" -Rect (New-RectObject -Left $opsSpanLeft -Top ($rects["crm"].Top - 26) -Width ($opsSpanRight - $opsSpanLeft) -Height 18) -Text "BAĞLI OPERASYON EKİPLERİ" -FillHex $colors.LightPanel -FontHex $colors.Muted -FontSize 9

    $procSpanLeft = ($procChildIds | ForEach-Object { $rects[$_].Left } | Measure-Object -Minimum).Minimum
    $procSpanRight = ($procChildIds | ForEach-Object { $rects[$_].Right } | Measure-Object -Maximum).Maximum
    $labelShapes += Add-LabelBand -Sheet $chartSheet -Name "band_proc_children" -Rect (New-RectObject -Left $procSpanLeft -Top ($rects["fleet"].Top - 26) -Width ($procSpanRight - $procSpanLeft) -Height 18) -Text "BAĞLI DESTEK ROLÜ" -FillHex $colors.LightPanel -FontHex $colors.Muted -FontSize 9
    $labelShapes += Add-LabelBand -Sheet $chartSheet -Name "band_support" -Rect (New-RectObject -Left $rects["support"].Left -Top ($rects["support"].Top - 26) -Width $rects["support"].Width -Height 18) -Text "FONKSİYONEL DESTEK YAPISI" -FillHex "#FBF7EF" -FontHex $colors.Navy -FontSize 9

    foreach ($node in $nodeDefinitions) {
        [void](Add-RoundedBox -Sheet $chartSheet -Rect $rects[$node.Id] -Name $node.Name -Lines $node.Lines -FillHex $node.Fill -LineHex $node.Line -TitleHex $node.Title -SecondaryHex $node.Secondary -BodyHex $node.Body -LineWeight 1.5)
    }

    $chartLines = @()
    foreach ($parentId in ($layoutModel.ChildrenByParent.Keys | Sort-Object { $layoutModel.NodeMap[$_].Order })) {
        $parentRect = $rects[$parentId]
        $childIds = @($layoutModel.ChildrenByParent[$parentId] | Sort-Object { $layoutModel.NodeMap[$_].Order })
        $childRects = @($childIds | ForEach-Object { $rects[$_] })
        if ($childRects.Count -eq 0) {
            continue
        }

        $sortedChildren = @($childRects | Sort-Object CenterX)
        $guideY = [double]($parentRect.Bottom + (($sortedChildren[0].Top - $parentRect.Bottom) / 2))
        $chartLines += Add-LineSegment -Sheet $chartSheet -X1 $parentRect.CenterX -Y1 $parentRect.Bottom -X2 $parentRect.CenterX -Y2 $guideY -ColorHex $colors.Line -Weight 2.2 -Transparency 0

        if ($sortedChildren.Count -gt 1) {
            $horizontalStartX = [double]([math]::Min($parentRect.CenterX, $sortedChildren[0].CenterX))
            $horizontalEndX = [double]([math]::Max($parentRect.CenterX, $sortedChildren[-1].CenterX))
            $chartLines += Add-LineSegment -Sheet $chartSheet -X1 $horizontalStartX -Y1 $guideY -X2 $horizontalEndX -Y2 $guideY -ColorHex $colors.Line -Weight 2.2 -Transparency 0
        } else {
            $chartLines += Add-LineSegment -Sheet $chartSheet -X1 $parentRect.CenterX -Y1 $guideY -X2 $sortedChildren[0].CenterX -Y2 $guideY -ColorHex $colors.Line -Weight 2.2 -Transparency 0
        }

        foreach ($childRect in $sortedChildren) {
            $chartLines += Add-LineSegment -Sheet $chartSheet -X1 $childRect.CenterX -Y1 $guideY -X2 $childRect.CenterX -Y2 $childRect.Top -ColorHex $colors.Line -Weight 2.2 -Transparency 0
        }
    }

    $techSupportCorridor = [double](($rects["call"].Right + $rects["fleet"].Left) / 2)
    $accSupportCorridor = [double]($rects["support"].Right + ($baseCellWidth * 0.9))

    $chartLines += Add-FunctionalLink -Sheet $chartSheet -ParentRect $rects["tech"] -ChildRect $rects["support"] -CorridorX $techSupportCorridor -ParentSide Right -ChildSide Left -ColorHex $colors.Functional -Weight 2.25 -DashStyle 5
    $chartLines += Add-FunctionalLink -Sheet $chartSheet -ParentRect $rects["acc"] -ChildRect $rects["support"] -CorridorX $accSupportCorridor -ParentSide Right -ChildSide Right -ColorHex $colors.Functional -Weight 2.25 -DashStyle 5

    [void](Merge-AndStyleRange -Sheet $chartSheet -Address "A56:AZ60" -Value "Düzenleme notu: Şema A4 çıktıda okunabilir olacak şekilde kompaktlaştırılmıştır. Tree layout algoritması en geniş level'i referans alır, şemayı global merkezde hizalar ve doğrudan raporlama çizgilerini alt/üst merkez noktalarından üretir. Fonksiyonel destek çizgileri yalnızca Bölge İdari İşler yapısı için yan kenarlardan bağlanır." -FillHex "#F4F7FB" -FontHex $colors.Muted -FontSize 10 -Horizontal Left)
    Set-TableBorder -Range $chartSheet.Range("A56:AZ60")

    $chartSheet.PageSetup.Orientation = 2
    $chartSheet.PageSetup.Zoom = $false
    $chartSheet.PageSetup.FitToPagesWide = 1
    $chartSheet.PageSetup.FitToPagesTall = 1
    $chartSheet.PageSetup.CenterHorizontally = $true
    $chartSheet.PageSetup.LeftMargin = $excel.InchesToPoints(0.3)
    $chartSheet.PageSetup.RightMargin = $excel.InchesToPoints(0.3)
    $chartSheet.PageSetup.TopMargin = $excel.InchesToPoints(0.4)
    $chartSheet.PageSetup.BottomMargin = $excel.InchesToPoints(0.4)

    $descSheet.Cells.Font.Name = "Segoe UI"
    $descSheet.Cells.Font.Size = 10
    $descSheet.Application.ActiveWindow.DisplayGridlines = $false

    $descColumnWidths = @(28, 18, 26, 42, 46, 42)
    $descColumnLetters = @("A", "B", "C", "D", "E", "F")
    for ($columnIndex = 0; $columnIndex -lt $descColumnLetters.Count; $columnIndex++) {
        $descSheet.Range("$($descColumnLetters[$columnIndex]):$($descColumnLetters[$columnIndex])").ColumnWidth = [double]$descColumnWidths[$columnIndex]
    }
    foreach ($row in 1..40) {
        $descSheet.Rows.Item($row).RowHeight = 30
    }

    [void](Merge-AndStyleRange -Sheet $descSheet -Address "A1:F2" -Value "ROL AÇIKLAMALARI VE KURUMSAL NOTLAR" -FillHex $colors.Navy -FontHex $colors.White -FontSize 18 -Bold)
    [void](Merge-AndStyleRange -Sheet $descSheet -Address "A3:F4" -Value "Bu sayfa, şemadaki pozisyonların bağlılık yapısını ve rol özetlerini kurumsal dil ile toplu olarak sunar. Kesik çizgiler, doğrudan hiyerarşi dışındaki matris bağlılık veya fonksiyonel destek ilişkilerini gösterir." -FillHex "#F4F7FB" -FontHex $colors.Text -FontSize 11 -Horizontal Left)

    $headers = @("Pozisyon", "Fonksiyon Grubu", "Bağlı Olduğu", "Rol Özeti", "Temel Sorumluluk / Katkı", "Kurumsal Not")
    for ($i = 0; $i -lt $headers.Count; $i++) {
        $cell = $descSheet.Cells.Item(6, $i + 1)
        $cell.Value2 = $headers[$i]
        $cell.Interior.Color = Get-RgbValue $colors.Blue
        $cell.Font.Name = "Segoe UI"
        $cell.Font.Size = 11
        $cell.Font.Bold = $true
        $cell.Font.Color = Get-RgbValue $colors.White
        $cell.HorizontalAlignment = -4108
        $cell.VerticalAlignment = -4108
        $cell.WrapText = $true
    }
    Set-TableBorder -Range $descSheet.Range("A6:F6")

    $groupFill = @{
        "Yönetim" = "#EEF3F8"
        "Finans" = "#F5F7FA"
        "Ticari" = "#F1F8F8"
        "Operasyon" = "#F4F8FC"
        "Teknik Hizmet" = "#F4F8FC"
        "Tedarik Zinciri" = "#FBF7EF"
        "Destek" = "#FBF7EF"
    }

    $rowIndex = 7
    foreach ($row in $roleRows) {
        for ($columnIndex = 0; $columnIndex -lt $row.Count; $columnIndex++) {
            $cell = $descSheet.Cells.Item($rowIndex, $columnIndex + 1)
            $cell.Value2 = $row[$columnIndex]
            $cell.WrapText = $true
            $cell.VerticalAlignment = -4160
            $cell.HorizontalAlignment = -4131
            $cell.Font.Name = "Segoe UI"
            $cell.Font.Size = 10
            $cell.Font.Color = Get-RgbValue $colors.Text
            if ($columnIndex -eq 1) {
                $cell.Interior.Color = Get-RgbValue $groupFill[$row[1]]
            } elseif ($rowIndex % 2 -eq 1) {
                $cell.Interior.Color = Get-RgbValue $colors.Stripe
            }
        }
        Set-TableBorder -Range $descSheet.Range("A$($rowIndex):F$($rowIndex)")
        $rowIndex++
    }

    $descSheet.Rows.Item("1:4").RowHeight = 34
    $descSheet.Range("A1:F$($rowIndex - 1)").EntireColumn.AutoFit() | Out-Null
    $descSheet.Columns.Item("D").ColumnWidth = 42
    $descSheet.Columns.Item("E").ColumnWidth = 46
    $descSheet.Columns.Item("F").ColumnWidth = 42
    $descSheet.Application.ActiveWindow.SplitRow = 6
    $descSheet.Application.ActiveWindow.FreezePanes = $true

    $workbook.SaveAs($resolvedOutputPath, 51)
    Write-Output $resolvedOutputPath
}
finally {
    if ($workbook) {
        $workbook.Close($true) | Out-Null
    }
    if ($excel) {
        $excel.Quit()
    }

    Release-ComObject $descSheet
    Release-ComObject $chartSheet
    Release-ComObject $workbook
    Release-ComObject $excel

    [gc]::Collect()
    [gc]::WaitForPendingFinalizers()
}







