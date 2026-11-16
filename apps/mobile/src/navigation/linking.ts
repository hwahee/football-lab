/**
 * Deep linking — three entry paths map onto the same route table:
 *
 *   1. Custom scheme     mobileboilerplate[-dev|-stg]://todos
 *      (scheme per env — see app.config.ts — so all three installs coexist)
 *   2. iOS Universal Links   https://app.example.com/todos
 *      (requires apple-app-site-association on the domain +
 *       `associatedDomains` in app.config.ts)
 *   3. Android App Links     https://app.example.com/todos
 *      (requires assetlinks.json on the domain + the `intentFilters`
 *       in app.config.ts)
 *
 * Notification taps: send `{"url": "https://app.example.com/todos"}` in the
 * push payload — expo-linking hands it to React Navigation via this config,
 * landing the user on the exact screen.
 *
 * NOT here on purpose: `…/voice/<intent>` links from Siri/Bixby/Assistant.
 * Those are COMMANDS, not screen addresses — "search for milk" is an action
 * with an argument, and half of them navigate nowhere at all. They are matched
 * by src/voice instead. React Navigation ignores paths it cannot resolve, so
 * both consumers read the same URL stream without stepping on each other.
 */
import * as Linking from 'expo-linking';
import type { LinkingOptions } from '@react-navigation/native';

import type { RootStackParamList } from './types';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [
    Linking.createURL('/'), // active custom scheme (env-specific)
    'https://app.example.com',
  ],
  config: {
    screens: {
      Game: 'game',
      Main: {
        screens: {
          TodosTab: 'todos',
          SettingsTab: 'settings',
        },
      },
      DesignSystem: 'design-system',
    },
  },
};
