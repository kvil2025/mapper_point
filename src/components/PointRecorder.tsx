"use client";

import { useState, useRef, useEffect } from "react";

interface PointRecorderProps {
  point: { id: string; lat: number; lng: number };
  onClose: () => void;
  onSave: (data: any) => void;
}

interface GeoData {
  fecha: string;
  numero_de_punto: string;
  caja: string;
  nivel: string;
  alteracion: string;
  mineralogia: string;
  observaciones: string;
  id_muestra: string;
  fotos?: string[]; // base64 compressed photos
  _transcripcion?: string;
}

// ── Geological dropdowns (industry standard) ──
const BASE_ALTERACION = [
  "No especificado", "Argílica", "Argílica avanzada", "Propilítica",
  "Sericítica", "Fílica", "Potásica", "Silicificación",
  "Cloritización", "Epidotización", "Oxidación", "Supérgena", "Otra",
];

const BASE_MINERALOGIA = [
  "Cuarzo", "Feldespato", "Plagioclasa", "Biotita", "Muscovita",
  "Pirita", "Calcopirita", "Molibdenita", "Magnetita", "Hematita",
  "Malaquita", "Crisocola", "Calcita", "Clorita", "Epidota",
  "Sericita", "Arcilla", "Limonita", "Goethita", "Turmalina",
];

