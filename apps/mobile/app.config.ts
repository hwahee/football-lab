/**
 * Dynamic Expo app config — ONE switch (APP_ENV) selects the build profile.
 *
 *   APP_ENV=development  (default)  → "Football Lab (Dev)",  com.example.mobileboilerplate.dev
 *   APP_ENV=staging                 → "Football Lab (Stg)",  com.example.mobileboilerplate.stg
 *   APP_ENV=production              → "Football Lab",        com.example.mobileboilerplate
 *
 * Distinct bundle ids / package names let all three environments install
 * side-by-side on one device. EAS build profiles set APP_ENV (see eas.json).
 *
 * SECRETS: none. The app bundle is a PUBLIC artifact — everything in `extra`
 * ships to every user's device. Anything requiring a secret is done by the
 * server on the app's behalf.
 *
 * runtimeVersion policy: `appVersion` — every store release (version bump)
 * is its own OTA compatibility group. OTA updates only ever reach binaries
 * built from the SAME app version; native changes require a store release by
 * construction. See docs/release-playbook.md before changing this.
 */
// Expo compiles THIS file with sucrase but loads what it imports with plain
// Node `require`, which cannot resolve `.ts` files — so the TypeScript config
// plugin below failed with "Cannot find module './plugins/withVoiceAssistants'".
// Registering sucrase's require hook (the same compiler, same version Expo
// uses) first makes the plugin importable. Must stay the first import.
import 'sucrase/register/ts';

import type { ConfigContext, ExpoConfig } from 'expo/config';
import splashScreen from 'expo-splash-screen/plugin';

import { withVoiceAssistants } from './plugins/withVoiceAssistants';

type AppEnv = 'development' | 'staging' | 'production';

/**
 * Verified deep-link host — Universal Links (iOS), App Links (Android) AND the
 * Google Assistant App Action capabilities all resolve against this one origin,
 * so it lives in a single constant.
 */
const LINK_HOST = 'app.example.com';

// process.env has an `any`-typed index signature; narrow it once here.
const processEnv = process.env as Record<string, string | undefined>;

const APP_ENV: AppEnv = (['development', 'staging', 'production'] as const).includes(
  processEnv.APP_ENV as AppEnv,
)
  ? (processEnv.APP_ENV as AppEnv)
  : 'development';

interface Profile {
  name: string;
  scheme: string;
  bundleIdSuffix: string;
  /**
   * Default API base URL per environment. `null` in development means
   * "derive from the platform at runtime" (iOS simulator: localhost,
   * Android emulator: 10.0.2.2 — see src/config/env.ts). Override anywhere
   * with EXPO_PUBLIC_API_URL (e.g. a LAN IP for physical devices).
   */
  apiBaseUrl: string | null;
}

const PROFILES: Record<AppEnv, Profile> = {
  development: {
    name: 'Football Lab (Dev)',
    scheme: 'mobileboilerplate-dev',
    bundleIdSuffix: '.dev',
    apiBaseUrl: null,
  },
  staging: {
    name: 'Football Lab (Stg)',
    scheme: 'mobileboilerplate-stg',
    bundleIdSuffix: '.stg',
    apiBaseUrl: 'https://api-staging.example.com',
  },
  production: {
    name: 'Football Lab',
    scheme: 'mobileboilerplate',
    bundleIdSuffix: '',
    apiBaseUrl: 'https://api.example.com',
  },
};

const profile = PROFILES[APP_ENV];
const bundleId = `com.example.mobileboilerplate${profile.bundleIdSuffix}`;
const apiBaseUrl = processEnv.EXPO_PUBLIC_API_URL ?? profile.apiBaseUrl;

const baseConfig = ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: profile.name,
  slug: 'mobile-boilerplate',
  // Single source of truth for the app version (semver). Sent to the API as
  // X-App-Version and compared against the server's version policy.
  version: '1.0.0',
  runtimeVersion: { policy: 'appVersion' },
  orientation: 'portrait',
  // Deep links: custom scheme (all envs) + Universal/App Links (see below).
  scheme: profile.scheme,
  userInterfaceStyle: 'automatic',
  platforms: ['ios', 'android'], // phones only — no web target (see README support matrix)
  plugins: [
    // Native splash: a flat brand color — the JS boot screen (src/boot)
    // takes over immediately, so this stays minimal on purpose. SDK 58 moved
    // the splash from the top-level `splash` field into this plugin.
    splashScreen({ backgroundColor: '#4F46E5', resizeMode: 'contain' }),
  ],
  updates: {
    // OTA update endpoint. EAS Update by default; the app-side consumption
    // is abstracted behind src/version/updates.ts, so a self-hosted expo-updates
    // server only needs this URL swapped.
    url: processEnv.EAS_UPDATE_URL ?? 'https://u.expo.dev/00000000-0000-0000-0000-000000000000',
    fallbackToCacheTimeout: 0, // never block launch waiting for an update
  },
  ios: {
    bundleIdentifier: bundleId,
    buildNumber: '1', // managed per release by EAS (`autoIncrement`), not by hand
    supportsTablet: false, // phones only (support matrix)
    // Universal Links: requires the AASA file on this domain.
    associatedDomains: [`applinks:${LINK_HOST}`],
  },
  android: {
    package: bundleId,
    versionCode: 1, // managed per release by EAS (`autoIncrement`), not by hand
    // App Links: requires assetlinks.json on this domain.
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: LINK_HOST, pathPrefix: '/' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  extra: {
    appEnv: APP_ENV,
    // Omitted (not null) when unset: since SDK 58 the manifest turns a null
    // `extra` value into `{}`, which the app would take for a URL.
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    eas: processEnv.EAS_PROJECT_ID ? { projectId: processEnv.EAS_PROJECT_ID } : undefined,
  },
});

/**
 * Config plugins are applied as FUNCTIONS rather than through the `plugins`
 * array: `ExpoConfig['plugins']` is typed for string module references only,
 * so an array entry would need a cast. Composing them here keeps the wiring
 * fully type-checked, and the order is explicit.
 *
 * withVoiceAssistants — Siri App Intents + Google Assistant App Actions. The
 * intents themselves are generated from src/shared/voice/catalog.ts
 * (`bun run voice:generate`); the plugin only wires the generated files into
 * the native projects at prebuild.
 */
export default (context: ConfigContext): ExpoConfig =>
  withVoiceAssistants(baseConfig(context), {
    linkOrigin: `https://${LINK_HOST}`,
    scheme: profile.scheme,
    // Public, like everything else in the bundle. The voice TOKEN is NOT here —
    // it lives in the keychain access group below.
    apiBaseUrl: apiBaseUrl ?? '',
    // Must also be registered on the App ID in the Apple developer portal.
    keychainAccessGroup: `$(AppIdentifierPrefix)${bundleId}.voice`,
    // Locales with a generated AppShortcuts.<locale>.strings — keep in sync
    // with SUPPORTED_LOCALES in @shared/i18n (minus the default locale).
    localizedPhrases: ['ko'],
  });
