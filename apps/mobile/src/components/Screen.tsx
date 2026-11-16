/** Standard screen shell: safe area + themed background + padding. */
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PropsWithChildren } from 'react';

import { useTheme } from '../theme/ThemeProvider';

export interface ScreenProps extends PropsWithChildren {
  testID?: string;
  /** Disable horizontal padding for edge-to-edge lists. */
  padded?: boolean;
  /** Set to false under a navigation header, which already clears the status bar. */
  topInset?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Screen({ testID, padded = true, topInset = true, style, children }: ScreenProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      testID={testID}
      style={[
        {
          flex: 1,
          backgroundColor: tokens.colors.bg,
          paddingTop: topInset ? insets.top : 0,
          paddingBottom: insets.bottom,
          paddingHorizontal: padded ? tokens.spacing.md : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