// Load custom fields from localStorage
const loadCustomFields = (): { alteracion: string[]; mineralogia: string[] } => {
  try {
    const saved = localStorage.getItem("geologgia-custom-fields");
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return { alteracion: [], mineralogia: [] };
};

const saveCustomFields = (fields: { alteracion: string[]; mineralogia: string[] }) => {
  localStorage.setItem("geologgia-custom-fields", JSON.stringify(fields));
};

// Fields the user needs to describe in their audio
const PROMPT_FIELDS = [
  { key: "caja", icon: "📦", label: "Caja", hint: "¿De qué caja es la muestra?" },
  { key: "nivel", icon: "📏", label: "Nivel / Profundidad", hint: "¿A qué profundidad o nivel?" },
  { key: "alteracion", icon: "🔥", label: "Alteración", hint: "Tipo de alteración hidrotermal" },
  { key: "mineralogia", icon: "💎", label: "Mineralogía", hint: "Minerales observados" },
  { key: "observaciones", icon: "📝", label: "Observaciones", hint: "Litología, estructuras, rumbo/manteo..." },
  { key: "id_muestra", icon: "🏷️", label: "ID Muestra", hint: "Código de la muestra" },
];

const FIELD_LABELS: Record<string, string> = {
  fecha: "Fecha",
  numero_de_punto: "N° Punto",
  caja: "Caja",
  nivel: "Nivel",
  alteracion: "Alteración",
  mineralogia: "Mineralogía",
  observaciones: "Observaciones",
  id_muestra: "ID Muestra",
};

export default function PointRecorder({ point, onClose, onSave }: PointRecorderProps) {
  const [step, setStep] = useState<"record" | "processing" | "review">("record");
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [geoData, setGeoData] = useState<GeoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentPromptIdx, setCurrentPromptIdx] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]);
  const [selectedMinerals, setSelectedMinerals] = useState<string[]>([]);
  const [customFields, setCustomFields] = useState(loadCustomFields());
  const [addingCustomAlteracion, setAddingCustomAlteracion] = useState(false);
  const [addingCustomMineral, setAddingCustomMineral] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const promptTimerRef = useRef<NodeJS.Timeout | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Merged options (base + custom)
  const ALTERACION_OPTIONS = [...BASE_ALTERACION, ...customFields.alteracion];
  const MINERALOGIA_COMMON = [...BASE_MINERALOGIA, ...customFields.mineralogia];

  // Auto-generated values
  const now = new Date();
  const autoFecha = now.toLocaleDateString("es-CL", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  // Cycle through prompt fields every 5 seconds while recording
  useEffect(() => {
    if (isRecording) {
      setCurrentPromptIdx(0);
      setRecordingSeconds(0);

      promptTimerRef.current = setInterval(() => {
        setCurrentPromptIdx((prev) => (prev + 1) % PROMPT_FIELDS.length);
      }, 5000);

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    }

    return () => {
      if (promptTimerRef.current) clearInterval(promptTimerRef.current);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, [isRecording]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // ── Photo capture ──
  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        // Compress: resize to max 800px and convert to JPEG
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const maxSize = 800;
          let { width, height } = img;
          if (width > maxSize || height > maxSize) {
            const ratio = Math.min(maxSize / width, maxSize / height);
            width *= ratio;
            height *= ratio;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL("image/jpeg", 0.7);
          setPhotos((prev) => [...prev, compressed]);
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
    // Reset input for re-capture
    e.target.value = "";
  };

  const removePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Audio recording ──
  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      setError("No se pudo acceder al micrófono. Verifica los permisos.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleProcessAudio = async () => {
    if (!audioBlob) return;
    setStep("processing");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");
      formData.append("pointId", point.id);
      formData.append("lat", point.lat.toString());
      formData.append("lng", point.lng.toString());

      const response = await fetch("/api/process-audio", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Error conectando con Gemini. ¿Está configurada la API key?");
      }

      const result = await response.json();
      if (result.error) throw new Error(result.error);

      // Pre-select minerals from AI response
      if (result.mineralogia && result.mineralogia !== "No especificado") {
        const detected = result.mineralogia.split(",").map((m: string) => m.trim());
        setSelectedMinerals(detected.filter((m: string) =>
          MINERALOGIA_COMMON.some((mc) => mc.toLowerCase() === m.toLowerCase())
        ));
      }

      // Auto-fill date, point number, and photos
      setGeoData({
        ...result,
        fecha: result.fecha || autoFecha,
        numero_de_punto: result.numero_de_punto || point.id,
        fotos: photos.length > 0 ? photos : undefined,
      });
      setStep("review");
    } catch (err: any) {
      setError(err.message || "Error procesando audio");
      setStep("record");
    }
  };

  const handleFieldChange = (key: string, value: string) => {
    if (!geoData) return;
    setGeoData({ ...geoData, [key]: value });
  };

  const toggleMineral = (mineral: string) => {
    setSelectedMinerals((prev) =>
      prev.includes(mineral) ? prev.filter((m) => m !== mineral) : [...prev, mineral]
    );
  };

  // Sync minerals to geoData
  useEffect(() => {
    if (geoData && step === "review") {
      const mineralStr = selectedMinerals.length > 0 ? selectedMinerals.join(", ") : "No especificado";
      if (mineralStr !== geoData.mineralogia) {
        setGeoData({ ...geoData, mineralogia: mineralStr });
      }
    }
  }, [selectedMinerals]);

  // Hidden file input for camera
  const hiddenPhotoInput = (
    <input
      ref={photoInputRef}
      type="file"
      accept="image/*"
      capture="environment"
      multiple
      className="hidden"
      onChange={handlePhotoCapture}
    />
  );

  // ── STEP 1: Record ──
  if (step === "record") {
    return (
      <div className="flex flex-col gap-3">
        {hiddenPhotoInput}

        {/* Header */}
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-base">🎙️ Registro Geológico</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        {/* Auto-captured info */}
        <div className="flex gap-2 text-xs flex-wrap">
          <span className="px-2 py-1 rounded-md bg-blue-900/50 border border-blue-700 text-blue-300">
            📅 {autoFecha}
          </span>
          <span className="px-2 py-1 rounded-md bg-blue-900/50 border border-blue-700 text-blue-300">
            📍 {point.id}
          </span>
          <span className="px-2 py-1 rounded-md bg-gray-800 border border-gray-600 text-gray-400">
            {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
          </span>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-2 text-sm text-red-300">{error}</div>
        )}

        {/* ── Prompt Carousel (visible while recording) ── */}
        {isRecording && (
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-amber-900/30 to-orange-900/30 border border-amber-700/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-amber-400 font-medium uppercase tracking-wider">Describe:</span>
              <span className="text-xs text-gray-400">
                {currentPromptIdx + 1}/{PROMPT_FIELDS.length}
              </span>
            </div>

            <div className="flex items-center gap-3 animate-fade-in" key={currentPromptIdx}>
              <span className="text-3xl">{PROMPT_FIELDS[currentPromptIdx].icon}</span>
              <div>
                <div className="font-bold text-amber-200 text-lg">{PROMPT_FIELDS[currentPromptIdx].label}</div>
                <div className="text-sm text-amber-300/70">{PROMPT_FIELDS[currentPromptIdx].hint}</div>
              </div>
            </div>

            <div className="flex justify-center gap-1.5 mt-3">
              {PROMPT_FIELDS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === currentPromptIdx
                      ? "w-6 bg-amber-400"
                      : i < currentPromptIdx
                        ? "w-1.5 bg-amber-600"
                        : "w-1.5 bg-gray-600"
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Field checklist (visible before recording) ── */}
        {!isRecording && !audioBlob && (
          <div className="rounded-xl bg-gray-800/50 border border-gray-700 p-3">
            <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">Campos a describir:</span>
            <div className="grid grid-cols-2 gap-1.5 mt-2">
              {PROMPT_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center gap-2 text-sm text-gray-300 py-1">
                  <span>{field.icon}</span>
                  <span>{field.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Photos section ── */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => photoInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-800/60 border border-emerald-600 text-emerald-300 text-sm hover:bg-emerald-700 transition-all"
          >
            📸 {photos.length > 0 ? `${photos.length} foto${photos.length > 1 ? "s" : ""}` : "Tomar foto"}
          </button>
          {photos.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto">
              {photos.map((photo, i) => (
                <div key={i} className="relative w-12 h-12 rounded-lg overflow-hidden border border-gray-600 flex-shrink-0">
                  <img src={photo} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
                  <button
                    onClick={() => removePhoto(i)}
                    className="absolute top-0 right-0 w-4 h-4 bg-red-600 text-white text-[10px] flex items-center justify-center rounded-bl-md"
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recording controls */}
        {!audioBlob ? (
          <div className="flex flex-col items-center py-2">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
                isRecording
                  ? "bg-red-500 hover:bg-red-600 animate-pulse shadow-lg shadow-red-500/40"
                  : "bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/30"
              }`}
            >
              {isRecording ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              ) : (
                <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
              )}
            </button>
            <span className="mt-2 text-sm text-gray-300">
              {isRecording ? (
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Grabando {formatTime(recordingSeconds)} — Toca para detener
                </span>
              ) : (
                "Toca para describir el punto"
              )}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <audio src={audioUrl!} controls className="w-full h-10" />
            <div className="flex gap-2">
              <button
                onClick={() => { setAudioBlob(null); setAudioUrl(null); setRecordingSeconds(0); }}
                className="flex-1 py-2 px-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
              >
                🔄 Regrabar
              </button>
              <button
                onClick={handleProcessAudio}
                className="flex-1 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm font-medium"
              >
                🤖 Analizar con IA
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── STEP 2: Processing ──
  if (step === "processing") {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-gray-300">Gemini está analizando tu audio...</span>
      </div>
    );
  }

  // ── STEP 3: Review & Edit with dropdowns ──
  return (
    <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-base">✅ Datos Extraídos — {point.id}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
      </div>

      {geoData && (
        <div className="flex flex-col gap-2">
          {/* Fecha & Punto (readonly) */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Fecha</label>
              <input type="text" value={geoData.fecha} readOnly className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-400" />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">N° Punto</label>
              <input type="text" value={geoData.numero_de_punto} readOnly className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-400" />
            </div>
          </div>

          {/* Caja & Nivel */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Caja</label>
              <input type="text" value={geoData.caja} onChange={(e) => handleFieldChange("caja", e.target.value)}
                className="w-full bg-gray-800/80 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none" />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Nivel</label>
              <input type="text" value={geoData.nivel} onChange={(e) => handleFieldChange("nivel", e.target.value)}
                className="w-full bg-gray-800/80 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none" />
            </div>
          </div>

          {/* Alteración - DROPDOWN + custom add */}
          <div className="flex flex-col gap-0.5">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">🔥 Alteración</label>
            <div className="flex gap-1">
              <select
                value={ALTERACION_OPTIONS.includes(geoData.alteracion) ? geoData.alteracion : "Otra"}
                onChange={(e) => handleFieldChange("alteracion", e.target.value)}
                className="flex-1 bg-gray-800/80 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none appearance-none"
              >
                {ALTERACION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <button
                onClick={() => { setAddingCustomAlteracion(true); setCustomInput(""); }}
                className="px-2 py-1 rounded-lg bg-gray-700 text-blue-300 text-xs hover:bg-gray-600 border border-gray-600 flex-shrink-0"
                title="Agregar opción"
              >+</button>
            </div>
            {addingCustomAlteracion && (
              <div className="flex gap-1 mt-1">
                <input type="text" value={customInput} onChange={(e) => setCustomInput(e.target.value)}
                  placeholder="Nueva alteración..."
                  autoFocus
                  className="flex-1 bg-gray-900 border border-blue-600 rounded-lg px-2 py-1 text-xs text-white focus:outline-none" />
                <button onClick={() => {
                  if (customInput.trim() && !ALTERACION_OPTIONS.includes(customInput.trim())) {
                    const updated = { ...customFields, alteracion: [...customFields.alteracion, customInput.trim()] };
                    setCustomFields(updated);
                    saveCustomFields(updated);
                    handleFieldChange("alteracion", customInput.trim());
                  }
                  setAddingCustomAlteracion(false);
                }} className="px-2 py-1 rounded-lg bg-blue-600 text-white text-xs">✓</button>
                <button onClick={() => setAddingCustomAlteracion(false)} className="px-2 py-1 rounded-lg bg-gray-700 text-gray-300 text-xs">✕</button>
              </div>
            )}
            {!ALTERACION_OPTIONS.includes(geoData.alteracion) && geoData.alteracion !== "No especificado" && (
              <input type="text" value={geoData.alteracion} onChange={(e) => handleFieldChange("alteracion", e.target.value)}
                placeholder="Especificar otra alteración..."
                className="w-full mt-1 bg-gray-800/80 border border-amber-600/50 rounded-lg px-3 py-1.5 text-sm text-amber-300 focus:border-amber-500 focus:outline-none" />
            )}
          </div>

          {/* Mineralogía - CHIP SELECT + custom add */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">💎 Mineralogía</label>
              <button
                onClick={() => { setAddingCustomMineral(true); setCustomInput(""); }}
                className="text-[10px] text-blue-400 hover:text-blue-300"
              >+ Agregar mineral</button>
            </div>
            {addingCustomMineral && (
              <div className="flex gap-1 mb-1">
                <input type="text" value={customInput} onChange={(e) => setCustomInput(e.target.value)}
                  placeholder="Nuevo mineral..."
                  autoFocus
                  className="flex-1 bg-gray-900 border border-blue-600 rounded-lg px-2 py-1 text-xs text-white focus:outline-none" />
                <button onClick={() => {
                  if (customInput.trim() && !MINERALOGIA_COMMON.includes(customInput.trim())) {
                    const updated = { ...customFields, mineralogia: [...customFields.mineralogia, customInput.trim()] };
                    setCustomFields(updated);
                    saveCustomFields(updated);
                    toggleMineral(customInput.trim());
                  }
                  setAddingCustomMineral(false);
                }} className="px-2 py-1 rounded-lg bg-blue-600 text-white text-xs">✓</button>
                <button onClick={() => setAddingCustomMineral(false)} className="px-2 py-1 rounded-lg bg-gray-700 text-gray-300 text-xs">✕</button>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-gray-800/50 border border-gray-700 max-h-24 overflow-y-auto">
              {MINERALOGIA_COMMON.map((mineral) => {
                const isSelected = selectedMinerals.some((m) => m.toLowerCase() === mineral.toLowerCase());
                return (
                  <button
                    key={mineral}
                    onClick={() => toggleMineral(mineral)}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium transition-all ${
                      isSelected
                        ? "bg-emerald-600 text-white border border-emerald-400"
                        : "bg-gray-700 text-gray-400 border border-gray-600 hover:border-gray-400"
                    }`}
                  >
                    {mineral}
                  </button>
                );
              })}
            </div>
            <input type="text" value={geoData.mineralogia} onChange={(e) => handleFieldChange("mineralogia", e.target.value)}
              placeholder="Editar minerales manualmente..."
              className="w-full bg-gray-800/80 border border-gray-600 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:border-blue-500 focus:outline-none" />
          </div>

          {/* ID Muestra */}
          <div className="flex flex-col gap-0.5">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">ID Muestra</label>
            <input type="text" value={geoData.id_muestra} onChange={(e) => handleFieldChange("id_muestra", e.target.value)}
              className="w-full bg-gray-800/80 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none" />
          </div>

          {/* Observaciones */}
          <div className="flex flex-col gap-0.5">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Observaciones</label>
            <textarea
              value={geoData.observaciones}
              onChange={(e) => handleFieldChange("observaciones", e.target.value)}
              rows={2}
              className="w-full bg-gray-800/80 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none resize-none"
            />
          </div>

          {/* Photos preview in review */}
          {photos.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">📸 Fotos ({photos.length})</label>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {photos.map((photo, i) => (
                  <img key={i} src={photo} alt={`Foto ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-gray-600 flex-shrink-0" />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-1 sticky bottom-0 bg-gray-900/90 py-2">
        <button
          onClick={() => { setStep("record"); setAudioBlob(null); setAudioUrl(null); setGeoData(null); setRecordingSeconds(0); setPhotos([]); setSelectedMinerals([]); }}
          className="flex-1 py-2 px-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
        >
          Descartar
        </button>
        <button
          onClick={() => geoData && onSave({ ...geoData, fotos: photos.length > 0 ? photos : undefined })}
          className="flex-1 py-2 px-3 rounded-lg bg-green-600 hover:bg-green-700 text-sm font-medium"
        >
          ✓ Guardar Punto
        </button>
      </div>
    </div>
  );
}
