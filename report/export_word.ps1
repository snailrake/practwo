param([Parameter(Mandatory=$true)][string]$DocxPath,[Parameter(Mandatory=$true)][string]$PdfPath)
$ErrorActionPreference='Stop'
$taskWord=$null;$taskDoc=$null
try {
    $taskWord=New-Object -ComObject Word.Application
    $taskWord.Visible=$false;$taskWord.DisplayAlerts=0
    $taskDoc=$taskWord.Documents.Open($DocxPath,$false,$false)
    $taskDoc.Repaginate()
    $taskDoc.Fields.Update() | Out-Null
    foreach($taskToc in $taskDoc.TablesOfContents) {
        $taskToc.Update()
        $taskToc.Range.Font.Name='Times New Roman'
        $taskToc.Range.Font.Size=12
        $taskToc.Range.ParagraphFormat.LineSpacingRule=0
        $taskToc.Range.ParagraphFormat.SpaceBefore=0
        $taskToc.Range.ParagraphFormat.SpaceAfter=0
        $taskToc.Range.ParagraphFormat.FirstLineIndent=0
    }
    $taskDoc.Repaginate()
    foreach($taskToc in $taskDoc.TablesOfContents) { $taskToc.UpdatePageNumbers() }
    $taskDoc.Save()
    $taskDoc.ExportAsFixedFormat($PdfPath,17)
    Write-Output ('TOC: '+$taskDoc.TablesOfContents.Count)
} finally {
    if($null -ne $taskDoc){$taskDoc.Close(0)}
    if($null -ne $taskWord){$taskWord.Quit()}
    if($null -ne $taskDoc){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskDoc)}
    if($null -ne $taskWord){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskWord)}
}
