/**
 * Todos — the demo screen exercising every data convention:
 *   - useInfiniteQuery + cursor pagination (scroll to load more)
 *   - all four data states: loading / error(+retry) / empty / data
 *   - optimistic toggle & delete, invalidating create
 *   - remote-config consumption (notice banner, feature flag)
 *   - UTC→device-timezone conversion at the display boundary
 *
 * Minimal state: the ONLY local state is the composer input and the status
 * filter; everything else derives from server cache, remote config, and —
 * for the search term — the route params (`?q=`, set by the `todos.search`
 * voice intent; see src/voice).
 */
import { useState } from 'react';
import { FlatList, Linking, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from '@react-navigation/native';

import type { Todo, TodoStatus } from '@shared/domain/todo';
import { formatUtcInTimeZone } from '@shared/time';

import { useCreateTodo, useDeleteTodo, useTodosInfinite, useUpdateTodo } from '../api/queries';
import { AppText } from '../components/AppText';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { CheckPop } from '../components/CheckPop';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Screen } from '../components/Screen';
import { Spinner } from '../components/Spinner';
import { TextField } from '../components/TextField';
import { useConfig } from '../config/ConfigProvider';
import { useLocale } from '../i18n/LocaleProvider';
import { OfflineBanner } from '../offline/OfflineBanner';
import type { MainTabParamList } from '../navigation/types';
import { touchSlop } from '../theme/skin';
import { useTheme } from '../theme/ThemeProvider';
import { TESTID } from '../testing/testids';

type StatusFilter = 'all' | TodoStatus;

