import React from 'react';
import {StyleSheet, View} from 'react-native';
import {colors} from './theme';

type Name = 'settings' | 'history' | 'scan' | 'clear' | 'back' | 'refresh';
export function Icon({name}: {name: Name}) {
  return <View pointerEvents="none" accessible={false} style={s.root}>
    {name === 'settings' && <>
      {[0, 45, 90, 135].map(angle => <View key={angle} style={[s.teeth, {transform: [{rotate: `${angle}deg`}]}]} />)}
      <View style={s.gear} /><View style={s.hub} />
    </>}
    {(name === 'history' || name === 'refresh') && <>
      <View style={[s.clock, name === 'refresh' && {borderLeftColor: 'transparent'}]} />
      {name === 'history' ? <><View style={s.hour} /><View style={s.minute} /></> : <View style={s.arrow} />}
    </>}
    {name === 'scan' && <>
      {[0, 90, 180, 270].map(angle => <View key={angle} style={[s.root, s.absolute, {transform: [{rotate: `${angle}deg`}]}]}><View style={s.corner} /></View>)}
      <View style={s.scanLine} />
    </>}
    {name === 'clear' && <><View style={s.bin} /><View style={s.lid} /><View style={s.handle} /><View style={[s.binLine, {left: 9}]} /><View style={[s.binLine, {left: 13}]} /></>}
    {name === 'back' && <View style={s.back} />}
  </View>;
}
const color = colors.secondary;
const s = StyleSheet.create({
  root: {width: 24, height: 24, alignItems: 'center', justifyContent: 'center'},
  absolute: {position: 'absolute'},
  teeth: {position: 'absolute', width: 6, height: 22, borderRadius: 1, backgroundColor: color},
  gear: {position: 'absolute', width: 17, height: 17, borderRadius: 9, backgroundColor: colors.background, borderWidth: 2, borderColor: color},
  hub: {width: 6, height: 6, borderRadius: 3, borderWidth: 1.5, borderColor: color},
  clock: {position: 'absolute', width: 19, height: 19, borderRadius: 10, borderWidth: 1.7, borderColor: color},
  hour: {position: 'absolute', width: 1.7, height: 6, top: 6, left: 11, backgroundColor: color},
  minute: {position: 'absolute', width: 6, height: 1.7, top: 11, left: 11, backgroundColor: color},
  arrow: {position: 'absolute', left: 2, top: 3, width: 7, height: 7, borderLeftWidth: 1.7, borderBottomWidth: 1.7, borderColor: color},
  corner: {position: 'absolute', top: 3, left: 3, width: 6, height: 6, borderLeftWidth: 1.7, borderTopWidth: 1.7, borderColor: color},
  scanLine: {width: 12, height: 1.7, backgroundColor: color},
  bin: {position: 'absolute', left: 6, top: 8, width: 12, height: 13, borderWidth: 1.7, borderTopWidth: 0, borderRadius: 2, borderColor: color},
  lid: {position: 'absolute', left: 4, top: 5, width: 16, height: 1.7, backgroundColor: color},
  handle: {position: 'absolute', left: 9, top: 2, width: 6, height: 4, borderWidth: 1.7, borderColor: color, borderRadius: 1},
  binLine: {position: 'absolute', top: 10, width: 1.5, height: 7, backgroundColor: color},
  back: {width: 9, height: 9, borderLeftWidth: 1.7, borderBottomWidth: 1.7, borderColor: color, transform: [{rotate: '45deg'}]},
});
