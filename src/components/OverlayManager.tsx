"use client";

import { useState, useRef } from "react";

interface GeoOverlay {
  id: string;
  name: string;
  type: "image" | "geojson";
  visible: boolean;
  opacity: number;
  imageData?: string;
  bounds?: [[number, number], [number, number]];
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
  const [uploadType, setUploadType] = useState<"image" | "geotiff" | "geojson">("image");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [processingTiff, setProcessingTiff] = useState(false);

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
  const tiffInputRef = useRef<HTMLInputElement>(null);
  const geojsonInputRef = useRef<HTMLInputElement>(null);

  // ── Image handler (JPG/PNG) ──
  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageName(file.name.replace(/\.[^.]+$/, ""));
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 2048;
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width *= ratio; height *= ratio;
        }
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        setImageData(canvas.toDataURL("image/jpeg", 0.6));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // ── GeoTIFF handler ──
  const handleGeoTIFF = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessingTiff(true);
    setImageName(file.name.replace(/\.[^.]+$/, ""));

    try {
      // Dynamic import from CDN
      const GeoTIFF = await import(/* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.min.js");
      const fromArrayBuffer = GeoTIFF.fromArrayBuffer || GeoTIFF.default?.fromArrayBuffer;

      const arrayBuffer = await file.arrayBuffer();
      const tiff = await fromArrayBuffer(arrayBuffer);
      const image = await tiff.getImage();

      // Extract bounding box from GeoTIFF metadata
      const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]
      const [minLng, minLat, maxLng, maxLat] = bbox;

      // Set coordinates automatically
      setSwLat(minLat.toFixed(6));
      setSwLng(minLng.toFixed(6));
      setNeLat(maxLat.toFixed(6));
      setNeLng(maxLng.toFixed(6));

      // Read raster data and convert to canvas
      const width = image.getWidth();
      const height = image.getHeight();
      const rasters = await image.readRasters();
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(width, 2048);
      canvas.height = Math.min(height, 2048);
      const ctx = canvas.getContext("2d")!;
      const imgData = ctx.createImageData(canvas.width, canvas.height);

      const numBands = rasters.length;
      const scaleX = width / canvas.width;
      const scaleY = height / canvas.height;

      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const srcX = Math.floor(x * scaleX);
          const srcY = Math.floor(y * scaleY);
          const srcIdx = srcY * width + srcX;
          const dstIdx = (y * canvas.width + x) * 4;

          if (numBands >= 3) {
            // RGB or RGBA
            imgData.data[dstIdx] = rasters[0][srcIdx];
            imgData.data[dstIdx + 1] = rasters[1][srcIdx];
            imgData.data[dstIdx + 2] = rasters[2][srcIdx];
            imgData.data[dstIdx + 3] = numBands >= 4 ? rasters[3][srcIdx] : 255;
          } else {
            // Grayscale — apply terrain colormap
            const val = rasters[0][srcIdx];
            if (val === 0 || val === -9999 || isNaN(val)) {
              imgData.data[dstIdx + 3] = 0; // transparent nodata
            } else {
              // Simple terrain colormap
              const norm = Math.max(0, Math.min(255, val));
              imgData.data[dstIdx] = norm;
              imgData.data[dstIdx + 1] = Math.min(255, norm + 40);
              imgData.data[dstIdx + 2] = Math.max(0, norm - 30);
              imgData.data[dstIdx + 3] = 255;
            }
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
      setImageData(canvas.toDataURL("image/png", 0.8));
    } catch (err: any) {
      console.error("GeoTIFF error:", err);
      alert(`Error al procesar GeoTIFF: ${err.message}\n\nVerifica que el archivo sea un GeoTIFF válido con coordenadas embebidas.`);
    } finally {
      setProcessingTiff(false);
      e.target.value = "";
    }
  };

  // ── GeoJSON handler ──
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
        } else { alert("El archivo no es un GeoJSON válido"); }
      } catch { alert("Error al parsear el archivo JSON"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── KML handler ──
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
          const point = pm.querySelector("Point coordinates");
          if (point) {
            const [lng, lat] = (point.textContent || "").trim().split(",").map(Number);
            features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { name } });
          }
          const line = pm.querySelector("LineString coordinates");
          if (line) {
            const coords = (line.textContent || "").trim().split(/\s+/).map(c => { const [lng, lat, alt] = c.split(",").map(Number); return [lng, lat, alt || 0]; });
            features.push({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { name } });
          }
          const poly = pm.querySelector("Polygon outerBoundaryIs LinearRing coordinates");
          if (poly) {
            const coords = (poly.textContent || "").trim().split(/\s+/).map(c => { const [lng, lat, alt] = c.split(",").map(Number); return [lng, lat, alt || 0]; });
            features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: { name } });
          }
        });
        if (features.length > 0) { setGeojsonData({ type: "FeatureCollection", features }); }
        else { alert("No se encontraron geometrías válidas en el KML"); }
      } catch { alert("Error al parsear el archivo KML"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const submitImageOverlay = () => {
    if (!imageData || !swLat || !swLng || !neLat || !neLng) { alert("Completa todos los campos"); return; }
    onAddOverlay({
      id: `img-${Date.now()}`, name: imageName || "Imagen", type: "image", visible: true, opacity: 0.7,
      imageData, bounds: [[parseFloat(swLat), parseFloat(swLng)], [parseFloat(neLat), parseFloat(neLng)]],
      addedAt: new Date().toISOString(),
    });
    resetForm();
  };

  const submitGeoJSONOverlay = () => {
    if (!geojsonData) { alert("Carga un archivo GeoJSON o KML primero"); return; }
    onAddOverlay({
      id: `geo-${Date.now()}`, name: geojsonName || "Capa vectorial", type: "geojson", visible: true, opacity: 0.8,
      geojsonData, color: geojsonColor, addedAt: new Date().toISOString(),
    });
    resetForm();
  };

  const resetForm = () => {
    setShowUpload(false); setImageData(null); setImageName("");
    setSwLat(""); setSwLng(""); setNeLat(""); setNeLng("");
    setGeojsonData(null); setGeojsonName("");
  };

  return (
    <div className="absolute inset-0 z-[3000] bg-gray-900/95 backdrop-blur-xl flex flex-col text-white overflow-hidden">
      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageFile} />
      <input ref={tiffInputRef} type="file" accept=".tif,.tiff,.geotiff" className="hidden" onChange={handleGeoTIFF} />
      <input ref={geojsonInputRef} type="file" accept=".geojson,.json,.kml,.kmz" className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.name.endsWith(".kml") || file.name.endsWith(".kmz")) { handleKMLFile(e); }
          else { handleGeoJSONFile(e); }
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
            <button onClick={() => setShowUpload(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-800/50 border border-blue-600 text-blue-300 hover:bg-blue-800 font-medium">
              + Agregar capa
            </button>
          )}
          <button onClick={onClose} className="w-10 h-10 rounded-xl bg-gray-800 border border-gray-600 flex items-center justify-center text-xl hover:bg-gray-700">&times;</button>
        </div>
      </div>

      {/* Upload form */}
      {showUpload && (
        <div className="p-4 border-b border-gray-700 bg-gray-800/50">
          {/* Type tabs — 3 options */}
          <div className="flex gap-1.5 mb-3">
            <button onClick={() => setUploadType("image")}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${uploadType === "image" ? "bg-amber-700 text-white" : "bg-gray-700 text-gray-400"}`}>
              🖼️ Imagen
            </button>
            <button onClick={() => setUploadType("geotiff")}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${uploadType === "geotiff" ? "bg-emerald-700 text-white" : "bg-gray-700 text-gray-400"}`}>
              🌍 GeoTIFF
            </button>
            <button onClick={() => setUploadType("geojson")}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${uploadType === "geojson" ? "bg-blue-700 text-white" : "bg-gray-700 text-gray-400"}`}>
              📐 GeoJSON/KML
            </button>
          </div>

          {/* ── GeoTIFF tab ── */}
          {uploadType === "geotiff" && (
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <button onClick={() => tiffInputRef.current?.click()} disabled={processingTiff}
                  className="flex-shrink-0 w-24 h-24 rounded-xl border-2 border-dashed border-gray-500 flex flex-col items-center justify-center text-gray-400 hover:border-emerald-500 hover:text-emerald-300 transition-all disabled:opacity-50">
                  {processingTiff ? (
                    <><div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" /><span className="text-[10px] mt-1">Procesando...</span></>
                  ) : imageData ? (
                    <img src={imageData} alt="Preview" className="w-full h-full object-cover rounded-lg" />
                  ) : (
                    <><span className="text-2xl">🌍</span><span className="text-[10px] mt-1">.tif/.tiff</span></>
                  )}
                </button>
                <div className="flex-1 flex flex-col gap-2">
                  <input type="text" value={imageName} onChange={(e) => setImageName(e.target.value)} placeholder="Nombre de la capa..."
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none" />
                  <span className="text-[10px] text-emerald-400">✨ Las coordenadas se extraen automáticamente del archivo</span>
                  {swLat && (
                    <span className="text-[10px] text-gray-400 font-mono">
                      📍 SW: {swLat}, {swLng} → NE: {neLat}, {neLng}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={resetForm} className="flex-1 py-2 rounded-lg bg-gray-700 text-gray-300 text-sm">Cancelar</button>
                <button onClick={submitImageOverlay} disabled={!imageData || processingTiff}
                  className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50">
                  Agregar GeoTIFF
                </button>
              </div>
            </div>
          )}

          {/* ── Image tab (manual coords) ── */}
          {uploadType === "image" && (
            <div className="flex flex-col gap-3">
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
                  <span className="text-[10px] text-gray-500">JPG/PNG — requiere coordenadas manuales</span>
                </div>
              </div>
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
          )}

          {/* ── GeoJSON/KML tab ── */}
          {uploadType === "geojson" && (
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
            <span className="text-xs">Soporta imágenes, GeoTIFF, GeoJSON y KML.</span>
          </div>
        )}

        {overlays.map((overlay) => (
          <div key={overlay.id}
            className={`rounded-xl border p-3 transition-all ${overlay.visible ? "bg-gray-800/50 border-gray-500" : "bg-gray-800/20 border-gray-700"}`}>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <button onClick={() => onToggleOverlay(overlay.id)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${overlay.visible ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-500"}`}>
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
            {overlay.visible && (
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-700">
                <span className="text-[10px] text-gray-500">Opacidad</span>
                <input type="range" min="0.1" max="1" step="0.1" value={overlay.opacity}
                  onChange={(e) => onOpacityChange(overlay.id, parseFloat(e.target.value))}
                  className="flex-1 h-1 bg-gray-600 rounded-full appearance-none cursor-pointer accent-blue-500" />
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
