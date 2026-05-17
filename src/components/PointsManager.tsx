"use client";

import { useState } from "react";

interface GeoData {
  fecha?: string;
  numero_de_punto?: string;
  caja?: string;
  nivel?: string;
  alteracion?: string;
  mineralogia?: string;
  observaciones?: string;
  id_muestra?: string;
  _transcripcion?: string;
}

interface Point {
  id: string;
  lat: number;
  lng: number;
  data?: GeoData;
}

interface PointsManagerProps {
  points: Point[];
  onClose: () => void;
  onUpdate: (points: Point[]) => void;
}

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

const EDITABLE_FIELDS = ["fecha", "numero_de_punto", "caja", "nivel", "alteracion", "mineralogia", "observaciones", "id_muestra"];

export default function PointsManager({ points, onClose, onUpdate }: PointsManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<GeoData | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const savedPoints = points.filter((p) => p.data);
  const pendingPoints = points.filter((p) => !p.data);

  const startEdit = (point: Point) => {
    setEditingId(point.id);
    setEditData({ ...point.data } as GeoData);
    setConfirmDeleteId(null);
  };

  const saveEdit = () => {
    if (!editingId || !editData) return;
    const updated = points.map((p) =>
      p.id === editingId ? { ...p, data: editData } : p
    );
    onUpdate(updated);
    setEditingId(null);
    setEditData(null);
  };

  const deletePoint = (id: string) => {
    const updated = points.filter((p) => p.id !== id);
    onUpdate(updated);
    setConfirmDeleteId(null);
    if (editingId === id) {
      setEditingId(null);
      setEditData(null);
    }
  };

  const clearAll = () => {
    if (confirm("¿Eliminar TODOS los puntos? Esta acción no se puede deshacer.")) {
      onUpdate([]);
      localStorage.removeItem("geologgia-points");
    }
  };

  return (
    <div className="absolute inset-0 z-[3000] bg-gray-900/95 backdrop-blur-xl flex flex-col text-white overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <div>
          <h2 className="font-bold text-lg">📋 Puntos Geológicos</h2>
          <span className="text-xs text-gray-400">{savedPoints.length} guardados, {pendingPoints.length} pendientes</span>
        </div>
        <div className="flex gap-2 items-center">
          {points.length > 0 && (
            <button onClick={clearAll} className="text-xs px-3 py-1.5 rounded-lg bg-red-900/50 border border-red-700 text-red-400 hover:bg-red-900">
              🗑️ Borrar todo
            </button>
          )}
          <button onClick={onClose} className="w-10 h-10 rounded-xl bg-gray-800 border border-gray-600 flex items-center justify-center text-xl hover:bg-gray-700">
            &times;
          </button>
        </div>
      </div>

      {/* Points list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {points.length === 0 && (
          <div className="text-center text-gray-500 py-12">
            <span className="text-4xl block mb-3">📍</span>
            No hay puntos registrados aún.
          </div>
        )}

        {points.map((point) => (
          <div
            key={point.id}
            className={`rounded-xl border p-4 transition-all ${
              point.data
                ? "bg-gray-800/50 border-gray-600"
                : "bg-yellow-900/20 border-yellow-700/40"
            }`}
          >
            {/* Point header */}
            <div className="flex justify-between items-start mb-2">
              <div>
                <span className={`font-mono font-bold text-sm ${point.data ? "text-green-400" : "text-yellow-400"}`}>
                  {point.id}
                </span>
                <span className="text-xs text-gray-500 ml-2">
                  {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
                </span>
              </div>
              <div className="flex gap-1.5">
                {point.data && (
                  <button
                    onClick={() => editingId === point.id ? setEditingId(null) : startEdit(point)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                      editingId === point.id
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    ✏️ {editingId === point.id ? "Cancelar" : "Editar"}
                  </button>
                )}
                {confirmDeleteId === point.id ? (
                  <div className="flex gap-1">
                    <button onClick={() => deletePoint(point.id)} className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-xs font-medium">
                      Sí, borrar
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} className="px-2.5 py-1 rounded-lg bg-gray-700 text-gray-300 text-xs">
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(point.id)}
                    className="px-2.5 py-1 rounded-lg bg-gray-700 text-red-400 hover:bg-red-900/50 text-xs"
                  >
                    🗑️
                  </button>
                )}
              </div>
            </div>

            {/* Point data (view mode) */}
            {point.data && editingId !== point.id && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                {EDITABLE_FIELDS.map((key) => {
                  const val = (point.data as any)?.[key];
                  if (!val || val === "No especificado") return null;
                  return (
                    <div key={key} className="text-xs">
                      <span className="text-gray-500">{FIELD_LABELS[key]}:</span>{" "}
                      <span className="text-gray-200">{val}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Point data (edit mode) */}
            {editingId === point.id && editData && (
              <div className="flex flex-col gap-2 mt-3">
                {EDITABLE_FIELDS.map((key) => (
                  <div key={key} className="flex flex-col gap-0.5">
                    <label className="text-xs text-gray-500 uppercase tracking-wide">{FIELD_LABELS[key]}</label>
                    {key === "observaciones" ? (
                      <textarea
                        value={(editData as any)[key] || ""}
                        onChange={(e) => setEditData({ ...editData, [key]: e.target.value })}
                        rows={2}
                        className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none resize-none"
                      />
                    ) : (
                      <input
                        type="text"
                        value={(editData as any)[key] || ""}
                        onChange={(e) => setEditData({ ...editData, [key]: e.target.value })}
                        className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                      />
                    )}
                  </div>
                ))}

                {/* Show transcription if available */}
                {editData._transcripcion && (
                  <div className="mt-1 p-2 rounded-lg bg-gray-900/60 border border-gray-700">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">Transcripción IA:</span>
                    <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{editData._transcripcion}</p>
                  </div>
                )}

                <button
                  onClick={saveEdit}
                  className="mt-1 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-sm font-medium"
                >
                  ✓ Guardar cambios
                </button>
              </div>
            )}

            {/* Pending point */}
            {!point.data && (
              <span className="text-xs text-yellow-500">⏳ Sin datos — toca el punto en el mapa para grabar</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
