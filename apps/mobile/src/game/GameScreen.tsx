/**
 * The game — the first thing the app shows.
 *
 *   ┌ scoreboard ─────────────── ⚙ ┐
 *   │                              │
 *   │   3D field, seen from above  │
 *   │                              │
 *   ├ control board ───────────────┤   ← changes with the phase
 *   └──────────────────────────────┘
 *
 * Everything is operated from the on-screen board (and by dragging players on
 * the field while setting up). Pressing START removes every control until the
 * play has been decided by the dice.
 */
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLocale } from '../i18n/LocaleProvider';
import type { RootStackParamList } from '../navigation/types';
import { TESTID } from '../testing/testids';
import { DIFFICULTIES, QUARTER_LENGTHS, otherTeam, type GameState } from './engine/game';
import { isMovable } from './engine/playbook';
import { fieldGoalChance, fieldGoalDistance } from './engine/sim';
import {
  CUSHIONS,
  DEF_PLAYS,
  DEF_ROLES,
  OFF_PLAYS,
  OFF_ROLES,
  RISKS,
  SPECIAL_PLAYS,
  isRunPlay,
  isSpecial,
  type DefPlayId,
  type OffPlayId,
  type TeamId,
} from './engine/types';
import { FieldView } from './FieldView';
import { TEAM_COLOR } from './palette';
import {
  describeDown,
  describeEvent,
  describeNote,
  describeOutcome,
  describeSpot,
  formatClock,
  isBigEvent,
  outcomeMood,
  roleName,
  teamName,
  type Translate,
} from './text';
import { G, GButton, GCard, GChip, GPanel, GSegmented, GText } from './ui/kit';
import { useGameSession, type GameSession } from './useGameSession';

const OFF_TAG: Record<OffPlayId, 'run' | 'pass' | 'kick'> = {
  insideRun: 'run',
  outsideRun: 'run',
  quickSlant: 'pass',
  curlFlat: 'pass',
  deepShot: 'pass',
  playAction: 'pass',
  screen: 'pass',
  punt: 'kick',
  fieldGoal: 'kick',
};
const DEF_TAG: Record<DefPlayId, 'balanced' | 'cover' | 'pressure' | 'run' | 'deep'> = {
  man: 'balanced',
  zone: 'cover',
  blitz: 'pressure',
  runStop: 'run',
  prevent: 'deep',
};
const TAG_COLOR = {
  run: G.color.go,
  pass: G.color.scrimmage,
  kick: G.color.led,
  balanced: G.color.inkMuted,
  cover: G.color.scrimmage,
  pressure: G.color.danger,
  deep: G.color.led,
} as const;

function TeamScore({
  team,
  score,
  hasBall,
  t,
}: {
  team: TeamId;
  score: number;
  hasBall: boolean;
  t: Translate;
}) {
  return (
    <View
      style={{
        flex: 1,
        flexDirection: team === 'home' ? 'row' : 'row-reverse',
        alignItems: 'center',
        gap: G.space.sm,
      }}
    >
      <View
        style={{
          width: 8,
          height: 34,
          borderRadius: 2,
          backgroundColor: TEAM_COLOR[team],
          transform: [{ skewX: '-12deg' }],
        }}
      />
      <View style={{ alignItems: team === 'home' ? 'flex-start' : 'flex-end' }}>
        <GText variant="label" color={hasBall ? G.color.led : G.color.inkMuted}>
          {hasBall ? '● ' : ''}
          {teamName(t, team)}
        </GText>
        <GText variant="digits" style={{ fontSize: 30, lineHeight: 34 }}>
          {String(score).padStart(2, '0')}
        </GText>
      </View>
    </View>
  );
}

