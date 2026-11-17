import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View, useWindowDimensions} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {historyRows, sessionTitle} from '../core/api/presentation';
import {useConversation, type Stage} from './useConversation';
import {styles as s} from './styles';
import {Icon} from './Icon';
import {colors} from './theme';
import {Dropdown} from './Dropdown';

const labels: Record<Stage, string> = {idle: '准备好听你说', stopping: '正在停止', starting: '正在打开麦克风', recording: '正在聆听', uploading: '正在发送', asr: '正在识别你的话', dsh: '正在思考与处理', summary: '正在整理回复', tts: '正在准备语音', playing: '正在为你播报'};
function Sheet({visible, title, children, close, headerAction}: {visible: boolean; title: string; children: React.ReactNode; close: () => void; headerAction?: React.ReactNode}) {
  return <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="fullScreen"><SafeAreaView style={s.sheet}><KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={s.sheetHeader}>
    <View style={s.sheetHeading}><Pressable accessibilityLabel="返回" accessibilityRole="button" onPress={close} style={s.back}><Icon name="back" /></Pressable><Text maxFontSizeMultiplier={1.2} style={s.sheetTitle}>{title}</Text></View>
    {headerAction}
  </View>{children}</KeyboardAvoidingView></SafeAreaView></Modal>;
}
export function HomeScreen() {
  const c = useConversation();
  const {height, width} = useWindowDimensions();
  const compact = height < 640;
  const [assistantHeight, setAssistantHeight] = useState(0);
  const avatarSize = Math.min(width * 0.38, height * 0.23, assistantHeight ? Math.max(28, (assistantHeight - 32) / 1.5) : 184, 184);
  const [detail, setDetail] = useState<{title: string; text: string} | null>(null);
  const [focusedInput, setFocusedInput] = useState<'server' | 'code' | null>(null);
  const [openDropdown, setOpenDropdown] = useState<'workspace' | 'session' | 'voice' | null>(null);
  useEffect(() => { setOpenDropdown(null); }, [c.settings, c.credentials, c.selection.workspaceId]);
  const selectOption = (kind: 'workspace' | 'session' | 'voice', id: string) => { setOpenDropdown(null); void c.choose(kind, id); };
  const connected = c.connection === 'connected';
  const talkDisabled = !connected || c.pending;
  const current = useRef(c); current.current = c;
  const pulse = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(false);
  const active = c.stage !== 'idle';
  const assistantActive = ['uploading', 'asr', 'dsh', 'summary', 'tts', 'playing'].includes(c.stage);
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, {toValue: 1, duration: c.stage === 'playing' ? 650 : 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true}),
      Animated.timing(pulse, {toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true}),
    ]));
    if (assistantActive) animation.start(); else pulse.setValue(0);
    return () => animation.stop();
  }, [assistantActive, c.stage, pulse]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const gesture = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => Boolean(current.current.connection === 'connected' && current.current.credentials && current.current.view && !current.current.pending),
    onMoveShouldSetPanResponder: () => Boolean(current.current.connection === 'connected' && current.current.credentials && current.current.view && !current.current.pending),
    onPanResponderGrant: () => {
      started.current = false;
      if (current.current.connection !== 'connected' || !current.current.credentials || !current.current.view || current.current.pending) return;
      if (current.current.continuous || current.current.stage !== 'idle') { current.current.stop(); return; }
      timer.current = setTimeout(() => {
        if (current.current.connection !== 'connected' || !current.current.credentials || !current.current.view || current.current.pending) return;
        started.current = true; current.current.press();
      }, 180);
    },
    onPanResponderMove: (_, state) => {
      if (!timer.current && !started.current) return;
      lift.setValue(Math.max(-85, Math.min(0, state.dy)));
      if (state.dy < -64) {
        if (timer.current) clearTimeout(timer.current); timer.current = null;
        if (!started.current) { started.current = true; current.current.press(); }
        current.current.lock();
      }
    },
    onPanResponderRelease: () => {
      if (timer.current) clearTimeout(timer.current); timer.current = null;
      Animated.spring(lift, {toValue: 0, useNativeDriver: true}).start();
      if (started.current) current.current.release(); started.current = false;
    },
    onPanResponderTerminate: () => {
      if (timer.current) clearTimeout(timer.current); timer.current = null;
      lift.setValue(0); current.current.stop(); started.current = false;
    },
    onPanResponderTerminationRequest: () => false,
  })).current;
  const busy = c.pending || active;
  const rows = historyRows(c.history?.items ?? []);
  const errorNotice = <>{c.error ? <Text accessibilityRole="alert" style={s.error}>{c.error}</Text> : null}{c.notice ? <Text style={s.notice}>{c.notice}</Text> : null}</>;
  return <SafeAreaView style={s.root}>
    <View style={s.header}>
      <Pressable accessibilityLabel="设置" accessibilityRole="button" onPress={c.openSettings} style={s.nav}><Icon name="settings" /></Pressable>
      {!connected && <Text accessibilityLiveRegion="polite" numberOfLines={1} style={[s.connectionLabel, c.connection === 'connecting' && s.connectingLabel]}>{c.connection === 'connecting' ? '正在连接' : c.connection === 'unpaired' ? '未配对' : '连接失败'}</Text>}
      <Pressable accessibilityLabel="当前会话历史" accessibilityRole="button" onPress={c.openHistory} style={s.nav}><Icon name="history" /></Pressable>
    </View>
    <View style={s.assistantStage}>
      {c.speech ? <Pressable accessibilityRole="button" accessibilityLabel="查看完整播报文字" onPress={() => setDetail({title: '助手回复', text: c.speech})} style={s.speechArea}>
        <View style={s.speechBubble}><Text numberOfLines={compact ? 2 : 4} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={s.speechText}>{c.speech}</Text></View>
      </Pressable> : null}
      <View onLayout={event => setAssistantHeight(event.nativeEvent.layout.height)} accessible accessibilityLabel={labels[c.stage]} accessibilityLiveRegion="polite" style={s.assistant}>
        <View style={[s.avatarScene, {width: avatarSize * 1.5, height: avatarSize * 1.5}]}>
          <Animated.View style={[s.halo, {width: avatarSize * 1.4, height: avatarSize * 1.4, borderRadius: avatarSize, opacity: pulse.interpolate({inputRange: [0, 1], outputRange: [0.13, 0.38]}), transform: [{scale: pulse.interpolate({inputRange: [0, 1], outputRange: [1, 1.1]})}]}]} />
          <Animated.View style={[s.avatar, {width: avatarSize, height: avatarSize * 0.88, borderRadius: avatarSize * 0.3, transform: [{translateY: pulse.interpolate({inputRange: [0, 1], outputRange: [0, -7]})}]}]}>
            <View style={[s.eyes, {gap: avatarSize * 0.24}]}><View style={s.eye} /><View style={s.eye} /></View><View style={s.mouth} />
          </Animated.View>
        </View>
        {assistantActive && <View style={s.wave}>{[0.45, 0.8, 1, 0.65, 0.9, 0.5, 0.75].map((barHeight, i) => <Animated.View key={i} style={[s.bar, {height: 6 + barHeight * 18, transform: [{scaleY: pulse.interpolate({inputRange: [0, 1], outputRange: [0.35 + (i % 3) * 0.12, 1]})}]}]} />)}</View>}
      </View>
    </View>
    <View style={[s.footer, compact && s.compactFooter]}>
      {c.transcript ? <Pressable accessibilityRole="button" accessibilityLabel="查看完整识别文字" onPress={() => setDetail({title: '识别文字', text: c.transcript})} style={s.transcriptArea}><Text numberOfLines={compact ? 1 : 2} maxFontSizeMultiplier={1.3} ellipsizeMode="tail" style={s.transcript}>{c.transcript}</Text></Pressable> : null}
      {connected && c.error ? <Pressable accessibilityRole="button" accessibilityLabel="查看错误详情" onPress={() => setDetail({title: '提示', text: c.error})}><Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={s.homeError}>{c.error}</Text></Pressable> : null}
      <Animated.View {...gesture.panHandlers} accessibilityRole="button" accessibilityState={{disabled: talkDisabled}} accessibilityLabel={c.continuous ? '停止持续监听' : '按住说话，上滑持续监听'} accessibilityHint="上滑持续监听，再次点按停止" accessibilityActions={talkDisabled ? [] : [{name: 'activate', label: '切换持续监听'}]} onAccessibilityAction={() => { if (talkDisabled) return; if (active || c.continuous) c.stop(); else { c.press(); c.lock(); } }} style={[s.talkButton, (c.continuous || c.stage === 'recording') && s.recordingButton, talkDisabled && s.disabled, {transform: [{translateY: lift}]}]}>
        <Text maxFontSizeMultiplier={1.2} style={s.mic}>{active && c.stage !== 'recording' && c.stage !== 'starting' ? '■' : '●'}</Text><Text maxFontSizeMultiplier={1.2} style={s.talkText}>{c.continuous ? '持续监听' : c.stage === 'recording' ? '松手发送' : active ? '停止本轮' : '按住说话'}</Text>
      </Animated.View>
    </View>
    <Sheet visible={detail !== null} title={detail?.title ?? ''} close={() => setDetail(null)}><ScrollView contentContainerStyle={s.sheetContent}><Text selectable style={s.historyText}>{detail?.text}</Text></ScrollView></Sheet>
    <Sheet visible={c.settings} title="设置" close={() => c.setSettings(false)} headerAction={<Pressable accessibilityRole="button" accessibilityLabel={c.credentials ? "断开连接并清除配对信息" : "扫描配对二维码"} accessibilityState={{disabled: busy}} disabled={busy} onPress={() => void (c.credentials ? c.disconnect() : c.scan())} style={({pressed}) => [s.scanButton, busy && s.disabled, pressed && s.pressed]}><Icon name={c.credentials ? "disconnect" : "scan"} /></Pressable>}>
      <ScrollView style={s.flex} contentContainerStyle={s.sheetContent} keyboardShouldPersistTaps="handled" refreshControl={c.credentials && !openDropdown ? <RefreshControl refreshing={c.pending} enabled={!busy || c.pending} onRefresh={() => void c.refresh()} colors={[colors.accent]} tintColor={colors.accent} progressBackgroundColor={colors.surface} /> : undefined}>
        {!c.credentials ? <>
        <Text style={s.section}>设备连接</Text><Text style={s.help}>扫描二维码，或输入地址和配对码。</Text>
        <TextInput accessibilityLabel="DSH 访问地址或配对链接" editable={!c.pending} value={c.server} onChangeText={c.setServer} placeholder="https://..." placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" onFocus={() => setFocusedInput('server')} onBlur={() => setFocusedInput(null)} style={[s.input, focusedInput === 'server' && s.inputFocused]} />
        <TextInput accessibilityLabel="六位配对码" editable={!c.pending} value={c.code} onChangeText={c.setCode} placeholder="6 位配对码" placeholderTextColor={colors.muted} autoCapitalize="characters" autoCorrect={false} maxLength={6} onFocus={() => setFocusedInput('code')} onBlur={() => setFocusedInput(null)} style={[s.input, focusedInput === 'code' && s.inputFocused]} />
        <View style={s.actions}><Pressable accessibilityRole="button" accessibilityState={{disabled: busy}} disabled={busy} onPress={() => void c.pair()} style={({pressed}) => [s.option, s.primaryAction, busy && s.disabled, pressed && s.pressed]}><Text style={[s.optionText, s.primaryActionText]}>连接</Text></Pressable></View>
        </> : <>
        <Text style={s.section}>工作区</Text>
        <Dropdown label="工作区" value={c.selection.workspaceId} options={(c.view?.workspaces ?? []).map(item => ({id: item.id, label: item.title || item.path}))} placeholder={c.view?.workspaces.length ? '选择工作区' : '暂无可用工作区'} disabled={busy} expanded={openDropdown === 'workspace'} onToggle={() => setOpenDropdown(openDropdown === 'workspace' ? null : 'workspace')} onSelect={id => selectOption('workspace', id)} />
        <View style={s.sectionRow}><Text style={[s.section, s.sectionInRow]}>会话</Text><Pressable accessibilityRole="button" accessibilityLabel="新会话" accessibilityState={{disabled: busy || !c.selection.workspaceId}} disabled={busy || !c.selection.workspaceId} onPress={() => { setOpenDropdown(null); void c.choose('new'); }} style={({pressed}) => [s.newSession, (busy || !c.selection.workspaceId) && s.disabled, pressed && s.pressed]}><Text style={s.historyActionText}>＋ 新会话</Text></Pressable></View>
        <Dropdown label="会话" value={c.selection.sessionId} options={c.sessions.map(item => ({id: item.sessionId, label: sessionTitle(item)}))} placeholder={!c.selection.workspaceId ? '请先选择工作区' : '新会话'} disabled={busy || !c.selection.workspaceId} expanded={openDropdown === 'session'} onToggle={() => setOpenDropdown(openDropdown === 'session' ? null : 'session')} onSelect={id => selectOption('session', id)} />
        <Text style={s.section}>使用的音色</Text>
        <Dropdown label="使用的音色" value={c.selection.voiceId ?? ''} options={[{id: '', label: '默认音色'}, ...(c.view?.voices ?? []).map(item => ({id: item.id, label: item.name}))]} placeholder="默认音色" disabled={busy} expanded={openDropdown === 'voice'} onToggle={() => setOpenDropdown(openDropdown === 'voice' ? null : 'voice')} onSelect={id => selectOption('voice', id)} />

        </>}
        {errorNotice}{c.pending && !c.credentials && <ActivityIndicator size="small" color={colors.accent} style={s.loader} />}
      </ScrollView>
      {c.credentials && <Pressable accessibilityRole="button" accessibilityLabel="复制当前配对地址" accessibilityHint={c.credentials.server} disabled={busy} onPress={() => void c.copyAddress()} style={({pressed}) => [s.pairedAddressArea, pressed && s.pressed]}><Text style={s.pairedAddress}>{c.credentials.server}</Text></Pressable>}
      {c.copied && <View pointerEvents="none" style={s.toastPosition}><View style={s.toast}><Text accessibilityLiveRegion="polite" style={s.toastText}>已复制</Text></View></View>}
    </Sheet>
    <Sheet visible={c.historyOpen} title="会话历史" close={() => c.setHistoryOpen(false)} headerAction={<Pressable accessibilityRole="button" accessibilityLabel="刷新当前会话历史" accessibilityState={{disabled: c.pending || !c.selection.sessionId}} disabled={c.pending || !c.selection.sessionId} onPress={() => void c.loadHistory()} style={({pressed}) => [s.historyAction, (c.pending || !c.selection.sessionId) && s.disabled, pressed && s.pressed]}><Icon name="refresh" /></Pressable>}>
      <ScrollView contentContainerStyle={s.sheetContent}>
        {c.history?.hasMore && <Pressable accessibilityRole="button" accessibilityState={{disabled: c.pending}} disabled={c.pending} onPress={() => void c.loadHistory(true)} style={({pressed}) => [s.olderHistory, c.pending && s.disabled, pressed && s.pressed]}><Text style={s.historyActionText}>加载更早记录</Text></Pressable>}
        {c.pending && <ActivityIndicator color={colors.accent} style={s.loader} />}{c.error ? <Text style={s.error}>{c.error}</Text> : null}
        {!rows.length && !c.pending && <Text style={s.empty}>{c.selection.sessionId ? '暂无对话记录' : '暂无对话记录，开始说话后创建新会话'}</Text>}
        {rows.map(row => <View key={row.key} style={[s.historyItem, row.role === '你' && s.userItem]}><Text style={s.historyRole}>{row.role}</Text><Text selectable style={s.historyText}>{row.text}</Text></View>)}
      </ScrollView>
    </Sheet>
  </SafeAreaView>;
}
