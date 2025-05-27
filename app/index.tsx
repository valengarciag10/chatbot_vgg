import React from 'react';
import { SafeAreaView } from 'react-native';
import AudioRecorder from '../components/AudioRecorder'; 

export default function HomeScreen() {
  return (
    <SafeAreaView style={{ flex: 1, justifyContent: 'center' }}>
      <AudioRecorder />
    </SafeAreaView>
  );
}
