import { ConfigPlugin } from "@expo/config-plugins";

// Placeholder config plugin for Phase 3 Option B (llama.cpp integration).
// Purpose: keep a stable hook where we can add Android/iOS native config later
// (permissions, abiFilters, packagingOptions, proguard rules, etc.). For now,
// this is a no-op to avoid surprising build changes.

const withOllamaNative: ConfigPlugin = (config) => {
  // Future: add android.manifest permissions or Gradle settings if needed.
  return config;
};

export default withOllamaNative;