function Scoreboard({
  game,
  locked,
  onSettings,
}: {
  game: GameState | null;
  locked: boolean;
  onSettings: () => void;
}) {
  const { t } = useLocale();
  return (
    <View
      testID={TESTID.game.scoreboard}
      style={{
        backgroundColor: G.color.panel,
        borderBottomWidth: 2,
        borderBottomColor: G.color.panelEdge,
        paddingHorizontal: G.space.md,
        paddingVertical: G.space.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: G.space.sm,
      }}
    >
      <TeamScore
        team="home"
        score={game?.score.home ?? 0}
        hasBall={game?.possession === 'home' && !game.over}
        t={t}
      />
      <View style={{ alignItems: 'center', minWidth: 96 }}>
        {game ? (
          <>
            <GText variant="label" color={G.color.inkMuted}>
              {game.over ? t('game.final') : t('game.quarter', { quarter: game.quarter })}
            </GText>
            <GText variant="digits" style={{ fontSize: 20 }}>
              {formatClock(game.clock)}
            </GText>
          </>
        ) : (
          <GText variant="title" color={G.color.led}>
            {t('game.title')}
          </GText>
        )}
      </View>
      <TeamScore
        team="away"
        score={game?.score.away ?? 0}
        hasBall={game?.possession === 'away' && !game.over}
        t={t}
      />
      <Pressable
        testID={TESTID.game.settings}
        onPress={onSettings}
        disabled={locked}
        accessibilityRole="button"
        accessibilityLabel={t('game.settings')}
        accessibilityState={{ disabled: locked }}
        hitSlop={10}
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: G.color.panelRaised,
          opacity: locked ? 0.3 : 1,
        }}
      >
        <Ionicons name="settings-sharp" size={18} color={G.color.ink} />
      </Pressable>
    </View>
  );
}

/** Down, distance and ball position — pinned over the top of the field. */
function DownMarker({ game }: { game: GameState }) {
  const { t } = useLocale();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: G.space.sm,
        left: G.space.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: G.space.sm,
        paddingHorizontal: G.space.md,
        paddingVertical: 5,
        borderRadius: G.radius.sm,
        backgroundColor: 'rgba(7,11,20,0.82)',
        borderLeftWidth: 4,
        borderLeftColor: TEAM_COLOR[game.possession],
      }}
    >
      <GText variant="title" color={G.color.led}>
        {describeDown(t, game)}
      </GText>
      <GText variant="small" color={G.color.inkMuted}>
        {describeSpot(t, game.ballOn)}
      </GText>
    </View>
  );
}

function MenuBoard({ game }: { game: GameSession }) {
  const { t } = useLocale();
  const { config } = game.session;
  return (
    <GPanel title={t('game.subtitle')} accent={G.color.led} style={{ flex: 1 }}>
      <View style={{ flex: 1, gap: G.space.md, justifyContent: 'center' }}>
        <GSegmented
          label={t('game.menu.mode')}
          value={config.mode}
          onChange={(mode) => game.setConfig({ mode })}
          testIDFor={(value) => TESTID.game.menuOption('mode', value)}
          options={[
            { value: 'ai', label: t('game.menu.mode.ai') },
            { value: 'pvp', label: t('game.menu.mode.pvp') },
          ]}
        />
        <GSegmented
          label={t('game.menu.difficulty')}
          value={config.difficulty}
          disabled={config.mode !== 'ai'}
          onChange={(difficulty) => game.setConfig({ difficulty })}
          testIDFor={(value) => TESTID.game.menuOption('difficulty', value)}
          options={DIFFICULTIES.map((value) => ({
            value,
            label: t(`game.menu.difficulty.${value}`),
          }))}
        />
        <GSegmented
          label={t('game.menu.length')}
          value={String(config.quarterSeconds) as '120' | '180' | '300'}
          onChange={(value) => game.setConfig({ quarterSeconds: Number(value) })}
          testIDFor={(value) => TESTID.game.menuOption('length', value)}
          options={QUARTER_LENGTHS.map((value) => ({
            value: String(value) as '120' | '180' | '300',
            label: t(`game.menu.length.${value}`),
          }))}
        />
        <GText variant="small" color={G.color.inkMuted}>
          {t(`game.menu.modeHint.${config.mode}`)}
        </GText>
      </View>
      <GButton
        testID={TESTID.game.kickoff}
        label={t('game.menu.kickoff')}
        tone="go"
        size="lg"
        onPress={game.startGame}
      />
    </GPanel>
  );
}

function NudgePad({ game, disabled }: { game: GameSession; disabled: boolean }) {
  const { t } = useLocale();
  const arrow = (
    direction: 'up' | 'down' | 'left' | 'right',
    dx: number,
    dz: number,
    glyph: string,
  ) => (
    <GButton
      testID={TESTID.game.nudge(direction)}
      label={glyph}
      size="sm"
      disabled={disabled}
      accessibilityLabel={t(`game.place.move.${direction}`)}
      onPress={() => game.nudge(dx, dz)}
      style={{ width: 44 }}
    />
  );
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      {arrow('up', 0, -1, '▲')}
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {arrow('left', -1, 0, '◀')}
        {arrow('down', 0, 1, '▼')}
        {arrow('right', 1, 0, '▶')}
      </View>
    </View>
  );
}