export function TodosScreen() {
  const { tokens } = useTheme();
  const { t, locale } = useLocale();
  const { config } = useConfig();
  const navigation = useNavigation<NavigationProp<MainTabParamList, 'TodosTab'>>();
  const route = useRoute<RouteProp<MainTabParamList, 'TodosTab'>>();

  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  // Route param, not local state: a voice search re-navigates with a new `q`,
  // and that is what re-renders the list.
  const search = route.params?.q?.trim() ?? '';

  const query = useTodosInfinite({
    status: filter === 'all' ? undefined : filter,
    q: search || undefined,
  });
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();

  // Derived from the query cache — never mirrored into local state.
  const todos = query.data?.pages.flatMap((page) => page.items) ?? [];

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    createTodo.mutate(trimmed);
    setTitle('');
  };

  const renderItem = ({ item }: { item: Todo }) => {
    const done = item.status === 'done';
    const nextStatus: TodoStatus = done ? 'open' : 'done';
    return (
      <View
        testID={TESTID.todos.item(item.id)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.spacing.sm,
          paddingVertical: tokens.spacing.sm,
          paddingHorizontal: tokens.spacing.md,
          borderBottomWidth: tokens.borderWidth,
          borderBottomColor: tokens.colors.border,
          backgroundColor: tokens.colors.surface,
        }}
      >
        <Pressable
          testID={TESTID.todos.itemToggle(item.id)}
          onPress={() => updateTodo.mutate({ id: item.id, patch: { status: nextStatus } })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={t('todos.toggleStatus', {
            title: item.title,
            status: t(done ? 'todos.status.open' : 'todos.status.done'),
          })}
          hitSlop={tokens.spacing.sm}
          style={{
            minWidth: tokens.minTouchTarget,
            minHeight: tokens.minTouchTarget,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CheckPop checked={done}>
            <Ionicons
              name={done ? 'checkbox' : 'square-outline'}
              size={tokens.type.heading + 4}
              color={done ? tokens.colors.success : tokens.colors.textMuted}
            />
          </CheckPop>
        </Pressable>

        <View style={{ flex: 1, gap: tokens.spacing.xs / 2 }}>
          <AppText
            numberOfLines={2}
            muted={done}
            style={done ? { textDecorationLine: 'line-through' } : undefined}
          >
            {item.title}
          </AppText>
          {/* UTC leaves the wire; the DEVICE time zone applies only here. */}
          <AppText variant="caption" muted>
            {formatUtcInTimeZone(item.createdAt, { locale })}
          </AppText>
        </View>

        <Badge
          label={t(done ? 'todos.status.done' : 'todos.status.open')}
          tone={done ? 'success' : 'neutral'}
        />
        <Pressable
          testID={TESTID.todos.itemDelete(item.id)}
          onPress={() => deleteTodo.mutate(item.id)}
          accessibilityRole="button"
          accessibilityLabel={t('todos.deleteTodo', { title: item.title })}
          hitSlop={tokens.spacing.sm}
          style={{
            minWidth: tokens.minTouchTarget,
            minHeight: tokens.minTouchTarget,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="trash-outline" size={tokens.type.heading} color={tokens.colors.danger} />
        </Pressable>
      </View>
    );
  };

  return (
    <Screen testID={TESTID.todos.screen} padded={false} topInset={false}>
      <View style={{ gap: tokens.spacing.sm, padding: tokens.spacing.md }}>
        <OfflineBanner />
        {/* Remote-config demo: server-controlled notice banner. */}
        {config.noticeBanner.enabled && config.noticeBanner.text ? (
          <Banner
            testID={TESTID.notice.banner}
            text={config.noticeBanner.text}
            onPress={
              config.noticeBanner.url
                ? () => void Linking.openURL(config.noticeBanner.url!)
                : undefined
            }
          />
        ) : null}

        <AppText variant="title">{t('todos.title')}</AppText>

        <View style={{ flexDirection: 'row', gap: tokens.spacing.sm, alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <TextField
              testID={TESTID.todos.createInput}
              value={title}
              onChangeText={setTitle}
              placeholder={t('todos.createPlaceholder')}
              label={t('todos.createLabel')}
              onSubmitEditing={submit}
              returnKeyType="done"
            />
          </View>
          <View style={{ paddingTop: tokens.type.caption + tokens.spacing.sm }}>
            <Button
              testID={TESTID.todos.createSubmit}
              label={t('common.add')}
              onPress={submit}
              loading={createTodo.isPending}
              accessibilityHint={t('todos.createSubmit')}
            />
          </View>
        </View>

        {/* Status filter — radio-style segmented control. */}
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('todos.filterLabel')}
          style={{ flexDirection: 'row', gap: tokens.spacing.sm }}
        >
          {(['all', 'open', 'done'] as const).map((value) => {
            const selected = filter === value;
            return (
              <Pressable
                key={value}
                testID={TESTID.todos.filter(value)}
                onPress={() => setFilter(value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={t(`todos.filter.${value}`)}
                hitSlop={touchSlop(tokens, tokens.chipHeight)}
                style={{
                  paddingHorizontal: tokens.controlPaddingX,
                  minHeight: tokens.chipHeight,
                  justifyContent: 'center',
                  borderRadius: tokens.radius.pill,
                  borderWidth: tokens.borderWidth,
                  borderColor: selected ? tokens.colors.primary : tokens.colors.border,
                  backgroundColor: selected ? tokens.colors.primary : tokens.colors.surface,
                }}
              >
                <AppText
                  variant="caption"
                  bold
                  color={selected ? tokens.colors.onPrimary : tokens.colors.text}
                >
                  {t(`todos.filter.${value}`)}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        {/* A voice search arrives with no on-screen trace of what was heard.
            Showing the term (and a way out) is what makes `todos.search`
            legible when the driver finally looks down. */}
        {search ? (
          <View
            testID={TESTID.todos.searchBanner}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: tokens.spacing.sm,
              paddingVertical: tokens.spacing.xs,
              paddingHorizontal: tokens.spacing.md,
              borderRadius: tokens.radius.pill,
              backgroundColor: tokens.colors.surface,
              borderWidth: tokens.borderWidth,
              borderColor: tokens.colors.border,
            }}
          >
            <Ionicons name="search" size={tokens.type.body} color={tokens.colors.textMuted} />
            <AppText variant="caption" style={{ flex: 1 }} numberOfLines={1}>
              {t('todos.searchResults', { query: search })}
            </AppText>
            <Pressable
              testID={TESTID.todos.searchClear}
              onPress={() => navigation.setParams({ q: undefined })}
              accessibilityRole="button"
              accessibilityLabel={t('todos.searchClear')}
              hitSlop={tokens.spacing.sm}
              style={{
                minWidth: tokens.minTouchTarget,
                minHeight: tokens.minTouchTarget,
                alignItems: 'flex-end',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="close" size={tokens.type.body} color={tokens.colors.textMuted} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {query.isPending ? (
        <Spinner testID={TESTID.todos.loading} accessibilityLabel={t('common.loading')} />
      ) : query.isError ? (
        <ErrorState
          testID={TESTID.todos.error}
          message={t('todos.loadFailed')}
          retryLabel={t('common.retry')}
          retryTestID={TESTID.todos.errorRetry}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <FlatList
          testID={TESTID.todos.list}
          data={todos}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshing={query.isRefetching && !query.isFetchingNextPage}
          onRefresh={() => void query.refetch()}
          // Infinite scroll: pull the next cursor page near the list end.
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          ListEmptyComponent={
            <EmptyState
              testID={TESTID.todos.empty}
              message={search ? t('todos.searchEmpty', { query: search }) : t('todos.empty')}
            />
          }
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <Spinner
                testID={TESTID.todos.footerLoading}
                accessibilityLabel={t('todos.loadingMore')}
                size="small"
              />
            ) : todos.length > 0 && !query.hasNextPage ? (
              <AppText
                variant="caption"
                muted
                align="center"
                style={{ padding: tokens.spacing.md }}
              >
                {t('todos.endReached')}
              </AppText>
            ) : undefined
          }
        />
      )}
    </Screen>
  );
}
