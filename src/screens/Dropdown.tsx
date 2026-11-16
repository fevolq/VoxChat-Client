import React, {useEffect, useRef, useState} from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {colors} from './theme';

interface Props {
  label: string;
  value?: string | null;
  options: {id: string; label: string}[];
  placeholder: string;
  disabled: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
}

export function Dropdown({label, value, options, placeholder, disabled, expanded, onToggle, onSelect}: Props) {
  const field = useRef<React.ComponentRef<typeof View>>(null);
  const overlay = useRef<React.ComponentRef<typeof View>>(null);
  const [position, setPosition] = useState<{left: number; width: number; top?: number; bottom?: number; maxHeight: number} | null>(null);
  useEffect(() => { if (!expanded) setPosition(null); }, [expanded]);
  function measure() {
    overlay.current?.measureInWindow((ox, oy, width, height) => {
      field.current?.measureInWindow((x, y, fieldWidth, fieldHeight) => {
        const top = y - oy;
        const below = Math.max(0, height - top - fieldHeight - 12);
        const above = Math.max(0, top - 12);
        const desired = Math.min(180, height * 0.3, options.length * 56 + 2);
        const upwards = below < desired && above > below;
        setPosition({
          left: Math.max(8, Math.min(x - ox, width - fieldWidth - 8)),
          width: Math.min(fieldWidth, width - 16),
          ...(upwards ? {bottom: height - top + 4} : {top: top + fieldHeight + 4}),
          maxHeight: Math.min(desired, upwards ? above : below),
        });
      });
    });
  }
  const selected = options.find(option => option.id === value);
  const unavailable = disabled || options.length === 0;
  return <View ref={field} collapsable={false}>
    <Pressable accessibilityRole="combobox" accessibilityLabel={label} accessibilityValue={{text: selected?.label ?? placeholder}} accessibilityState={{disabled: unavailable, expanded}} disabled={unavailable} onPress={onToggle} style={({pressed}) => [s.field, expanded && s.focused, unavailable && s.disabled, pressed && s.pressed]}>
      <Text numberOfLines={1} style={[s.text, !selected && s.placeholder]}>{selected?.label ?? placeholder}</Text>
      <View style={[s.arrow, expanded && s.arrowUp]} />
    </Pressable>
    <Modal transparent visible={expanded && !unavailable} animationType="none" onRequestClose={onToggle} onShow={measure}>
      <View ref={overlay} collapsable={false} style={s.overlay} onLayout={measure}>
        <Pressable accessibilityRole="button" accessibilityLabel="收起选项" onPress={onToggle} style={StyleSheet.absoluteFill} />
        {position && <ScrollView keyboardShouldPersistTaps="handled" style={[s.menu, position]}>
      {options.map(option => <Pressable key={option.id} accessibilityRole="button" accessibilityLabel={option.label} accessibilityState={{selected: option.id === value}} onPress={() => onSelect(option.id)} style={({pressed}) => [s.option, option.id === value && s.selected, pressed && s.pressed]}>
        <Text numberOfLines={2} style={s.text}>{option.label}</Text>
        {option.id === value && <Text style={s.check}>✓</Text>}
      </Pressable>)}
        </ScrollView>}
      </View>
    </Modal>
  </View>;
}

const s = StyleSheet.create({
  field: {minHeight: 40, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12},
  focused: {borderColor: colors.accent},
  text: {fontSize: 11, lineHeight: 17, color: colors.text, flex: 1},
  placeholder: {color: colors.muted},
  arrow: {width: 6, height: 6, borderBottomWidth: 1.5, borderRightWidth: 1.5, borderColor: colors.secondary, transform: [{rotate: '45deg'}], marginRight: 2, marginBottom: 3},
  arrowUp: {transform: [{rotate: '225deg'}], marginBottom: 0, marginTop: 3},
  overlay: {flex: 1},
  menu: {position: 'absolute', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface, elevation: 8, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: {width: 0, height: 4}},
  option: {minHeight: 40, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12},
  selected: {backgroundColor: colors.selected},
  check: {fontSize: 11, color: colors.accent},
  disabled: {opacity: 0.5}, pressed: {opacity: 0.7},
});
