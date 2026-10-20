import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { alpha, colors } from './game/theme';

type Props = {
  children: ReactNode;
  /** Called on TRY AGAIN, so the app can leave the screen that broke instead of rendering it again. */
  onReset?: () => void;
};
type State = { error: Error | null };

/**
 * A render error anywhere below this would otherwise unmount the whole tree and
 * leave a black screen with no way out. Showing the message and a way to retry
 * is the difference between a bug report and a mystery.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    return (
      <View style={styles.root}>
        <Text style={styles.eyebrow}>SOMETHING BROKE</Text>
        <Text style={styles.message}>{error.message}</Text>
        <Pressable
          style={styles.button}
          onPress={() => {
            this.setState({ error: null });
            this.props.onReset?.();
          }}>
          <Text style={styles.buttonLabel}>TRY AGAIN</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 14,
  },
  eyebrow: {
    color: colors.white,
    opacity: alpha.dim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 3,
  },
  message: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '300',
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    marginTop: 18,
    paddingHorizontal: 30,
    paddingVertical: 14,
    backgroundColor: colors.white,
  },
  buttonLabel: {
    color: colors.black,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.4,
  },
});
