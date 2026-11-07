# Q50 Native Telemetry — Phase 6A

**An original, read-only legacy Android 2.3/API-10 instrument application** designed
for App Garage-compatible V37 Infiniti Q50/Q60 head units.
Not affiliated with Nissan/Infiniti. NOT an ECU controller or a mechanical diagnostic tool.

> **STATUS (owner-reported, November 7, 2026):** The Android application was built,
> packaged as an EPK, installed, and reported working on a **2017 Infiniti Q50 Red Sport 400**.
> This is an owner-reported in-car integration milestone, not independent verification
> of individual sensor mappings, calibration, update frequency or compatibility with other cars.

## Features

- Native Canvas gauge display at a fixed 800x480 design grid; letterboxes cleanly.
- Vehicle sensor subscription using `SensorManager`, provisional IDs 13,17,14,15,23,22.
- Stale/invalid readings show `--` rather than fake data.
- Tap anywhere for a raw sensor audit; hold 800 ms to enable/disable **labeled** demo.
- RPM peak and event counts (in memory); no external storage or network permissions.
- On Android pause/resume: unsubscribe/resubscribe without duplicate listeners.
- No CAN writes, OBD operations, hidden services, network communication, or ECU commands.
- Manifest intentionally does not mark itself as safe to operate while driving.

## Windows requirements

- **JDK 17 recommended**, with `javac` and `keytool` on PATH. Newer JDKs can trigger a D8 crash with this legacy build toolchain.
- Android SDK `platforms;android-34` and `build-tools;34.0.0`. Use Android Studio SDK Manager.
- Windows PowerShell (VS Code integrated terminal is fine).
- Python 3 and `cryptography` (`.venv` at repository root is auto-detected by build.ps1).

## Build

From project root (`q50-digital-twin`):

```powershell
.\.venv\Scripts\python.exe -m pip install -r native-app\requirements-build.txt
javac -version
Test-Path "$env:LOCALAPPDATA\Android\Sdk\build-tools\34.0.0\aapt.exe"
Test-Path "$env:LOCALAPPDATA\Android\Sdk\platforms\android-34\android.jar"
.\native-app\build.ps1
```

Use a **new private password** when prompted for the APK-signing key; save the
password in your own password manager. The signing key is generated at
`native-app/signing/q50-dev.jks` and ignored by Git.

Expected outputs:

- `native-app/build/q50-native.apk`
- `native-app/build/q50-native.epk`

The APK is built as pure Java for minSdkVersion 10; a v1-compatible APK
signature is requested. EPK v2 packaging uses a public OBU cert from upstream.

### Minimal tests before any car test

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s native-app\tests -p "test_*.py" -v
javac --release 8 -d native-app\build\classes native-app\src\com\aram\q50telemetry\SensorState.java native-app\tests\SensorStateTest.java
java -cp native-app\build\classes SensorStateTest
```

### Parked-only installation trial (optional; at owner's risk)

1. Confirm your head unit is the original App Garage-capable InTouch version.
   The working third-party `.epk` suggests compatibility, but is not proof.
2. Make sure the dashboard apps you depend on still work, and record their versions.
   Never uninstall a working existing app merely to test this one.
3. Copy only `q50-native.epk` to the root of a **spare, empty FAT32 USB**.
   FAT32 formatting deletes data, so do not format a stick that contains files.
4. Park outdoors in a safe place, shift into **P**, apply parking brake,
   maintain stable vehicle power and keep the vehicle stationary. Follow the
   vehicle owner's manual and avoid any apps while driving.
5. From the stock infotainment screen, open App Garage -> Install Apps via USB.
   Choose **Q50 Native Telemetry** (not an "Install All" option), confirm.
6. Don't remove the USB until installation is complete. If rejected, stop:
   do NOT bypass app restrictions, flash firmware or change ECU settings.
7. Launch while parked. If there is no data, tap to AUDIT to see what sensors
   arrived. Compare reported RPM at idle, coolant (when available), and the
   stationary speed of 0 with the factory displays or a trusted diagnostic tool.
8. Do NOT drive to test it. Exporting logs and other dynamic validation require
   a separately reviewed stationary or bench procedure.

## What the result means

- **No app in USB list:** investigate APK/EPK format, version code and matching
  certificate before any further install attempt.
- **App installs, says no sensors:** Android layer or permissions differ.
  The app never substitutes fake values unless demo was explicitly selected.
- **Sensor present, reading looks wrong:** raw mapping is not calibrated for
  your firmware. Treat it as incorrect until cross-checked.
- **App closes unexpectedly:** remove the candidate via App Garage where possible,
  preserve error messages; avoid modifying system firmware.

## Engineering concepts

`SensorManager` callbacks, Android activity lifecycle, API 10 compatibility,
monotonic clocks, bounded redraw rates, stale-data detection, proof by test,
binary EPK packaging, separate APK signing and EPK encryption.

## Credits

- App Garage research, vendor permission, IVI metadata and vehicle-sensor type
  hypotheses are based on MIT-licensed community research:
  https://github.com/bugjosh/appgarage-dash
  https://github.com/czpeanut/q50-app
- The native UI and Java app in this project are newly written, not repackaged
  binaries of other developers' applications.
- The bundled public certificate is documented in `keys/README.md`.

## Next milestone (after independently validating live readings)

Add validated signal maps, a timestamped recording/export strategy, improved
rendering benchmarks, and a bridge to the existing FastAPI/PostgreSQL Digital Twin.
