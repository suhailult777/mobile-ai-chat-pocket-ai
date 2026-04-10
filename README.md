# 📱 PocketClaw: Mobile AI Chat & ZeroClaw Integration

<div align="center">
  <img src="https://img.shields.io/badge/Expo-SDK%2054-000000?logo=expo&logoColor=white" alt="Expo SDK" />
  <img src="https://img.shields.io/badge/React%20Native-0.81-61dafb?logo=react&logoColor=black" alt="React Native" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Platform-Android%20First-3ddc84?logo=android&logoColor=white" alt="Platform" />
  <img src="https://img.shields.io/badge/LLM-GLM--5-blue?logo=nvidia&logoColor=white" alt="GLM-5" />
</div>

<br />

PocketClaw is an advanced mobile chat application designed for seamless localized AI workflows. It features a robust dual-execution path (NVIDIA Proxy Mode & Native On-Device Mode) and integrates directly with the **ZeroClaw Gateway** to securely execute local shell commands directly from your mobile device.

This repository is optimized for **low-latency streaming UX**, **resilient model fallback**, and **production-oriented error handling**.

---

## 📑 Table of Contents

- [✨ What's New (Latest Fixes & Features)](#-whats-new-latest-fixes--features)
- [🏗 Architecture](#-architecture)
- [🚀 Quick Start & Local Setup](#-quick-start--local-setup)
- [⚙️ Configuration](#-configuration)
- [🛠 Scripts](#-scripts)
- [🤖 Agent Mode & ZeroClaw Execution](#-agent-mode--zeroclaw-execution)
- [🐞 Troubleshooting & Known Issues](#-troubleshooting--known-issues)
- [🛡 Security and Privacy](#-security-and-privacy)

---

## ✨ What's New (Latest Fixes & Features)

We've recently overhauled the networking and execution pipeline to support heavier models and remote execution:

- **NVIDIA GLM-5 Integration (z-ai/glm5)**: Switched the primary intelligence engine to GLM-5 for state-of-the-art tool calling and parsing.
- **Fixed SSE Network Timeouts (OkHttp)**: Resolved a critical bug where the native Android OkHttp client would drop connections during long tool executions (>10s).
  - *Fix Details*: Disabled Nagle's algorithm (setNoDelay(true)) and implemented high-volume whitespace padded heartbeat emitting. This forces the TCP buffer to flush via Bun's server bridge, keeping the mobile client alive perfectly during heavy GLM-5 shell executions.
- **Trailing Space Model Patches**: Fixed an issue causing 404 errors from NVIDIA NIM APIs by trimming trailing spaces from requested model strings.
- **End-to-End ZeroClaw Execution**: The mobile app can now accurately read terminal locations, execute PowerShell, and read local desktop files through the ZeroClaw gateway. 

---

## 🏗 Architecture

PocketClaw maintains a clean separation between the mobile UI and the inference backend:

1. **Mobile UI (Expo/React Native)**: Captures prompts and renders streaming markdown, thinking indicators, and haptics via FlashList.
2. **Node.js/Bun Proxy (server/index.js)**: Bridges HTTP to the NVIDIA API and the local ZeroClaw agent. Handles model fallbacks, SSE connections, and parses LLM tool calls.
3. **ZeroClaw Gateway**: A secure local binary that catches commands from the proxy and executes them on the host OS.
4. **NVIDIA NIM (z-ai/glm5)**: The LLM brain responsible for generation and reasoning.

---

## 🚀 Quick Start & Local Setup

To test the entire end-to-end remote execution and AI chatting flow locally, you'll need to start three core services:

### Prerequisites
- **Bun 1.1+** (Fast JavaScript runtime)
- **Expo CLI** (
pm i -g expo-cli)
- **NVIDIA API Key** (for NIM integration)
- **ZeroClaw Binary** (Installed locally)

---

### Step 1: Start the ZeroClaw Gateway

The gateway safely executes terminal commands triggered by the AI.

1. Open a new terminal.
2. Run the gateway startup script:
   `powershell
   cd D:\pocket-claw\mobile-ai-chat-pocket-ai
   .\server\zeroclaw-gateway.ps1
   `
3. Open another terminal to generate a fresh pairing code to link the proxy:
   `powershell
   zeroclaw gateway get-paircode --new
   `
   *(Keep this 6-digit code handy to enter into the mobile app's Settings).*

---

### Step 2: Start the Bun Proxy Server

The proxy handles the heavy lifting of routing UI requests to NVIDIA and enforcing timeouts.

1. Open a new terminal.
2. Install dependencies:
   `powershell
   cd D:\pocket-claw\mobile-ai-chat-pocket-ai\server
   bun install
   `
3. Set your environment variables:
   `powershell
   copy .env.example .env
   # Edit .env and add your NVIDIA_API_KEY
   `
4. Start the proxy server:
   `powershell
   bun run index.js
   `
   *The proxy runs on http://0.0.0.0:8787.*

---

### Step 3: Launch the Expo Mobile App

1. Open a new terminal from the project root.
2. Install app dependencies:
   `powershell
   cd D:\pocket-claw\mobile-ai-chat-pocket-ai
   bun install
   `
3. Start the Expo bundler:
   `powershell
   bun run start -- --go --host lan --port 8081 --offline
   `
4. Open the **Expo Go** app on your physical device or emulator and scan the generated QR code.

---

### Step 4: Connect the App to the Server

Once the app opens on your device:
1. Go to the **Settings** tab.
2. Under "Mode", select **NVIDIA Proxy**.
3. Under "Proxy Host", enter your PC's local IP address (e.g., 192.168.x.x). Keep the port as 8787.
4. Enter the z-ai/glm5 model.
5. Toggle **ZeroClaw Enabled** and enter the pairing code from Step 1.
6. Test the connection! Ask the AI: *"Run this on my computer via zeroclaw_webhook and return output only: Get-Location"*

---

## ⚙️ Configuration

### Important App Settings (SecureStore)

| Key                     | Default                          | Notes                              |
| ----------------------- | -------------------------------- | ---------------------------------- |
| host                  | 127.0.0.1                      | Proxy host for 
vidia-proxy mode |
| model                 | z-ai/glm5                      | Active LLM Model ID                |
| zeroClawEnabled       | alse                          | Enables ZeroClaw webhook tools     |
| zeroClawGatewayUrl    | http://127.0.0.1:3000          | Local ZeroClaw gateway address     |

---

## 🛠 Scripts

| Command                 | Description                             |
| ----------------------- | --------------------------------------- |
| un run start         | Start Expo dev server                   |
| un run proxy:install | Install proxy dependencies in server/ |
| un run proxy:start   | Start NVIDIA proxy server               |
| un run test          | Run test suites                         |
| un run android:apk   | Build preview APK via EAS               |

---

## 🤖 Agent Mode & ZeroClaw Execution

When **Agent Mode** is enabled, the proxy injects system prompts and parses out <tool_calls>.

If the AI decides to execute a shell command, the proxy pauses the main LLM stream, triggers the local ZeroClaw Gateway binary via child_process, and streams massive whitespaces (setNoDelay(true)) back to the mobile client as a heartbeat. Once the host PC resolves the executed command, the proxy packages the stdout/stderr and feeds it back to the GLM-5 model for a finalized conversational response.

---

## 🐞 Troubleshooting & Known Issues

- **Network Timeout (Network Error reaching http://...)**: If you experience this during long tool calls, ensure you are running the latest server/index.js which includes the setNoDelay TCP padding fixes.
- **Model 404 Errors**: Ensure your model string in the app Settings does not have a trailing space (e.g., z-ai/glm5 ). The latest proxy trims this automatically.
- **Expo Go LAN Issues**: If Expo Go cannot connect, verify your Windows Defender Firewall allows traffic on ports 8081 (Expo) and 8787 (Proxy).

---

## 🛡 Security and Privacy

- **On-Device Keys**: ZeroClaw pairing tokens are safely stored inside the device's secure enclave (expo-secure-store).
- **No Key Leaks**: The NVIDIA API key lives exclusively in the local Node.js proxy .env file and is never transmitted to the client.
- **Local Network Only**: ZeroClaw binds to localhost and your proxy, meaning external internet traffic cannot trigger your host shell.
