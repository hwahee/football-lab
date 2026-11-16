/**
 * Route table. The app opens on the game (`Game`); everything else — the
 * boilerplate's Todos / Settings tabs — sits one level down in `Main`, reached
 * from the gear button on the game's scoreboard and left with the header's
 * back button. The design-system gallery is registered in DEV builds only.
 */
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { env } from '../config/env';
import { GameScreen } from '../game/GameScreen';
import { useLocale } from '../i18n/LocaleProvider';
import { useTheme } from '../theme/ThemeProvider';
import { DesignSystemScreen } from '../screens/DesignSystemScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { TodosScreen } from '../screens/TodosScreen';
import { TESTID } from '../testing/testids';
import type { MainTabParamList, RootStackParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function MainTabs() {
  const { tokens } = useTheme();
  const { t } = useLocale();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.colors.primary,
        tabBarInactiveTintColor: tokens.colors.textMuted,
        tabBarStyle: {
          backgroundColor: tokens.colors.surface,
          borderTopColor: tokens.colors.border,
        },
      }}
    >
      <Tab.Screen
        name="TodosTab"
        component={TodosScreen}
        options={{
          title: t('tab.todos'),
          tabBarButtonTestID: TESTID.tabs.todos,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkbox-outline" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{
          title: t('tab.settings'),
          tabBarButtonTestID: TESTID.tabs.settings,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { t } = useLocale();
  return (
    <Stack.Navigator initialRouteName="Game" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Game" component={GameScreen} />
      <Stack.Screen
        name="Main"
        component={MainTabs}
        // The header is the way back to the game.
        options={{ headerShown: true, title: t('game.settings'), headerBackTitle: t('game.title') }}
      />
      {env.isDev ? (
        <Stack.Screen
          name="DesignSystem"
          component={DesignSystemScreen}
          options={{ headerShown: true, title: t('designSystem.title') }}
        />
      ) : null}
    </Stack.Navigator>
  );
}
