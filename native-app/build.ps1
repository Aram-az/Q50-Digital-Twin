# Build a legacy API 10 Android APK and wrap as EPK v2 on Windows PowerShell.
# Requires Android SDK build-tools 34.0.0, android-34, JDK 17+, Python cryptography.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Get-Command javac -ErrorAction SilentlyContinue)) { throw 'JDK not found: install JDK 17+, then restart terminal.' }
$python = Join-Path $root '..\.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { $python = 'python' }
if ($python -eq 'python' -and -not (Get-Command python -ErrorAction SilentlyContinue)) { throw 'Python missing.' }
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$bt = Join-Path $sdk 'build-tools\34.0.0'
$jar = Join-Path $sdk 'platforms\android-34\android.jar'
$aapt = Join-Path $bt 'aapt.exe'
$d8 = Join-Path $bt 'd8.bat'
$zipalign = Join-Path $bt 'zipalign.exe'
$apksigner = Join-Path $bt 'apksigner.bat'
foreach ($path in @($jar,$aapt,$d8,$zipalign,$apksigner)) {
    if (-not (Test-Path $path)) { throw "Missing Android SDK tool: $path`nInstall Android SDK Platform 34 and Build-Tools 34.0.0." }
}
if (-not (Test-Path 'keys\obu_cert.pem')) { throw 'Missing matching PUBLIC device certificate.' }

New-Item -ItemType Directory -Force build\classes,build\dex,signing | Out-Null
Remove-Item -Recurse -Force build\classes, build\dex
New-Item -ItemType Directory -Force build\classes,build\dex | Out-Null

Write-Host '[1/7] Compiling Android Java sources...'
$sources = @(Get-ChildItem -Recurse -Filter '*.java' src | ForEach-Object FullName)
& javac --release 8 -g -classpath $jar -d build\classes @sources
if ($LASTEXITCODE -ne 0) { throw 'javac compilation failed.' }

Write-Host '[2/7] Converting Java bytecode to Dalvik DEX...'
$classes = @(Get-ChildItem -Recurse -Filter '*.class' build\classes | ForEach-Object FullName)
& $d8 --min-api 10 --lib $jar --output build\dex @classes
if ($LASTEXITCODE -ne 0) { throw 'd8 failed.' }

Write-Host '[3/7] Packaging APK...'
$versionCode = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
$manifest = (Get-Content AndroidManifest.xml -Raw) -replace 'android:versionCode="[0-9]+"', ('android:versionCode="'+$versionCode+'"')
[System.IO.File]::WriteAllText((Join-Path $root 'build\AndroidManifest.xml'), $manifest)
& $aapt package -f -M build\AndroidManifest.xml -S res -I $jar -F build\q50-unsigned.apk
if ($LASTEXITCODE -ne 0) { throw 'aapt package failed.' }
Push-Location build\dex
try {
    & $aapt add ..\q50-unsigned.apk classes.dex | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'aapt add classes.dex failed.' }
} finally { Pop-Location }

Write-Host '[4/7] Aligning APK...'
& $zipalign -f -p 4 build\q50-unsigned.apk build\q50-aligned.apk
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed.' }

Write-Host '[5/7] Signing APK with YOUR local developer keystore...'
$pass = $env:Q50_SIGNING_PASSWORD
if (-not $pass) { $pass = Read-Host 'Developer signing password (keep it for future updates)' }
if ($pass.Length -lt 6) { throw 'Please choose a signing password of at least 6 characters.' }
if (-not (Test-Path 'signing\q50-dev.jks')) {
    & keytool -genkeypair -noprompt -keystore signing\q50-dev.jks -alias q50native -keyalg RSA -keysize 2048 -validity 10000 -storepass $pass -keypass $pass -dname 'CN=Q50 Native Telemetry'
    if ($LASTEXITCODE -ne 0) { throw 'Keystore generation failed.' }
}
& $apksigner sign --ks signing\q50-dev.jks --ks-key-alias q50native --ks-pass ("pass:"+$pass) --key-pass ("pass:"+$pass) --min-sdk-version 10 --v1-signing-enabled true --v2-signing-enabled true --out build\q50-native.apk build\q50-aligned.apk
if ($LASTEXITCODE -ne 0) { throw 'APK signing failed. Check the keystore password.' }
& $apksigner verify --min-sdk-version 10 --verbose build\q50-native.apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }

Write-Host '[6/7] Wrapping signed APK as EPK v2...'
& $python -m pip show cryptography > $null
if ($LASTEXITCODE -ne 0) { throw 'Install cryptography: python -m pip install cryptography' }
& $python tools\build_epk.py --apk build\q50-native.apk --cert keys\obu_cert.pem --out build\q50-native.epk
if ($LASTEXITCODE -ne 0) { throw 'EPK packaging failed.' }

Write-Host '[7/7] Validating manifest metadata...'
& $aapt dump badging build\q50-native.apk | Select-String 'package:|sdkVersion|targetSdkVersion|launchable-activity'
Write-Host ''
Write-Host 'DONE: native-app\build\q50-native.apk and native-app\build\q50-native.epk'
Write-Host 'Only test in your owned vehicle while safely parked; compatibility is unverified.'
