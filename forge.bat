@echo off
setlocal
  set MYDIR=%~dp0.
  set CLAUDE_CONFIG_DIR=%MYDIR%\..\.claude_personal
  set HOME=%CLAUDE_CONFIG_DIR%
  set CLAUDE_CODE_GIT_BASH_PATH=C:\Program Files\Git\bin\bash.exe
  call "%MYDIR%\..\..\InitEnvironment.bat"
  node "%MYDIR%\forge.js" %*
endlocal
