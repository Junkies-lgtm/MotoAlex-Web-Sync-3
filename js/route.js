/**
 * MotoAlex Navigation - Geteilte Route Viewer
 * Liest Wegpunkte & Modus aus der URL, rendert die Karte und zeigt App-Handoff
 */

// Adresse des Kartenstils (MapTiler Streets v4)
const MAP_STYLE_URL = 'https://api.maptiler.com/maps/streets-v4/style.json?key=dmKZNBELPxVIfl7kMaLH';

// Basisadresse des BRouter-Routendienstes (eigener Server)
const ROUTING_SERVICE_URL = 'https://brouter.motoalex-navigation.de/brouter';

// BRouter-Profil-ID
const PROFILE_ID = 'motorcycle';

// Zuordnung der vier Routing-Modi zu BRouter-Profilparametern (profile:name=wert)
const MODE_PARAMETERS = {
  schnellste: {
    avoid_motorways: 0,
    consider_town: 0,
    curviness: 0
  },
  schnell: {
    avoid_motorways: 1,
    consider_town: 0,
    curviness: 0
  },
  kurvig: {
    avoid_motorways: 1,
    consider_town: 1,
    curviness: 1
  },
  extra_kurvig: {
    avoid_motorways: 1,
    consider_town: 1,
    curviness: 2
  }
};

const MODE_LABELS = {
  schnellste: 'Schnellste Route (Autobahn bevorzugt)',
  schnell: 'Schnelle Landstraße',
  kurvig: 'Kurvige Landstraße',
  extra_kurvig: 'Extra Kurvig (Nebenstrecken)'
};

let mapInstance = null;

document.addEventListener('DOMContentLoaded', () => {
  initRouteViewer();
});

function initRouteViewer() {
  const parseResult = window.RouteUrl ? window.RouteUrl.parseRouteUrl(window.location.search) : { valid: false, error: 'URL-Parser nicht geladen.' };

  const errorContainer = document.getElementById('route-error-container');
  const successContainer = document.getElementById('route-success-container');

  if (!parseResult.valid) {
    // Fehlerzustand anzeigen
    if (errorContainer) errorContainer.style.display = 'block';
    if (successContainer) successContainer.style.display = 'none';

    const detailsEl = document.getElementById('error-details');
    if (detailsEl && parseResult.error) {
      detailsEl.innerText = parseResult.error;
    }
    return;
  }

  // Erfolgszustand anzeigen
  if (errorContainer) errorContainer.style.display = 'none';
  if (successContainer) successContainer.style.display = 'block';

  const { waypoints, mode, segmentModes } = parseResult;
  const numSegments = Math.max(1, waypoints.length - 1);
  const activeSegmentModes = segmentModes && segmentModes.length > 0 ? segmentModes : Array(numSegments).fill(mode || 'kurvig');

  // Prüfen, ob alle Segmente denselben Modus haben
  const allSameMode = activeSegmentModes.every(m => m === activeSegmentModes[0]);

  // Header & Badges aktualisieren
  const modeBadge = document.getElementById('route-mode-badge');
  if (modeBadge) {
    if (allSameMode) {
      modeBadge.innerText = `Profil: ${MODE_LABELS[activeSegmentModes[0]] || activeSegmentModes[0]}`;
    } else {
      modeBadge.innerText = 'Profil: Individuelle Abschnitte';
    }
  }

  const pointsBadge = document.getElementById('route-points-badge');
  if (pointsBadge) {
    pointsBadge.innerText = `${waypoints.length} Wegpunkte (${numSegments} ${numSegments === 1 ? 'Abschnitt' : 'Abschnitte'})`;
  }

  const statPoints = document.getElementById('route-stat-points');
  if (statPoints) {
    statPoints.innerText = String(waypoints.length);
  }

  // "Im Web-Planer bearbeiten" Link aktualisieren
  const btnPlaner = document.getElementById('btn-open-in-planer');
  if (btnPlaner) {
    const searchParams = window.location.search;
    btnPlaner.href = `planer.html${searchParams}`;
  }

  // Wegpunkt-Liste rendern
  renderWaypointList(waypoints, activeSegmentModes);

  // Karte initialisieren
  renderRouteMap(waypoints, activeSegmentModes);
}

