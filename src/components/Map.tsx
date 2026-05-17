"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import PointRecorder from "./PointRecorder";
import PointsManager from "./PointsManager";
import TracksManager, { TRACK_COLORS } from "./TracksManager";
import type { SavedTrack } from "./TracksManager";
import OverlayManager from "./OverlayManager";
import type { GeoOverlay } from "./OverlayManager";

// Declare Leaflet as global (loaded from CDN in layout.tsx)
declare const L: any;

interface Point {
  id: string;
  lat: number;
  lng: number;
  data?: any;
}

// Default fallback: Santiago de Chile
const DEFAULT_POSITION: [number, number] = [-33.4489, -70.6693];

export default function Map() {
  const [mounted, setMounted] = useState(false);
  const mapRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [activePoint, setActivePoint] = useState<Point | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gpsPosition, setGpsPosition] = useState<[number, number] | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const markersRef = useRef<any[]>([]);

  // ── Point configuration ──
  const [showConfig, setShowConfig] = useState(false);
  const [showPointsManager, setShowPointsManager] = useState(false);
  const [pointPrefix, setPointPrefix] = useState("PT");
  const [startNumber, setStartNumber] = useState(1);
  const [configApplied, setConfigApplied] = useState(false);
  const nextNumberRef = useRef(1);

  // ── Track recording ──
  interface TrackPoint { lat: number; lng: number; alt: number | null; time: string; }
  const [isTracking, setIsTracking] = useState(false);
  const [trackPoints, setTrackPoints] = useState<TrackPoint[]>([]);
  const [trackElapsed, setTrackElapsed] = useState(0);
  const [showTrackExport, setShowTrackExport] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const polylineRef = useRef<any>(null);
  const trackTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ── Saved tracks ──
  const [savedTracks, setSavedTracks] = useState<SavedTrack[]>([]);
  const [visibleTrackIds, setVisibleTrackIds] = useState<string[]>([]);
  const [showTracksManager, setShowTracksManager] = useState(false);
  const trackPolylinesRef = useRef<Record<string, any>>({});

  // ── Overlays ──
  const [overlays, setOverlays] = useState<GeoOverlay[]>([]);
  const [showOverlayManager, setShowOverlayManager] = useState(false);
  const overlayLayersRef = useRef<Record<string, any>>({});

  // Client-side mount guard + load saved data
  useEffect(() => {
    setMounted(true);

    // Restore config from localStorage
    try {
      const savedConfig = localStorage.getItem("geologgia-config");
      if (savedConfig) {
        const cfg = JSON.parse(savedConfig);
        setPointPrefix(cfg.prefix || "PT");
        setStartNumber(cfg.nextNumber || 1);
        nextNumberRef.current = cfg.nextNumber || 1;
        setConfigApplied(true);
      }

      const savedPoints = localStorage.getItem("geologgia-points");
      if (savedPoints) {
        const pts = JSON.parse(savedPoints) as Point[];
        setPoints(pts);
      }

      // Load saved tracks
      const savedTracksData = localStorage.getItem("geologgia-tracks");
      if (savedTracksData) {
        setSavedTracks(JSON.parse(savedTracksData));
      }

      // Load overlays
      const savedOverlays = localStorage.getItem("geologgia-overlays");
      if (savedOverlays) {
        setOverlays(JSON.parse(savedOverlays));
      }
    } catch { /* ignore parse errors */ }
  }, []);

  // Save points to localStorage whenever they change
  useEffect(() => {
    if (!mounted) return;
    if (points.length === 0) {
      localStorage.removeItem("geologgia-points");
      return;
    }
    localStorage.setItem("geologgia-points", JSON.stringify(points));
  }, [points, mounted]);

  // ── Sync Leaflet markers with points state ──
  const syncMarkersToPoints = useCallback((updatedPoints: Point[]) => {
    if (!mapRef.current || typeof L === "undefined") return;

    // Remove ALL existing markers from the map
    markersRef.current.forEach((m) => {
      if (mapRef.current) mapRef.current.removeLayer(m);
    });
    markersRef.current = [];

    // Re-draw markers from the updated points
    updatedPoints.forEach((p, i) => {
      const hasSaved = !!p.data;
      const icon = L.divIcon({
        html: `<div style="width:28px;height:28px;background:${hasSaved ? '#22c55e' : '#ef4444'};border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold;">${i + 1}</div>`,
        iconSize: [28, 28], iconAnchor: [14, 14], className: "",
      });
      const m = L.marker([p.lat, p.lng], { icon }).addTo(mapRef.current);
      m.bindPopup(`<b>${p.id}</b><br>${hasSaved ? (p.data?.alteracion || '') + '<br>' + (p.data?.mineralogia || '') : 'Sin datos'}`);
      markersRef.current.push(m);
    });
  }, []);

  // ── Trash system for recovery ──
  const moveToTrash = (deletedPoints: Point[]) => {
    try {
      const existing = JSON.parse(localStorage.getItem("geologgia-trash") || "[]");
      const trashEntry = {
        deletedAt: new Date().toISOString(),
        points: deletedPoints,
      };
      // Keep last 10 trash entries
      const updated = [trashEntry, ...existing].slice(0, 10);
      localStorage.setItem("geologgia-trash", JSON.stringify(updated));
    } catch { /* ignore */ }
  };

  // Save config to localStorage
  const saveConfig = () => {
    localStorage.setItem("geologgia-config", JSON.stringify({
      prefix: pointPrefix,
      nextNumber: nextNumberRef.current,
    }));
  };

  // When config is applied, update the counter and persist
  const applyConfig = () => {
    nextNumberRef.current = startNumber;
    setConfigApplied(true);
    setShowConfig(false);
    localStorage.setItem("geologgia-config", JSON.stringify({
      prefix: pointPrefix,
      nextNumber: startNumber,
    }));
  };

  // Generate next point ID
  const getNextPointId = () => {
    const num = nextNumberRef.current;
    nextNumberRef.current = num + 1;
    return `${pointPrefix}-${String(num).padStart(3, "0")}`;
  };

  // Create a geological point and open the recorder
  const createGeoPoint = useCallback((lat: number, lng: number) => {
    if (!mapRef.current || typeof L === "undefined") return;

    const pointId = getNextPointId();
    const displayNum = nextNumberRef.current - 1; // The number we just used

    const newPoint: Point = {
      id: pointId,
      lat,
      lng,
    };

    const geoIcon = L.divIcon({
      html: `<div style="
        width: 28px; height: 28px; 
        background: #ef4444; 
        border: 3px solid white; 
        border-radius: 50%; 
        box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        display: flex; align-items: center; justify-content: center;
        color: white; font-size: 11px; font-weight: bold;
      ">${displayNum}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      className: "",
    });

    const marker = L.marker([lat, lng], { icon: geoIcon }).addTo(mapRef.current);
    marker.bindPopup(`<b>${newPoint.id}</b><br>Lat: ${lat.toFixed(5)}<br>Lng: ${lng.toFixed(5)}`);
    markersRef.current.push(marker);

    setPoints((prev) => [...prev, newPoint]);
    setActivePoint(newPoint);

    mapRef.current.setView([lat, lng], mapRef.current.getZoom());
  }, [pointPrefix]);

  useEffect(() => {
    if (!mounted) return;
    if (mapRef.current) return;

    const initMap = () => {
      try {
        if (typeof L === "undefined") {
          setTimeout(initMap, 500);
          return;
        }

        if (!mapContainerRef.current) {
          setError("Container del mapa no disponible");
          return;
        }

        delete (L.Icon.Default.prototype as any)._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
          iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
          shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
        });

        const map = L.map(mapContainerRef.current, {
          center: DEFAULT_POSITION,
          zoom: 13,
          zoomControl: false,
          doubleClickZoom: false,
        });

        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
          { attribution: "Tiles &copy; Esri", maxZoom: 18 }
        ).addTo(map);

        L.tileLayer.wms(
          "https://ide.sernageomin.cl/arcgis/services/Geologia/Geologia_Basica_Sernageomin/MapServer/WMSServer",
          { layers: "0", format: "image/png", transparent: true, opacity: 0.5, attribution: "&copy; SERNAGEOMIN" }
        ).addTo(map);

        L.control.zoom({ position: "topright" }).addTo(map);

        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const latlng: [number, number] = [pos.coords.latitude, pos.coords.longitude];
              setGpsPosition(latlng);
              setGpsAccuracy(pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null);
              map.setView(latlng, 14);
              const gpsIcon = L.divIcon({
                html: `<div style="width:20px;height:20px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 0 12px rgba(59,130,246,0.7);animation:pulse 2s infinite;"></div>`,
                iconSize: [20, 20], iconAnchor: [10, 10], className: "",
              });
              L.marker(latlng, { icon: gpsIcon }).addTo(map).bindPopup("📍 Tu ubicación GPS");
            },
            () => { setGpsPosition(null); },
            { timeout: 8000, enableHighAccuracy: true }
          );

          // Continuous GPS watch for accuracy updates
          navigator.geolocation.watchPosition(
            (pos) => {
              setGpsPosition([pos.coords.latitude, pos.coords.longitude]);
              setGpsAccuracy(pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null);
            },
            () => {},
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
          );
        }

        // Double-click on map -> create point (prevents accidental marks while panning)
        map.on("dblclick", (e: any) => {
          window.dispatchEvent(new CustomEvent("geologgia-map-click", { detail: { lat: e.latlng.lat, lng: e.latlng.lng } }));
        });

        mapRef.current = map;
        setMapReady(true);

        // Restore saved markers on the map
        try {
          const savedPoints = localStorage.getItem("geologgia-points");
          if (savedPoints) {
            const pts = JSON.parse(savedPoints) as Point[];
            pts.forEach((p, i) => {
              if (p.data) {
                const icon = L.divIcon({
                  html: `<div style="width:28px;height:28px;background:#22c55e;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold;">${i + 1}</div>`,
                  iconSize: [28, 28], iconAnchor: [14, 14], className: "",
                });
                const m = L.marker([p.lat, p.lng], { icon }).addTo(map);
                m.bindPopup(`<b>${p.id}</b><br>${p.data.alteracion || ""}<br>${p.data.mineralogia || ""}`);
                markersRef.current.push(m);
              }
            });
          }
        } catch { /* ignore */ }
      } catch (err: any) {
        console.error("Error cargando mapa:", err);
        setError(err.message || "Error desconocido al cargar el mapa");
      }
    };

    initMap();
    return () => {
      // Cleanup GPS tracking
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (trackTimerRef.current) clearInterval(trackTimerRef.current);
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [mounted]);

  useEffect(() => {
    const handler = (e: any) => {
      const { lat, lng } = e.detail;
      createGeoPoint(lat, lng);
    };
    window.addEventListener("geologgia-map-click", handler);
    return () => window.removeEventListener("geologgia-map-click", handler);
  }, [createGeoPoint]);

  const handleRecordAtGPS = () => {
    if (!gpsPosition) {
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const latlng: [number, number] = [pos.coords.latitude, pos.coords.longitude];
            setGpsPosition(latlng);
            createGeoPoint(latlng[0], latlng[1]);
          },
          () => alert("GPS no disponible. Activa la ubicación."),
          { timeout: 8000, enableHighAccuracy: true }
        );
      }
      return;
    }
    createGeoPoint(gpsPosition[0], gpsPosition[1]);
  };

  const handleSave = useCallback(
    (data: any) => {
      if (!activePoint) return;
      setPoints((prev) => prev.map((p) => p.id === activePoint.id ? { ...p, data } : p));

      // Update marker to green (saved)
      if (mapRef.current && typeof L !== "undefined") {
        const idx = points.findIndex((p) => p.id === activePoint.id);
        if (idx >= 0 && markersRef.current[idx]) {
          const m = markersRef.current[idx];
          const greenIcon = L.divIcon({
            html: `<div style="width:28px;height:28px;background:#22c55e;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold;">${idx + 1}</div>`,
            iconSize: [28, 28], iconAnchor: [14, 14], className: "",
          });
          m.setIcon(greenIcon);
          m.bindPopup(`<b>${activePoint.id}</b><br>${data.alteracion || ""}<br>${data.mineralogia || ""}`);
        }
      }

      setActivePoint(null);
      // Persist config (next number has already incremented)
      saveConfig();
    },
    [activePoint, pointPrefix, points]
  );

  // Export to CSV
  const exportCSV = () => {
    const savedPoints = points.filter((p) => p.data);
    if (savedPoints.length === 0) { alert("No hay puntos guardados para exportar."); return; }
    const headers = ["ID","Lat","Lng","Fecha","N° Punto","Litología","Nivel","Alteración","Mineralogía","Observaciones","ID Muestra"];
    const rows = savedPoints.map((p) => [p.id, p.lat.toFixed(6), p.lng.toFixed(6), p.data?.fecha||"", p.data?.numero_de_punto||p.id, p.data?.litologia||p.data?.caja||"", p.data?.nivel||"", p.data?.alteracion||"", p.data?.mineralogia||"", p.data?.observaciones||"", p.data?.id_muestra||""]);
    const csv = [headers,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    downloadFile(`geologgia_${pointPrefix}_${new Date().toISOString().slice(0,10)}.csv`, "\uFEFF"+csv, "text/csv;charset=utf-8;");
  };

  // ── Track recording ──
  const startTracking = () => {
    if (!("geolocation" in navigator)) { alert("GPS no disponible"); return; }
    setTrackPoints([]);
    setTrackElapsed(0);
    setIsTracking(true);
    setShowTrackExport(false);

    // Remove old polyline
    if (polylineRef.current && mapRef.current) {
      mapRef.current.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }

    // Start GPS watch
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const tp: TrackPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          alt: pos.coords.altitude,
          time: new Date().toISOString(),
        };
        setTrackPoints((prev) => {
          const updated = [...prev, tp];
          // Draw polyline
          if (mapRef.current && typeof L !== "undefined") {
            const coords = updated.map((p) => [p.lat, p.lng]);
            if (polylineRef.current) {
              polylineRef.current.setLatLngs(coords);
            } else {
              polylineRef.current = L.polyline(coords, { color: "#f59e0b", weight: 4, opacity: 0.9 }).addTo(mapRef.current);
            }
          }
          return updated;
        });
        setGpsPosition([pos.coords.latitude, pos.coords.longitude]);
      },
      (err) => console.warn("Track GPS error:", err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
    );

    // Timer
    trackTimerRef.current = setInterval(() => setTrackElapsed((p) => p + 1), 1000);
  };

  const stopTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (trackTimerRef.current) { clearInterval(trackTimerRef.current); trackTimerRef.current = null; }
    setIsTracking(false);
    setShowTrackExport(true);

    // Save track to savedTracks array
    if (trackPoints.length > 1) {
      const date = new Date().toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const newTrack: SavedTrack = {
        id: `trk-${Date.now()}`,
        name: `Ruta ${date}`,
        date,
        distance: calcTrackDistanceFromPoints(trackPoints),
        duration: trackElapsed,
        pointCount: trackPoints.length,
        points: trackPoints,
        color: TRACK_COLORS[savedTracks.length % TRACK_COLORS.length],
      };
      const updated = [newTrack, ...savedTracks];
      setSavedTracks(updated);
      localStorage.setItem("geologgia-tracks", JSON.stringify(updated));
    }
    // Also save last track for backward compat
    localStorage.setItem("geologgia-track", JSON.stringify(trackPoints));
  };

  // Calculate distance from a specific points array
  const calcTrackDistanceFromPoints = (pts: TrackPoint[]) => {
    let dist = 0;
    for (let i = 1; i < pts.length; i++) {
      const R = 6371000;
      const dLat = (pts[i].lat - pts[i-1].lat) * Math.PI / 180;
      const dLon = (pts[i].lng - pts[i-1].lng) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(pts[i-1].lat*Math.PI/180) * Math.cos(pts[i].lat*Math.PI/180) * Math.sin(dLon/2)**2;
      dist += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }
    return dist < 1000 ? `${Math.round(dist)} m` : `${(dist/1000).toFixed(2)} km`;
  };

  // ── Saved tracks management ──
  const toggleTrackVisibility = (id: string) => {
    setVisibleTrackIds((prev) => {
      const isVisible = prev.includes(id);
      if (isVisible) {
        // Remove polyline from map
        if (trackPolylinesRef.current[id] && mapRef.current) {
          mapRef.current.removeLayer(trackPolylinesRef.current[id]);
          delete trackPolylinesRef.current[id];
        }
        return prev.filter((tid) => tid !== id);
      } else {
        // Draw polyline on map
        const track = savedTracks.find((t) => t.id === id);
        if (track && mapRef.current && typeof L !== "undefined") {
          const coords = track.points.map((p) => [p.lat, p.lng]);
          const pl = L.polyline(coords, { color: track.color, weight: 4, opacity: 0.85, dashArray: "8 4" }).addTo(mapRef.current);
          pl.bindPopup(`<b>${track.name}</b><br>${track.distance} — ${track.pointCount} pts`);
          trackPolylinesRef.current[id] = pl;
          mapRef.current.fitBounds(pl.getBounds(), { padding: [50, 50] });
        }
        return [...prev, id];
      }
    });
  };

  const showAllTracks = () => {
    savedTracks.forEach((track) => {
      if (!visibleTrackIds.includes(track.id)) {
        toggleTrackVisibility(track.id);
      }
    });
  };

  const hideAllTracks = () => {
    visibleTrackIds.forEach((id) => {
      if (trackPolylinesRef.current[id] && mapRef.current) {
        mapRef.current.removeLayer(trackPolylinesRef.current[id]);
        delete trackPolylinesRef.current[id];
      }
    });
    setVisibleTrackIds([]);
  };

  const deleteTrack = (id: string) => {
    // Remove from map
    if (trackPolylinesRef.current[id] && mapRef.current) {
      mapRef.current.removeLayer(trackPolylinesRef.current[id]);
      delete trackPolylinesRef.current[id];
    }
    setVisibleTrackIds((prev) => prev.filter((tid) => tid !== id));
    const updated = savedTracks.filter((t) => t.id !== id);
    setSavedTracks(updated);
    localStorage.setItem("geologgia-tracks", JSON.stringify(updated));
  };

  const renameTrack = (id: string, name: string) => {
    const updated = savedTracks.map((t) => t.id === id ? { ...t, name } : t);
    setSavedTracks(updated);
    localStorage.setItem("geologgia-tracks", JSON.stringify(updated));
  };

  const exportSingleTrack = (track: SavedTrack, format: "gpx" | "kml" | "geojson") => {
    const date = new Date().toISOString().slice(0, 10);
    if (format === "gpx") {
      const trkpts = track.points.map(p => `      <trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.alt||0}</ele><time>${p.time}</time></trkpt>`).join("\n");
      downloadFile(`${track.name}.gpx`, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GeologgIA Mapper">\n  <trk>\n    <name>${track.name}</name>\n    <trkseg>\n${trkpts}\n    </trkseg>\n  </trk>\n</gpx>`, "application/gpx+xml");
    } else if (format === "kml") {
      const coords = track.points.map(p => `${p.lng},${p.lat},${p.alt||0}`).join(" ");
      downloadFile(`${track.name}.kml`, `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>${track.name}</name>\n    <Placemark>\n      <name>Ruta</name>\n      <LineString><coordinates>${coords}</coordinates></LineString>\n    </Placemark>\n  </Document>\n</kml>`, "application/vnd.google-earth.kml+xml");
    } else {
      const geojson = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: track.points.map(p => [p.lng, p.lat, p.alt||0]) }, properties: { name: track.name, date: track.date, distance: track.distance } }] }, null, 2);
      downloadFile(`${track.name}.geojson`, geojson, "application/geo+json");
    }
  };

  // ── Overlay management ──
  const addOverlay = (overlay: GeoOverlay) => {
    const updated = [...overlays, overlay];
    setOverlays(updated);
    localStorage.setItem("geologgia-overlays", JSON.stringify(updated));
    renderOverlayOnMap(overlay);
  };

  const removeOverlay = (id: string) => {
    if (overlayLayersRef.current[id] && mapRef.current) {
      mapRef.current.removeLayer(overlayLayersRef.current[id]);
      delete overlayLayersRef.current[id];
    }
    const updated = overlays.filter((o) => o.id !== id);
    setOverlays(updated);
    localStorage.setItem("geologgia-overlays", JSON.stringify(updated));
  };

  const toggleOverlay = (id: string) => {
    const overlay = overlays.find((o) => o.id === id);
    if (!overlay) return;
    const newVisible = !overlay.visible;
    if (newVisible) {
      renderOverlayOnMap({ ...overlay, visible: true });
    } else {
      if (overlayLayersRef.current[id] && mapRef.current) {
        mapRef.current.removeLayer(overlayLayersRef.current[id]);
        delete overlayLayersRef.current[id];
      }
    }
    const updated = overlays.map((o) => o.id === id ? { ...o, visible: newVisible } : o);
    setOverlays(updated);
    localStorage.setItem("geologgia-overlays", JSON.stringify(updated));
  };

  const changeOverlayOpacity = (id: string, opacity: number) => {
    if (overlayLayersRef.current[id]) {
      overlayLayersRef.current[id].setStyle?.({ opacity, fillOpacity: opacity * 0.5 });
      if (overlayLayersRef.current[id].setOpacity) overlayLayersRef.current[id].setOpacity(opacity);
    }
    const updated = overlays.map((o) => o.id === id ? { ...o, opacity } : o);
    setOverlays(updated);
    localStorage.setItem("geologgia-overlays", JSON.stringify(updated));
  };

  const renderOverlayOnMap = (overlay: GeoOverlay) => {
    if (!mapRef.current || typeof L === "undefined") return;
    // Remove existing
    if (overlayLayersRef.current[overlay.id]) {
      mapRef.current.removeLayer(overlayLayersRef.current[overlay.id]);
    }
    if (overlay.type === "image" && overlay.imageData && overlay.bounds) {
      const imgOverlay = L.imageOverlay(overlay.imageData, overlay.bounds, { opacity: overlay.opacity }).addTo(mapRef.current);
      overlayLayersRef.current[overlay.id] = imgOverlay;
      mapRef.current.fitBounds(overlay.bounds, { padding: [50, 50] });
    } else if (overlay.type === "geojson" && overlay.geojsonData) {
      const layer = L.geoJSON(overlay.geojsonData, {
        style: { color: overlay.color || "#3b82f6", weight: 2, opacity: overlay.opacity, fillOpacity: (overlay.opacity || 0.8) * 0.3 },
        onEachFeature: (feature: any, lyr: any) => {
          if (feature.properties?.name) lyr.bindPopup(`<b>${feature.properties.name}</b>`);
        },
      }).addTo(mapRef.current);
      overlayLayersRef.current[overlay.id] = layer;
      mapRef.current.fitBounds(layer.getBounds(), { padding: [50, 50] });
    }
  };

  // Render saved overlays when map is ready
  useEffect(() => {
    if (!mapReady) return;
    overlays.forEach((o) => {
      if (o.visible && !overlayLayersRef.current[o.id]) {
        renderOverlayOnMap(o);
      }
    });
  }, [mapReady]);

  const calcTrackDistance = () => {
    let dist = 0;
    for (let i = 1; i < trackPoints.length; i++) {
      const R = 6371000;
      const dLat = (trackPoints[i].lat - trackPoints[i-1].lat) * Math.PI / 180;
      const dLon = (trackPoints[i].lng - trackPoints[i-1].lng) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(trackPoints[i-1].lat*Math.PI/180) * Math.cos(trackPoints[i].lat*Math.PI/180) * Math.sin(dLon/2)**2;
      dist += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }
    return dist < 1000 ? `${Math.round(dist)} m` : `${(dist/1000).toFixed(2)} km`;
  };

  const formatElapsed = (s: number) => {
    const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const sec = s%60;
    return `${h>0?h+"h ":""} ${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  };

  const downloadFile = (name: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  const exportGPX = () => {
    const date = new Date().toISOString().slice(0,10);
    const trkpts = trackPoints.map(p => `      <trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.alt||0}</ele><time>${p.time}</time></trkpt>`).join("\n");
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GeologgIA Mapper">\n  <trk>\n    <name>Track ${date}</name>\n    <trkseg>\n${trkpts}\n    </trkseg>\n  </trk>\n</gpx>`;
    downloadFile(`track_${date}.gpx`, gpx, "application/gpx+xml");
  };

  const exportKML = () => {
    const date = new Date().toISOString().slice(0,10);
    const coords = trackPoints.map(p => `${p.lng},${p.lat},${p.alt||0}`).join(" ");
    const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>GeologgIA Track ${date}</name>\n    <Placemark>\n      <name>Ruta</name>\n      <Style><LineStyle><color>ff00bfff</color><width>4</width></LineStyle></Style>\n      <LineString><coordinates>${coords}</coordinates></LineString>\n    </Placemark>\n  </Document>\n</kml>`;
    downloadFile(`track_${date}.kml`, kml, "application/vnd.google-earth.kml+xml");
  };

  const exportGeoJSON = () => {
    const date = new Date().toISOString().slice(0,10);
    const geojson = JSON.stringify({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "LineString", coordinates: trackPoints.map(p => [p.lng, p.lat, p.alt||0]) },
        properties: { name: `Track ${date}`, date, points: trackPoints.length, creator: "GeologgIA Mapper" }
      }]
    }, null, 2);
    downloadFile(`track_${date}.geojson`, geojson, "application/geo+json");
  };

  return (
    <div className="relative w-full h-screen">
      <div ref={mapContainerRef} className="w-full h-full" />

      <style>{`
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(59,130,246,0.5); }
          70% { box-shadow: 0 0 0 15px rgba(59,130,246,0); }
          100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); }
        }
        /* Safe area for iPhone notch/home indicator */
        .safe-bottom {
          padding-bottom: max(16px, env(safe-area-inset-bottom, 16px));
        }
      `}</style>

      {/* Loading / Error overlay */}
      {!mapReady && (
        <div className="absolute inset-0 z-[2000] flex flex-col items-center justify-center bg-gray-900 text-white text-lg gap-4">
          {error ? (
            <div className="flex flex-col items-center gap-3">
              <span className="text-red-400 text-xl">❌ Error</span>
              <span className="text-sm text-gray-400 max-w-xs text-center">{error}</span>
              <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-blue-600 rounded-lg text-sm">Reintentar</button>
            </div>
          ) : (
            <span>🗺️ Cargando Mapa...</span>
          )}
        </div>
      )}

      {/* ── Top bar: GPS Accuracy + Config + Counter + Export ── */}
      {mapReady && !activePoint && (
        <div className="absolute top-0 left-0 right-0 z-[1000] safe-top pt-2 px-4 flex justify-between items-center">
          {/* GPS accuracy badge */}
          <div className="flex items-center gap-2">
            {gpsAccuracy !== null && (
              <div className={`px-2.5 py-1.5 rounded-xl backdrop-blur-md border text-xs font-mono flex items-center gap-1.5 ${
                gpsAccuracy <= 5 ? "bg-green-900/80 border-green-600 text-green-300" :
                gpsAccuracy <= 15 ? "bg-blue-900/80 border-blue-600 text-blue-300" :
                gpsAccuracy <= 30 ? "bg-amber-900/80 border-amber-600 text-amber-300" :
                "bg-red-900/80 border-red-600 text-red-300"
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  gpsAccuracy <= 5 ? "bg-green-400" :
                  gpsAccuracy <= 15 ? "bg-blue-400" :
                  gpsAccuracy <= 30 ? "bg-amber-400 animate-pulse" :
                  "bg-red-400 animate-pulse"
                }`} />
                📡 ±{gpsAccuracy}m
              </div>
            )}

            {/* Point counter — clickable to open manager */}
            <button
              onClick={() => setShowPointsManager(true)}
              className="px-3 py-1.5 rounded-xl bg-gray-900/80 backdrop-blur-md border border-gray-600 text-white text-xs flex items-center gap-2 hover:bg-gray-800 transition-all"
            >
              <span>📍 {points.filter(p => p.data).length}/{points.length}</span>
              <span className="text-gray-400">|</span>
              <span className="text-blue-300 font-mono">
                {pointPrefix}-{String(nextNumberRef.current).padStart(3, "0")}
              </span>
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex gap-1.5">
            {/* Tracks button */}
            {savedTracks.length > 0 && (
              <button
                onClick={() => setShowTracksManager(true)}
                className="h-9 px-2.5 rounded-xl bg-amber-900/80 backdrop-blur-md border border-amber-600 text-amber-300 flex items-center gap-1 hover:bg-amber-800 transition-all text-xs"
              >
                🚶 {savedTracks.length}
              </button>
            )}

            {/* Layers button */}
            <button
              onClick={() => setShowOverlayManager(true)}
              className={`h-9 px-2.5 rounded-xl backdrop-blur-md border flex items-center gap-1 hover:bg-gray-800 transition-all text-xs ${
                overlays.length > 0
                  ? "bg-blue-900/80 border-blue-600 text-blue-300"
                  : "bg-gray-900/80 border-gray-600 text-gray-300"
              }`}
            >
              🗺️ {overlays.length > 0 ? overlays.length : "Capas"}
            </button>

            {/* Export CSV */}
            {points.filter(p => p.data).length > 0 && (
              <button
                onClick={exportCSV}
                className="h-9 px-2.5 rounded-xl bg-green-800/80 backdrop-blur-md border border-green-600 text-green-300 flex items-center gap-1 hover:bg-green-700 transition-all text-xs"
              >
                📥 CSV
              </button>
            )}

            {/* Config gear */}
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="w-9 h-9 rounded-xl bg-gray-900/80 backdrop-blur-md border border-gray-600 text-white flex items-center justify-center hover:bg-gray-800 transition-all text-sm"
            >
              ⚙️
            </button>
          </div>
        </div>
      )}

      {/* ── Config Panel ── */}
      {showConfig && (
        <div className="absolute top-16 right-4 z-[1500] w-72 bg-gray-900/95 backdrop-blur-xl border border-gray-600 rounded-2xl p-4 shadow-2xl text-white">
          <h4 className="font-semibold text-sm mb-3">⚙️ Configurar Numeración</h4>
          
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wide">Prefijo</label>
              <input
                type="text"
                value={pointPrefix}
                onChange={(e) => setPointPrefix(e.target.value.toUpperCase())}
                placeholder="PT"
                className="w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
              />
            </div>

            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wide">Número inicial</label>
              <input
                type="number"
                value={startNumber}
                onChange={(e) => setStartNumber(Math.max(1, parseInt(e.target.value) || 1))}
                min={1}
                className="w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
              />
            </div>

            <div className="text-xs text-gray-400 bg-gray-800/50 rounded-lg p-2">
              Vista previa: <span className="text-blue-300 font-mono">{pointPrefix}-{String(startNumber).padStart(3, "0")}</span>, {pointPrefix}-{String(startNumber + 1).padStart(3, "0")}, {pointPrefix}-{String(startNumber + 2).padStart(3, "0")}...
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowConfig(false)}
                className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={applyConfig}
                className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm font-medium"
              >
                ✓ Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Floating Action Buttons (mobile-safe) ── */}
      {mapReady && !activePoint && !showConfig && (
        <div className="absolute bottom-0 left-0 right-0 z-[1000] safe-bottom pb-4 px-4 flex flex-col gap-2 items-center">
          {/* Track recording bar */}
          {isTracking && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-amber-900/90 backdrop-blur-md border border-amber-600 text-amber-200 text-xs">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="font-mono">{formatElapsed(trackElapsed)}</span>
              <span className="text-amber-400">|</span>
              <span>{calcTrackDistance()}</span>
              <span className="text-amber-400">|</span>
              <span>{trackPoints.length} pts</span>
              <button onClick={stopTracking} className="ml-2 px-3 py-1 bg-red-600 hover:bg-red-700 rounded-full text-white text-xs font-medium">⏹ Detener</button>
            </div>
          )}

          {/* Track export panel */}
          {showTrackExport && trackPoints.length > 0 && (
            <div className="flex flex-col gap-2 px-4 py-3 rounded-2xl bg-gray-900/90 backdrop-blur-md border border-gray-600 text-white text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">📍 Track: {calcTrackDistance()} — {trackPoints.length} puntos</span>
                <button onClick={() => setShowTrackExport(false)} className="text-gray-400 hover:text-white">&times;</button>
              </div>
              <div className="flex gap-2">
                <button onClick={exportGPX} className="flex-1 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-xs font-medium">📥 GPX</button>
                <button onClick={exportKML} className="flex-1 py-2 rounded-lg bg-sky-700 hover:bg-sky-600 text-xs font-medium">🌍 KML</button>
                <button onClick={exportGeoJSON} className="flex-1 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-xs font-medium">📐 GeoJSON</button>
              </div>
            </div>
          )}

          {/* Main action row */}
          <div className="flex flex-row gap-2 items-center flex-wrap justify-center">
            <button
              onClick={handleRecordAtGPS}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm shadow-lg shadow-blue-600/30 transition-all active:scale-95"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0013 3.06V1h-2v2.06A8.994 8.994 0 003.06 11H1v2h2.06A8.994 8.994 0 0011 20.94V23h2v-2.06A8.994 8.994 0 0020.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
              </svg>
              📍 Punto
            </button>

            {!isTracking && !showTrackExport && (
              <button
                onClick={startTracking}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-medium text-sm shadow-lg shadow-amber-600/30 transition-all active:scale-95"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
                </svg>
                🚶 Ruta
              </button>
            )}

            <div className="flex items-center px-3 py-2.5 rounded-full bg-gray-900/80 backdrop-blur-md border border-gray-600 text-gray-300 text-xs">
              <svg className="w-4 h-4 mr-2 text-red-400" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>
              Doble toque = punto
            </div>
          </div>
        </div>
      )}

      {/* ── Floating panel for audio recording (mobile-safe) ── */}
      {activePoint && (
        <div className="absolute bottom-0 left-0 right-0 md:left-auto md:w-96 md:right-4 md:bottom-4 z-[1000] bg-gray-900/95 backdrop-blur-xl border-t md:border border-gray-600 p-4 md:p-5 md:rounded-2xl shadow-2xl text-white safe-bottom">
          <PointRecorder
            point={activePoint}
            onClose={() => setActivePoint(null)}
            onSave={handleSave}
          />
        </div>
      )}
      {/* ── Points Manager overlay ── */}
      {showPointsManager && (
        <PointsManager
          points={points}
          onClose={() => setShowPointsManager(false)}
          onUpdate={(updated, deleted) => {
            if (deleted && deleted.length > 0) {
              moveToTrash(deleted);
            }
            setPoints(updated);
            localStorage.setItem("geologgia-points", JSON.stringify(updated));
            syncMarkersToPoints(updated);
          }}
          onRestore={(restored) => {
            const merged = [...points, ...restored];
            setPoints(merged);
            localStorage.setItem("geologgia-points", JSON.stringify(merged));
            syncMarkersToPoints(merged);
          }}
        />
      )}

      {/* ── Tracks Manager overlay ── */}
      {showTracksManager && (
        <TracksManager
          tracks={savedTracks}
          visibleTrackIds={visibleTrackIds}
          onClose={() => setShowTracksManager(false)}
          onToggleTrack={toggleTrackVisibility}
          onDeleteTrack={deleteTrack}
          onRenameTrack={renameTrack}
          onExportTrack={exportSingleTrack}
          onShowAll={showAllTracks}
          onHideAll={hideAllTracks}
        />
      )}

      {/* ── Overlay Manager overlay ── */}
      {showOverlayManager && (
        <OverlayManager
          overlays={overlays}
          onClose={() => setShowOverlayManager(false)}
          onAddOverlay={addOverlay}
          onRemoveOverlay={removeOverlay}
          onToggleOverlay={toggleOverlay}
          onOpacityChange={changeOverlayOpacity}
        />
      )}
    </div>
  );
}
