param(
    [string]$OutputDirectory,
    [string]$CompanyName = "RAİNWATER DIŞ TİCARET SANAYİ VE TİCARET ANAONİM ŞİRKETİ"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$desktopRoot = Join-Path $env:USERPROFILE "OneDrive\Masaüstü"
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $desktopRoot ("Pozisyon_Talimatnameleri_{0}" -f (Get-Date -Format "yyyyMMdd_HHmm"))
}
$null = New-Item -Path $OutputDirectory -ItemType Directory -Force

$wdAlignParagraphLeft = 0
$wdAlignParagraphCenter = 1
$wdStory = 6
$wdFormatXMLDocument = 12
$issueDate = Get-Date -Format "dd.MM.yyyy"
$trCulture = [System.Globalization.CultureInfo]::GetCultureInfo("tr-TR")

$commonBoundaryRules = @(
    "Her çalışan yalnızca görev tanımı, unvanı ve tanımlı yetki sınırı içinde işlem yapar.",
    "Açık ve kayıtlı yetki devri bulunmadıkça başka bir çalışanın görev alanına müdahale edilemez.",
    "Başka bir birimin müşteri, finans, operasyon, evrak veya insan kaynağı kayıtlarına yetkisiz erişim sağlanamaz.",
    "Hiyerarşiyi aşarak baskı kurmak, kayıt dışı talimat vermek veya süreci denetlenemez biçimde yürütmek yasaktır.",
    "Görev çakışması halinde nihai karar ilgili yönetici veya yetkilendirilmiş üst yönetici tarafından verilir.",
    "Bu kurallara aykırılıkta tutanak, savunma ve delil değerlendirme süreci işletilir."
)

$commonConfidentialityRules = @(
    "Müşteri, çalışan, tedarikçi, ticari, finansal ve operasyonel veriler gizlidir.",
    "Kişisel veriler yalnızca hukuka, dürüstlük kuralına ve şirket talimatlarına uygun şekilde işlenir.",
    "Evrak, rapor ve dijital dosyalar yetkisiz ortamlarda tutulamaz veya paylaşılamaz.",
    "Veri ihlali, yanlış gönderim veya erişim zafiyeti derhal yöneticiye raporlanır."
)

$commonDisciplineRules = @(
    "Talimatnameye aykırılık halinde fiilin niteliğine göre yazılı uyarı, ihtar, görev değişikliği, zarar rücuu ve iş sözleşmesinin feshi dahil işlemler uygulanabilir.",
    "Şirket verilerinin yetkisiz paylaşılması, sahtecilik, kayıt dışı işlem veya zimmetli varlığın kötüye kullanılması haklı nedenle fesih sebebi oluşturabilir.",
    "Kusurlu davranış nedeniyle doğan zararlar genel hükümler çerçevesinde ilgili çalışandan talep edilebilir."
)

$commonCompetitionRules = @(
    "Şirket müşteri portföyü, fiyatlandırma bilgisi ve ticari ilişki ağı kişisel amaçla kullanılamaz.",
    "Şirket müşterilerine şahsi hat, şahsi hesap veya şirket dışı ticari ilişki önerilemez.",
    "Müşteri listeleri, tedarikçi verileri ve ticari raporlar üçüncü kişilerle paylaşılamaz.",
    "İş ilişkisinin sona ermesi halinde şirketten edinilen ticari ilişki avantajı şirkete rakip olacak şekilde kullanılamaz."
)

function Get-SafeFileName {
    param([string]$Name)
    $invalid = [System.IO.Path]::GetInvalidFileNameChars()
    foreach ($char in $invalid) {
        $Name = $Name.Replace([string]$char, "-")
    }
    return ($Name -replace "\s+", "_").Trim("_")
}

function Set-SelectionFormat {
    param($Selection, [double]$FontSize = 10.5, [bool]$Bold = $false, [int]$Alignment = 0, [double]$SpaceAfter = 6)
    $Selection.Font.Name = "Segoe UI"
    $Selection.Font.Size = $FontSize
    $Selection.Font.Bold = if ($Bold) { 1 } else { 0 }
    $Selection.ParagraphFormat.Alignment = $Alignment
    $Selection.ParagraphFormat.SpaceAfter = $SpaceAfter
    $Selection.ParagraphFormat.LineSpacingRule = 0
}

function Add-Paragraph {
    param($Selection, [string]$Text, [double]$FontSize = 10.5, [bool]$Bold = $false, [int]$Alignment = 0, [double]$SpaceAfter = 6)
    Set-SelectionFormat -Selection $Selection -FontSize $FontSize -Bold $Bold -Alignment $Alignment -SpaceAfter $SpaceAfter
    $Selection.EndKey($wdStory) | Out-Null
    $Selection.TypeText($Text)
    $Selection.TypeParagraph()
}

function Add-Section {
    param($Selection, [string]$Heading, [string[]]$Lines, [string]$Mode = "default")
    Add-Paragraph -Selection $Selection -Text $Heading -FontSize 11.5 -Bold $true -SpaceAfter 4
    $i = 1
    foreach ($line in $Lines) {
        Add-Paragraph -Selection $Selection -Text ("{0}) {1}" -f $i, (Format-ListLine -Text $line -Mode $Mode)) -SpaceAfter 3
        $i++
    }
    Add-Paragraph -Selection $Selection -Text "" -SpaceAfter 3
}

function Format-ListLine {
    param(
        [string]$Text,
        [string]$Mode = "default"
    )

    $value = ($Text -replace "\s+", " ").Trim()
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $value
    }

    $firstChar = $value.Substring(0, 1).ToUpper($trCulture)
    if ($value.Length -gt 1) {
        $value = $firstChar + $value.Substring(1)
    }
    else {
        $value = $firstChar
    }

    if ($Mode -eq "prohibited") {
        if ($value -notmatch "[.!?]$") {
            return "$value yasaktır."
        }
        return $value
    }

    if ($value -notmatch "[.!?]$") {
        $value += "."
    }

    return $value
}

