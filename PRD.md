Product Requirements Document: Ollama Mobile — Offline Local LLM Chat

1. Executive Summary
   Ollama Mobile is a cross-platform React Native application built with an Expo-managed development workflow, designed to enable users to chat with Ollama local language models (LLMs) offline. The app prioritizes Android for initial release, with iOS support planned later.

The app runs seamlessly within Expo tooling, allowing rapid prototyping with Expo Go for JavaScript-only features and supporting custom development clients/EAS builds for native code integrations.

It supports two primary operational modes:

On-device Ollama daemon
: The phone hosts the Ollama runtime and language models directly, subject to device capabilities.

Local-hosted Ollama
: Ollama runs on a local machine within the same LAN and the phone communicates to it—offering a fallback for less powerful phones.

The user interface offers chat functionality with streaming responses, model selection, basic parameter tuning, model downloads and management, and privacy controls.

2. Goals & Success Metrics
   Goals
   Deliver a fully functional offline chat experience leveraging locally hosted Ollama models.
   Simplify development and testing via the Expo workflow, ensuring a smooth path from JavaScript prototyping to native integration.
   Provide secure, private local-only usage of models with comprehensive management capabilities.
   Success Metrics
   MVP:
   Chat with streaming responses working on Android devices connected to Ollama running locally or over LAN.

Performance:
90% of prompts under 50 tokens return first streamed output within 5 seconds on capable devices.

Usability:
Users can select/switch models, view local storage usage, and remove models easily.

Security & Privacy:
All model data and logs remain local by default, with no external exposure.

3. Personas
   ML Enthusiast / Developer:
   Interested in running and testing models on mobile devices, with the ability to tune prompts.

Privacy-conscious User:
Prefers fully local inference without any cloud involvement.

QA / Tester:
Requires fast, iterative testing using Expo on-device tools.

4. Use Cases
   Chatting with an on-device Ollama model without internet access.
   Managing model files stored locally on device.
   Tuning model parameters such as temperature, max tokens, and toggling streaming responses.
   Exporting and importing model configurations and conversation logs.
   Developer mode to connect to a remote local Ollama server via LAN for running larger models.
5. High
   -Level Product Requirements

5.1 Functional Requirements (FR)
FR1:
Connect to an Ollama HTTP API endpoint, configurable by host and port, defaulting to http://127.0.0.1:11434.

FR2:
Provide a chat interface supporting streaming responses by parsing Ollama’s line-delimited JSON output and appending tokens as they arrive.

FR3:
Implement model management UI to list available models (via GET /api/models or equivalent), allow model download/installation, and enable deletion of model files.

FR4:
Settings UI to configure endpoint host/port, toggle offline mode, show memory and usage warnings, and adjust parameters like temperature, top_p, and max_tokens.

FR5:
Storage dashboard displaying model sizes, available device disk space, and alert users if a model exceeds free space.

FR6:
Developer mode with advanced logs, local file picker for manual model file pushing, and option to connect to LAN-hosted Ollama servers.

FR7:
Ensure the app runs smoothly in Expo Go for JS-only features (connecting to remote PC-hosted Ollama). Document and support the path for creating dev clients or EAS builds to enable native modules.

5.2 Non-Functional Requirements (NFR)
NFR1:
Offline-first functionality when Ollama daemon is present on the device.

NFR2:
Secure storage with encrypted data at rest (opt-in), and default local-only storage of conversations.

NFR3:
Responsive UI streaming with real-time progress and estimated tokens remaining.

NFR4:
Cross-platform codebase focusing on Android-first due to hardware model hosting constraints.

NFR5:
Modular architecture to switch easily between remote HTTP API access and native bindings to local Ollama runtime.

6. Architecture & Implementation Strategy
   Recommended Incremental Approach (Option A)
   Phase 1 — Prototype (Expo Go, JS-only)
   Utilize fetch streaming to communicate with a remote Ollama server on LAN or local Ollama exposing the API on 127.0.0.1:11434. This phase requires no native code and supports rapid iteration through Expo Go.

Phase 2 — Device-native Integration (Dev Client / EAS)
For embedding Ollama runtime or optimized native bindings (e.g., llama.cpp/ggml), develop custom Expo dev clients or EAS builds to include native modules. This enables on-device native performance beyond JS-only capabilities.

Phase 3 — On-device Ollama Runtime (Advanced)
Package or build an ARM-compatible Ollama binary for Android that serves its API locally. This phase demands specific native code and is suited for powerful devices. Community resources can assist with this complex setup.

