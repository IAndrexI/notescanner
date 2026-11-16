@echo off
title Build NoteScan Android APK
cd /d "%~dp0"
echo ====================================================
echo   Building NoteScan Android APK
echo ====================================================
echo.

if exist "C:\Program Files\Java\jdk-21.0.11" (
    set "JAVA_HOME=C:\Program Files\Java\jdk-21.0.11"
) else if exist "C:\Program Files\Java\jdk-17" (
    set "JAVA_HOME=C:\Program Files\Java\jdk-17"
)

echo [1/2] Syncing web assets into native Android project...
call npx cap sync android

echo [2/2] Compiling Debug APK with Gradle...
cd android
call gradlew.bat assembleDebug

if exist "app\build\outputs\apk\debug\app-debug.apk" (
    echo.
    echo ====================================================
    echo   BUILD SUCCESSFUL!
    echo   Your APK is ready at:
    echo   android\app\build\outputs\apk\debug\app-debug.apk
    echo ====================================================
) else (
    echo.
    echo Build encountered an error. Check logs above.
)

pause
