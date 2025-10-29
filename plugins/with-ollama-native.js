// Placeholder config plugin for Phase 3 Option B (llama.cpp integration).
// This no-op plugin exists to keep a stable hook for future native config tweaks.

/**
 * @param {import('@expo/config-types').ExpoConfig} config
 * @returns {import('@expo/config-types').ExpoConfig}
 */
function withOllamaNative(config) {
  // Future: add android.manifest permissions or Gradle settings if needed.
  return config;
}

module.exports = withOllamaNative;
