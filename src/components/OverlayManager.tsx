"use client";

import { useState, useRef } from "react";

interface GeoOverlay {
  id: string;
  name: string;
  type: "image" | "geojson";
  visible: boolean;
  opacity: number;
  // For image overlays
  imageData?: string; // base64
  bounds?: [[number, number], [number, number]]; // [[swLat, swLng], [neLat, neLng]]
  // For GeoJSON overlays
  geojsonData?: any;
  color?: string;
  addedAt: string;
}

interface OverlayManagerProps {
  overlays: GeoOverlay[];
  onClose: () => void;
  onAddOverlay: (overlay: GeoOverlay) => void;
  onRemoveOverlay: (id: string) => void;
  onToggleOverlay: (id: string) => void;
  onOpacityChange: (id: string, opacity: number) => void;
}

const OVERLAY_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6"];

export default function OverlayManager({
  overlays, onClose, onAddOverlay, onRemoveOverlay, onToggleOverlay, onOpacityChange
}: OverlayManagerProps) {
  const [showUpload, setShowUpload] = useState(false);
  const [uploadType, setUploadType] = useState<"image" | "geojson">("image");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Image upload state
  const [imageName, setImageName] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [swLat, setSwLat] = useState("");
  const [swLng, setSwLng] = useState("");
  const [neLat, setNeLat] = useState("");
  const [neLng, setNeLng] = useState("");

  // GeoJSON upload state
  const [geojsonName, setGeojsonName] = useState("");
  const [geojsonData, setGeojsonData] = useState<any>(null);
  const [geojsonColor, setGeojsonColor] = useState("#3b82f6");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const geojsonInputRef = useRef<HTMLInputElement>(null);

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageName(file.name.replace(/\.[^.]+$/, ""));

    const reader = new FileReader();
    reader.onload = () => {
      // Compress image
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 2048;
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
        setImageData(canvas.toDataURL("image/jpeg", 0.6));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleGeoJSONFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGeojsonName(file.name.replace(/\.[^.]+$/, ""));

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        if (json.type === "FeatureCollection" || json.type === "Feature" || json.features) {
          setGeojsonData(json);
        } else {
          alert("El archivo no es un GeoJSON válido (necesita type: FeatureCollection o Feature)");
        }
      } catch {
        alert("Error al parsear el archivo JSON");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleKMLFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGeojsonName(file.name.replace(/\.[^.]+$/, ""));

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parser = new DOMParser();
        const kml = parser.parseFromString(reader.result as string, "text/xml");
        const placemarks = kml.querySelectorAll("Placemark");
        const features: any[] = [];

        placemarks.forEach((pm) => {
          const name = pm.querySelector("name")?.textContent || "Sin nombre";
          // Points
          const point = pm.querySelector("Point coordinates");
          if (point) {
            const [lng, lat] = (point.textContent || "").trim().split(",").map(Number);
            features.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: [lng, lat] },
              properties: { name },
            });
          }
          // LineStrings
          const line = pm.querySelector("LineString coordinates");
          if (line) {
            const coords = (line.textContent || "").trim().split(/\s+/).map(c => {
              const [lng, lat, alt] = c.split(",").map(Number);
              return [lng, lat, alt || 0];
            });
            features.push({
              type: "Feature",
              geometry: { type: "LineString", coordinates: coords },
              properties: { name },
            });
          }
          // Polygons
          const poly = pm.querySelector("Polygon outerBoundaryIs LinearRing coordinates");
          if (poly) {
            const coords = (poly.textContent || "").trim().split(/\s+/).map(c => {
              const [lng, lat, alt] = c.split(",").map(Number);
              return [lng, lat, alt || 0];
            });
            features.push({
              type: "Feature",
              geometry: { type: "Polygon", coordinates: [coords] },
              properties: { name },
            });
          }
        });

        if (features.length > 0) {
          setGeojsonData({ type: "FeatureCollection", features });
        } else {
          alert("No se encontraron geometrías válidas en el KML");
        }
      } catch {
        alert("Error al parsear el archivo KML");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const submitImageOverlay = () => {
    if (!imageData || !swLat || !swLng || !neLat || !neLng) {
      alert("Completa todos los campos: imagen y coordenadas de las esquinas");
      return;
    }
    const overlay: GeoOverlay = {
      id: `img-${Date.now()}`,
      name: imageName || "Imagen",
      type: "image",
      visible: true,
      opacity: 0.7,
      imageData,
      bounds: [[parseFloat(swLat), parseFloat(swLng)], [parseFloat(neLat), parseFloat(neLng)]],
      addedAt: new Date().toISOString(),
    };
    onAddOverlay(overlay);
    resetForm();
  };

  const submitGeoJSONOverlay = () => {
    if (!geojsonData) { alert("Carga un archivo GeoJSON o KML primero"); return; }
    const overlay: GeoOverlay = {
      id: `geo-${Date.now()}`,
      name: geojsonName || "Capa vectorial",
      type: "geojson",
      visible: true,
      opacity: 0.8,
      geojsonData,
      color: geojsonColor,
      addedAt: new Date().toISOString(),
    };
    onAddOverlay(overlay);
    resetForm();
  };

  const resetForm = () => {
    setShowUpload(false);
    setImageData(null);
    setImageName("");
    setSwLat(""); setSwLng(""); setNeLat(""); setNeLng("");
    setGeojsonData(null);
    setGeojsonName("");
  };

  return (
    <div className="absolute inset-0 z-[3000] bg-gray-900/95 backdrop-blur-xl flex flex-col text-white overflow-hidden">
      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
      <input ref={geojsonInputRef} type="file" accept=".geojson,.json,.kml,.kmz" className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.name.endsWith(".kml") || file.name.endsWith(".kmz")) {
            handleKMLFile(e);
          } else {
            handleGeoJSONFile(e);
          }
        }}
      />

      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <div>
          <h2 className="font-bold text-lg">🗺️ Capas y Overlays</h2>
          <span className="text-xs text-gray-400">{overlays.length} capas cargadas</span>
        </div>
        <div className="flex gap-2 items-center">
          {!showUpload && (
            <button
              onClick={() => setShowUpload(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-800/50 border border-blue-600 text-blue-300 hover:bg-blue-800 font-medium"
            >
              + Agregar capa
            </button>
          )}
          <button onClick={onClose} className="w-10 h-10 rounded-xl bg-gray-800 border border-gray-600 flex items-center justify-center text-xl hover:bg-gray-700">
            &times;
          </button>
        </div>
      </div>

      {/* Upload form */}
      {showUpload && (
        <div className="p-4 border-b border-gray-700 bg-gray-800/50">
          {/* Type tabs */}
          <div className="flex gap-2 mb-3">
            <button onClick={() => setUploadType("image")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${uploadType === "image" ? "bg-amber-700 text-white" : "bg-gray-700 text-gray-400"}`}>
              🖼️ Imagen georeferenciada
            </button>
            <button onClick={() => setUploadType("geojson")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${uploadType === "geojson" ? "bg-blue-700 text-white" : "bg-gray-700 text-gray-400"}`}>
              📐 GeoJSON / KML
            </button>
          </div>

          {uploadType === "image" ? (
            <div className="flex flex-col gap-3">
              {/* Image preview + upload */}
              <div className="flex gap-3">
                <button onClick={() => fileInputRef.current?.click()}
                  className="flex-shrink-0 w-24 h-24 rounded-xl border-2 border-dashed border-gray-500 flex flex-col items-center justify-center text-gray-400 hover:border-amber-500 hover:text-amber-300 transition-all">
                  {imageData ? (
                    <img src={imageData} alt="Preview" className="w-full h-full object-cover rounded-lg" />
                  ) : (
                    <><span className="text-2xl">🖼️</span><span className="text-[10px] mt-1">Cargar</span></>
                  )}
                </button>
                <div className="flex-1 flex flex-col gap-2">
                  <input type="text" value={imageName} onChange={(e) => setImageName(e.target.value)} placeholder="Nombre de la capa..."
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none" />
                  <span className="text-[10px] text-gray-500">JPG/PNG — se superpone al mapa en las coordenadas indicadas</span>
                </div>
              </div>

              {/* Coordinates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase">Esquina SW (inferior-izq)</label>
                  <div className="flex gap-1 mt-0.5">
                    <input type="number" step="any" value={swLat} onChange={(e) => setSwLat(e.target.value)} placeholder="Lat"
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-2 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none" />
                    <input type="number" step="any" value={swLng} onChange={(e) => setSwLng(e.target.value)} placeholder="Lng"
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-2 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase">Esquina NE (superior-der)</label>
                  <div className="flex gap-1 mt-0.5">
                    <input type="number" step="any" value={neLat} onChange={(e) => setNeLat(e.target.value)} placeholder="Lat"
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-2 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none" />
                    <input type="number" step="any" value={neLng} onChange={(e) => setNeLng(e.target.value)} placeholder="Lng"
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-2 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={resetForm} className="flex-1 py-2 rounded-lg bg-gray-700 text-gray-300 text-sm">Cancelar</button>
                <button onClick={submitImageOverlay} className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium">Agregar imagen</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <button onClick={() => geojsonInputRef.current?.click()}
                  className="flex-shrink-0 w-24 h-24 rounded-xl border-2 border-dashed border-gray-500 flex flex-col items-center justify-center text-gray-400 hover:border-blue-500 hover:text-blue-300 transition-all">
                  {geojsonData ? (
                    <><span className="text-2xl">✅</span><span className="text-[10px] mt-1">{geojsonData.features?.length || 1} features</span></>
                  ) : (
                    <><span className="text-2xl">📐</span><span className="text-[10px] mt-1">Cargar</span></>
                  )}
                </button>
                <div className="flex-1 flex flex-col gap-2">
                  <input type="text" value={geojsonName} onChange={(e) => setGeojsonName(e.target.value)} placeholder="Nombre de la capa..."
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none" />
                  <span className="text-[10px] text-gray-500">Formatos: .geojson, .json, .kml</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500">Color:</span>
                    <div className="flex gap-1">
                      {OVERLAY_COLORS.map((c) => (
                        <button key={c} onClick={() => setGeojsonColor(c)}
                          className={`w-5 h-5 rounded-full border-2 ${geojsonColor === c ? "border-white" : "border-transparent"}`}
                          style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={resetForm} className="flex-1 py-2 rounded-lg bg-gray-700 text-gray-300 text-sm">Cancelar</button>
                <button onClick={submitGeoJSONOverlay} className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium">Agregar capa</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Overlays list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {overlays.length === 0 && !showUpload && (
          <div className="text-center text-gray-500 py-12">
            <span className="text-4xl block mb-3">🗺️</span>
            No hay capas cargadas.<br />
            <span className="text-xs">Agrega imágenes georeferenciadas o archivos GeoJSON/KML.</span>
          </div>
        )}

        {overlays.map((overlay) => (
          <div
            key={overlay.id}
            className={`rounded-xl border p-3 transition-all ${
              overlay.visible ? "bg-gray-800/50 border-gray-500" : "bg-gray-800/20 border-gray-700"
            }`}
          >
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <button
                  onClick={() => onToggleOverlay(overlay.id)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${
                    overlay.visible ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-500"
                  }`}
                >
                  {overlay.visible ? "👁️" : "👁️‍🗨️"}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{overlay.type === "image" ? "🖼️" : "📐"}</span>
                    <span className="font-medium text-sm truncate">{overlay.name}</span>
                  </div>
                  <span className="text-[10px] text-gray-500">
                    {overlay.type === "image" ? "Imagen georeferenciada" : `GeoJSON — ${overlay.geojsonData?.features?.length || 0} features`}
                  </span>
                </div>
              </div>

              {confirmDeleteId === overlay.id ? (
                <div className="flex gap-1">
                  <button onClick={() => onRemoveOverlay(overlay.id)} className="px-2 py-1 rounded-lg bg-red-600 text-white text-xs">Sí</button>
                  <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-1 rounded-lg bg-gray-700 text-gray-300 text-xs">No</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDeleteId(overlay.id)} className="px-2 py-1 rounded-lg bg-gray-700 text-red-400 hover:bg-red-900/50 text-xs">🗑️</button>
              )}
            </div>

            {/* Opacity slider */}
            {overlay.visible && (
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-700">
                <span className="text-[10px] text-gray-500">Opacidad</span>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.1"
                  value={overlay.opacity}
                  onChange={(e) => onOpacityChange(overlay.id, parseFloat(e.target.value))}
                  className="flex-1 h-1 bg-gray-600 rounded-full appearance-none cursor-pointer accent-blue-500"
                />
                <span className="text-[10px] text-gray-400 w-8 text-right">{Math.round(overlay.opacity * 100)}%</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export type { GeoOverlay };
