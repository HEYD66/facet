$ErrorActionPreference = 'Stop'
$testSdk = 'D:\Android\Sdk'
$testJdk = 'D:\Android-studio\jbr'
$testOutput = Join-Path $PSScriptRoot '..\build\input-helper'
New-Item -ItemType Directory -Force -Path (Join-Path $testOutput 'classes') | Out-Null
$testLibraries = @("$testSdk\platforms\android-29\android.jar","$testSdk\platforms\android-29\uiautomator.jar","$testSdk\platforms\android-29\optional\android.test.base.jar")
& "$testJdk\bin\javac.exe" -source 8 -target 8 -cp ($testLibraries -join ';') -d "$testOutput\classes" "$PSScriptRoot\FacetInputTest.java"
if ($LASTEXITCODE -ne 0) { throw 'Input helper compilation failed' }
& "$testJdk\bin\jar.exe" cf "$testOutput\input.jar" -C "$testOutput\classes" .
$previousJava = $env:JAVA_HOME
try {
    $env:JAVA_HOME = $testJdk
    & "$testSdk\build-tools\35.0.0\d8.bat" --min-api 28 --lib $testLibraries[0] --lib $testLibraries[1] --lib $testLibraries[2] --output "$testOutput\facet-input.jar" "$testOutput\input.jar"
    if ($LASTEXITCODE -ne 0) { throw 'Input helper dex conversion failed' }
} finally { $env:JAVA_HOME = $previousJava }
