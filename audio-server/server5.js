
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs"); 
const util = require('util');
const { exec } = require("child_process");
const axios = require("axios");

const execPromise = util.promisify(exec);
const readFileAsync = fs.promises.readFile;
const unlinkAsync = fs.promises.unlink;
const statAsync = fs.promises.stat; 
const mkdirAsync = fs.promises.mkdir;

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const UPLOADS_DIR = path.join(__dirname, "uploads");
const TTS_OUTPUT_DIR = path.join(__dirname, "tts_outputs");

// Función genérica para asegurar que un directorio exista
const ensureDirExists = async (dirPath, dirNameForLog) => {
  try {
    await statAsync(dirPath);
    console.log(`Directorio '${dirNameForLog}' ya existe: ${dirPath}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`Directorio '${dirNameForLog}' (${dirPath}) no encontrado, creándolo...`);
      await mkdirAsync(dirPath, { recursive: true });
    } else {
      console.error(`Error al verificar/crear el directorio '${dirNameForLog}':`, error);
      process.exit(1);
    }
  }
};

// --- Servir archivos de audio TTS estáticamente ---
app.use('/tts_audio', express.static(TTS_OUTPUT_DIR));

// --- Configuración de Multer para la subida de archivos ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
        'audio/mpeg',   // .mp3
        'audio/wav',    // .wav
        'audio/ogg',    // .ogg
        'audio/mp4',    // .m4a (y otros archivos mp4)
        'audio/webm',   // .webm
        'audio/x-m4a',  // .m4a (Apple)
        'audio/aac',    // .aac
        'audio/opus',   // .opus
        'audio/3gpp',   // .3gp (común en Android)
        'audio/m4a',    // Agregar soporte explícito para audio/m4a

      ];    
      if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      console.warn("Tipo de archivo no permitido:", file.mimetype);
      cb(new Error("Tipo de archivo no permitido. Sube un archivo de audio compatible."), false);
    }
  },
});


// --- Ruta Principal para el Procesamiento ---
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se recibió ningún archivo de audio." });
  }

  const inputPath = req.file.path;
  const fileExtension = path.extname(inputPath);
  const baseName = path.basename(inputPath, fileExtension);
  const wavPath = path.join(UPLOADS_DIR, `${baseName}.wav`);
  const txtPath = path.join(UPLOADS_DIR, `${baseName}.txt`);

  const filesToClean = [inputPath];

  console.log(`\n[${new Date().toISOString()}] Petición recibida. Procesando archivo: ${req.file.originalname}`);

  try {
    // PASO 1: Convertir a WAV (ffmpeg)
    console.log(`Paso 1: Convertir a WAV (${wavPath})...`);
    const ffmpegCommand = `ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`;
    await execPromise(ffmpegCommand);
    console.log("Conversión a WAV completada.");

    // PASO 2: Transcribir audio con script Python (Whisper)
    console.log(`Paso 2: Transcribir audio con script Python (${wavPath})...`);
    const pythonWhisperScript = path.join(__dirname,'..','scripts', 'transcribe.py');
    const whisperCommand = `python "${pythonWhisperScript}" "${wavPath}" --model base --language Spanish`;
    const { stdout: whisperStdout, stderr: whisperStderr } = await execPromise(whisperCommand);
    if (whisperStderr) console.warn("Stderr de Whisper:", whisperStderr.trim());
    console.log("Script de transcripción ejecutado.");

    // PASO 3: Leer archivo de transcripción
    console.log(`Paso 3: Leer archivo de transcripción (${txtPath})...`);
    let transcript;
    try {
      transcript = (await readFileAsync(txtPath, "utf-8")).trim();
    } catch (readError) {
      console.error(`Error crítico: No se pudo leer el archivo de transcripción ${txtPath}.`, readError);
      return res.status(500).json({ error: "Fallo al leer la transcripción." });
    }
    if (!transcript) {
      console.warn("La transcripción está vacía.");
      return res.status(400).json({ error: "La transcripción está vacía. No se pudo detectar voz." });
    }
    console.log("Transcripción obtenida:", transcript);

    // PASO 4: Enviar transcripción al LLM (OpenRouter)
    console.log("Paso 4: Enviar transcripción al LLM...");
    const OPENROUTER_API_KEY_ENV = "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";
    if (!OPENROUTER_API_KEY_ENV) {
      console.error("Error crítico: La API Key de OpenRouter (OPENROUTER_API_KEY) no está configurada en .env.");
      return res.status(500).json({ error: "Configuración del servidor incompleta (API Key LLM)." });
    }
    const llmApiResponse = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "mistralai/mistral-7b-instruct",
        messages: [
          { role: "system", content: "Eres un asistente virtual útil. Responde de forma clara y concisa. Se breve, no quiero mensajes muy largos" },
          { role: "user", content: transcript },
        ],
      },
      {
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY_ENV}`,
          "Content-Type": "application/json",
        },
        timeout: 45000,
      }
    );
    const llmResponseText = llmApiResponse.data?.choices?.[0]?.message?.content?.trim();
    if (!llmResponseText) {
      console.error("Respuesta inesperada o vacía del LLM:", llmApiResponse.data);
      return res.status(500).json({ error: "El modelo de lenguaje no devolvió una respuesta válida." });
    }
    console.log("Respuesta del LLM (texto):", llmResponseText);

    // PASO 5: Convertir respuesta de texto a audio (TTS usando gTTS script)
    let audioResponseUrl = null;
    let audioResponseLocalPath = null;
    console.log("Paso 5.1: Generando audio de respuesta con script Python (gTTS)...");

    if (llmResponseText) {
      const pythonTtsScriptPath = path.join(__dirname,'..','scripts', 'gtts_script.py');
      try {
        await statAsync(pythonTtsScriptPath);
        console.log(`Script gTTS encontrado en: ${pythonTtsScriptPath}`);

        const ttsFileName = `response-gtts-${Date.now()}.mp3`;
        audioResponseLocalPath = path.join(TTS_OUTPUT_DIR, ttsFileName);
        // Escapar comillas y saltos de línea para el comando shell
        const escapedText = llmResponseText.replace(/"/g, '\\"').replace(/\n/g, ' ');
        const gttsCommand = `python "${pythonTtsScriptPath}" --text "${escapedText}" --output "${audioResponseLocalPath}" --lang "es"`;

        const { stdout: gttsStdout, stderr: gttsStderr } = await execPromise(gttsCommand, { timeout: 20000 }); // Timeout de 20 segundos
      
        // AHORA, la verificación crucial:
        try {
          const stats = await fs.promises.stat(audioResponseLocalPath); // Esto fallará si el archivo no existe
          if (stats.size > 0) {
            console.log(`VERIFICADO: Archivo ${audioResponseLocalPath} existe y tiene tamaño ${stats.size} bytes.`);
            audioResponseUrl = `/tts_audio/${ttsFileName}`;
          } else {
            console.error(`ERROR DE CREACIÓN DE ARCHIVO: Archivo ${audioResponseLocalPath} existe PERO ESTÁ VACÍO.`);
            audioResponseLocalPath = null;
            audioResponseUrl = null;
          }
        } catch (checkFileError) {
          console.error(`ERROR DE CREACIÓN DE ARCHIVO: Fallo al verificar ${audioResponseLocalPath} después de ejecutar gTTS script. El archivo probablemente no fue creado.`);
          console.error("Detalles del error de statAsync:", checkFileError.message);
          audioResponseLocalPath = null; // Asegurar que no se use si no existe
          audioResponseUrl = null;
        }

      } catch (gttsError) { // Este catch es para errores al *ejecutar* el script o al *verificar la existencia del script mismo*
        if (gttsError.code === 'ENOENT' && gttsError.path === pythonTtsScriptPath) {
          console.warn(`Script gTTS (${pythonTtsScriptPath}) no encontrado. No se generará audio.`);
        } else if (gttsError.killed) {
          console.error(`Error ejecutando script Python gTTS: TIMEOUT. El script tardó más de 20 segundos. Stderr: ${gttsError.stderr || '(no stderr)'}`);
        } else {
          console.error("Error general al intentar ejecutar script Python gTTS o verificar su existencia:", gttsError.message);
          if(gttsError.stderr) console.error("Stderr del error de gTTS:", gttsError.stderr);
        }
        audioResponseLocalPath = null;
        audioResponseUrl = null;
      }
    } else {
      console.log("No hay texto de LLM para convertir a audio.");
    }

    if (!audioResponseUrl) {
      console.warn("No se pudo generar audio de respuesta con gTTS. Se enviará solo texto.");
    }

    // PASO 6: Devolver respuesta al cliente
    console.log("Proceso completado. Enviando respuesta al cliente.");
    res.json({
      mensaje: "Proceso completado",
      transcripcion: transcript,
      respuesta_texto: llmResponseText,
      respuesta_audio_url: audioResponseUrl,
    });

  } catch (error) {
    console.error("------------------------------------");
    console.error(`Error en el endpoint /upload [${new Date().toISOString()}]:`);
    let errorMessage = "Error interno del servidor.";
    let errorDetails = error.message;
    let statusCode = 500;

    if (axios.isAxiosError(error)) {
      console.error("Tipo: Error de Axios (LLM API)");
      errorMessage = "Error al comunicarse con el modelo de lenguaje.";
      statusCode = error.response?.status || 503;
      errorDetails = error.response?.data || error.message;
    } else if (error.cmd) {
      console.error("Tipo: Error de Comando Externo (ffmpeg/python STT/python TTS)");
      errorMessage = `Error durante el procesamiento.`;
      errorDetails = `Comando: ${error.cmd}\nSalida: ${error.code}\nStderr: ${error.stderr}\nStdout: ${error.stdout}`;
    } else {
      console.error("Tipo: Error General del Servidor");
    }
    console.error("Detalles completos del error:", error);
    console.error("------------------------------------");

    res.status(statusCode).json({
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? errorDetails : "Detalles adicionales ocultos.",
    });
  } finally {
    console.log("Limpiando archivos temporales...");
    for (const filePath of filesToClean) {
      try {
        if (fs.existsSync(filePath)) {
          await unlinkAsync(filePath);
        }
      } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') {
          console.warn(`Advertencia: No se pudo borrar el archivo temporal ${filePath}:`, unlinkError.message);
        }
      }
    }
    console.log("Limpieza de archivos completada.");
  }
});

// Middleware para manejar errores de Multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error("Error de Multer no capturado:", err);
    return res.status(400).json({ error: `Error en la subida del archivo: ${err.message}` });
  } else if (err) {
    console.error("Error no manejado globalmente (fuera de /upload):", err);
    return res.status(500).json({ error: `Error inesperado del servidor: ${err.message}` });
  }
  next();
});

// Iniciar el servidor
const startServer = async () => {
  await ensureDirExists(UPLOADS_DIR, "uploads");
  await ensureDirExists(TTS_OUTPUT_DIR, "tts_outputs");

  app.listen(port, () => {
    console.log(`\n Servidor Express corriendo en http://localhost:${port}`);
    console.log(`   Directorio de subidas (uploads): ${UPLOADS_DIR}`);
    console.log(`   Directorio de audios TTS (tts_outputs): ${TTS_OUTPUT_DIR}`);
    
  });
};

startServer().catch(err => {
    console.error("Falló el inicio del servidor:", err);
    process.exit(1);
});