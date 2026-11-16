/**
 * Settings — language (device/EN/KO), theme (system/light/dark), design
 * variant (standard/contrast/office/kids), OTA update check, and the dev-only design-system gallery.
 * Every preference is persisted through the kv-store facade.
 */
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { env } from '../config/env';
import { useLocale, type LocalePreference } from '../i18n/LocaleProvider';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, type ThemeMode } from '../theme/ThemeProvider';
import { touchSlop } from '../theme/skin';
import { DESIGN_VARIANTS, type DesignVariant } from '../theme/tokens';
import { Screen } from '../components/Screen';
import { TESTID } from '../testing/testids';
import { getUpdateChannel } from '../version/updates';

/** Radio-style option row shared by the three preference groups. */
function OptionRow<T extends string>({
  options,
  selected,
  onSelect,
  testIDFor,
  labelFor,
  groupLabel,
}: {
  options: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
  testIDFor: (value: T) => string;
  labelFor: (value: T) => string;
  groupLabel: string;
}) {
  const { tokens } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={groupLabel}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm }}
    >
      {options.map((value) => {
        const isSelected = value === selected;
        return (
          <Pressable
            key={value}
            testID={testIDFor(value)}
            onPress={() => onSelect(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={labelFor(value)}
            hitSlop={touchSlop(tokens, tokens.chipHeight)}
            style={{
              paddingHorizontal: tokens.controlPaddingX,
              minHeight: tokens.chipHeight,
              justifyContent: 'center',
              borderRadius: tokens.radius.control,
              borderWidth: tokens.borderWidth,
              borderColor: isSelected ? tokens.colors.primary : tokens.colors.border,
              backgroundColor: isSelected ? tokens.colors.primary : tokens.colors.surface,
            }}
          >
            <AppText
              variant="caption"
              bold
              color={isSelected ? tokens.colors.onPrimary : tokens.colors.text}
            >
              {labelFor(value)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SettingsScreen() {
  const { tokens, mode, setMode, variant, setVariant } = useTheme();
  const { t, preference, setPreference } = useLocale();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [updateResult, setUpdateResult] = useState<'idle' | 'checking' | 'up-to-date'>('idle');

  const checkUpdate = async () => {
    setUpdateResult('checking');
    try {
      const channel = getUpdateChannel();
      if (await channel.checkForUpdate()) {
        await channel.downloadAndRestart(); // restarts on success
      }
      setUpdateResult('up-to-date');
    } catch {
      setUpdateResult('up-to-date');
    }
  };

  return (
    <Screen testID={TESTID.settings.screen} padded={false} topInset={false}>
      <ScrollView contentContainerStyle={{ padding: tokens.spacing.md, gap: tokens.spacing.md }}>
        <AppText variant="title">{t('settings.title')}</AppText>

        <Card style={{ gap: tokens.spacing.sm }}>
          <AppText variant="heading">{t('settings.language')}</AppText>
          <OptionRow<LocalePreference>
            options={['system', 'en', 'ko']}
            selected={preference}
            onSelect={setPreference}
            testIDFor={(value) => TESTID.settings.locale(value)}
            labelFor={(value) =>
              value === 'system'
                ? t('settings.language.system')
                : value === 'en'
                  ? 'English'
                  : '한국어'
            }
            groupLabel={t('settings.language')}
          />
        </Card>

        <Card style={{ gap: tokens.spacing.sm }}>
          <AppText variant="heading">{t('settings.appearance')}</AppText>
          <AppText variant="caption" muted>
            {t('settings.theme')}
          </AppText>
          <OptionRow<ThemeMode>
            options={['system', 'light', 'dark']}
            selected={mode}
            onSelect={setMode}
            testIDFor={(value) => TESTID.settings.themeMode(value)}
            labelFor={(value) => t(`settings.theme.${value}`)}
            groupLabel={t('settings.theme')}
          />
          <AppText variant="caption" muted>
            {t('settings.design')}
          </AppText>
          <OptionRow<DesignVariant>
            options={DESIGN_VARIANTS}
            selected={variant}
            onSelect={setVariant}
            testIDFor={(value) => TESTID.settings.design(value)}
            labelFor={(value) => t(`settings.design.${value}`)}
            groupLabel={t('settings.design')}
          />
        </Card>

        <Card style={{ gap: tokens.spacing.sm }}>
          <AppText variant="heading">{t('settings.about')}</AppText>
          <AppText variant="caption" muted>
            {t('settings.appVersion')}: {env.appVersion}
          </AppText>
          <AppText variant="caption" muted>
            {t('settings.environment')}: {env.appEnv} ({env.apiBaseUrl})
          </AppText>
          <Button
            testID={TESTID.settings.checkUpdate}
            label={
              updateResult === 'up-to-date' ? t('settings.upToDate') : t('settings.checkUpdate')
            }
            variant="secondary"
            loading={updateResult === 'checking'}
            onPress={() => void checkUpdate()}
          />
        </Card>

        {env.isDev ? (
          <Card style={{ gap: tokens.spacing.sm }}>
            <AppText variant="heading">{t('settings.developer')}</AppText>
            <Button
              testID={TESTID.settings.designSystemLink}
              label={t('settings.designSystem')}
              variant="secondary"
              onPress={() => navigation.navigate('DesignSystem')}
            />
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
