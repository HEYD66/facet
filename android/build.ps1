param(
    [string]$SdkPath = 'D:\Android\Sdk',
    [string]$JavaPath = 'D:\Android-studio\jbr',
    [string]$GradleCache = 'D:\Android\GradleCache',
    [string]$GradleExecutable
)
$ErrorActionPreference = 'Stop'
if (!$GradleExecutable) {
    $GradleExecutable = Get-ChildItem (Join-Path $GradleCache 'wrapper\dists') -Recurse -Filter gradle.bat | Select-Object -First 1 -ExpandProperty FullName
}
if (!(Test-Path -LiteralPath $GradleExecutable)) { throw 'Provide an existing Gradle executable with -GradleExecutable.' }
$names = 'JAVA_HOME','ANDROID_HOME','ANDROID_USER_HOME','ANDROID_SDK_HOME','GRADLE_USER_HOME'
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
try {
    $env:JAVA_HOME = $JavaPath
    $env:ANDROID_HOME = $SdkPath
    $env:ANDROID_USER_HOME = Join-Path (Split-Path $SdkPath -Parent) 'UserHome'
    $env:ANDROID_SDK_HOME = $null
    $env:GRADLE_USER_HOME = $GradleCache
    & $GradleExecutable -p $PSScriptRoot assembleDebug --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) { throw "Android build failed: $LASTEXITCODE" }
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name,$previous[$name],'Process') }
}
