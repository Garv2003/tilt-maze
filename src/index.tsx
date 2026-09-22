import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { ErrorBoundary } from './error-boundary';
import { LEVELS } from './game/levels';
import type { Progress } from './game/progress';
import {
  clearProgress,
  completedCount,
  emptyProgress,
  loadProgress,
  recordFor,
  saveProgress,
  withCompletion,
} from './game/progress';
import type { Settings } from './game/settings';
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  setCurrentSettings,
} from './game/settings';
import { colors } from './game/theme';
import { GameScreen } from './screens/game-screen';
import { MapScreen } from './screens/map-screen';
import { SettingsScreen } from './screens/settings-screen';

type Screen =
  { name: 'map' } | { name: 'settings' } | { name: 'game'; levelIndex: number };

const App = () => {
  const [screen, setScreen] = useState<Screen>({ name: 'map' });
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;

    Promise.all([loadProgress(), loadSettings()]).then(
      ([storedProgress, storedSettings]) => {
        if (!alive) {
          return;
        }
        setProgress(storedProgress);
        setSettings(storedSettings);
        setCurrentSettings(storedSettings);
        setReady(true);
      },
    );

    return () => {
      alive = false;
    };
  }, []);

  const changeSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(current => {
      const next = { ...current, ...patch };
      // Mirror immediately so sound and haptics fired from callbacks and
      // worklet bridges see the new value without waiting for a re-render.
      setCurrentSettings(next);
      saveSettings(next);
      return next;
    });
  }, []);

  const handleComplete = useCallback(
    (levelId: string, ms: number, falls: number) => {
      setProgress(current => {
        const updated = withCompletion(current, levelId, ms, falls);
        saveProgress(updated);
        return updated;
      });
    },
    [],
  );

  const handleAdvance = useCallback(() => {
    setScreen(current =>
      current.name === 'game'
        ? {
            name: 'game',
            levelIndex: Math.min(current.levelIndex + 1, LEVELS.length - 1),
          }
        : current,
    );
  }, []);

  const handleResetProgress = useCallback(() => {
    clearProgress();
    setProgress(emptyProgress());
  }, []);

  const showMap = useCallback(() => setScreen({ name: 'map' }), []);

  // Holding the first frame until storage answers avoids a flash where
  // everything looks locked and then pops into place.
  if (!ready) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <GestureHandlerRootView style={styles.root}>
        <StatusBar style="light" />
        <ErrorBoundary>
          {screen.name === 'map' ? (
            <MapScreen
              progress={progress}
              settings={settings}
              onPlay={index => setScreen({ name: 'game', levelIndex: index })}
              onOpenSettings={() => setScreen({ name: 'settings' })}
            />
          ) : null}

          {screen.name === 'settings' ? (
            <SettingsScreen
              settings={settings}
              onChange={changeSettings}
              onResetProgress={handleResetProgress}
              onClose={showMap}
              clearedCount={completedCount(LEVELS, progress)}
              totalLevels={LEVELS.length}
            />
          ) : null}

          {screen.name === 'game' ? (
            <GameScreen
              levelIndex={screen.levelIndex}
              settings={settings}
              bestMs={recordFor(progress, LEVELS[screen.levelIndex].id).bestMs}
              onExit={showMap}
              onComplete={handleComplete}
              onAdvance={handleAdvance}
            />
          ) : null}
        </ErrorBoundary>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black,
  },
});

export { App };