/**
 * Rendert die tabellarische Wegpunkt-Übersicht inklusive Abschnitts-Profile
 */
function renderWaypointList(waypoints, segmentModes = []) {
  const listEl = document.getElementById('route-waypoints-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  const total = waypoints.length;

  waypoints.forEach((wp, idx) => {
    // Abschnitts-Hinweis vor dem Wegpunkt anzeigen (ab dem 2. Punkt)
    if (idx > 0 && segmentModes.length >= idx) {
      const segMode = segmentModes[idx - 1] || 'kurvig';
      const segLi = document.createElement('li');
      segLi.className = 'route-segment-info-item';
      segLi.style.padding = '4px 12px 4px 28px';
      segLi.style.fontSize = '12px';
      segLi.style.color = 'var(--text-dim)';
      segLi.style.display = 'flex';
      segLi.style.alignItems = 'center';
      segLi.style.gap = '6px';
      segLi.style.borderLeft = '2px dashed var(--surface-light)';
      segLi.style.marginLeft = '20px';

      segLi.innerHTML = `
        <span style="font-size: 11px;">↳ Abschnitt ${idx}: <strong>${MODE_LABELS[segMode] || segMode}</strong></span>
      `;
      listEl.appendChild(segLi);
    }

    const li = document.createElement('li');
    li.className = 'route-wp-item';

    let roleText = '';
    let badgeClass = '';
    let badgeText = '';

    if (idx === 0) {
      roleText = 'Startpunkt';
      badgeClass = 'marker-start';
      badgeText = 'Start';
    } else if (idx === total - 1 && total > 1) {
      roleText = 'Zielpunkt';
      badgeClass = 'marker-end';
      badgeText = 'Ziel';
    } else {
      roleText = `Via-Punkt ${idx}`;
      badgeClass = 'marker-via';
      badgeText = String(idx);
    }

    li.innerHTML = `
      <div class="route-wp-badge ${badgeClass}">${badgeText}</div>
      <div class="route-wp-info">
        <span class="route-wp-role">${roleText}</span>
        <span class="route-wp-coords">${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}</span>
      </div>
    `;

    listEl.appendChild(li);
  });
}

/**
 * Initialisiert die MapLibre-Karte und zeichnet die Route
 */
function renderRouteMap(waypoints, segmentModesOrMode) {
  try {
    mapInstance = new maplibregl.Map({
      container: 'map',
      style: MAP_STYLE_URL,
      center: [waypoints[0].lng, waypoints[0].lat],
      zoom: 10,
      attributionControl: true
    });

    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapInstance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    mapInstance.on('load', () => {
      // 1. Bounds berechnen und Karte einpassen
      const bounds = new maplibregl.LngLatBounds();
      waypoints.forEach(wp => bounds.extend([wp.lng, wp.lat]));

      // 2. Marker für jeden Wegpunkt setzen
      const total = waypoints.length;
      waypoints.forEach((wp, idx) => {
        const container = document.createElement('div');
        container.className = 'map-marker-container';

        const pin = document.createElement('div');
        pin.className = 'custom-map-pin';

        if (idx === 0) {
          pin.classList.add('marker-start');
          pin.innerText = 'Start';
        } else if (idx === total - 1 && total > 1) {
          pin.classList.add('marker-end');
          pin.innerText = 'Ziel';
        } else {
          pin.classList.add('marker-via');
          pin.innerText = String(idx);
        }

        container.appendChild(pin);

        new maplibregl.Marker({ element: container, anchor: 'bottom' })
          .setLngLat([wp.lng, wp.lat])
          .addTo(mapInstance);
      });

      mapInstance.fitBounds(bounds, { padding: 60, maxZoom: 14 });

      // 3. Route berechnen & zeichnen
      fetchAndDrawRoute(waypoints, segmentModesOrMode);
    });

  } catch (err) {
    console.error('Kartenfehler:', err);
  }
}

/**
 * Ruft die Route von BRouter ab und zeichnet sie auf die Karte.
 * Unterstützt segmentweise Profile.
 */
async function fetchAndDrawRoute(waypoints, segmentModesOrMode) {
  const numSegments = Math.max(1, waypoints.length - 1);
  let segmentModes = [];

  if (Array.isArray(segmentModesOrMode)) {
    segmentModes = segmentModesOrMode;
  } else if (typeof segmentModesOrMode === 'string') {
    segmentModes = Array(numSegments).fill(segmentModesOrMode);
  } else {
    segmentModes = Array(numSegments).fill('kurvig');
  }

  const allSame = segmentModes.every(m => m === segmentModes[0]);
  let geojson = null;

  try {
    if (allSame) {
      const selectedMode = segmentModes[0] || 'kurvig';
      const modeParams = MODE_PARAMETERS[selectedMode] || MODE_PARAMETERS.kurvig;

      const url = buildBRouterUrl(waypoints, PROFILE_ID, modeParams);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        geojson = data;
      }
    } else {
      // Segmentweise Berechnung
      const segmentFeatures = [];
      let totalLengthMeters = 0;
      let totalTimeSeconds = 0;

      for (let i = 0; i < waypoints.length - 1; i++) {
        const wpA = waypoints[i];
        const wpB = waypoints[i + 1];
        const segMode = segmentModes[i] || 'kurvig';
        const modeParams = MODE_PARAMETERS[segMode] || MODE_PARAMETERS.kurvig;

        const url = buildBRouterUrl([wpA, wpB], PROFILE_ID, modeParams);
        const res = await fetch(url);
        if (res.ok) {
          const d = await res.json();
          if (d.features && d.features.length > 0) {
            const feat = d.features[0];
            segmentFeatures.push(feat);
            const props = feat.properties || {};
            totalLengthMeters += parseFloat(props['track-length'] || 0);
            totalTimeSeconds += parseFloat(props['total-time'] || 0);
          }
        }
      }

      if (segmentFeatures.length > 0) {
        const allCoords = [];
        segmentFeatures.forEach((feat, idx) => {
          const c = feat.geometry.coordinates;
          if (idx === 0) {
            allCoords.push(...c);
          } else {
            allCoords.push(...c.slice(1));
          }
        });

        geojson = {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: allCoords
              },
              properties: {
                'track-length': String(totalLengthMeters),
                'total-time': String(totalTimeSeconds)
              }
            }
          ]
        };
      }
    }
  } catch (err) {
    console.error('Fehler beim Routenabruf:', err);
    return;
  }

  if (!geojson || !geojson.features || geojson.features.length === 0) return;

  try {
    const feature = geojson.features[0];
    const props = feature.properties || {};

    // Statistiken aktualisieren
    const distanceMeters = parseFloat(props['track-length']) || 0;
    const durationSeconds = parseFloat(props['total-time']) || 0;

    const distKm = (distanceMeters / 1000).toFixed(1);
    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.round((durationSeconds % 3600) / 60);
    const durationText = hours > 0 ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;

    const statDist = document.getElementById('route-stat-distance');
    if (statDist) statDist.innerText = `${distKm} km`;

    const statDur = document.getElementById('route-stat-duration');
    if (statDur) statDur.innerText = durationText;

    // Routen-Layer hinzufügen
    if (!mapInstance.getSource('route-source')) {
      mapInstance.addSource('route-source', {
        type: 'geojson',
        data: geojson
      });

      // Casing (Weißer Rand)
      mapInstance.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': 8,
          'line-opacity': 0.95
        }
      });

      // Routenlinie (Orange)
      mapInstance.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#d94800',
          'line-width': 5,
          'line-opacity': 1
        }
      });
    } else {
      mapInstance.getSource('route-source').setData(geojson);
    }

  } catch (err) {
    console.warn('Routendarstellung fehlgeschlagen:', err);
  }
}
