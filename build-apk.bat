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

echo [2/2] Compiling Signed Release APK with Gradle...
cd android
call gradlew.bat assembleRelease
cd ..

if exist "android\app\build\outputs\apk\release\app-release.apk" (
    copy /y "android\app\build\outputs\apk\release\app-release.apk" "NoteScan.apk" >nul
    echo.
    echo ====================================================
    echo   BUILD SUCCESSFUL!
    echo   Your signed Release APK is ready at:
    echo   NoteScan.apk
    echo ====================================================
) else (
    echo.
    echo Build encountered an error. Check logs above.
)

pause
