# Exact Windows 11 installation and build workflow

Do not run anything in your car until the complete desktop build has succeeded.

1. Open `q50-digital-twin` in VS Code, choose a **PowerShell** terminal.
2. Extract the supplied Phase 6 update ZIP **at the repository root**. The ZIP
   contains a `native-app/` folder. It does NOT overwrite your React frontend.
3. Install a JDK 17+ (Temurin is suitable). Restart VS Code; verify:
   `java -version`, `javac -version`, `keytool -help`.
4. Install Android Studio from the official site if you don't have it. In
   Settings -> Languages & Frameworks -> Android SDK, install:
   - Android SDK Platform 34 (Android 14)
   - Android SDK Build-Tools **34.0.0** (enable Show Package Details)
   - Android SDK Command-line Tools (optional for this script).
5. Confirm the SDK tools exist:

```powershell
Test-Path "$env:LOCALAPPDATA\Android\Sdk\build-tools\34.0.0\aapt.exe"
Test-Path "$env:LOCALAPPDATA\Android\Sdk\platforms\android-34\android.jar"
```

Both must be True. If Android Studio uses another SDK directory, set
`$env:ANDROID_HOME = 'C:\path\to\sdk'` for the terminal session.

6. Install EPK packaging dependency in your existing venv:

```powershell
.\.venv\Scripts\python.exe -m pip install -r native-app\requirements-build.txt
```

7. Run the tests:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s native-app\tests -p "test_*.py" -v
New-Item -ItemType Directory -Force native-app\build\classes | Out-Null
javac --release 8 -d native-app\build\classes native-app\src\com\aram\q50telemetry\SensorState.java native-app\tests\SensorStateTest.java
java -cp native-app\build\classes SensorStateTest
```

8. Build signed APK and encrypted EPK:

```powershell
.\native-app\build.ps1
```

Enter a NEW developer signing password when prompted. SAVE IT privately.
If Windows blocks PowerShell script execution, use a temporary current-process
setting (don't change global policy):

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\native-app\build.ps1
```

9. Verify both output files exist:

```powershell
Test-Path native-app\build\q50-native.apk
Test-Path native-app\build\q50-native.epk
Get-FileHash native-app\build\q50-native.epk -Algorithm SHA256
```

10. Test only on the owner's parked Q50 with the original App Garage head unit;
    follow `native-app/README.md` for the optional USB installation trial.

## Troubleshooting

- `javac is not recognized`: JDK not installed or VS Code reopened before PATH refresh.
- `android.jar missing`: SDK Platform 34 not installed, or SDK directory differs.
- `aapt.exe missing`: SDK Build-Tools 34.0.0 not installed.
- `cryptography missing`: install into the root `.venv` using step 6.
- `APK signature failed`: wrong developer-keystore password. **Do not delete
  `signing/q50-dev.jks` without backing it up**, or updates will require uninstall.
- `EPK does not appear`: incompatible device certificate/version or application
  metadata are possible. Do NOT attempt firmware modifications or bypass checks.

Note: the included app is an original implementation informed by community
reverse engineering. No car test has yet demonstrated that it works on the
particular owner's 2017 Q50 or that the vehicle uses the same sensor map.
