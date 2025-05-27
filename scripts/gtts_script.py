import argparse
from gtts import gTTS
import sys
import os
from pydub import AudioSegment

def text_to_speech(text, output_path, lang='es', slow=False, volume_db=3000):
    try:
        output_dir = os.path.dirname(output_path)
        if output_dir and not os.path.exists(output_dir):
            print(f"Creando directorio: {output_dir}", file=sys.stderr) # Log para stderr
            os.makedirs(output_dir, exist_ok=True)
        else:
            print(f"Directorio de salida ya existe o no es necesario crear: {output_dir}", file=sys.stderr)

        print(f"Intentando guardar audio en: {output_path} con texto: '{text[:50]}...'", file=sys.stderr)
        tts = gTTS(text=text, lang=lang, slow=slow)
        tts.save(output_path)  # Esta línea sigue siendo crítica

        # Verificar si el archivo realmente se creó y no está vacío
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            print(f"ÉXITO: Audio guardado en: {output_path}", file=sys.stderr)
            
            # Ahora ajustamos el volumen usando pydub
            audio = AudioSegment.from_mp3(output_path)

            # Aumentar el volumen en decibelios (puedes modificar el valor de volume_db según lo necesites)
            louder_audio = audio + volume_db  # Ajuste en decibelios
            louder_audio.export(output_path, format='mp3')  # Sobreescribir el archivo con el nuevo volumen

            print(f"El volumen ha sido ajustado. Archivo final guardado en: {output_path}")
            return True
        else:
            print(f"ERROR: El archivo {output_path} no se creó o está vacío después de tts.save().", file=sys.stderr)
            return False

    except Exception as e:
        print(f"EXCEPCIÓN en gTTS (text_to_speech): {type(e).__name__} - {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return False

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convierte texto a voz usando gTTS y guarda en un archivo.")
    parser.add_argument("--text", required=True, help="El texto a convertir a voz.")
    parser.add_argument("--output", required=True, help="Ruta del archivo MP3 de salida.")
    parser.add_argument("--lang", default="es", help="Código de idioma para gTTS (ej: 'es', 'en').")
    parser.add_argument("--slow", action="store_true", help="Usar una velocidad de habla más lenta.")
    parser.add_argument("--volume", type=int, default=10, help="Ajusta el volumen en decibelios (default: 10).")

    args = parser.parse_args()
    print(f"gtts_script.py llamado con args: {args}", file=sys.stderr)

    if text_to_speech(args.text, args.output, args.lang, args.slow, args.volume):
        sys.exit(0)  # Éxito
    else:
        sys.exit(1)  # Error
