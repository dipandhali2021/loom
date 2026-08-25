import React from 'react';
import { Stack } from 'expo-router';

export default function VoiceLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />;
}
