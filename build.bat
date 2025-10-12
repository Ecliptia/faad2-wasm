@echo off
REM Windows Build Script for FAAD2 WASM
REM This script provides an alternative to Make for Windows users

setlocal enabledelayedexpansion

if "%1"=="" goto help
if "%1"=="help" goto help
if "%1"=="setup-submodules" goto setup-submodules
if "%1"=="setup-emsdk" goto setup-emsdk
if "%1"=="setup" goto setup
if "%1"=="ensure-headers" goto ensure-headers
if "%1"=="patch-libfaad" goto patch-libfaad
if "%1"=="build" goto build
if "%1"=="build-node" goto build-node
if "%1"=="clean" goto clean

echo Unknown target: %1
goto help

:help
echo FAAD2 WASM Build System - Windows
echo.
echo Usage: build.bat [target]
echo.
echo Available targets:
echo   setup-submodules  - Initialize git submodules
echo   setup-emsdk      - Install and activate Emscripten SDK
echo   setup            - Run both setup targets
echo   ensure-headers   - Copy header files
echo   patch-libfaad    - Apply patches to libfaad
echo   build            - Build WASM module for web
echo   build-node       - Build WASM module for Node.js
echo   clean            - Remove built files
echo   help             - Show this help message
goto :eof

:setup-submodules
echo Setting up Git submodules...
git submodule init
git submodule update
git submodule status
echo Submodules setup complete.
goto :eof

:setup-emsdk
echo Setting up Emscripten SDK...
cd emsdk
call emsdk.bat install 4.0.11
call emsdk.bat activate 4.0.11
cd ..
echo Emscripten SDK setup complete.
goto :eof

:setup
call :setup-submodules
call :setup-emsdk
goto :eof

:ensure-headers
echo Ensuring headers are in place...
if not exist faad2\include\faad.h (
    copy faad2\include\faad.h.in faad2\include\faad.h
    echo Header copied.
) else (
    echo Header already exists.
)
goto :eof

:patch-libfaad
echo Applying patch to libfaad...
patch -p0 --forward --quiet < patch\libfaad.diff
if errorlevel 1 (
    echo Patch failed or already applied.
) else (
    echo Patch applied successfully.
)
goto :eof

:clean
echo Cleaning build files...
if exist pkg\faad2_wasm.mjs del pkg\faad2_wasm.mjs
if exist pkg\faad2_wasm.wasm del pkg\faad2_wasm.wasm
echo Clean complete.
goto :eof

:build
echo Building FAAD2 WASM for web...
cd emsdk
call emsdk_env.bat
cd ..\faad2
emcc ^
  ..\src\faad2_wasm.c ^
  libfaad/bits.c libfaad/cfft.c libfaad/common.c libfaad/decoder.c libfaad/drc.c ^
  libfaad/drm_dec.c libfaad/error.c libfaad/filtbank.c libfaad/hcr.c libfaad/huffman.c ^
  libfaad/ic_predict.c libfaad/is.c libfaad/lt_predict.c libfaad/mdct.c libfaad/mp4.c ^
  libfaad/ms.c libfaad/output.c libfaad/pns.c libfaad/ps_dec.c libfaad/ps_syntax.c ^
  libfaad/pulse.c libfaad/rvlc.c libfaad/sbr_dct.c libfaad/sbr_dec.c libfaad/sbr_e_nf.c ^
  libfaad/sbr_fbt.c libfaad/sbr_hfadj.c libfaad/sbr_hfgen.c libfaad/sbr_huff.c libfaad/sbr_qmf.c ^
  libfaad/sbr_syntax.c libfaad/sbr_tf_grid.c libfaad/specrec.c libfaad/syntax.c libfaad/tns.c ^
  -I. -Ilibfaad -Iinclude ^
  -O3 ^
  -DPACKAGE_VERSION=\"2.11.2\" ^
  -s STACK_SIZE=262144 ^
  -s EXPORTED_FUNCTIONS="[\"_get_faad_capabilities\",\"_init_decoder\",\"_decode_frame\",\"_malloc\",\"_free\"]" ^
  -s EXPORTED_RUNTIME_METHODS="[\"ccall\",\"cwrap\",\"getValue\",\"setValue\",\"writeArrayToMemory\",\"HEAPU8\"]" ^
  -s MODULARIZE=1 ^
  -s EXPORT_NAME="Faad2Module" ^
  -s ALLOW_MEMORY_GROWTH=1 ^
  -s ENVIRONMENT="web" ^
  -o ..\pkg\faad2_wasm.mjs
cd ..
if exist pkg\faad2_wasm.mjs (
    echo Build complete! Output in pkg/
) else (
    echo Build failed!
    exit /b 1
)
goto :eof

:build-node
echo Building FAAD2 WASM for Node.js...
cd emsdk
call emsdk_env.bat
cd ..\faad2
emcc ^
  ..\src\faad2_wasm.c ^
  libfaad/bits.c libfaad/cfft.c libfaad/common.c libfaad/decoder.c libfaad/drc.c ^
  libfaad/drm_dec.c libfaad/error.c libfaad/filtbank.c libfaad/hcr.c libfaad/huffman.c ^
  libfaad/ic_predict.c libfaad/is.c libfaad/lt_predict.c libfaad/mdct.c libfaad/mp4.c ^
  libfaad/ms.c libfaad/output.c libfaad/pns.c libfaad/ps_dec.c libfaad/ps_syntax.c ^
  libfaad/pulse.c libfaad/rvlc.c libfaad/sbr_dct.c libfaad/sbr_dec.c libfaad/sbr_e_nf.c ^
  libfaad/sbr_fbt.c libfaad/sbr_hfadj.c libfaad/sbr_hfgen.c libfaad/sbr_huff.c libfaad/sbr_qmf.c ^
  libfaad/sbr_syntax.c libfaad/sbr_tf_grid.c libfaad/specrec.c libfaad/syntax.c libfaad/tns.c ^
  -I. -Ilibfaad -Iinclude ^
  -O3 ^
  -DPACKAGE_VERSION=\"2.11.2\" ^
  -s STACK_SIZE=262144 ^
  -s EXPORTED_FUNCTIONS="[\"_get_faad_capabilities\",\"_init_decoder\",\"_decode_frame\",\"_malloc\",\"_free\"]" ^
  -s EXPORTED_RUNTIME_METHODS="[\"ccall\",\"cwrap\",\"getValue\",\"setValue\",\"writeArrayToMemory\",\"HEAPU8\"]" ^
  -s MODULARIZE=1 ^
  -s EXPORT_NAME="Faad2Module" ^
  -s ALLOW_MEMORY_GROWTH=1 ^
  -s ENVIRONMENT="node,web" ^
  -o ..\pkg\faad2_wasm.mjs
cd ..
if exist pkg\faad2_wasm.mjs (
    echo Build complete! Output in pkg/
) else (
    echo Build failed!
    exit /b 1
)
goto :eof
