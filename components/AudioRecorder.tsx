import React, { useState, useRef, useEffect } from 'react'; // Añadido useEffect
import { View, Button, Text, Alert, Platform } from 'react-native'; // Añadido Platform
import { Audio } from 'expo-av';

// --- CONFIGURACIÓN DEL SERVIDOR ---
const SERVER_IP = "192.168.15.100"; 
const SERVER_PORT = "5000";
const SERVER_URL_UPLOAD = `http://${SERVER_IP}:${SERVER_PORT}/upload`;
// ---------------------------------

// Interfaz para la respuesta esperada del servidor
interface ServerResponse {
  mensaje?: string;
  respuesta_audio_url?: string; // Solo nos interesa esta por ahora para el audio
}

const AudioRecorder = () => {
  const [isRecording, setIsRecording] = useState(false); // Usaremos este estado para el botón
  const [audioUri, setAudioUri] = useState<string | null>(null); // Para el URI del audio grabado
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundObjectRef = useRef<Audio.Sound | null>(null); // Para controlar el audio de respuesta

  // Limpieza: Descargar el objeto de sonido cuando el componente se desmonta
  useEffect(() => {
    return () => {
      soundObjectRef.current?.unloadAsync();
    };
  }, []);

  // Iniciar grabación
  const startRecording = async () => {
    setIsRecording(true);
    // Detener y descargar cualquier audio de respuesta que pudiera estar sonando
    await soundObjectRef.current?.stopAsync();
    await soundObjectRef.current?.unloadAsync();
    soundObjectRef.current = null;

    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Permiso denegado", "Necesitamos acceso al micrófono para grabar.");
        setIsRecording(false);
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true, // Importante para que el audio de respuesta se reproduzca
        // interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX, // Opcional
        // interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX, // Opcional
      });

      console.log("CLIENTE LOG: Iniciando grabación...");
      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(Audio.RECORDING_OPTIONS_PRESET_HIGH_QUALITY);
      await newRecording.startAsync();

      recordingRef.current = newRecording;
    } catch (err) {
      console.error("CLIENTE ERROR: Error al iniciar grabación", err);
      Alert.alert("Error", "No se pudo iniciar la grabación.");
      setIsRecording(false);
    }
  };

  // Detener grabación y enviar al servidor
  const stopRecordingAndSend = async () => {
    if (!recordingRef.current) return;
    console.log("CLIENTE LOG: Deteniendo grabación...");
    setIsRecording(false);

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null; // Limpiar referencia

      setAudioUri(uri); // Mantienes esto para tu <Text> actual

      if (uri) {
        console.log("CLIENTE LOG: Audio del usuario guardado en:", uri);
        await sendAudioToServer(uri); // Llamar a enviar al servidor
      } else {
        console.error("CLIENTE ERROR: No se pudo obtener la URI del audio grabado.");
        Alert.alert("Error", "No se pudo obtener el audio grabado.");
      }
    } catch (err) {
      console.error("CLIENTE ERROR: Error al detener la grabación", err);
      Alert.alert("Error", "No se pudo detener la grabación.");
    }
  };

  // Enviar el audio al servidor
  const sendAudioToServer = async (uri: string | null) => {
    if (!uri) return;
    console.log("CLIENTE LOG: Enviando audio al servidor...");

    const formData = new FormData();
    // Corrección para nombre de archivo y tipo MIME más robusto
    const filename = uri.split('/').pop() || `audio-${Date.now()}.m4a`;
    let type;

    if (filename.endsWith('.wav')) {
      type = 'audio/wav';
    } else if (filename.endsWith('.mp3')) {
      type = 'audio/mpeg';
    } else if (filename.endsWith('.m4a')) {
      type = 'audio/mp4'; // m4a es parte de mp4
    } else if (filename.endsWith('.aac')) {
      type = 'audio/aac';
    } else if (filename.endsWith('.3gp')) {
      type = 'audio/3gpp';
    } else if (filename.endsWith('.opus')) {
      type = 'audio/opus';
    } else {
      type = 'application/octet-stream'; // por si no se reconoce
    }


    formData.append("file", {
      uri: Platform.OS === "android" ? uri : uri.replace("file://", ""), // Corrección común para iOS URI
      name: filename,
      type: type,
    } as any);

    try {
      const response = await fetch(SERVER_URL_UPLOAD, {
        method: "POST",
        body: formData,
        // NO establecer 'Content-Type': 'multipart/form-data' aquí, fetch lo maneja.
      });

      const result: ServerResponse = await response.json(); // Especificar el tipo de resultado
      console.log("CLIENTE LOG: Respuesta del servidor recibida:", JSON.stringify(result, null, 2));

      if (response.ok && result) {
        Alert.alert("Servidor", result.mensaje || "Audio procesado correctamente"); // Mensaje al usuario

        // --- LÓGICA PARA REPRODUCIR AUDIO DE RESPUESTA ---
        const partialAudioUrl = result.respuesta_audio_url;
        if (partialAudioUrl) {
          const fullAudioUrl = `http://${SERVER_IP}:${SERVER_PORT}${partialAudioUrl}`;
          console.log("CLIENTE LOG: URL completa construida para audio:", fullAudioUrl);
          await playAudioResponse(fullAudioUrl);
        } else {
          console.log("CLIENTE LOG: No se recibió respuesta_audio_url del servidor.");
        }
        // --------------------------------------------------

      } else {
        console.error("CLIENTE ERROR: Respuesta no OK del servidor o resultado inválido:", result);
        Alert.alert("Error del Servidor", result.error || result.mensaje || "Ocurrió un error en el servidor.");
      }
    } catch (err: any) {
      console.error("CLIENTE ERROR: Error en fetch o al procesar la respuesta:", err);
      Alert.alert("Error de Comunicación", `No se pudo conectar o procesar la respuesta: ${err.message}`);
    }
  };

  // Nueva función para reproducir el audio de respuesta
  const playAudioResponse = async (audioUriToPlay: string) => {
    console.log("CLIENTE LOG: Intentando reproducir audio desde:", audioUriToPlay);
    try {
      // Descargar cualquier sonido previo que estuviera cargado para la respuesta
      if (soundObjectRef.current) {
        console.log("CLIENTE LOG: Descargando sonido previo de respuesta...");
        await soundObjectRef.current.unloadAsync();
        soundObjectRef.current = null;
      }

      console.log("CLIENTE LOG: Llamando a Audio.Sound.createAsync...");
      const { sound, status } = await Audio.Sound.createAsync(
        { uri: audioUriToPlay },
        { shouldPlay: true }
      );
      soundObjectRef.current = sound; // Guardar referencia al nuevo sonido
      console.log("CLIENTE LOG: Sonido cargado por createAsync. Estado inicial:", JSON.stringify(status, null, 2));

      sound.setOnPlaybackStatusUpdate((playbackStatus) => {
        if (!playbackStatus.isLoaded) {
          if (playbackStatus.error) {
            console.error(`CLIENTE ERROR REPRODUCCIÓN: ${playbackStatus.error}`);
            Alert.alert("Error de reproducción", `No se pudo reproducir: ${playbackStatus.error}`);
          }
        } else {
          if (playbackStatus.didJustFinish && !playbackStatus.isLooping) {
            console.log("CLIENTE LOG: Reproducción de respuesta completada.");
            soundObjectRef.current?.unloadAsync(); // Descargar después de terminar
            soundObjectRef.current = null;
          }
        }
      });

    } catch (error: any) {
      console.error("CLIENTE EXCEPCIÓN en playAudioResponse:", error);
      console.log("CLIENTE EXCEPCIÓN OBJETO:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
      Alert.alert("Error de Audio", `Excepción al cargar/reproducir audio de respuesta: ${error.message || 'Error desconocido'}`);
    }
  };

  // Determinar qué función llamar al presionar el botón
  const handleButtonPress = () => {
    if (isRecording) {
      stopRecordingAndSend();
    } else {
      startRecording();
    }
  };

  return (
    <View style={{ padding: 20, alignItems: "center" }}>
      <Button 
        title={isRecording ? "Detener Grabación" : "Iniciar Grabación"} 
        onPress={handleButtonPress} 
      />
      {audioUri && <Text>Audio guardado en: {audioUri}</Text>}
    </View>
  );
};

export default AudioRecorder;