function CallBoard({ game, state }: { game: GameSession; state: GameState }) {
  const { t } = useLocale();
  const [tab, setTab] = useState<'play' | 'place'>('play');
  const { session } = game;
  const team = session.turn ?? state.possession;
  const offense = session.phase === 'offense';
  const { offCall, defCall } = session;
  const twoPlayer = state.config.mode === 'pvp';
  // The computer is kicking: there is no defense to call.
  const facingKick = !offense && isSpecial(offCall.play);
  const roles = offense ? OFF_ROLES : DEF_ROLES;
  const kickable = fieldGoalDistance(state.ballOn) <= 68;
  // The away team attacks DOWN the screen: its left is the screen's right.
  const mirrored = state.possession === 'away';

  const hint = offense
    ? offCall.play === 'fieldGoal'
      ? t('game.play.fieldGoal.hint', {
          distance: fieldGoalDistance(state.ballOn),
          chance: Math.round(fieldGoalChance(state.ballOn) * 100),
        })
      : t(`game.play.${offCall.play}.hint`)
    : t(`game.def.${defCall.play}.hint`);

  const primary =
    offense && twoPlayer && !isSpecial(offCall.play) ? (
      <GButton
        testID={TESTID.game.lockIn}
        label={t('game.action.lock')}
        tone={team === 'home' ? 'primary' : 'danger'}
        size="lg"
        onPress={game.lockIn}
      />
    ) : (
      <GButton
        testID={TESTID.game.start}
        label={`▶ ${t('game.action.start')}`}
        caption={t('game.action.startHint')}
        tone="go"
        size="lg"
        onPress={game.start}
      />
    );

  if (facingKick) {
    return (
      <GPanel
        title={t('game.turn.defense', { team: teamName(t, team) })}
        accent={TEAM_COLOR[team]}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <GText color={G.color.inkMuted}>
            {t('game.kickNotice', { team: teamName(t, otherTeam(team)) })}
          </GText>
        </View>
        {primary}
      </GPanel>
    );
  }

  return (
    <GPanel
      title={t(offense ? 'game.turn.offense' : 'game.turn.defense', { team: teamName(t, team) })}
      accent={TEAM_COLOR[team]}
      style={{ flex: 1 }}
      right={
        <GSegmented
          compact
          value={tab}
          onChange={setTab}
          testIDFor={(value) => TESTID.game.tab(value)}
          options={[
            { value: 'play', label: t('game.tab.play') },
            { value: 'place', label: t('game.tab.place') },
          ]}
        />
      }
    >
      {tab === 'play' ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: 6, paddingBottom: G.space.xs }}
        >
          <View
            accessibilityRole="radiogroup"
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}
          >
            {offense
              ? [...OFF_PLAYS, ...SPECIAL_PLAYS].map((play) => (
                  <GCard
                    key={play}
                    testID={TESTID.game.play(play)}
                    title={t(`game.play.${play}`)}
                    tag={t(`game.tag.${OFF_TAG[play]}`)}
                    tagColor={TAG_COLOR[OFF_TAG[play]]}
                    selected={offCall.play === play}
                    disabled={play === 'fieldGoal' && !kickable}
                    onPress={() => game.setOffense({ play })}
                  />
                ))
              : DEF_PLAYS.map((play) => (
                  <GCard
                    key={play}
                    testID={TESTID.game.play(play)}
                    title={t(`game.def.${play}`)}
                    tag={t(`game.tag.${DEF_TAG[play]}`)}
                    tagColor={TAG_COLOR[DEF_TAG[play]]}
                    selected={defCall.play === play}
                    onPress={() => game.setDefense({ play })}
                  />
                ))}
          </View>
          <GText
            variant="small"
            color={G.color.inkMuted}
            numberOfLines={1}
            style={{ minHeight: 16 }}
          >
            {hint}
          </GText>
          {offense ? (
            <>
              <GSegmented
                label={t('game.option.side')}
                value={offCall.flip !== mirrored ? 'left' : 'right'}
                disabled={isSpecial(offCall.play)}
                onChange={(value) => game.setOffense({ flip: (value === 'left') !== mirrored })}
                testIDFor={(value) => TESTID.game.option('side', value)}
                options={[
                  { value: 'left', label: t('game.option.side.left') },
                  { value: 'right', label: t('game.option.side.right') },
                ]}
              />
              <GSegmented
                label={t('game.option.risk')}
                value={offCall.risk}
                disabled={isSpecial(offCall.play) || isRunPlay(offCall.play)}
                onChange={(risk) => game.setOffense({ risk })}
                testIDFor={(value) => TESTID.game.option('risk', value)}
                options={RISKS.map((value) => ({ value, label: t(`game.option.risk.${value}`) }))}
              />
            </>
          ) : (
            <GSegmented
              label={t('game.option.cushion')}
              value={defCall.cushion}
              onChange={(cushion) => game.setDefense({ cushion })}
              testIDFor={(value) => TESTID.game.option('cushion', value)}
              options={CUSHIONS.map((value) => ({
                value,
                label: t(`game.option.cushion.${value}`),
              }))}
            />
          )}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, gap: G.space.sm }}>
          <View style={{ flexDirection: 'row', gap: G.space.md, alignItems: 'center' }}>
            <View
              accessibilityRole="radiogroup"
              style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}
            >
              {roles.map((role) => (
                <GChip
                  key={role}
                  testID={TESTID.game.player(role)}
                  label={roleName(t, role, mirrored)}
                  color={TEAM_COLOR[team]}
                  selected={session.selected === role}
                  onPress={() => game.select(session.selected === role ? null : role)}
                />
              ))}
            </View>
            <NudgePad game={game} disabled={!session.selected || !isMovable(session.selected)} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: G.space.sm }}>
            <GText variant="small" color={G.color.inkMuted} style={{ flex: 1 }}>
              {session.selected && !isMovable(session.selected)
                ? t('game.place.locked')
                : t('game.place.hint')}
            </GText>
            <GButton
              testID={TESTID.game.resetPlacement}
              label={t('game.place.reset')}
              size="sm"
              onPress={game.resetPlacement}
            />
          </View>
        </View>
      )}
      {primary}
    </GPanel>
  );
}

