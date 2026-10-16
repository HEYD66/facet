param(
    [string]$SdkPath = 'D:\Android\Sdk',
    [string]$JavaPath = 'D:\Android-studio\jbr',
    [string]$Platform = 'android-29',
    [string]$BuildTools = '35.0.0'
)
$ErrorActionPreference = 'Stop'
$testSdk = $SdkPath
$testJdk = $JavaPath
$testOutput = Join-Path $PSScriptRoot '..\build\input-helper'
New-Item -ItemType Directory -Force -Path (Join-Path $testOutput 'classes') | Out-Null
$testLibraries = @("$testSdk\platforms\$Platform\android.jar","$testSdk\platforms\$Platform\uiautomator.jar","$testSdk\platforms\$Platform\optional\android.test.base.jar")
foreach ($library in $testLibraries) { if (!(Test-Path -LiteralPath $library)) { throw "Missing helper SDK library: $library" } }
& "$testJdk\bin\javac.exe" -source 8 -target 8 -cp ($testLibraries -join ';') -d "$testOutput\classes" "$PSScriptRoot\FacetInputTest.java"
if ($LASTEXITCODE -ne 0) { throw 'Input helper compilation failed' }
& "$testJdk\bin\jar.exe" cf "$testOutput\input.jar" -C "$testOutput\classes" .
$previousJava = $env:JAVA_HOME
try {
    $env:JAVA_HOME = $testJdk
    & "$testSdk\build-tools\$BuildTools\d8.bat" --min-api 28 --lib $testLibraries[0] --lib $testLibraries[1] --lib $testLibraries[2] --output "$testOutput\facet-input.jar" "$testOutput\input.jar"
    if ($LASTEXITCODE -ne 0) { throw 'Input helper dex conversion failed' }
} finally { $env:JAVA_HOME = $previousJava }