function Get-DocumentTitle {
    param($Role)
    return "{0} - {1} Talimatnamesi" -f $Role.Title, $Role.Subject
}

function Add-MetadataTable {
    param($Document, $Selection, [string[][]]$Rows)
    $Selection.EndKey($wdStory) | Out-Null
    $table = $Document.Tables.Add($Selection.Range, $Rows.Count, 2)
    $table.Borders.Enable = 1
    for ($r = 0; $r -lt $Rows.Count; $r++) {
        $table.Cell($r + 1, 1).Range.Text = $Rows[$r][0]
        $table.Cell($r + 1, 2).Range.Text = $Rows[$r][1]
        $table.Cell($r + 1, 1).Range.Font.Name = "Segoe UI"
        $table.Cell($r + 1, 2).Range.Font.Name = "Segoe UI"
        $table.Cell($r + 1, 1).Range.Font.Size = 9.5
        $table.Cell($r + 1, 2).Range.Font.Size = 9.5
        $table.Cell($r + 1, 1).Range.Bold = 1
    }
    $Selection.EndKey($wdStory) | Out-Null
    $Selection.TypeParagraph()
}

$roles = @(
    [pscustomobject]@{ Title="Genel Müdür"; EmployeeRole="Genel Müdür"; Department="Yönetim"; ReportsTo="Şirket Üst Yönetimi"; DocumentNo="RW-IK-TA-101"; Subject="Stratejik Yönetim, Kurumsal Yönetişim ve İcra Koordinasyonu"; Purpose="Şirketin stratejik yönü, bütçe disiplini ve tüm icra yapısının tek merkezden yönetilmesini sağlamak"; RoleDefinition="Şirketin stratejik yönü, mali dengesi ve tüm icra yapısından sorumlu en üst icra yöneticisidir."; Responsibilities=@("stratejik plan ve bütçe yönetimi","yönetim raporları ve hedef takibi","kritik onay ve temsil kararları","birimler arası önceliklendirme ve risk yönetimi"); Interfaces=@("Genel Müdür Yardımcısı ve Muhasebe Müdüründen düzenli rapor almak","bağlı müdürlükler arası öncelik ve karar yönü belirlemek","kritik müşteri, tedarikçi ve kurum konularında şirketi temsil etmek"); Systems=@("yönetim raporları","bütçe dosyaları","yetki matrisi","kritik sözleşme kayıtları"); Assets=@("kurumsal cihazlar","yönetim raporları","imza ve erişim yetkileri","gizli karar dosyaları"); SpecificProhibited=@("kayıt dışı onay verilmesi","kişisel çıkar doğuracak karar kullanılması","gerçeğe aykırı rapor talep edilmesi"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","6102 sayılı Türk Ticaret Kanunu","6698 sayılı Kişisel Verilerin Korunması Kanunu","şirket ana sözleşmesi ve yetki matrisi") },
    [pscustomobject]@{ Title="Genel Müdür Yardımcısı"; EmployeeRole="Genel Müdür Yardımcısı"; Department="Yönetim"; ReportsTo="Genel Müdür"; DocumentNo="RW-IK-TA-102"; Subject="İcra Koordinasyonu, Süreç Yönetimi ve Operasyonel Takip"; Purpose="Bağlı müdürlüklerin aynı yönetim ritmi içinde çalışmasını ve üst yönetim kararlarının uygulanmasını sağlamak"; RoleDefinition="Bağlı müdürlüklerin günlük icra disiplinini ve üst yönetim kararlarının uygulanmasını yöneten üst düzey koordinasyon rolüdür."; Responsibilities=@("bağlı müdürlüklerin hedef ve çıktı takibi","çapraz birim koordinasyonu","toplantı ve aksiyon yönetimi","uygulama sonuçlarının raporlanması"); Interfaces=@("Satış, Operasyon, Teknik Servis, Satın Alma ve İK yöneticilerinden rapor almak","muhasebe ile finansal etkisi olan kararları koordine etmek","Genel Müdüre şirket icra görünümü sunmak"); Systems=@("aksiyon listeleri","performans raporları","koordinasyon notları","eskalasyon kayıtları"); Assets=@("kurumsal rapor dosyaları","toplantı notları","erişim araçları","yönetsel karar kayıtları"); SpecificProhibited=@("yetki sınırı aşımı","kayıt dışı görev dağılımı değişikliği","aksiyon bilgisinin gizlenmesi"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","6102 sayılı Türk Ticaret Kanunu","6698 sayılı Kişisel Verilerin Korunması Kanunu","şirket iç yönetmelikleri ve yetki matrisi") },
    [pscustomobject]@{ Title="Muhasebe Müdürü"; EmployeeRole="Muhasebe Müdürü"; Department="Mali İşler / Muhasebe"; ReportsTo="Genel Müdür"; DocumentNo="RW-IK-TA-103"; Subject="Mali Kontrol, Kayıt, Raporlama ve Uyum"; Purpose="Mali kayıtların doğruluğu, izlenebilirliği ve mevzuata uygunluğu için yönetim seviyesinde kontrol disiplini kurmak"; RoleDefinition="Şirketin mali kayıt düzeni, vergi ve beyan süreçleri ile finansal raporlama sisteminden sorumlu yönetici roldür."; Responsibilities=@("muhasebe kapanışları ve raporlama","vergi, SGK ve beyan süreçleri","kasa, banka ve cari hesap kontrolleri","mali risk ve uyum takibi"); Interfaces=@("Genel Müdüre finansal sonuç ve risk raporu sunmak","Bölge İdari İşler Destek Personeli ile fonksiyonel koordinasyon yürütmek","ödeme ve tahsilat etkisi olan işlemlerde diğer birimlerle çalışmak"); Systems=@("muhasebe kayıtları","banka-kasa mutabakatları","beyanname veri setleri","finansal rapor dosyaları"); Assets=@("mali mühür ve token","finansal raporlar","kurumsal bilgisayar","mali evrak arşivi"); SpecificProhibited=@("belgesiz mali kayıt açılması","onaysız ödeme veya mahsup işlemi","finansal bilgilerin yetkisiz paylaşılması"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","6102 sayılı Türk Ticaret Kanunu","213 sayılı Vergi Usul Kanunu","3065 sayılı Katma Değer Vergisi Kanunu","5510 sayılı Sosyal Sigortalar ve Genel Sağlık Sigortası Kanunu","6698 sayılı Kişisel Verilerin Korunması Kanunu") },
    [pscustomobject]@{ Title="Satış Müdürü"; EmployeeRole="Satış Müdürü"; Department="Ticari"; ReportsTo="Genel Müdür Yardımcısı"; DocumentNo="RW-IK-TA-104"; Subject="Ticari Performans, Kanal Yönetimi ve Saha Koordinasyonu"; Purpose="Satış hedefleri, kanal öncelikleri ve bölgesel/kurumsal satış işleyişini ortak kurallarla yönetmek"; RoleDefinition="Gelir hedeflerinin gerçekleştirilmesi ve bağlı satış yönetim rollerinin koordinasyonundan sorumlu ticari liderlik rolüdür."; Responsibilities=@("satış hedef planlama ve takip","bölgesel ve kurumsal kanal yönetimi","kampanya ve fiyat disiplini","ticari raporlama ve kapanış görünümü"); Interfaces=@("Genel Müdür Yardımcısına ticari görünüm sunmak","Operasyon, Teknik Servis ve Muhasebe ile koordinasyon yürütmek","bağlı satış yönetim rollerini yönetmek"); Systems=@("CRM ve pipeline kayıtları","hedef raporları","kampanya onay kayıtları","müşteri analiz dosyaları"); Assets=@("müşteri portföy bilgileri","satış rapor setleri","erişim hesapları","kampanya dosyaları"); SpecificProhibited=@("yetki dışı fiyat veya indirim verilmesi","satış verisinin manipüle edilmesi","müşteri portföyünden kişisel menfaat sağlanması"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","6102 sayılı Türk Ticaret Kanunu","6502 sayılı Tüketicinin Korunması Hakkında Kanun","6698 sayılı Kişisel Verilerin Korunması Kanunu","şirket satış ve prim kuralları") },
    [pscustomobject]@{ Title="Operasyon Müdürü"; EmployeeRole="Operasyon Müdürü"; Department="Operasyon"; ReportsTo="Genel Müdür Yardımcısı"; DocumentNo="RW-IK-TA-105"; Subject="Süreç, Hizmet Kalitesi ve Merkez Operasyon Yönetimi"; Purpose="Operasyon omurgasının standardize, ölçülebilir ve sürdürülebilir biçimde yönetilmesini sağlamak"; RoleDefinition="Hizmet sürekliliği, süreç verimliliği ve bağlı operasyon fonksiyonlarının yönetiminden sorumlu ana operasyon lideridir."; Responsibilities=@("CRM, Demobank ve Çağrı Merkezi koordinasyonu","hizmet kalitesi ve süreç iyileştirme","iş yükü ve kayıt kalitesi takibi","operasyonel sapmalarda aksiyon yönetimi"); Interfaces=@("Genel Müdür Yardımcısına hizmet seviyesi raporu sunmak","Satış ile lead ve dönüşüm kalitesi üzerinde çalışmak","muhasebe, teknik servis ve diğer destek birimleriyle koordinasyon kurmak"); Systems=@("CRM ve veri sistemleri","çağrı logları","performans raporları","kalite takip dosyaları"); Assets=@("operasyon raporları","müşteri işlem kayıtları","erişim hesapları","ses kayıt sistemleri"); SpecificProhibited=@("operasyon verisinin gerçeğe aykırı raporlanması","kayıt dışı müşteri yönlendirmesi","bağlı ekip sonuçlarının manipüle edilmesi"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","6502 sayılı Tüketicinin Korunması Hakkında Kanun","6698 sayılı Kişisel Verilerin Korunması Kanunu","6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun","şirket operasyon prosedürleri") },
    [pscustomobject]@{ Title="Teknik Servis Müdürü"; EmployeeRole="Teknik Servis Müdürü"; Department="Teknik Hizmet"; ReportsTo="Genel Müdür Yardımcısı"; DocumentNo="RW-IK-TA-106"; Subject="Saha Hizmet, SLA ve Servis Kalitesi Yönetimi"; Purpose="Saha teknik hizmetlerinin planlı, güvenli ve şirket standartlarına uygun yürütülmesini sağlamak"; RoleDefinition="Teknik servis kalitesi, saha hizmet standartları ve servis planlamasından sorumlu yönetici roldür."; Responsibilities=@("iş emri ve lot planı takibi","servis kalite ve SLA yönetimi","teknik evrak ve kayıt kontrolü","müşteri etkili teknik aksiyonların yönetimi"); Interfaces=@("Genel Müdür Yardımcısına servis performans raporu sunmak","Satın Alma ve Lojistik ile ihtiyaç planlamak","Bölge İdari İşler Destek Personeli ile fonksiyonel koordinasyon yürütmek"); Systems=@("servis portal kayıtları","lot planı dosyaları","SLA raporları","teknik evrak kayıtları"); Assets=@("servis planlama kayıtları","erişim araçları","teknik rapor dosyaları","saha kalite kayıtları"); SpecificProhibited=@("gerçeğe aykırı iş emri kapatma","İSG kurallarının göz ardı edilmesi","müşteriye prosedür dışı teknik taahhüt verilmesi"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","6331 sayılı İş Sağlığı ve Güvenliği Kanunu","6502 sayılı Tüketicinin Korunması Hakkında Kanun","6698 sayılı Kişisel Verilerin Korunması Kanunu","şirket teknik servis prosedürleri") },
    [pscustomobject]@{ Title="Satın Alma ve Lojistik Müdürü"; EmployeeRole="Satın Alma ve Lojistik Müdürü"; Department="Tedarik Zinciri"; ReportsTo="Genel Müdür Yardımcısı"; DocumentNo="RW-IK-TA-107"; Subject="Tedarik, Stok, Sevkiyat ve Filo Koordinasyonu"; Purpose="Tedarik, stok ve lojistik süreçlerinin maliyet, hız ve izlenebilirlik dengesiyle yönetilmesini sağlamak"; RoleDefinition="Tedarik planlama, stok ve sevkiyat akışı ile filo destek faaliyetlerinin yönetiminden sorumlu roldür."; Responsibilities=@("satın alma talep ve sipariş yönetimi","tedarikçi ve teklif kontrolü","stok ve sevkiyat akışı takibi","filo operasyon süreçlerinin yönetsel denetimi"); Interfaces=@("Genel Müdür Yardımcısına tedarik görünümü sunmak","Muhasebe ile mali onay etkili süreçleri koordine etmek","Teknik Servis ve Operasyon ile ihtiyaç planlamak"); Systems=@("sipariş kayıtları","stok ve sevkiyat takip sistemleri","tedarikçi onay dosyaları","filo bakım kayıtları"); Assets=@("tedarikçi veri dosyaları","stok raporları","erişim araçları","filo kayıtları"); SpecificProhibited=@("yetkisiz satın alma onayı","stok ve sevkiyat verisinin yanıltıcı tutulması","tedarik avantajından kişisel menfaat sağlanması"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","6102 sayılı Türk Ticaret Kanunu","2918 sayılı Karayolları Trafik Kanunu","6698 sayılı Kişisel Verilerin Korunması Kanunu","şirket satın alma ve stok prosedürleri") },
    [pscustomobject]@{ Title="İnsan Kaynakları Müdürü"; EmployeeRole="İnsan Kaynakları Müdürü"; Department="İnsan Kaynakları"; ReportsTo="Genel Müdür Yardımcısı"; DocumentNo="RW-IK-TA-108"; Subject="İşe Alım, Organizasyon ve Çalışan Deneyimi"; Purpose="İnsan kaynakları süreçlerinin yasal uyum, kurumsal tutarlılık ve kayıt disiplini ile yürütülmesini sağlamak"; RoleDefinition="İşe alım, organizasyonel yapılanma, çalışan ilişkileri ve performans süreçlerinden sorumlu ana İK rolüdür."; Responsibilities=@("işe alım ve işten çıkış süreçleri","kadro ve organizasyon planlaması","özlük ve personel kayıt yönetimi","çalışan ilişkileri ve performans takibi"); Interfaces=@("Genel Müdür Yardımcısına kadro ve risk görünümü sunmak","Muhasebe ile bordro ve personel hareketlerinde koordinasyon kurmak","bölüm yöneticileri ile işe alım ve performans süreçlerini yürütmek"); Systems=@("özlük dosyaları","aday takip kayıtları","performans verileri","İK süreç dokümanları"); Assets=@("personel verileri","kurumsal bilgisayar","İK arşivi","gizli çalışan raporları"); SpecificProhibited=@("kişisel verilerin yetkisiz paylaşılması","kayıt dışı disiplin veya işe alım süreci yürütülmesi","ayrımcılık veya kayırmacılık yapılması"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","5510 sayılı Sosyal Sigortalar ve Genel Sağlık Sigortası Kanunu","6331 sayılı İş Sağlığı ve Güvenliği Kanunu","6698 sayılı Kişisel Verilerin Korunması Kanunu","şirket İK politika ve disiplin düzenlemeleri") },
    [pscustomobject]@{ Title="Bölge Satış Yönetmenleri"; EmployeeRole="Bölge Satış Yönetmeni"; Department="Ticari"; ReportsTo="Satış Müdürü"; DocumentNo="RW-IK-TA-109"; Subject="Saha Performansı, Bölge Yönetimi ve Müşteri Gelişimi"; Purpose="Bölgesel satış faaliyetlerinin ortak performans ve müşteri yönetim disiplini ile yürütülmesini sağlamak"; RoleDefinition="Sorumlu olduğu bölgede satış hedeflerinin, saha üretkenliğinin ve müşteri gelişiminin yönetiminden sorumlu ticari saha lideridir."; Responsibilities=@("bölgesel satış hedef takibi","ziyaret ve saha planı yönetimi","müşteri ve rekabet geri bildirimi","kampanya ve tahsilat disiplin takibi"); Interfaces=@("Satış Müdürüne bölge performans raporu sunmak","Operasyon ve Teknik Servis ile saha sorunlarında çalışmak","Eğitim Yönetmeni ile gelişim ihtiyacını paylaşmak"); Systems=@("bölge satış kayıtları","müşteri ziyaret raporları","saha dashboard'ları","tahsilat takip notları"); Assets=@("müşteri portföyü","bölge raporları","erişim hesapları","saha planlama dosyaları"); SpecificProhibited=@("müşteri verisinin kişisel portföy gibi kullanılması","yetki dışı fiyat veya tahsilat taahhüdü","hedef ve kapanış verisinin manipüle edilmesi"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","6502 sayılı Tüketicinin Korunması Hakkında Kanun","6698 sayılı Kişisel Verilerin Korunması Kanunu","şirket satış ve saha davranış kuralları") },
    [pscustomobject]@{ Title="Kurumsal Satış Yönetmeni"; EmployeeRole="Kurumsal Satış Yönetmeni"; Department="Ticari"; ReportsTo="Satış Müdürü"; DocumentNo="RW-IK-TA-110"; Subject="Anahtar Hesap, Teklif ve Müşteri Yönetimi"; Purpose="Kurumsal müşterilere yönelik satış faaliyetlerinin yüksek kayıt kalitesi ve temsil standardı ile yürütülmesini sağlamak"; RoleDefinition="Kurumsal müşteri portföyünün geliştirilmesi ve büyük hesap ilişkisinin yönetiminden sorumlu ticari roldür."; Responsibilities=@("kurumsal müşteri portföy yönetimi","teklif ve sözleşme süreci","tahsilat ve uygulama risk takibi","müşteri ilişki raporlaması"); Interfaces=@("Satış Müdürüne kurumsal pipeline sunmak","Muhasebe ile sözleşme ve ödeme etkili dosyalarda çalışmak","Operasyon ve Teknik Servis ile teslim etkisi olan konuları koordine etmek"); Systems=@("kurumsal müşteri kayıtları","teklif ve sözleşme dosyaları","tahsilat raporları","müşteri ilişki notları"); Assets=@("kurumsal müşteri portföyü","teklif dosyaları","erişim hesapları","ticari rapor setleri"); SpecificProhibited=@("yetki dışı fiyat, vade veya teslim taahhüdü","müşteri bilgisinin kayıt dışı paylaşılması","kişisel menfaat için müşteri yönlendirmesi"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","6102 sayılı Türk Ticaret Kanunu","6502 sayılı Tüketicinin Korunması Hakkında Kanun","6698 sayılı Kişisel Verilerin Korunması Kanunu","şirket teklif ve sözleşme kuralları") },
    [pscustomobject]@{ Title="Eğitim Yönetmeni"; EmployeeRole="Eğitim Yönetmeni"; Department="Ticari / Gelişim"; ReportsTo="Satış Müdürü"; DocumentNo="RW-IK-TA-111"; Subject="Yetkinlik Gelişimi, Eğitim Planlama ve Uygulama"; Purpose="Şirketin satış odaklı eğitim ve gelişim süreçlerini planlı, kayıtlı ve ölçülebilir hale getirmek"; RoleDefinition="Satış organizasyonunun yetkinlik gelişimi, eğitim planı ve saha gelişim programlarından sorumlu roldür."; Responsibilities=@("eğitim ihtiyaç analizi","yıllık eğitim planı","saha gelişim programları","ölçme-değerlendirme ve raporlama"); Interfaces=@("Satış Müdürüne eğitim planı ve etki raporu sunmak","bölge ve kurumsal satış yapılarıyla ihtiyaç toplamak","İK ile onboarding ve performans kesişiminde çalışmak"); Systems=@("eğitim planı kayıtları","katılım listeleri","ölçme-değerlendirme sonuçları","eğitim içerik dosyaları"); Assets=@("eğitim içerikleri","gelişim raporları","erişim hesapları","eğitim arşivi"); SpecificProhibited=@("onaysız eğitim içeriği kullanılması","katılım verisinin yanıltıcı raporlanması","eğitim materyalinin yetkisiz paylaşılması"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","6698 sayılı Kişisel Verilerin Korunması Kanunu","6331 sayılı İş Sağlığı ve Güvenliği Kanunu","şirket eğitim ve gelişim politikaları") },
    [pscustomobject]@{ Title="CRM / Data Yönetmeni"; EmployeeRole="CRM / Data Yönetmeni"; Department="Operasyon"; ReportsTo="Operasyon Müdürü"; DocumentNo="RW-IK-TA-112"; Subject="Veri Kalitesi, Raporlama ve Karar Destek"; Purpose="Müşteri ve operasyon verilerinin güvenilir, izlenebilir ve karar almaya elverişli olmasını sağlamak"; RoleDefinition="Müşteri verisi, raporlama disiplini ve analitik görünürlüğün yönetiminden sorumlu operasyon rolüdür."; Responsibilities=@("CRM veri standardı ve kalite yönetimi","dashboard ve raporlama üretimi","mükerrer/eksik kayıt düzeltme aksiyonları","erişim ve veri görünürlüğü takibi"); Interfaces=@("Operasyon Müdürüne veri görünümü raporu sunmak","Satış ve Çağrı süreçleriyle veri alanlarında çalışmak","Demobank ve Çağrı Merkezi kayıt disiplinini desteklemek"); Systems=@("CRM ana verileri","raporlama tabloları","veri kalite kontrol dosyaları","erişim logları"); Assets=@("müşteri veri tabanları","dashboard ve raporlar","erişim araçları","veri kalite çalışma dosyaları"); SpecificProhibited=@("müşteri verisinin yetkisiz indirilmesi","veri sonuçlarının manipüle edilmesi","yetkisiz kullanıcıya erişim açılması"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","6698 sayılı Kişisel Verilerin Korunması Kanunu","6102 sayılı Türk Ticaret Kanunu","şirket CRM ve bilgi güvenliği politikaları") },
    [pscustomobject]@{ Title="Demobank Yönetmeni"; EmployeeRole="Demobank Yönetmeni"; Department="Operasyon"; ReportsTo="Operasyon Müdürü"; DocumentNo="RW-IK-TA-113"; Subject="Lead Yönetimi, Telefon Ön Görüşme ve Saha Aktarım"; Purpose="Demobank yapısında müşteri adaylarının kurumsal ve ölçülebilir biçimde işlenmesini sağlamak"; RoleDefinition="Lead işleme, telefon ön görüşme ve satışa uygun müşteri adayının oluşturulmasından sorumlu yönetsel roldür."; Responsibilities=@("lead havuzu yönetimi","telefon ön görüşme standardı","satışa uygun kayıt aktarımı","dönüşüm ve kalite raporlaması"); Interfaces=@("Operasyon Müdürüne lead kalite raporu sunmak","Satış ile müşteri aktarım kalitesini koordine etmek","CRM / Data ve Çağrı Merkezi ile kayıt çakışmalarını yönetmek"); Systems=@("lead havuzu kayıtları","çağrı logları","müşteri yönlendirme raporları","iletişim izin kayıtları"); Assets=@("müşteri aday veri setleri","çağrı sistemleri","kurumsal cihazlar","rapor dosyaları"); SpecificProhibited=@("izinsiz ticari arama yapılması","müşteri verisinin sistem dışına aktarılması","kayıt dışı lead yönlendirmesi"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","6502 sayılı Tüketicinin Korunması Hakkında Kanun","6698 sayılı Kişisel Verilerin Korunması Kanunu","6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun","Ticari İletişim Yönetmeliği") },
    [pscustomobject]@{ Title="Çağrı Merkezi"; EmployeeRole="Çağrı Merkezi Personeli"; Department="Operasyon"; ReportsTo="Operasyon Müdürü"; DocumentNo="RW-IK-TA-114"; Subject="Müşteri İletişimi, Kayıt Yönetimi ve İlk Temas"; Purpose="Müşteri ile ilk temasın kurumsal, ölçülü ve denetlenebilir esaslarla yürütülmesini sağlamak"; RoleDefinition="Müşteri taleplerinin ilk temas noktası olarak kayıt, yönlendirme ve geri bildirim iletişimini yürüten operasyon rolüdür."; Responsibilities=@("çağrı karşılama ve kayıt açma","talep ve şikayet yönlendirme","geri arama ve çözüm takibi","çağrı kalite ve sonuç kodu disiplini"); Interfaces=@("Operasyon Müdürüne çağrı kalite ve yoğunluk raporu sunmak","Teknik Servis, Satış ve Muhasebe ile talepleri doğru aktarmak","CRM / Data ile kayıt standardı üzerinde çalışmak"); Systems=@("çağrı sistemi","müşteri talep kayıtları","geri arama logları","kalite takip raporları"); Assets=@("kulaklık ve telefon ekipmanı","müşteri iletişim kayıtları","erişim hesapları","çağrı takip dosyaları"); SpecificProhibited=@("müşteriye yanlış veya yetki dışı bilgi verilmesi","çağrı notlarının gerçeğe aykırı girilmesi","müşteri verisinin kişisel cihazda tutulması"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","6502 sayılı Tüketicinin Korunması Hakkında Kanun","6698 sayılı Kişisel Verilerin Korunması Kanunu","6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun","şirket çağrı kalite standartları") },
    [pscustomobject]@{ Title="Filo Operasyon Sorumlusu"; EmployeeRole="Filo Operasyon Sorumlusu"; Department="Destek"; ReportsTo="Satın Alma ve Lojistik Müdürü"; DocumentNo="RW-IK-TA-115"; Subject="Araç Yönetimi, Zimmet ve Kullanım Takibi"; Purpose="Şirket araç filosunun güvenli, kayıtlı ve planlı biçimde kullanılmasını sağlamak"; RoleDefinition="Şirket araç filosunun bakım, zimmet, kullanım ve hasar kayıtlarından sorumlu saha destek rolüdür."; Responsibilities=@("araç atama ve zimmet yönetimi","bakım, sigorta ve muayene takibi","yakıt, kilometre ve kullanım raporları","kaza, hasar ve ceza süreçlerinin takibi"); Interfaces=@("Satın Alma ve Lojistik Müdürüne filo görünümü sunmak","Teknik Servis ve saha kullanan ekiplerle araç planlamak","Muhasebe ile ceza ve bakım faturası süreçlerini koordine etmek"); Systems=@("araç zimmet kayıtları","bakım ve sigorta takip dosyaları","yakıt-kilometre kayıtları","hasar ve ceza takip listeleri"); Assets=@("araç anahtarları ve evrakları","filo takip dosyaları","erişim araçları","araç zimmet kayıtları"); SpecificProhibited=@("araçların kayıt dışı kullandırılması","bakım/hasar bilgilerinin gizlenmesi","araç kullanım verisinden kişisel menfaat sağlanması"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","2918 sayılı Karayolları Trafik Kanunu","6698 sayılı Kişisel Verilerin Korunması Kanunu","şirket araç kullanımı ve zimmet prosedürleri") },
    [pscustomobject]@{ Title="Bölge İdari İşler Destek Personeli"; EmployeeRole="Bölge İdari İşler Destek Personeli"; Department="Destek"; ReportsTo="Teknik Servis Müdürü / Muhasebe Müdürü"; DocumentNo="RW-IK-TA-116"; Subject="Koordinasyon, Evrak ve İdari Destek"; Purpose="İdari ve operasyonel destek süreçlerinin iki ana fonksiyona eş zamanlı ve kayıtlı biçimde verilmesini sağlamak"; RoleDefinition="Teknik Servis ve Muhasebe tarafına matris/fonksiyonel bağlı olarak evrak, takip ve idari destek sağlayan roldür."; Responsibilities=@("evrak ve bilgi akışı takibi","idari destek taleplerinin yönlendirilmesi","teslim-tesellüm ve dosyalama düzeni","şube/bölge destek koordinasyonu"); Interfaces=@("Teknik Servis Müdürü ile servis evrakı ve takip işlerinde çalışmak","Muhasebe Müdürü ile mali evrak ve idari kayıt akışını desteklemek","talep çakışmalarında kayıtlı öncelik ve eskalasyon uygulamak"); Systems=@("evrak takip kayıtları","idari destek notları","teknik ve mali işlem listeleri","şube arşivi"); Assets=@("evrak arşivleri","kurumsal bilgisayar","takip formları","gizli idari belgeler"); SpecificProhibited=@("yetki dışı mali veya teknik karar alınması","evrak ve takip kayıtlarının gerçeğe aykırı tutulması","idari destek rolüyle veri manipülasyonu yapılması"); Laws=@("4857 sayılı İş Kanunu","6098 sayılı Türk Borçlar Kanunu","6102 sayılı Türk Ticaret Kanunu","213 sayılı Vergi Usul Kanunu","6698 sayılı Kişisel Verilerin Korunması Kanunu","şirket idari işler ve evrak prosedürleri") }
)

function Get-Definitions {
    param($Role)
    @(
        "Şirket: $CompanyName",
        "$($Role.EmployeeRole): $($Role.RoleDefinition)",
        "Bağlı Yönetici: $($Role.ReportsTo)",
        "Kayıt ve Sistemler: $([string]::Join(', ', $Role.Systems))",
        "Şirket Varlıkları: $([string]::Join(', ', $Role.Assets))"
    )
}

function Get-Records {
    param($Role)
    @(
        "$([string]::Join(', ', $Role.Systems)) süreçleri güncel, izlenebilir ve doğrulanabilir şekilde tutulur.",
        "Gerçeğe aykırı kayıt, açıklamasız düzeltme veya yetkisiz veri değişikliği yapılamaz.",
        "Kullanıcı adı, parola, token ve benzeri erişim araçları kişiye özeldir.",
        "Yetki sınırını aşan veya kayıtla desteklenemeyen taleplerde işlem durdurulur ve yöneticiye bildirim yapılır."
    )
}

function Get-Assets {
    param($Role)
    @(
        "$([string]::Join(', ', $Role.Assets)) görevin gereği olarak zimmetle teslim edilebilir ve yalnızca iş amaçlı kullanılır.",
        "Teslim, devir ve iade işlemleri imzalı kayıt ve kontrol esasına göre yürütülür.",
        "Zimmetli varlığın kaybı, hasarı, amacı dışında kullanımı veya yetkisiz devri halinde derhal bildirim yapılır.",
        "Kusur tespiti halinde doğan zararlar mevzuat ve şirket prosedürleri çerçevesinde ilgili personele rücu edilebilir."
    )
}

function Get-Prohibited {
    param($Role)
    $items = @()
    $items += $Role.SpecificProhibited
    $items += "Şirket verilerinin, müşteri bilgilerinin veya ticari sırların yetkisiz paylaşılması."
    $items += "Sahtecilik yapılması; belge üzerinde tahrifat, imza taklidi veya gerçeğe aykırı kayıt oluşturulması."
    $items += "Müşteriye, çalışma arkadaşına veya üçüncü kişilere yönelik fiziki müdahale, tehdit, hakaret, baskı veya taciz niteliğinde davranışta bulunulması."
    $items
}

function Write-RoleDocument {
    param($Word, $Role, [string]$TargetPath)

    $document = $null
    try {
        $document = $Word.Documents.Add()
        $document.PageSetup.TopMargin = $Word.CentimetersToPoints(2.2)
        $document.PageSetup.BottomMargin = $Word.CentimetersToPoints(2.0)
        $document.PageSetup.LeftMargin = $Word.CentimetersToPoints(2.0)
        $document.PageSetup.RightMargin = $Word.CentimetersToPoints(2.0)

        $selection = $Word.Selection
        Add-Paragraph -Selection $selection -Text $CompanyName -FontSize 13 -Bold $true -Alignment $wdAlignParagraphCenter -SpaceAfter 2
        Add-Paragraph -Selection $selection -Text (Get-DocumentTitle -Role $Role) -FontSize 12.5 -Bold $true -Alignment $wdAlignParagraphCenter -SpaceAfter 2
        Add-Paragraph -Selection $selection -Text "(TEBLİĞ-TEBELLÜĞ BELGESİDİR)" -FontSize 10.5 -Bold $true -Alignment $wdAlignParagraphCenter -SpaceAfter 10

        $rows = @(
            @("Doküman No", $Role.DocumentNo),
            @("Yayın Tarihi", $issueDate),
            @("Yürürlük Tarihi", $issueDate),
            @("Revizyon No", "00"),
            @("Revizyon Tarihi", "-"),
            @("Sayfa No", "1/...")
        )
        Add-MetadataTable -Document $document -Selection $selection -Rows $rows

        Add-Section -Selection $selection -Heading "Madde 1 - Amaç" -Lines @($Role.Purpose, "Görev, yetki ve sorumluluk sınırlarını açık, ölçülebilir ve denetlenebilir hale getirmek", "Hiyerarşi dışı talimat, görev alanı dışına müdahale ve kayıt dışı işlem riskini önlemek")
        Add-Section -Selection $selection -Heading "Madde 2 - Kapsam" -Lines @("$($Role.EmployeeRole) pozisyonunu, bağlı bulunduğu $($Role.Department) fonksiyonunu ve ilgili iş akışlarını kapsar", "Pozisyonun ilişkili olduğu sistem, evrak, rapor, dijital kayıt ve şirket varlıklarını kapsar", "Pozisyonun temas ettiği ilgili yönetici ve destek birimleriyle yürütülen koordinasyon süreçlerini kapsar")
        Add-Section -Selection $selection -Heading "Madde 3 - Hukuki Dayanak" -Lines $Role.Laws
        Add-Section -Selection $selection -Heading "Madde 4 - Tanımlar" -Lines (Get-Definitions -Role $Role)
        Add-Section -Selection $selection -Heading "Madde 5 - Görev Tanımı ve Temel Sorumluluklar" -Lines $Role.Responsibilities
        Add-Section -Selection $selection -Heading "Madde 6 - Raporlama, Koordinasyon ve Onay Akışı" -Lines $Role.Interfaces
        Add-Section -Selection $selection -Heading "Madde 7 - Sistem, Belge ve Kayıt Disiplini" -Lines (Get-Records -Role $Role)
        Add-Section -Selection $selection -Heading "Madde 8 - Zimmet, Ekipman ve Şirket Varlıkları" -Lines (Get-Assets -Role $Role)
        Add-Section -Selection $selection -Heading "Madde 9 - Gizlilik, KVKK ve Bilgi Güvenliği" -Lines $commonConfidentialityRules
        Add-Section -Selection $selection -Heading "Madde 10 - Görev Sınırları, Yetki Disiplini ve İşe Müdahale Yasağı" -Lines $commonBoundaryRules
        Add-Section -Selection $selection -Heading "Madde 11 - Yasaklı Fiiller" -Lines (Get-Prohibited -Role $Role) -Mode "prohibited"
        Add-Section -Selection $selection -Heading "Madde 12 - Disiplin ve Hukuki Sonuçlar" -Lines $commonDisciplineRules
        Add-Section -Selection $selection -Heading "Ek Madde 13 - Şirket Bilgileri, Müşteri Portföyü ve Rekabet Yasağı" -Lines $commonCompetitionRules

        Add-Paragraph -Selection $selection -Text "TEBLİĞ - TEBELLÜĞ ŞERHİ" -FontSize 11.5 -Bold $true -SpaceAfter 4
        Add-Paragraph -Selection $selection -Text ("İşbu ""{0}"" tarafıma okunmuş, açıklanmış ve bir nüshası teslim edilmiştir. Talimatname hükümlerini okuduğumu, anladığımı, kabul ettiğimi ve tüm kurallara uygun hareket edeceğimi beyan ederim." -f (Get-DocumentTitle -Role $Role)) -SpaceAfter 8
        Add-Paragraph -Selection $selection -Text "Çalışanın;" -Bold $true -SpaceAfter 3
        Add-Paragraph -Selection $selection -Text "Adı Soyadı : ______________________________" -SpaceAfter 2
        Add-Paragraph -Selection $selection -Text "T.C. Kimlik No : ______________________________" -SpaceAfter 2
        Add-Paragraph -Selection $selection -Text ("Görevi : {0}" -f $Role.EmployeeRole) -SpaceAfter 2
        Add-Paragraph -Selection $selection -Text ("Birim : {0}" -f $Role.Department) -SpaceAfter 2
        Add-Paragraph -Selection $selection -Text "Tarih : ____ / ____ / ______" -SpaceAfter 2
        Add-Paragraph -Selection $selection -Text "İmza : ______________________________" -SpaceAfter 8
        Add-Paragraph -Selection $selection -Text "Tebliğ Eden Yetkilinin;" -Bold $true -SpaceAfter 3
        Add-Paragraph -Selection $selection -Text "Adı Soyadı : ______________________________" -SpaceAfter 2
        Add-Paragraph -Selection $selection -Text "Unvanı : ______________________________" -SpaceAfter 2
        Add-Paragraph -Selection $selection -Text "Tarih : ____ / ____ / ______" -SpaceAfter 2
        Add-Paragraph -Selection $selection -Text "İmza : ______________________________" -SpaceAfter 8
        Add-Paragraph -Selection $selection -Text "İmzadan İmtina Halinde Tutanak Notu:" -Bold $true -SpaceAfter 3
        Add-Paragraph -Selection $selection -Text "Yukarıdaki talimatname ilgili çalışana tebliğ edilmiş; ancak çalışan imzadan imtina etmiştir." -SpaceAfter 2
        Add-Paragraph -Selection $selection -Text "Tarih/Saat: ____ / ____ / ______ - ____ : ____" -SpaceAfter 2
        Add-Paragraph -Selection $selection -Text "Tutanağı Düzenleyen Yetkili: ______________________________" -SpaceAfter 2
        Add-Paragraph -Selection $selection -Text "İmza: ______________________________" -SpaceAfter 2

        $document.SaveAs([ref]$TargetPath, [ref]$wdFormatXMLDocument)
    }
    finally {
        if ($document) {
            $document.Close()
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($document)
        }
    }
}

$word = $null
$generatedFiles = New-Object System.Collections.Generic.List[string]

try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0

    foreach ($role in $roles) {
        $fileName = Get-SafeFileName -Name ("{0}_Talimatname_Teblig_Tebellug.docx" -f $role.Title)
        $targetPath = Join-Path $OutputDirectory $fileName
        Write-RoleDocument -Word $word -Role $role -TargetPath $targetPath
        [void]$generatedFiles.Add($targetPath)
    }
}
finally {
    if ($word) {
        $word.Quit()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

$indexPath = Join-Path $OutputDirectory "Talimatname_Dizini.txt"
$indexContent = @(
    "Pozisyon Talimatname Seti",
    "Üretim Tarihi: $issueDate",
    "Çıkış Klasörü: $OutputDirectory",
    ""
)
$indexContent += ($generatedFiles | ForEach-Object { "- " + (Split-Path $_ -Leaf) })
Set-Content -Path $indexPath -Value $indexContent -Encoding UTF8

Write-Output ("Talimatname seti oluşturuldu: {0}" -f $OutputDirectory)
Write-Output ("Üretilen dosya sayısı: {0}" -f $generatedFiles.Count)

