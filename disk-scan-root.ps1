function Get-FolderSizeBytes {
    param([Parameter(Mandatory)][string]$Path)
    [long]$total = 0
    $stack = New-Object 'System.Collections.Generic.Stack[string]'
    $stack.Push($Path)
    while($stack.Count -gt 0){
        $current = $stack.Pop()
        try {
            foreach($entry in [System.IO.Directory]::EnumerateFileSystemEntries($current)){
                try {
                    $attr = [System.IO.File]::GetAttributes($entry)
                    if(($attr -band [System.IO.FileAttributes]::Directory) -ne 0){
                        if(($attr -band [System.IO.FileAttributes]::ReparsePoint) -eq 0){
                            $stack.Push($entry)
                        }
                    } else {
                        $total += ([System.IO.FileInfo]::new($entry)).Length
                    }
                } catch { }
            }
        } catch { }
    }
    return $total
}

$results = Get-ChildItem -LiteralPath C:\ -Directory -Force -ErrorAction SilentlyContinue |
    ForEach-Object {
        $bytes = Get-FolderSizeBytes -Path $_.FullName
        [pscustomobject]@{
            Name = $_.Name
            Path = $_.FullName
            GB = [math]::Round($bytes / 1GB, 2)
        }
    } |
    Sort-Object GB -Descending |
    Select-Object -First 10

$results | ForEach-Object { '{0}`t{1}`t{2:N2}' -f $_.Name, $_.Path, $_.GB }