Alternative Option (Option B)
Keep Ollama running solely on a local laptop and connect the mobile app via LAN. This is faster to ship but requires the laptop to be on for offline functionality.

7. Data Flow & API Endpoints
   Chat requests: POST prompts to /api/chat or /run endpoints, consuming streaming NDJSON tokens to update the chat UI in real time.
   Model metadata: GET requests retrieve available model lists and details.
   Model uploads: If supported, use multipart uploads to the daemon or manually place model files on device storage via developer tools.
8. UI / UX Design (MVP Screens)
   Welcome & Connect:
   Mode selection including auto-detect local Ollama, connect to LAN host, or installation guide.

Chat Screen:
Displays messages with input box, streaming indicator, send/stop controls, and quick model selector.

Model Browser:
Lists models with size, description, and install/remove options.

Settings:
Configure endpoint, developer mode toggles, storage cleanup, and privacy options.

Developer Tools:
Advanced logs, raw streaming data views, and manual host connection entries.

9. Technical Stack & Libraries
   Framework:
   React Native with Expo-managed workflow and TypeScript.

UI:
React Native Paper or Tailwind-like styling plus custom components.

Networking:
Use fetch streaming or eventsource-like parsers to handle line-delimited NDJSON.

Storage:
expo-file-system for managing model files; expo-secure-store for sensitive data.

Native Integration:
Utilize Expo config plugins and EAS builds to incorporate native code when needed.

10. Constraints & Trade
    -offs

Expo Go Limitations:
Fast JS development but no support for custom native modules; on-device runtime integration requires dev clients/EAS builds.

Device Resource Constraints:
Most phones cannot run large LLMs (13B+). On-device success is limited to small or optimized models (approx. ≤3B). Expect constraints in RAM, storage, and battery life.

Model Tuning:
Full on-device fine-tuning is impractical; only basic parameter tuning and prompt adjustments are viable, with lightweight adapters (e.g., LoRA) as a stretch goal.

11. Security, Privacy & Compliance
    All communications default to remain local (127.0.0.1 or LAN). Any telemetry requires clear user consent.
    Encrypt stored model files and conversation logs or provide user choice for deletion.
    Offer explicit options to export/import conversations through local files only.
12. Testing & Quality Assurance
    Unit Tests: Validate streaming response parsing, model list retrieval, and settings persistence.
    Integration Tests: Verify Expo Go JS-only interactions with desktop Ollama servers; use dev clients for native runtime tests.
    Performance Testing: Measure latency on a range of devices from low-end to high-end across multiple model sizes.
    Beta Testing: Engage internal users with capable hardware; track issues like model download failures and storage limits.
13. Milestones & Roadmap
    Weeks 0–2:
    Requirements, specification, and proof of concept with Expo Go talking to remote Ollama (chat + streaming).

Weeks 3–5:
Build model management UI, storage dashboard, and auto-detection of Ollama hosts.

Weeks 6–8:
Develop dev client build flow and research native module integration.

Weeks 9–12:
Prototype on-device Ollama runtime (advanced, device and ARM build permitting).

Weeks 12–16:
Final polishing, security hardening, beta testing, and documentation.

14. Risks & Mitigations
    Risk:
    Device hardware may be insufficient to run models.
    Mitigation: Provide fallback mode connecting to LAN-hosted Ollama; clearly inform users about hardware requirements.

Risk:
Limitations of Expo Go for native integration.
Mitigation: Early decision-making to balance JS-only or native builds with clear documentation and user guidance.

Risk:
Issues with model licensing and size.
Mitigation: Only allow user-downloaded models with visible license info; recommend small, compatible models.

15. Implementation Notes & Developer Checklist
    Begin with a minimal Expo project featuring chat and settings screens.
    Implement streaming JSON parsing by streaming fetch calls to http://&lt;host&gt;:11434, reading line-delimited JSON to append tokens dynamically to chat UI.
    Use community open-source RN client examples for guidance on streaming and model management.
    Ensure Ollama endpoint accessibility over LAN or localhost during Expo Go testing.
    If embedding runtime, develop an Expo config plugin and build custom dev clients with EAS.
    Add verbose logging and raw streaming views for debugging model outputs.
16. Documentation & Support
    Provide a “Getting Started” guide covering running Ollama on desktop, network connection setup, enabling on-device Ollama, system requirements, and recommended models.
    Include a developer README detailing steps to create dev clients, add native modules, and build on Android via EAS.
    Maintain an appendix with key references including Ollama’s official repo, community mobile clients, Android LLM guides, and Expo documentation.
