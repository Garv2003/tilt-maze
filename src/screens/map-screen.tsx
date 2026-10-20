import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ListRenderItemInfo } from 'react-native';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
} from 'react-native-reanimated';
import { Canvas, Group, vec } from '@shopify/react-native-skia';

import { Board } from '../game/board';
import { fallLabel, formatTime } from '../game/format';
import { hapticTap } from '../game/haptics';
import type { LevelDef } from '../game/levels';
import { LEVELS, parseLevel, playArea } from '../game/levels';
import type { LevelRecord, Progress } from '../game/progress';
import {
  completedCount,
  isUnlocked,
  nextLevelIndex,
  recordFor,
  totalsFor,
} from '../game/progress';
import type { Settings } from '../game/settings';
import { FULL_TILT_FOR } from '../game/settings';
import { MAX_STARS, starString } from '../game/stars';
import { alpha, colors, FRAME } from '../game/theme';
import { useSmoothTilt, useTilt } from '../game/use-tilt';
import { isWorldStart, worldName, worldOf, worldStats } from '../game/worlds';

const TILE = 26;
const RAIL = 56;
const ROW_HEIGHT = 76;
const WORLD_ROW_HEIGHT = 64;

/** Matches the board's own extrusion, scaled down for a tile. */
const TILE_REST = 3;
const TILE_LIFT = 5;

const HERO_CELL = 12;
const HERO_PAD = FRAME + 8;
const HERO_TILT = 0.13;

type MapScreenProps = {
  progress: Progress;
  settings: Settings;
  onPlay: (index: number) => void;
  onOpenSettings: () => void;
};

type Tilt = { value: { x: number; y: number } };

type ListItem =
  | { kind: 'world'; world: number }
  | { kind: 'level'; level: LevelDef; index: number };

/** Each world gets a header row ahead of its first level. */
const ITEMS: ListItem[] = LEVELS.flatMap((level, index): ListItem[] =>
  isWorldStart(index)
    ? [
        { kind: 'world', world: worldOf(index) },
        { kind: 'level', level, index },
      ]
    : [{ kind: 'level', level, index }],
);

const ITEM_HEIGHTS = ITEMS.map(item =>
  item.kind === 'world' ? WORLD_ROW_HEIGHT : ROW_HEIGHT,
);
/** Where each row starts, measured from the top of the rows (below the header). */
const ITEM_OFFSETS = ITEM_HEIGHTS.map((_height, i) =>
  ITEM_HEIGHTS.slice(0, i).reduce((sum, h) => sum + h, 0),
);
/** The row that holds each level. */
const LEVEL_ITEM_INDEX = LEVELS.map((_level, levelIndex) =>
  ITEMS.findIndex(item => item.kind === 'level' && item.index === levelIndex),
);

/**
 * A level rendered as a small extruded icon: an outlined footprint with a face
 * floating above it that slides as the device leans. Same language as the
 * board, so the map and the game read as one object.
 */
const LevelTile = ({
  tilt,
  state,
}: {
  tilt: Tilt;
  state: 'done' | 'next' | 'locked';
}) => {
  const face = useAnimatedStyle(() => ({
    transform: [
      { translateX: -tilt.value.x * TILE_LIFT },
      { translateY: -TILE_REST - tilt.value.y * TILE_LIFT },
    ],
  }));

  return (
    <View style={styles.tileBox}>
      <View
        style={[styles.tileFootprint, state === 'locked' && styles.faint]}
      />
      <Animated.View
        style={[
          styles.tileFace,
          state === 'done' && styles.tileFaceDone,
          state === 'next' && styles.tileFaceNext,
          state === 'locked' && styles.tileFaceLocked,
          face,
        ]}>
        {state === 'next' ? <View style={styles.tileDot} /> : null}
      </Animated.View>
    </View>
  );
};

const stateFor = (
  record: LevelRecord,
  isNext: boolean,
): 'done' | 'next' | 'locked' => {
  if (record.completed) {
    return 'done';
  }
  return isNext ? 'next' : 'locked';
};

