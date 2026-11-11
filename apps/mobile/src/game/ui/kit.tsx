/**
 * "Gridiron" — the game's own design system.
 *
 * The app's skins (standard/contrast/office/kids) style the utility screens;
 * the game deliberately does not follow them. It always looks like a night
 * game: a dark stadium backdrop, scoreboard-amber LED numerals, chunky
 * arcade buttons with a pressable edge, slanted condensed capitals.
 * docs/game-design-system.md describes the rules.
 *
 * Like the app's design system, interactive components REQUIRE a `testID`.
 */
import type { PropsWithChildren, ReactNode } from 'react';
import {
  Platform,
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { PALETTE } from '../palette';

export const G = {
  color: PALETTE,
  space: { xs: 4, sm: 8, md: 12, lg: 16 },
  radius: { sm: 6, md: 10, lg: 14 },
  /** Height of the "edge" under a button — what it travels when pressed. */
  edge: 5,
  font: {
    display: Platform.select({ ios: 'AvenirNextCondensed-Heavy', default: 'sans-serif-condensed' }),
    digits: Platform.select({ ios: 'Menlo-Bold', default: 'monospace' }),
  },
} as const;

type TextVariant = 'display' | 'title' | 'label' | 'body' | 'small' | 'digits';

const TEXT: Record<TextVariant, TextStyle> = {
  display: {
    fontFamily: G.font.display,
    fontSize: 26,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 1,
  },
  title: {
    fontFamily: G.font.display,
    fontSize: 17,
    fontWeight: '800',
    fontStyle: 'italic',
    letterSpacing: 0.6,
  },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  body: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  small: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  digits: {
    fontFamily: G.font.digits,
    fontSize: 24,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
};

export interface GTextProps extends PropsWithChildren {
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  testID?: string;
}

export function GText({
  variant = 'body',
  color,
  style,
  numberOfLines,
  testID,
  children,
}: GTextProps) {
  const fallback =
    variant === 'label' ? G.color.inkMuted : variant === 'digits' ? G.color.led : G.color.ink;
  return (
    <Text
      testID={testID}
      numberOfLines={numberOfLines}
      // Game copy keeps its size: the layout is a fixed board, not a document.
      maxFontSizeMultiplier={1.2}
      style={[TEXT[variant], { color: color ?? fallback }, style]}
    >
      {children}
    </Text>
  );
}

type Tone = 'go' | 'primary' | 'neutral' | 'danger';

const TONES: Record<Tone, { face: string; edge: string; ink: string }> = {
  go: { face: G.color.go, edge: G.color.goEdge, ink: '#04210f' },
  primary: { face: G.color.home, edge: G.color.homeEdge, ink: '#ffffff' },
  neutral: { face: G.color.panelRaised, edge: '#0a101d', ink: G.color.ink },
  danger: { face: G.color.away, edge: G.color.awayEdge, ink: '#ffffff' },
};

export interface GButtonProps {
  testID: string;
  label: string;
  /** Second line under the label (big buttons). */
  caption?: string;
  onPress: () => void;
  tone?: Tone;
  size?: 'lg' | 'md' | 'sm';
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Arcade button: a face sitting on an edge; pressing pushes the face down. */
export function GButton({
  testID,
  label,
  caption,
  onPress,
  tone = 'neutral',
  size = 'md',
  disabled = false,
  accessibilityLabel,
  style,
}: GButtonProps) {
  const colors = TONES[tone];
  const height = size === 'lg' ? 54 : size === 'md' ? 44 : 34;
  const edge = size === 'sm' ? 3 : G.edge;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      hitSlop={size === 'sm' ? 6 : 2}
      style={[{ opacity: disabled ? 0.4 : 1 }, style]}
    >
      {({ pressed }) => (
        <View
          style={{
            backgroundColor: colors.edge,
            borderRadius: G.radius.md,
            paddingBottom: pressed ? 1 : edge,
            marginTop: pressed ? edge - 1 : 0,
          }}
        >
          <View
            style={{
              minHeight: height,
              paddingHorizontal: size === 'sm' ? G.space.sm : G.space.lg,
              borderRadius: G.radius.md,
              backgroundColor: colors.face,
              borderTopWidth: 1.5,
              borderTopColor: 'rgba(255,255,255,0.35)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <GText
              variant={size === 'lg' ? 'display' : size === 'md' ? 'title' : 'label'}
              color={colors.ink}
              numberOfLines={1}
            >
              {label}
            </GText>
            {caption ? (
              <GText variant="small" color={colors.ink} style={{ opacity: 0.75, marginTop: -2 }}>
                {caption}
              </GText>
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

export interface GPanelProps extends PropsWithChildren {
  /** Color of the stripe down the left edge — usually the team at the controls. */
  accent?: string;
  title?: string;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The board the controls sit on. */
export function GPanel({ accent, title, right, style, testID, children }: GPanelProps) {
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: G.color.panel,
          borderTopWidth: 2,
          borderTopColor: G.color.panelEdge,
          paddingHorizontal: G.space.md,
          paddingTop: G.space.sm,
          gap: G.space.sm,
        },
        style,
      ]}
    >
      {title !== undefined || right ? (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: G.space.sm, minHeight: 34 }}
        >
          {accent ? (
            <View
              style={{
                width: 6,
                height: 22,
                borderRadius: 2,
                backgroundColor: accent,
                transform: [{ skewX: '-12deg' }],
              }}
            />
          ) : null}
          <GText variant="title" numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </GText>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export interface GSegmentedProps<T extends string> {
  label?: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  testIDFor: (value: T) => string;
  disabled?: boolean;
  compact?: boolean;
}

/** One-of-N switch; the lit segment carries an LED bar. */
export function GSegmented<T extends string>({
  label,
  options,
  value,
  onChange,
  testIDFor,
  disabled = false,
  compact = false,
}: GSegmentedProps<T>) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: G.space.sm,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {label ? (
        <GText variant="label" style={{ width: 72 }} numberOfLines={1}>
          {label}
        </GText>
      ) : null}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{
          flex: compact ? undefined : 1,
          flexDirection: 'row',
          backgroundColor: G.color.night,
          borderRadius: G.radius.sm,
          padding: 3,
          gap: 3,
        }}
      >
        {options.map((option) => {
          const on = option.value === value;
          return (
            <Pressable
              key={option.value}
              testID={testIDFor(option.value)}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled }}
              accessibilityLabel={option.label}
              hitSlop={{ top: 6, bottom: 6 }}
              style={{
                flex: compact ? undefined : 1,
                minHeight: 30,
                paddingHorizontal: G.space.md,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: G.radius.sm - 2,
                backgroundColor: on ? G.color.panelRaised : 'transparent',
                borderBottomWidth: 3,
                borderBottomColor: on ? G.color.led : 'transparent',
              }}
            >
              <GText variant="small" color={on ? G.color.ink : G.color.inkMuted} numberOfLines={1}>
                {option.label}
              </GText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export interface GCardProps {
  testID: string;
  title: string;
  tag: string;
  tagColor: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}

/** A play in the playbook grid: a colored spine for its kind, then its name. */
export function GCard({
  testID,
  title,
  tag,
  tagColor,
  selected,
  onPress,
  disabled = false,
}: GCardProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${title}, ${tag}`}
      hitSlop={{ top: 3, bottom: 3 }}
      style={{
        flexGrow: 1,
        flexBasis: '30%',
        minHeight: 38,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingRight: 6,
        borderRadius: G.radius.sm,
        overflow: 'hidden',
        backgroundColor: selected ? G.color.panelRaised : G.color.night,
        borderWidth: 2,
        borderColor: selected ? G.color.led : G.color.panelEdge,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <View style={{ width: 5, alignSelf: 'stretch', backgroundColor: tagColor }} />
      <View style={{ flex: 1 }}>
        <GText variant="label" color={tagColor} style={{ fontSize: 8, letterSpacing: 0.8 }}>
          {tag}
        </GText>
        <GText variant="small" color={selected ? G.color.led : G.color.ink} numberOfLines={1}>
          {title}
        </GText>
      </View>
    </Pressable>
  );
}

export interface GChipProps {
  testID: string;
  label: string;
  selected: boolean;
  onPress: () => void;
  color: string;
  disabled?: boolean;
}

/** A player on the roster strip. */
export function GChip({ testID, label, selected, onPress, color, disabled = false }: GChipProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      hitSlop={4}
      style={{
        minWidth: 58,
        minHeight: 38,
        paddingHorizontal: G.space.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderRadius: 19,
        backgroundColor: selected ? G.color.ink : G.color.night,
        borderWidth: 2,
        borderColor: selected ? G.color.ink : G.color.panelEdge,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <GText variant="small" color={selected ? G.color.night : G.color.ink}>
        {label}
      </GText>
    </Pressable>
  );
}