function HandoverBoard({ game, state }: { game: GameSession; state: GameState }) {
  const { t } = useLocale();
  const defense = otherTeam(state.possession);
  return (
    <GPanel title={t('game.handover.title')} accent={TEAM_COLOR[defense]} style={{ flex: 1 }}>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <GText color={G.color.inkMuted}>
          {t('game.handover.body', { team: teamName(t, defense) })}
        </GText>
      </View>
      <GButton
        testID={TESTID.game.ready}
        label={t('game.action.ready')}
        tone={defense === 'home' ? 'primary' : 'danger'}
        size="lg"
        onPress={game.ready}
      />
    </GPanel>
  );
}

function EventLog({
  events,
  t,
  mirrored,
}: {
  events: readonly Parameters<typeof describeEvent>[1][];
  t: Translate;
  mirrored: boolean;
}) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 3, paddingBottom: G.space.xs }}>
      {/* Newest first: the line that just happened is always in view. */}
      {[...events].reverse().map((event, index) => (
        <View key={events.length - index} style={{ flexDirection: 'row', gap: G.space.sm }}>
          <GText
            variant="small"
            color={G.color.ledDim}
            style={{ fontFamily: G.font.digits, width: 38 }}
          >
            {event.t.toFixed(1)}s
          </GText>
          <GText
            variant="small"
            color={isBigEvent(event) ? G.color.led : G.color.ink}
            style={{ flex: 1 }}
          >
            {describeEvent(t, event, mirrored)}
          </GText>
        </View>
      ))}
    </ScrollView>
  );
}

/** Shown from START until the whistle: no buttons at all, by design. */
function LiveBoard({ game }: { game: GameSession }) {
  const { t } = useLocale();
  const { session } = game;
  return (
    <GPanel
      testID={TESTID.game.live}
      title={t('game.live.title')}
      accent={G.color.led}
      style={{ flex: 1 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: G.space.sm }}>
        <Ionicons name="lock-closed" size={14} color={G.color.inkMuted} />
        <GText variant="small" color={G.color.inkMuted}>
          {session.phase === 'presnap' ? t('game.live.shift') : t('game.live.locked')}
        </GText>
      </View>
      <EventLog events={session.feed} t={t} mirrored={session.game?.possession === 'away'} />
    </GPanel>
  );
}

