import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hapticTap } from '../game/haptics';
import { playCue } from '../game/sound';
import type { Sensitivity, Settings } from '../game/settings';
import { SENSITIVITY_LABEL } from '../game/settings';
import { alpha, colors } from '../game/theme';

type SettingsScreenProps = {
  settings: Settings;
  onChange: (next: Partial<Settings>) => void;
  onResetProgress: () => void;
  onClose: () => void;
  clearedCount: number;
  totalLevels: number;
};

const Toggle = ({
  label,
  hint,
  value,
  onToggle,
}: {
  label: string;
  hint: string;
  value: boolean;
  onToggle: () => void;
}) => (
  <Pressable
    onPress={onToggle}
    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
    <View style={styles.rowText}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowHint}>{hint}</Text>
    </View>
    <View style={[styles.switch, value && styles.switchOn]}>
      <View style={[styles.knob, value && styles.knobOn]} />
    </View>
  </Pressable>
);

const Segmented = ({
  value,
  onSelect,
}: {
  value: Sensitivity;
  onSelect: (next: Sensitivity) => void;
}) => (
  <View style={styles.segmented}>
    {(['gentle', 'normal', 'sharp'] as const).map(option => {
      const active = option === value;
      return (
        <Pressable
          key={option}
          onPress={() => onSelect(option)}
          style={[styles.segment, active && styles.segmentActive]}>
          <Text style={[styles.segmentLabel, active && styles.segmentLabelOn]}>
            {SENSITIVITY_LABEL[option]}
          </Text>
        </Pressable>
      );
    })}
  </View>
);

export const SettingsScreen = ({
  settings,
  onChange,
  onResetProgress,
  onClose,
  clearedCount,
  totalLevels,
}: SettingsScreenProps) => {
  const insets = useSafeAreaInsets();
  const [confirmingReset, setConfirmingReset] = useState(false);

  const toggle = (key: keyof Settings) => () => {
    hapticTap();
    onChange({ [key]: !settings[key] } as Partial<Settings>);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 18 }]}>
        <Pressable onPress={onClose} hitSlop={16}>
          <Text style={styles.back}>‹ BACK</Text>
        </Pressable>
        <Text style={styles.title}>SETTINGS</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + 48 },
        ]}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.section}>FEEDBACK</Text>

        <Toggle
          label="Sound"
          hint="Cues when you fall and when you clear a level"
          value={settings.sound}
          onToggle={() => {
            const next = !settings.sound;
            onChange({ sound: next });
            if (next) {
              // Play after the change so the preview honours the new value.
              setTimeout(() => playCue('tap'), 0);
            }
          }}
        />

        <Toggle
          label="Haptics"
          hint="A tap on impact, a jolt when the marble drops"
          value={settings.haptics}
          onToggle={toggle('haptics')}
        />

        <Text style={styles.section}>CONTROL</Text>

        <Toggle
          label="Motion sensor"
          hint={
            settings.useSensor
              ? 'Tilt the device to roll the marble'
              : 'Off — drag anywhere on screen instead'
          }
          value={settings.useSensor}
          onToggle={toggle('useSensor')}
        />

        <View style={styles.block}>
          <Text style={styles.rowLabel}>Sensitivity</Text>
          <Text style={styles.rowHint}>
            How far you lean for full speed. Sharp needs about 16°, gentle about
            31°.
          </Text>
          <Segmented
            value={settings.sensitivity}
            onSelect={next => {
              hapticTap();
              onChange({ sensitivity: next });
            }}
          />
        </View>

        <Toggle
          label="Invert left / right"
          hint="Use if the marble rolls the opposite way to your lean"
          value={settings.invertX}
          onToggle={toggle('invertX')}
        />

        <Toggle
          label="Invert up / down"
          hint="Use if leaning away sends the marble the wrong way"
          value={settings.invertY}
          onToggle={toggle('invertY')}
        />

        <Text style={styles.section}>PROGRESS</Text>

        <View style={styles.block}>
          <Text style={styles.rowLabel}>
            {clearedCount} of {totalLevels} cleared
          </Text>
          <Text style={styles.rowHint}>
            Best times and completed levels are stored on this device only.
          </Text>

          {confirmingReset ? (
            <View style={styles.confirmRow}>
              <Pressable
                style={styles.danger}
                onPress={() => {
                  hapticTap();
                  onResetProgress();
                  setConfirmingReset(false);
                }}>
                <Text style={styles.dangerLabel}>ERASE EVERYTHING</Text>
              </Pressable>
              <Pressable
                onPress={() => setConfirmingReset(false)}
                hitSlop={12}
                style={styles.cancel}>
                <Text style={styles.cancelLabel}>CANCEL</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={styles.outline}
              onPress={() => setConfirmingReset(true)}>
              <Text style={styles.outlineLabel}>RESET PROGRESS</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black,
  },

  header: {
    paddingHorizontal: 28,
    paddingBottom: 26,
    gap: 16,
  },
  back: {
    color: colors.white,
    opacity: alpha.dim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.4,
  },
  title: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 5,
  },

  body: {
    paddingHorizontal: 28,
  },
  section: {
    color: colors.white,
    opacity: alpha.faint,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2.8,
    marginTop: 26,
    marginBottom: 6,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    gap: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.09)',
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowText: {
    flex: 1,
    gap: 6,
  },
  rowLabel: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '300',
  },
  rowHint: {
    color: colors.white,
    opacity: alpha.faint,
    fontSize: 12,
    lineHeight: 17,
  },

  switch: {
    width: 46,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.white,
    opacity: alpha.dim,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  switchOn: {
    opacity: 1,
    backgroundColor: colors.white,
  },
  knob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.white,
  },
  knobOn: {
    backgroundColor: colors.black,
    alignSelf: 'flex-end',
  },

  block: {
    paddingVertical: 18,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.09)',
  },

  segmented: {
    flexDirection: 'row',
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  segment: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: colors.white,
  },
  segmentLabel: {
    color: colors.white,
    opacity: alpha.dim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  segmentLabelOn: {
    color: colors.black,
    opacity: 1,
  },

  outline: {
    marginTop: 14,
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.white,
  },
  outlineLabel: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
  },
  confirmRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  danger: {
    paddingHorizontal: 20,
    paddingVertical: 11,
    backgroundColor: colors.white,
  },
  dangerLabel: {
    color: colors.black,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
  },
  cancel: {
    paddingVertical: 11,
  },
  cancelLabel: {
    color: colors.white,
    opacity: alpha.dim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
  },
});
