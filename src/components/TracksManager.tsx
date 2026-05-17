"use client";

import { useState } from "react";

interface TrackPoint {
  lat: number;
  lng: number;
  alt: number | null;
  time: string;
}

interface SavedTrack {
  id: string;
  name: string;
  date: string;
  distance: string;
  duration: number; // seconds
  pointCount: number;
  points: TrackPoint[];
  color: string;
}

interface TracksManagerProps {
  tracks: SavedTrack[];
  visibleTrackIds: string[];
  onClose: () => void;
  onToggleTrack: (id: string) => void;
  onDeleteTrack: (id: string) => void;
  onRenameTrack: (id: string, name: string) => void;
  onExportTrack: (track: SavedTrack, format: "gpx" | "kml" | "geojson") => void;
  onShowAll: () => void;
  onHideAll: () => void;
}

const TRACK_COLORS = ["#f59e0b", "#3b82f6", "#ef4444", "#22c55e", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];

const formatDuration = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
};

export default function TracksManager({
  tracks, visibleTrackIds, onClose, onToggleTrack, onDeleteTrack, onRenameTrack, onExportTrack, onShowAll, onHideAll
}: TracksManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const startRename = (track: SavedTrack) => {
    setEditingId(track.id);
    setEditName(track.name);
  };

  const saveRename = () => {
    if (editingId && editName.trim()) {
      onRenameTrack(editingId, editName.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="absolute inset-0 z-[3000] bg-gray-900/95 backdrop-blur-xl flex flex-col text-white overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <div>
          <h2 className="font-bold text-lg">🚶 Rutas Guardadas</h2>
          <span className="text-xs text-gray-400">{tracks.length} rutas — {visibleTrackIds.length} visibles en mapa</span>
        </div>
        <div className="flex gap-2 items-center">
          {tracks.length > 0 && (
            <>
              <button onClick={onShowAll} className="text-xs px-2.5 py-1.5 rounded-lg bg-green-900/50 border border-green-700 text-green-400 hover:bg-green-900">
                👁️ Todas
              </button>
              <button onClick={onHideAll} className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-600 text-gray-400 hover:text-white">
                🚫 Ocultar
              </button>
            </>
          )}
          <button onClick={onClose} className="w-10 h-10 rounded-xl bg-gray-800 border border-gray-600 flex items-center justify-center text-xl hover:bg-gray-700">
            &times;
          </button>
        </div>
      </div>

      {/* Tracks list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {tracks.length === 0 && (
          <div className="text-center text-gray-500 py-12">
            <span className="text-4xl block mb-3">🚶</span>
            No hay rutas guardadas aún.<br />
            <span className="text-xs">Usa el botón "🚶 Ruta" para grabar tu recorrido.</span>
          </div>
        )}

        {tracks.map((track) => {
          const isVisible = visibleTrackIds.includes(track.id);
          const isExpanded = expandedId === track.id;

          return (
            <div
              key={track.id}
              className={`rounded-xl border p-4 transition-all ${
                isVisible ? "bg-gray-800/50 border-gray-500" : "bg-gray-800/20 border-gray-700"
              }`}
            >
              {/* Track header */}
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Visibility toggle */}
                  <button
                    onClick={() => onToggleTrack(track.id)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${
                      isVisible ? "bg-amber-600 text-white" : "bg-gray-700 text-gray-500"
                    }`}
                  >
                    {isVisible ? "👁️" : "👁️‍🗨️"}
                  </button>

                  {/* Color dot + name */}
                  <div className="flex-1 min-w-0" onClick={() => setExpandedId(isExpanded ? null : track.id)}>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: track.color }} />
                      {editingId === track.id ? (
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={saveRename}
                          onKeyDown={(e) => e.key === "Enter" && saveRename()}
                          autoFocus
                          className="bg-gray-900 border border-blue-500 rounded px-2 py-0.5 text-sm text-white focus:outline-none w-full"
                        />
                      ) : (
                        <span className="font-medium text-sm truncate">{track.name}</span>
                      )}
                    </div>
                    <div className="flex gap-3 text-xs text-gray-400 mt-0.5">
                      <span>📅 {track.date}</span>
                      <span>📏 {track.distance}</span>
                      <span>⏱️ {formatDuration(track.duration)}</span>
                      <span>📍 {track.pointCount} pts</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-1 flex-shrink-0 ml-2">
                  <button
                    onClick={() => startRename(track)}
                    className="px-2 py-1 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-xs"
                  >
                    ✏️
                  </button>
                  {confirmDeleteId === track.id ? (
                    <div className="flex gap-1">
                      <button onClick={() => onDeleteTrack(track.id)} className="px-2 py-1 rounded-lg bg-red-600 text-white text-xs">Sí</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-1 rounded-lg bg-gray-700 text-gray-300 text-xs">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(track.id)} className="px-2 py-1 rounded-lg bg-gray-700 text-red-400 hover:bg-red-900/50 text-xs">🗑️</button>
                  )}
                </div>
              </div>

              {/* Expanded: export buttons */}
              {isExpanded && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-gray-700">
                  <button onClick={() => onExportTrack(track, "gpx")} className="flex-1 py-1.5 rounded-lg bg-emerald-800/60 border border-emerald-600 text-emerald-300 text-xs font-medium hover:bg-emerald-700">📥 GPX</button>
                  <button onClick={() => onExportTrack(track, "kml")} className="flex-1 py-1.5 rounded-lg bg-sky-800/60 border border-sky-600 text-sky-300 text-xs font-medium hover:bg-sky-700">🌍 KML</button>
                  <button onClick={() => onExportTrack(track, "geojson")} className="flex-1 py-1.5 rounded-lg bg-violet-800/60 border border-violet-600 text-violet-300 text-xs font-medium hover:bg-violet-700">📐 GeoJSON</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { TRACK_COLORS };
export type { SavedTrack, TrackPoint };