const metaFor = (record: LevelRecord, isNext: boolean) => {
  if (record.completed) {
    const stars =
      record.bestStars === null ? '' : `${starString(record.bestStars)}  `;
    const falls =
      record.fewestFalls === null
        ? ''
        : `  ·  ${fallLabel(record.fewestFalls).toUpperCase()}`;
    return `${stars}BEST ${formatTime(record.bestMs ?? 0)}${falls}`;
  }
  return isNext ? 'NEXT UP' : 'LOCKED';
};

/** The same facts as `metaFor`, phrased for a screen reader. */
const spokenMetaFor = (record: LevelRecord, isNext: boolean) => {
  if (record.completed) {
    const parts = [`best ${formatTime(record.bestMs ?? 0)}`];
    if (record.fewestFalls !== null) {
      parts.push(`fewest ${fallLabel(record.fewestFalls)}`);
    }
    if (record.bestStars !== null) {
      parts.push(`${record.bestStars} of ${MAX_STARS} stars`);
    }
    return parts.join(', ');
  }
  return isNext ? 'next up' : 'locked';
};

export const MapScreen = ({
  progress,
  settings,
  onPlay,
  onOpenSettings,
}: MapScreenProps) => {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const { tilt, calibrate } = useTilt({
    fullTilt: FULL_TILT_FOR[settings.sensitivity],
    invertX: settings.invertX,
    invertY: settings.invertY,
    useSensor: settings.useSensor,
  });
  const smoothTilt = useSmoothTilt(tilt);

  // Zero against however the phone is being held while browsing, so the map
  // sits level rather than slammed to one side.
  useEffect(() => {
    const id = setTimeout(calibrate, 400);
    return () => clearTimeout(id);
  }, [calibrate]);

  const cleared = useMemo(() => completedCount(LEVELS, progress), [progress]);
  const current = useMemo(() => nextLevelIndex(LEVELS, progress), [progress]);
  const allCleared = cleared === LEVELS.length;
  const stars = useMemo(() => totalsFor(LEVELS, progress).stars, [progress]);

  const heroLevel = useMemo(
    () => parseLevel(LEVELS[current], HERO_CELL),
    [current],
  );
  const heroArea = playArea(heroLevel);
  const heroWidth = heroArea.width + HERO_PAD * 2;
  const heroHeight = heroArea.height + HERO_PAD * 2;

  const heroTilt = reduceMotion ? 0 : HERO_TILT;
  const heroTransform = useDerivedValue(() => [
    { perspective: 700 },
    { rotateY: -smoothTilt.value.x * heroTilt },
    { rotateX: smoothTilt.value.y * heroTilt },
  ]);

  const listRef = useRef<FlatList<ListItem>>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const scrolled = useRef(false);
  const topPad = insets.top + 22;

  const onHeaderLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) =>
      setHeaderHeight(e.nativeEvent.layout.height),
    [],
  );

  // Every row has a fixed height, so the position of any row is known exactly once the header is measured.
  const getItemLayout = useCallback(
    (_data: ArrayLike<ListItem> | null | undefined, index: number) => ({
      length: ITEM_HEIGHTS[index],
      offset: topPad + headerHeight + ITEM_OFFSETS[index],
      index,
    }),
    [topPad, headerHeight],
  );

  // Open at the level you are up to, not at the top of a long list.
  useEffect(() => {
    if (headerHeight === 0 || scrolled.current) {
      return;
    }
    scrolled.current = true;
    if (current <= 2) {
      return;
    }
    // Start one level early so the previous level shows above it, and take the world heading with it.
    const from = current - 1;
    const item = LEVEL_ITEM_INDEX[from] - (isWorldStart(from) ? 1 : 0);
    listRef.current?.scrollToIndex({ index: item, animated: false });
  }, [headerHeight, current]);

  const renderRow = ({ item }: ListRenderItemInfo<ListItem>) => {
    if (item.kind === 'world') {
      const stats = worldStats(LEVELS, progress.records, item.world);
      return (
        <View
          style={styles.world}
          accessible
          accessibilityRole="header"
          accessibilityLabel={`World ${item.world + 1}, ${worldName(item.world)}, ${stats.cleared} of ${stats.total} cleared, ${stats.stars} of ${stats.maxStars} stars`}>
          <Text style={styles.worldTitle}>
            WORLD {item.world + 1} · {worldName(item.world).toUpperCase()}
          </Text>
          <Text style={styles.meta}>
            {stats.cleared} OF {stats.total} CLEARED · {stats.stars} OF{' '}
            {stats.maxStars} STARS
          </Text>
        </View>
      );
    }
    const { level, index } = item;
    const record = recordFor(progress, level.id);
    const unlocked = isUnlocked(index, LEVELS, progress);
    const isNext = index === current && !allCleared;

    return (
      <Pressable
        key={level.id}
        disabled={!unlocked}
        accessibilityRole="button"
        accessibilityState={{ disabled: !unlocked }}
        accessibilityLabel={`Level ${index + 1}, ${level.name}, ${spokenMetaFor(record, isNext)}`}
        onPress={() => {
          hapticTap();
          onPlay(index);
        }}
        style={({ pressed }) => [
          styles.row,
          pressed && unlocked && styles.rowPressed,
        ]}>
        <View style={styles.rail}>
          {/* `connectorHidden` comes last: a later style wins, and
                `connectorDim` would otherwise reveal a hidden line. */}
          <View
            style={[
              styles.connector,
              styles.connectorTop,
              !record.completed && styles.connectorDim,
              index === 0 && styles.connectorHidden,
            ]}
          />
          <View
            style={[
              styles.connector,
              styles.connectorBottom,
              !record.completed && styles.connectorDim,
              index === LEVELS.length - 1 && styles.connectorHidden,
            ]}
          />
          <LevelTile tilt={smoothTilt} state={stateFor(record, isNext)} />
        </View>

        <View style={styles.info}>
          <Text
            style={[styles.name, !unlocked && styles.nameLocked]}
            numberOfLines={1}>
            {String(index + 1).padStart(2, '0')} {level.name}
          </Text>
          <Text style={styles.meta}>{metaFor(record, isNext)}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <FlatList
        ref={listRef}
        data={ITEMS}
        keyExtractor={item =>
          item.kind === 'world' ? `world-${item.world}` : item.level.id
        }
        renderItem={renderRow}
        getItemLayout={getItemLayout}
        ListHeaderComponent={
          <View onLayout={onHeaderLayout}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>TILT MAZE</Text>
              <Pressable
                onPress={onOpenSettings}
                hitSlop={16}
                accessibilityRole="button"
                accessibilityLabel="Settings">
                <Text style={styles.settingsLink}>SETTINGS</Text>
              </Pressable>
            </View>

            <Text style={styles.subtitle}>
              {allCleared
                ? `ALL ${LEVELS.length} CLEARED`
                : `${cleared} OF ${LEVELS.length} CLEARED`}
              {`  ·  ${stars} OF ${LEVELS.length * MAX_STARS} STARS`}
            </Text>

            <View style={styles.meter}>
              <View
                style={[styles.meterFill, { flex: Math.max(cleared, 0.0001) }]}
              />
              <View
                style={{ flex: Math.max(LEVELS.length - cleared, 0.0001) }}
              />
            </View>

            {/* The next level as a 3D icon, leaning with the device. */}
            <Pressable
              style={({ pressed }) => [
                styles.hero,
                pressed && styles.rowPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Play ${LEVELS[current].name}, level ${current + 1} of ${LEVELS.length}`}
              onPress={() => {
                hapticTap();
                onPlay(current);
              }}>
              <Canvas style={{ width: heroWidth, height: heroHeight }}>
                <Group
                  origin={vec(heroWidth / 2, heroHeight / 2)}
                  transform={heroTransform}>
                  <Group
                    transform={[
                      { translateX: HERO_PAD - heroArea.x },
                      { translateY: HERO_PAD - heroArea.y },
                    ]}>
                    <Board level={heroLevel} tilt={smoothTilt} />
                  </Group>
                </Group>
              </Canvas>

              <View style={styles.heroText}>
                <Text style={styles.heroEyebrow}>
                  {allCleared ? 'REPLAY' : 'NEXT UP'}
                </Text>
                <Text style={styles.heroTitle}>{LEVELS[current].name}</Text>
                <Text style={styles.heroMeta}>
                  LEVEL {current + 1} OF {LEVELS.length}
                </Text>
                <View style={styles.heroButton}>
                  <Text style={styles.heroButtonLabel}>PLAY</Text>
                </View>
              </View>
            </Pressable>

            <Text style={styles.section}>ALL LEVELS</Text>
          </View>
        }
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
        // Each row carries a small canvas, so only render what is near the screen.
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={7}
        removeClippedSubviews
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black,
  },
  scroll: {
    paddingHorizontal: 28,
  },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 5,
  },
  settingsLink: {
    color: colors.white,
    opacity: alpha.dim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.4,
  },
  subtitle: {
    color: colors.white,
    opacity: alpha.faint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.6,
    marginTop: 10,
  },
  meter: {
    flexDirection: 'row',
    height: 2,
    marginTop: 18,
  },
  meterFill: {
    backgroundColor: colors.white,
  },

  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
    marginTop: 28,
    marginBottom: 6,
  },
  heroText: {
    flex: 1,
    gap: 8,
  },
  heroEyebrow: {
    color: colors.white,
    opacity: alpha.dim,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2.8,
  },
  heroTitle: {
    color: colors.white,
    fontSize: 25,
    fontWeight: '200',
    letterSpacing: 0.4,
  },
  heroMeta: {
    color: colors.white,
    opacity: alpha.faint,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2.2,
  },
  heroButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 26,
    paddingVertical: 11,
    backgroundColor: colors.white,
  },
  heroButtonLabel: {
    color: colors.black,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.4,
  },

  section: {
    color: colors.white,
    opacity: alpha.faint,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2.8,
    marginTop: 30,
    marginBottom: 6,
  },

  world: {
    height: WORLD_ROW_HEIGHT,
    justifyContent: 'flex-end',
    paddingBottom: 10,
    gap: 6,
  },
  worldTitle: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.6,
  },

  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowPressed: {
    opacity: 0.6,
  },

  rail: {
    width: RAIL,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    position: 'absolute',
    width: 1,
    left: RAIL / 2,
    backgroundColor: colors.white,
    opacity: alpha.dim,
  },
  connectorTop: {
    top: 0,
    height: (ROW_HEIGHT - TILE) / 2,
  },
  connectorBottom: {
    bottom: 0,
    height: (ROW_HEIGHT - TILE) / 2,
  },
  connectorDim: {
    opacity: alpha.hairline,
  },
  connectorHidden: {
    opacity: 0,
  },

  tileBox: {
    width: TILE,
    height: TILE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileFootprint: {
    position: 'absolute',
    width: TILE,
    height: TILE,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.white,
    opacity: alpha.dim,
  },
  faint: {
    opacity: alpha.hairline,
  },
  tileFace: {
    width: TILE,
    height: TILE,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileFaceDone: {
    backgroundColor: colors.white,
  },
  tileFaceNext: {
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: colors.black,
  },
  tileFaceLocked: {
    borderWidth: 1,
    borderColor: colors.white,
    opacity: alpha.faint,
    backgroundColor: colors.black,
  },
  tileDot: {
    width: TILE * 0.3,
    height: TILE * 0.3,
    borderRadius: TILE,
    backgroundColor: colors.white,
  },

  info: {
    flex: 1,
    gap: 7,
  },
  name: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '300',
    letterSpacing: 0.4,
  },
  nameLocked: {
    opacity: alpha.faint,
  },
  meta: {
    color: colors.white,
    opacity: alpha.faint,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2.2,
  },
});
