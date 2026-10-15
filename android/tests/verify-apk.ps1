param([string]$ApkPath = (Join-Path $PSScriptRoot '..\app\build\outputs\apk\debug\app-debug.apk'))
$ErrorActionPreference = 'Stop'
$metadata = Get-Content (Join-Path $PSScriptRoot '..\core-artifact.json') -Raw | ConvertFrom-Json
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ApkPath))
try {
    $checks = @{
        'lib/arm64-v8a/libfacet_mihomo.so' = $metadata.binarySHA256
        'assets/mihomo/source.tgz' = $metadata.sourceSHA256
        'assets/mihomo/LICENSE' = (Get-FileHash (Join-Path $PSScriptRoot '..\..\resources\mihomo\LICENSE')).Hash
        'assets/mihomo/ARTIFACT.json' = (Get-FileHash (Join-Path $PSScriptRoot '..\core-artifact.json')).Hash
    }
    foreach ($item in $checks.GetEnumerator()) {
        $entry = $archive.GetEntry($item.Key)
        if (!$entry) { throw "Missing APK entry: $($item.Key)" }
        $stream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $actual = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') }
        finally { $stream.Dispose(); $sha.Dispose() }
        if ($actual -ne $item.Value) { throw "APK artifact hash mismatch: $($item.Key)" }
        Write-Output "Verified APK entry: $($item.Key)"
    }
} finally { $archive.Dispose() }
Get-FileHash -LiteralPath $ApkPath -Algorithm SHA256