function ResultBoard({ game, state }: { game: GameSession; state: GameState }) {
  const { t } = useLocale();
  const last = game.session.last;
  if (!last) return null;
  const mood = outcomeMood(last.outcome.kind, last.yards);
  const color = mood === 'good' ? G.color.go : mood === 'bad' ? G.color.danger : G.color.ink;
  const notes = last.notes.map((note) => describeNote(t, note)).filter((line) => line !== null);
  return (
    <GPanel testID={TESTID.game.result} accent={TEAM_COLOR[last.offense]} style={{ flex: 1 }}>
      <View style={{ gap: 2, paddingTop: G.space.xs }}>
        <GText variant="display" color={color} numberOfLines={1}>
          {describeOutcome(t, last.outcome.kind, last.yards)}
        </GText>
        {notes.map((line) => (
          <GText key={line} variant="small" color={G.color.led}>
            {line}
          </GText>
        ))}
        {state.over ? null : (
          <GText variant="small" color={G.color.inkMuted}>
            {t('game.note.nextBall', {
              team: teamName(t, state.possession),
              spot: `${describeDown(t, state)} · ${describeSpot(t, state.ballOn)}`,
            })}
          </GText>
        )}
      </View>
      <EventLog events={last.events} t={t} mirrored={last.offense === 'away'} />
      <GButton
        testID={TESTID.game.next}
        label={t('game.action.next')}
        tone="primary"
        size="lg"
        onPress={game.next}
      />
    </GPanel>
  );
}

function FinalBoard({ game, state }: { game: GameSession; state: GameState }) {
  const { t } = useLocale();
  const { home, away } = state.score;
  const winner: TeamId | null = home === away ? null : home > away ? 'home' : 'away';
  const rows = [
    ['game.stat.plays', 'plays'],
    ['game.stat.rush', 'rushYards'],
    ['game.stat.pass', 'passYards'],
    ['game.stat.firstDowns', 'firstDowns'],
    ['game.stat.turnovers', 'turnovers'],
  ] as const;
  return (
    <GPanel accent={winner ? TEAM_COLOR[winner] : G.color.led} style={{ flex: 1 }}>
      <GText
        variant="display"
        color={winner ? TEAM_COLOR[winner] : G.color.led}
        style={{ textAlign: 'center' }}
      >
        {winner ? t('game.final.win', { team: teamName(t, winner) }) : t('game.final.draw')}
      </GText>
      <View style={{ flex: 1, justifyContent: 'center', gap: 4 }}>
        {rows.map(([label, key]) => (
          <View key={key} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <GText variant="digits" color={TEAM_COLOR.home} style={{ width: 64, fontSize: 18 }}>
              {state.stats.home[key]}
            </GText>
            <GText variant="label" style={{ flex: 1, textAlign: 'center' }}>
              {t(label)}
            </GText>
            <GText
              variant="digits"
              color={TEAM_COLOR.away}
              style={{ width: 64, fontSize: 18, textAlign: 'right' }}
            >
              {state.stats.away[key]}
            </GText>
          </View>
        ))}
      </View>
      <GButton
        testID={TESTID.game.newGame}
        label={t('game.menu.newGame')}
        tone="go"
        size="lg"
        onPress={game.backToMenu}
      />
    </GPanel>
  );
}

export function GameScreen() {
  const game = useGameSession();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { session, locked } = game;
  const state = session.game;
  const settingUp = session.phase === 'offense' || session.phase === 'defense';

  let board;
  if (!state || session.phase === 'menu') board = <MenuBoard game={game} />;
  else if (settingUp)
    board = <CallBoard key={`${session.phase}:${session.turn}`} game={game} state={state} />;
  else if (session.phase === 'handover') board = <HandoverBoard game={game} state={state} />;
  else if (locked) board = <LiveBoard game={game} />;
  else if (session.phase === 'result') board = <ResultBoard game={game} state={state} />;
  else board = <FinalBoard game={game} state={state} />;

  return (
    <View
      testID={TESTID.game.screen}
      style={{ flex: 1, backgroundColor: G.color.panel, paddingTop: insets.top }}
    >
      <Scoreboard
        game={state}
        locked={locked}
        onSettings={() => navigation.navigate('Main', { screen: 'SettingsTab' })}
      />
      <View style={{ flex: 1, backgroundColor: G.color.night }}>
        <FieldView
          testID={TESTID.game.field}
          getFrame={game.getFrame}
          onTouch={settingUp ? game.fieldTouch : undefined}
        />
        {state &&
        session.phase !== 'menu' &&
        session.phase !== 'final' &&
        session.phase !== 'result' ? (
          <DownMarker game={state} />
        ) : null}
      </View>
      <View
        style={{
          height: Math.max(300, Math.min(390, height * 0.46)),
          paddingBottom: Math.max(insets.bottom, G.space.sm),
          backgroundColor: G.color.panel,
        }}
      >
        {board}
      </View>
    </View>
  );
}
