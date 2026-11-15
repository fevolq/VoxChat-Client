import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

export function HomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>VoxChat</Text>
        <Text style={styles.subtitle}>DSH 语音交互客户端</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>客户端框架已就绪</Text>
          <Text style={styles.cardText}>协议版本 v2</Text>
          <Text style={styles.cardText}>Android / iOS / 平板共用业务核心</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: '#f7f8fa'},
  container: {flex: 1, justifyContent: 'center', padding: 24},
  title: {fontSize: 32, fontWeight: '700', color: '#172033'},
  subtitle: {marginTop: 8, fontSize: 16, color: '#5d687a'},
  card: {marginTop: 28, padding: 20, borderRadius: 16, backgroundColor: '#ffffff'},
  cardTitle: {fontSize: 18, fontWeight: '600', color: '#172033'},
  cardText: {marginTop: 8, fontSize: 14, color: '#5d687a'},
});
