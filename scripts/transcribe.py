import whisper
import sys
import os

# Verificamos si el archivo de audio existe
audio_path = sys.argv[1]
if not os.path.exists(audio_path):
    print(f"Error: El archivo {audio_path} no existe")
    sys.exit(1)

# Cargamos el modelo base
print("Cargando el modelo Whisper...")
model = whisper.load_model("base")

# Transcribimos el audio
print(f"Transcribiendo el audio: {audio_path}")
result = model.transcribe(audio_path, language="Spanish")

# Guardamos la transcripción en un archivo .txt
txt_path = os.path.splitext(audio_path)[0] + ".txt"
with open(txt_path, "w", encoding="utf-8") as f:
    f.write(result["text"])

print(f"Transcripción guardada en {txt_path}")
