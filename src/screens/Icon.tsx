import React from 'react';
import {StyleSheet, View} from 'react-native';
import {colors} from './theme';

type Name = 'settings' | 'history' | 'scan' | 'disconnect' | 'back' | 'refresh';
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
    {name === 'disconnect' && <View style={s.unplug}>
      <View style={[s.cord, {top: 0}]} /><View style={s.socket} />
      <View style={[s.prong, {left: 9}]} /><View style={[s.prong, {left: 13.3}]} />
      <View style={s.plug} /><View style={[s.cord, {top: 21}]} />
    </View>}
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
  unplug: {width: 24, height: 24, transform: [{rotate: '45deg'}]},
  cord: {position: 'absolute', left: 11.15, width: 1.7, height: 3, borderRadius: 1, backgroundColor: color},
  socket: {position: 'absolute', left: 7, top: 3, width: 10, height: 6, borderWidth: 1.7, borderColor: color, borderTopLeftRadius: 3, borderTopRightRadius: 3, borderBottomLeftRadius: 1, borderBottomRightRadius: 1},
  prong: {position: 'absolute', top: 11, width: 1.7, height: 5, borderRadius: 1, backgroundColor: color},
  plug: {position: 'absolute', left: 7, top: 15, width: 10, height: 6, borderWidth: 1.7, borderColor: color, borderTopLeftRadius: 1, borderTopRightRadius: 1, borderBottomLeftRadius: 3, borderBottomRightRadius: 3},
  back: {width: 9, height: 9, borderLeftWidth: 1.7, borderBottomWidth: 1.7, borderColor: color, transform: [{rotate: '45deg'}]},
});
