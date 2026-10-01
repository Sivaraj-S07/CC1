# Compiler / runtime setup (Python · Java · C · C++)

Each programming question stores its language (`language`, plus optional `allowed_languages`).
When a student presses **Run** or **Submit**, the backend picks the toolchain from that language:

| Quiz language | Toolchain used        |
| ------------- | --------------------- |
| Python        | Python 3 (`python3`)  |
| Java          | JDK (`javac` + `java`)|
| C             | GCC (`gcc`)           |
| C++           | G++ (`g++`)           |

A language the question does not allow is never executed; the run falls back to the question's own language.

## 1. Install the runtimes once (never on demand)

**Ubuntu / Debian**
```bash
sudo apt-get update
sudo apt-get install -y python3 build-essential default-jdk
```
**Windows (your setup)**
1. Python 3 from python.org — tick *Add python.exe to PATH* (do NOT use the Microsoft Store alias).
2. MinGW-w64 / MSYS2 (provides `gcc` and `g++`), e.g. `winget install BrechtSanders.WinLibs.POSIX.UCRT`.
3. A **JDK** (not just a JRE), e.g. `winget install EclipseAdoptium.Temurin.21.JDK`, then open a new terminal.

macOS: `brew install python gcc openjdk`.

Or let the project do it: `cd backend && npm run setup:compilers -- --install`

If a tool is installed but not on PATH, pin it in `backend/.env`:
`PYTHON_BIN`, `GCC_BIN`, `GPP_BIN`, `JAVAC_BIN`, `JAVA_BIN` (or `JAVA_HOME`).

## 2. Verify
```bash
cd backend
npm install
npm run check:runtimes     # all four must show ✓
npm run test:judge         # 38 tests: stdin/stdout, compile errors, runtime errors, timeouts, per-language Run/Submit
npm test                   # existing clone / PDF tests
```

## 3. Run
```bash
cd backend  && npm start        # http://localhost:5000
cd frontend && npm install && npm run dev
```
`backend/.env` keeps `CODE_EXEC_PROVIDER=auto` (local toolchain first, then optional remote/Wandbox fallback).
