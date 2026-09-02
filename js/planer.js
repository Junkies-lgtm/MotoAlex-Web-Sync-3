/**
 * MotoAlex Navigation - Routenplaner
 * Reines Vanilla JavaScript mit MapLibre GL JS & BRouter API
 */

// ==========================================================================
// 1. ZENTRALE KONSTANTEN (KONFIGURATION)
// ==========================================================================

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

// ==========================================================================
// 2. ANWENDUNGSZUSTAND (STATE)
// ==========================================================================
const state = {
  waypoints: [], // Array von { lng: number, lat: number, marker: MarkerInstance }
  segmentModes: [], // Array von String-Modi je Abschnitt (Länge = waypoints.length - 1)
  currentRouteGeoJSON: null,
  currentRouteProperties: null,
  selectedMode: 'kurvig', // Standardprofil: 'kurvig' ('schnellste', 'schnell', 'kurvig', 'extra_kurvig')
  isLoading: false
};

// DOM-Elemente & Kontextmenü-Status
let map;
let domElements = {};
let activeContextMenu = null;
let lastContextMenuOpenTimestamp = 0;
let draggedWaypointIndex = null;

/**
 * Prueft, ob das Geraet ein Touchscreen oder ein mobiles Geraet ist
 */
function isTouchOrMobileDevice() {
  return window.matchMedia('(max-width: 880px)').matches ||
         window.matchMedia('(pointer: coarse)').matches ||
         ('ontouchstart' in window) ||
         (navigator.maxTouchPoints > 0);
}

// Profil-Beschreibungen
const PROFILE_EXPLANATIONS = {
  schnellste: {
    icon: '🚀',
    title: 'Schnellste',
    desc: 'Kürzeste Fahrzeit. Nutzt Autobahnen und Hauptverkehrsachsen.'
  },
  schnell: {
    icon: '💨',
    title: 'Schnell',
    desc: 'Direkter Weg ohne Autobahn. Durchfährt Städte, wenn es Fahrzeit spart.'
  },
  kurvig: {
    icon: '🏍️',
    title: 'Kurvig',
    desc: 'Kurvenreiche Landstraßen ohne Autobahn. Meidet größere Städte für mehr Fahrspaß (kann länger dauern).'
  },
  extra_kurvig: {
    icon: '⚡',
    title: 'Extra kurvig',
    desc: 'Sehr kurvige Land- & Nebenstraßen ohne Autobahn. Maximale Kurvenanzahl abseits großer Städte.'
  }
};

/**
 * Aktualisiert die Erklaerung des ausgewaehlten Routenprofils
 */
function updateProfileExplanation(modeKey) {
  const profile = PROFILE_EXPLANATIONS[modeKey] || PROFILE_EXPLANATIONS.kurvig;
  if (domElements.profileInfoIcon) domElements.profileInfoIcon.textContent = profile.icon;
  if (domElements.profileInfoTitle) domElements.profileInfoTitle.textContent = profile.title;
  if (domElements.profileInfoDesc) domElements.profileInfoDesc.textContent = profile.desc;
}

/**
 * Initialisiert das Beta-Hinweis-Popup ueber der Karte
 */
function initBetaPopup() {
  let isDismissed = false;
  try {
    isDismissed = localStorage.getItem('motoalex_beta_popup_dismissed') === 'true';
  } catch (_) {}

  if (isDismissed && domElements.betaInfoPopup) {
    domElements.betaInfoPopup.style.display = 'none';
  }

  const dismissPopup = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (domElements.betaInfoPopup) {
      domElements.betaInfoPopup.style.opacity = '0';
      domElements.betaInfoPopup.style.transform = 'translateY(-8px)';
      setTimeout(() => {
        if (domElements.betaInfoPopup) {
          domElements.betaInfoPopup.style.display = 'none';
        }
      }, 200);
    }
    try {
      localStorage.setItem('motoalex_beta_popup_dismissed', 'true');
    } catch (_) {}
  };

  if (domElements.btnCloseBetaPopup) {
    domElements.btnCloseBetaPopup.addEventListener('click', dismissPopup);
    domElements.btnCloseBetaPopup.addEventListener('touchend', dismissPopup);
  }
  if (domElements.btnAckBetaPopup) {
    domElements.btnAckBetaPopup.addEventListener('click', dismissPopup);
    domElements.btnAckBetaPopup.addEventListener('touchend', dismissPopup);
  }
}

/**
 * Initialisiert den schliessbaren Karten-Bedienhinweis
 */
function initMapHint() {
  const dismissMapHint = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (domElements.mapClickHint) {
      domElements.mapClickHint.style.opacity = '0';
      domElements.mapClickHint.style.transform = 'translateY(-6px)';
      setTimeout(() => {
        if (domElements.mapClickHint) {
          domElements.mapClickHint.style.display = 'none';
        }
      }, 200);
    }
  };

  if (domElements.btnCloseMapHint) {
    domElements.btnCloseMapHint.addEventListener('click', dismissMapHint);
    domElements.btnCloseMapHint.addEventListener('touchend', dismissMapHint);
  }
}

// ==========================================================================
// 3. INITIALISIERUNG
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  // DOM-Referenzen cachen
  domElements = {
    modeSelect: document.getElementById('routing-mode'),
    profileInfoBox: document.getElementById('profile-info-box'),
    profileInfoIcon: document.getElementById('profile-info-icon'),
    profileInfoTitle: document.getElementById('profile-info-title'),
    profileInfoDesc: document.getElementById('profile-info-desc'),
    betaInfoPopup: document.getElementById('beta-info-popup'),
    btnCloseBetaPopup: document.getElementById('btn-close-beta-popup'),
    btnAckBetaPopup: document.getElementById('btn-ack-beta-popup'),
    mapClickHint: document.getElementById('map-click-hint'),
    btnCloseMapHint: document.getElementById('btn-close-map-hint'),
    waypointsList: document.getElementById('waypoints-list'),
    emptyWaypointsHint: document.getElementById('empty-waypoints-hint'),
    statusBanner: document.getElementById('status-banner'),
    routeSummaryBox: document.getElementById('route-summary'),
    routeDistance: document.getElementById('route-distance'),
    routeDuration: document.getElementById('route-duration'),
    btnCalculate: document.getElementById('btn-calculate'),
    btnShareRoute: document.getElementById('btn-share-route'),
    btnGpxDownload: document.getElementById('btn-gpx-download'),
    btnClearRoute: document.getElementById('btn-clear-route'),
    shareModal: document.getElementById('share-modal'),
    btnCloseShareModal: document.getElementById('btn-close-share-modal'),
    btnCloseShareModalFooter: document.getElementById('btn-close-share-modal-footer'),
    shareUrlInput: document.getElementById('share-url-input'),
    btnCopyShareUrl: document.getElementById('btn-copy-share-url'),
    shareCopyFeedback: document.getElementById('share-copy-feedback'),
    shareQrContainer: document.getElementById('share-qrcode'),
    addressSearchInput: document.getElementById('address-search-input'),
    btnClearSearch: document.getElementById('btn-clear-search'),
    searchResultsDropdown: document.getElementById('search-results-dropdown'),
    mapErrorNotice: document.getElementById('map-error-notice')
  };

  initMap();
  initEventListeners();
  initAddressSearch();
  initBetaPopup();
  initMapHint();
  updateProfileExplanation(state.selectedMode || 'kurvig');
  checkUrlParamsOnLoad();
});

/**
 * Blendet den dezenten Fehlerhinweis ueber der Karte ein
 */
function showMapErrorBanner() {
  const el = domElements.mapErrorNotice || document.getElementById('map-error-notice');
  if (el) {
    el.style.display = 'flex';
  }
}

/**
 * Blendet den dezenten Fehlerhinweis wieder aus
 */
function hideMapErrorBanner() {
  const el = domElements.mapErrorNotice || document.getElementById('map-error-notice');
  if (el) {
    el.style.display = 'none';
  }
}

/**
 * Zeigt einen deutlich sichtbaren Hinweis im Kartenbereich an
 */
function showMapNotice(title, message, isError = false) {
  const mapContainer = document.getElementById('map');
  if (!mapContainer) return;
  mapContainer.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 24px; text-align: center; background-color: var(--surface); color: var(--text);">
      <div style="font-size: 2.2rem; margin-bottom: 12px;">${isError ? '⚠️' : '🗺️'}</div>
      <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 8px; color: ${isError ? 'var(--color-error)' : 'var(--accent)'};">${title}</h3>
      <p style="max-width: 500px; font-size: 0.95rem; color: var(--text-dim); line-height: 1.6; margin-bottom: 16px;">${message}</p>
      <div style="background-color: var(--surface-light); border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 10px 16px; font-family: monospace; font-size: 0.85rem; color: var(--text);">
        const MAP_STYLE_URL = 'https://api.maptiler.com/maps/streets-v4/style.json?key=...';
      </div>
    </div>
  `;
}

/**
 * Initialisiert die MapLibre-Karte
 */
function initMap() {
  // Pruefen, ob noch ein Platzhalter-Schluessel aktiv ist
  if (MAP_STYLE_URL.includes('yourapikey') || MAP_STYLE_URL.includes('DEIN_SCHLUESSEL')) {
    showMapNotice(
      'Kein Kartenschlüssel hinterlegt',
      'In js/planer.js ist noch der Platzhalter yourapikey für den MapTiler-Kartenstil eingetragen. Bitte trage dort deinen persönlichen MapTiler API-Schlüssel ein, um die Karte zu laden.'
    );
    return;
  }

  try {
    map = new maplibregl.Map({
      container: 'map',
      style: MAP_STYLE_URL,
      center: [10.4515, 51.1657], // Geografische Mitte Deutschlands
      zoom: 6,
      attributionControl: true
    });

    // Navigations-Bedienelemente (Zoom / Kompass) hinzufuegen
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');

    // Skala hinzufuegen
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    // Klick auf die Karte: auf mobilen Geraeten oeffnet ein Tippen das Menue, auf Desktop schliesst es dieses
    map.on('click', (e) => {
      if (isTouchOrMobileDevice()) {
        openContextMenu(e);
      } else {
        closeContextMenu();
      }
    });

    // Kontextmenü mit Rechtsklick öffnen
    map.on('contextmenu', (e) => {
      e.originalEvent.preventDefault();
      openContextMenu(e);
    });

    map.on('movestart', () => {
      closeContextMenu();
    });

    // Nach dem Laden des Kartenstils Routing-Ebenen vorbereiten
    map.on('load', () => {
      setupRouteLayers();
      map.resize();
    });

    window.addEventListener('resize', () => {
      if (map) {
        map.resize();
      }
    });
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        if (map) {
          map.resize();
        }
      }, 100);
    });

    // Fehlerbehandlung für die Karte: Listener für das error-Ereignis
    map.on('error', (e) => {
      const errorText = (e && e.error && (e.error.message || e.error.statusText)) || (e && e.message) || (e && e.error) || 'Unbekannter Fehler';
      const errorUrl = (e && (e.url || (e.error && (e.error.url || e.error.statusText)) || (e.tile && (e.tile.url || (e.tile.canonical && e.tile.canonical.url))) || (e.source && e.source.url))) || (e && e.resource && e.resource.url) || 'Unbekannte Adresse';

      console.error(`Kartenfehler: ${errorText} | Adresse: ${errorUrl}`, e);

      showMapErrorBanner();

      if (e && e.error && (e.error.status === 401 || e.error.status === 403 || e.error.status === 404)) {
        showMapNotice(
          'Fehler beim Laden des Kartenstils',
          `Der Kartendienst konnte nicht geladen werden (HTTP ${e.error.status || 'Fehler'}). Bitte überprüfe den hinterlegten API-Schlüssel in js/planer.js.`,
          true
        );
      }
    });

    // Sobald Kacheln oder Kartendaten wieder erfolgreich geladen werden, Hinweis ausblenden
    map.on('data', (e) => {
      if (e.dataType === 'source' || e.dataType === 'tile' || e.dataType === 'style') {
        hideMapErrorBanner();
      }
    });

    map.on('sourcedata', (e) => {
      if (e.isSourceLoaded) {
        hideMapErrorBanner();
      }
    });

    map.on('idle', () => {
      hideMapErrorBanner();
    });
  } catch (err) {
    console.error('Fehler bei der Karteninitialisierung:', err);
    showMapNotice(
      'Karteninitialisierung fehlgeschlagen',
      'Die Karte konnte nicht geladen werden. Bitte überprüfe die Konfiguration in js/planer.js.',
      true
    );
  }
}

/**
 * Schliesst das offene Kontextmenü auf der Karte
 */
function closeContextMenu() {
  if (activeContextMenu && activeContextMenu.parentNode) {
    activeContextMenu.parentNode.removeChild(activeContextMenu);
    activeContextMenu = null;
  }
}

/**
 * Oeffnet das 3-Felder-Kontextmenue ("als Start", "als Via", "als Ziel")
 */
function openContextMenu(e) {
  closeContextMenu();
  lastContextMenuOpenTimestamp = Date.now();

  const lng = e.lngLat.lng;
  const lat = e.lngLat.lat;
  const point = e.point;

  const mapContainer = map.getContainer();
  const rect = mapContainer.getBoundingClientRect();

  const menu = document.createElement('div');
  menu.className = 'map-context-menu';

  // Positionierung innerhalb der sichtbaren Karte sicherstellen
  let left = point.x + 6;
  let top = point.y + 6;
  if (left + 165 > rect.width) {
    left = Math.max(8, point.x - 160);
  }
  if (top + 150 > rect.height) {
    top = Math.max(8, point.y - 140);
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  menu.innerHTML = `
    <button type="button" class="context-menu-item" data-action="start">
      <span class="context-menu-dot dot-start"></span>
      <span>als Start</span>
    </button>
    <button type="button" class="context-menu-item" data-action="via">
      <span class="context-menu-dot dot-via"></span>
      <span>als Via</span>
    </button>
    <button type="button" class="context-menu-item" data-action="ziel">
      <span class="context-menu-dot dot-end"></span>
      <span>als Ziel</span>
    </button>
  `;

  menu.addEventListener('click', (evt) => {
    evt.stopPropagation();
    const btn = evt.target.closest('.context-menu-item');
    if (!btn) return;
    const action = btn.dataset.action;
    closeContextMenu();

    if (action === 'start') {
      addWaypointAsStart(lng, lat);
    } else if (action === 'via') {
      addWaypointAsVia(lng, lat);
    } else if (action === 'ziel') {
      addWaypointAsZiel(lng, lat);
    }
  });

  menu.addEventListener('contextmenu', (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
  });

  mapContainer.appendChild(menu);
  activeContextMenu = menu;
}

/**
 * Registriert Event Listener fuer Benutzerinteraktionen
 */
function initEventListeners() {
  // Klick ausserhalb des Menüs schliesst dieses
  document.addEventListener('click', (e) => {
    if (Date.now() - lastContextMenuOpenTimestamp < 100) {
      return;
    }
    if (activeContextMenu && !activeContextMenu.contains(e.target)) {
      closeContextMenu();
    }
  });

  // Modus-Aenderung (Hauptauswahl aendert alle Abschnitte und den Standardmodus)
  if (domElements.modeSelect) {
    domElements.modeSelect.addEventListener('change', (e) => {
      state.selectedMode = e.target.value;
      updateProfileExplanation(state.selectedMode);
      // Alle Segmente auf den neu gewählten globalen Modus aktualisieren
      for (let i = 0; i < state.segmentModes.length; i++) {
        state.segmentModes[i] = state.selectedMode;
      }
      renderWaypointsList();
      if (state.waypoints.length >= 2) {
        calculateRoute();
      }
    });
  }

  // Route berechnen
  if (domElements.btnCalculate) {
    domElements.btnCalculate.addEventListener('click', () => {
      calculateRoute();
    });
  }

  // GPX-Download
  if (domElements.btnGpxDownload) {
    domElements.btnGpxDownload.addEventListener('click', () => {
      downloadGpxFile();
    });
  }

  // Route teilen
  if (domElements.btnShareRoute) {
    domElements.btnShareRoute.addEventListener('click', () => {
      openShareModal();
    });
  }

  // Modal schliessen
  if (domElements.btnCloseShareModal) {
    domElements.btnCloseShareModal.addEventListener('click', () => {
      closeShareModal();
    });
  }

  if (domElements.btnCloseShareModalFooter) {
    domElements.btnCloseShareModalFooter.addEventListener('click', () => {
      closeShareModal();
    });
  }

  if (domElements.shareModal) {
    domElements.shareModal.addEventListener('click', (e) => {
      if (e.target === domElements.shareModal) {
        closeShareModal();
      }
    });
  }

  // ESC-Taste schliesst das Modal und Kontextmenü
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeContextMenu();
      if (domElements.shareModal && domElements.shareModal.style.display !== 'none') {
        closeShareModal();
      }
    }
  });

  // Link kopieren
  if (domElements.btnCopyShareUrl) {
    domElements.btnCopyShareUrl.addEventListener('click', () => {
      copyShareUrl();
    });
  }

  // Alles zuruecksetzen
  if (domElements.btnClearRoute) {
    domElements.btnClearRoute.addEventListener('click', () => {
      clearAllWaypointsAndRoute();
    });
  }
}

// ==========================================================================
// 4b. OFFLINE-STÄDTE-, PASS- & ORTSSUCHE
// ==========================================================================

/**
 * Wandelt HTML-Sonderzeichen zur sicheren Ausgabe um
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Normalisiert Zeichenketten fuer tolerante Suche (Umlaute, Sonderzeichen, Kleinschreibung)
 * Wandelt Umlaute sowohl direkt als auch in zerlegter Form um (z. B. Köln -> koln, koeln)
 */
function normalizeSearchString(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Initialisiert die Offline-Städte- und Ortssuche
 */
function initAddressSearch() {
  const input = domElements.addressSearchInput;
  const clearBtn = domElements.btnClearSearch;
  const dropdown = domElements.searchResultsDropdown;

  if (!input || !dropdown) return;

  // Sofortige Suche beim Tippen (ohne Server-Latenz)
  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (clearBtn) {
      clearBtn.style.display = query.length > 0 ? 'block' : 'none';
    }

    if (query.length < 1) {
      hideSearchResults();
      return;
    }

    performLocalPlacesSearch(query);
  });

  // Beim Fokussieren bestehende Suche wieder einblenden
  input.addEventListener('focus', () => {
    const query = input.value.trim();
    if (query.length >= 1) {
      performLocalPlacesSearch(query);
    }
  });

  // Enter-Taste waehlt erstes Ergebnis
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const firstItem = dropdown.querySelector('.search-result-item');
      if (firstItem) {
        firstItem.click();
      }
    } else if (e.key === 'Escape') {
      hideSearchResults();
    }
  });

  // Klick auf Leeren-Button
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      input.value = '';
      clearBtn.style.display = 'none';
      hideSearchResults();
      input.focus();
    });
  }

  // Klick ausserhalb schliesst Dropdown
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box-container')) {
      hideSearchResults();
    }
  });
}

/**
 * Durchsucht die integrierte Orte- und Pässedatenbank lokal im Browser
 */
function performLocalPlacesSearch(query) {
  const dropdown = domElements.searchResultsDropdown;
  if (!dropdown) return;

  const places = window.MOTOALEX_PLACES || [];
  if (places.length === 0) {
    dropdown.style.display = 'block';
    dropdown.innerHTML = '<div class="search-empty-hint">Ortsdatenbank wird geladen...</div>';
    return;
  }

  const normQuery = normalizeSearchString(query);
  const rawQueryLower = query.toLowerCase().trim();

  if (!normQuery && !rawQueryLower) {
    hideSearchResults();
    return;
  }

  // Relevanz-Scoring
  const matches = [];

  for (let i = 0; i < places.length; i++) {
    const item = places[i]; // [name, lat, lng, type, zipOrDesc]
    const name = item[0] || '';
    const lat = item[1];
    const lng = item[2];
    const type = item[3] || 'stadt';
    const desc = item[4] || '';

    const normName = normalizeSearchString(name);
    const normDesc = normalizeSearchString(desc);
    const rawNameLower = name.toLowerCase();
    const rawDescLower = desc.toLowerCase();

    let score = 0;

    if (rawNameLower.startsWith(rawQueryLower) || normName.startsWith(normQuery)) {
      // Exakter Wortanfang im Namen = hoechste Prioritaet
      score = 100 - Math.abs(normName.length - normQuery.length);
    } else if (rawNameLower.includes(rawQueryLower) || normName.includes(normQuery)) {
      // Name enthaelt Suchbegriff
      score = 60;
    } else if (rawDescLower.startsWith(rawQueryLower) || normDesc.startsWith(normQuery)) {
      // PLZ oder Zusatz beginnt mit Suchbegriff (z.B. "50667")
      score = 50;
    } else if (rawDescLower.includes(rawQueryLower) || normDesc.includes(normQuery)) {
      // PLZ / Bundesland enthaelt Suchbegriff
      score = 30;
    }

    // Pässe oder POIs bei speziellem Keyword boosten
    if ((normQuery.includes('pass') || normQuery.includes('joch')) && type === 'pass') {
      score += 25;
    }

    if (score > 0) {
      matches.push({ name, lat, lng, type, desc, score });
    }
  }

  // Nach Score absteigend sortieren
  matches.sort((a, b) => b.score - a.score);

  // Maximal 8 beste Treffer
  const topMatches = matches.slice(0, 8);

  renderSearchResults(topMatches, query);
}

/**
 * Rendert die Trefferliste im Dropdown
 */
function renderSearchResults(items, query) {
  const dropdown = domElements.searchResultsDropdown;
  if (!dropdown) return;

  if (!items || items.length === 0) {
    dropdown.style.display = 'block';
    dropdown.innerHTML = `<div class="search-empty-hint">Kein Ort oder Pass für „${escapeHtml(query)}“ gefunden</div>`;
    return;
  }

  dropdown.innerHTML = '';
  dropdown.style.display = 'block';

  items.forEach((item) => {
    let icon = '📍';
    if (item.type === 'pass') icon = '🏔️';
    else if (item.type === 'poi') icon = '🏍️';
    else if (item.type === 'stadt') icon = '🏙️';

    const itemEl = document.createElement('div');
    itemEl.className = 'search-result-item';
    itemEl.innerHTML = `
      <div class="search-result-primary">${icon} ${escapeHtml(item.name)}</div>
      ${item.desc ? `<div class="search-result-secondary">${escapeHtml(item.desc)}</div>` : ''}
    `;

    itemEl.addEventListener('click', (e) => {
      e.stopPropagation();
      onSearchResultSelected(item.lng, item.lat, item.name);
    });

    dropdown.appendChild(itemEl);
  });
}

/**
 * Behandelt die Auswahl eines Suchtreffers
 */
function onSearchResultSelected(lng, lat, name) {
  hideSearchResults();
  if (domElements.addressSearchInput) {
    domElements.addressSearchInput.value = '';
    if (domElements.btnClearSearch) {
      domElements.btnClearSearch.style.display = 'none';
    }
  }

  // Karte auf den Punkt zentrieren
  if (map) {
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), 12),
      essential: true
    });
  }

  // Logik: 
  // 1. Wenn noch kein Wegpunkt existiert -> Als Start setzen
  // 2. Wenn 1 Wegpunkt existiert -> Als Ziel setzen (Route wird sofort berechnet)
  // 3. Wenn bereits Start & Ziel existieren -> Als neues Zwischenziel / Ziel anfügen
  if (state.waypoints.length === 0) {
    addWaypointAsStart(lng, lat);
    showStatus(`Startpunkt gesetzt: ${name}`, 'success');
  } else if (state.waypoints.length === 1) {
    addWaypointAsZiel(lng, lat);
    showStatus(`Zielpunkt gesetzt: ${name}`, 'success');
  } else {
    // Als weiteres Zwischenziel/Ziel anfügen
    addWaypointAsZiel(lng, lat);
    showStatus(`Wegpunkt hinzugefügt: ${name}`, 'success');
  }
}

/**
 * Schließt das Such-Dropdown
 */
function hideSearchResults() {
  const dropdown = domElements.searchResultsDropdown;
  if (dropdown) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
  }
}

// ==========================================================================
// 5. WEGPUNKT-MANAGEMENT & SORTIERUNG
// ==========================================================================

/**
 * Erstellt ein neues Wegpunkt-Objekt inklusive verschiebbarem Kartenmarker
 */
function createWaypointObject(lng, lat) {
  const container = document.createElement('div');
  container.className = 'map-marker-container';

  const pin = document.createElement('div');
  pin.className = 'custom-map-pin';
  container.appendChild(pin);

  const marker = new maplibregl.Marker({
    element: container,
    draggable: true,
    anchor: 'bottom'
  })
    .setLngLat([lng, lat])
    .addTo(map);

  const waypointObj = {
    lng,
    lat,
    marker
  };

  // Touch Long-Press Erkennung fuer mobile Geraete
  let touchStartPos = { x: 0, y: 0 };
  let isLongPressActive = false;
  let longPressTimer = null;

  container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      isLongPressActive = false;

      longPressTimer = setTimeout(() => {
        isLongPressActive = true;
        container.classList.add('marker-is-dragging');
        if (navigator.vibrate) {
          try { navigator.vibrate(35); } catch (_) {}
        }
      }, 250);
    }
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (longPressTimer && !isLongPressActive && e.touches.length > 0) {
      const dx = Math.abs(e.touches[0].clientX - touchStartPos.x);
      const dy = Math.abs(e.touches[0].clientY - touchStartPos.y);
      if (dx > 8 || dy > 8) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }
  }, { passive: true });

  const clearTouchState = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    container.classList.remove('marker-is-dragging');
  };

  container.addEventListener('touchend', clearTouchState, { passive: true });
  container.addEventListener('touchcancel', clearTouchState, { passive: true });

  marker.on('dragstart', () => {
    closeContextMenu();
    container.classList.add('marker-is-dragging');
  });

  // Marker verschiebbar mit Linksklick oder Touch-Drag
  marker.on('dragend', () => {
    clearTouchState();
    const newLngLat = marker.getLngLat();
    waypointObj.lng = newLngLat.lng;
    waypointObj.lat = newLngLat.lat;
    renderWaypointsList();
    if (state.waypoints.length >= 2) {
      calculateRoute();
    }
  });

  return waypointObj;
}

/**
 * Synchronisiert das segmentModes Array mit der aktuellen Anzahl an Wegpunkten
 */
function syncSegmentModes() {
  const numSegments = Math.max(0, state.waypoints.length - 1);
  const defaultMode = state.selectedMode || 'kurvig';
  
  while (state.segmentModes.length < numSegments) {
    state.segmentModes.push(defaultMode);
  }
  if (state.segmentModes.length > numSegments) {
    state.segmentModes.length = numSegments;
  }
}

/**
 * Fuegt einen Wegpunkt an einem bestimmten Index ein
 */
function insertWaypointAt(lng, lat, targetIndex) {
  const waypointObj = createWaypointObject(lng, lat);

  if (targetIndex <= 0) {
    state.waypoints.unshift(waypointObj);
    if (state.waypoints.length > 1) {
      state.segmentModes.unshift(state.selectedMode || 'kurvig');
    }
  } else if (targetIndex >= state.waypoints.length) {
    state.waypoints.push(waypointObj);
    if (state.waypoints.length > 1) {
      state.segmentModes.push(state.selectedMode || 'kurvig');
    }
  } else {
    state.waypoints.splice(targetIndex, 0, waypointObj);
    state.segmentModes.splice(targetIndex, 0, state.selectedMode || 'kurvig');
  }

  syncSegmentModes();
  updateMarkerLabels();
  renderWaypointsList();

  if (state.waypoints.length >= 2) {
    calculateRoute();
  }
}

/**
 * 'als Start' setzen:
 * Fuegt den Punkt an den Anfang ein (neuer Startpunkt)
 */
function addWaypointAsStart(lng, lat) {
  insertWaypointAt(lng, lat, 0);
}

/**
 * 'als Via' setzen:
 * Fuegt den Punkt zwischen Start und Ziel ein (bzw. vor das letzte Ziel)
 */
function addWaypointAsVia(lng, lat) {
  if (state.waypoints.length >= 2) {
    insertWaypointAt(lng, lat, state.waypoints.length - 1);
  } else {
    insertWaypointAt(lng, lat, state.waypoints.length);
  }
}

/**
 * 'als Ziel' setzen:
 * Fuegt den Punkt am Ende an
 */
function addWaypointAsZiel(lng, lat) {
  insertWaypointAt(lng, lat, state.waypoints.length);
}

/**
 * Standard-Hinzufuegen (z.B. URL-Parameter)
 */
function addWaypoint(lng, lat) {
  insertWaypointAt(lng, lat, state.waypoints.length);
}

/**
 * Verschiebt einen Wegpunkt innerhalb der Liste
 */
function moveWaypoint(fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= state.waypoints.length || toIndex >= state.waypoints.length) return;
  const [moved] = state.waypoints.splice(fromIndex, 1);
  state.waypoints.splice(toIndex, 0, moved);
  syncSegmentModes();
  updateMarkerLabels();
  renderWaypointsList();
  if (state.waypoints.length >= 2) {
    calculateRoute();
  }
}

/**
 * Entfernt einen einzelnen Wegpunkt anhand seines Index
 */
function removeWaypoint(index) {
  if (index < 0 || index >= state.waypoints.length) return;

  state.waypoints[index].marker.remove();
  state.waypoints.splice(index, 1);
  if (state.segmentModes.length > 0) {
    const segIdxToRemove = Math.min(index, state.segmentModes.length - 1);
    state.segmentModes.splice(segIdxToRemove, 1);
  }
  syncSegmentModes();

  updateMarkerLabels();
  renderWaypointsList();

  if (state.waypoints.length >= 2) {
    calculateRoute();
  } else {
    clearRouteLayer();
  }
}

/**
 * Aktualisiert die Beschriftung und Farbgebung der Karten-Marker
 * Start = "Start" (grün), Ziel = "Ziel" (rot), Via = "1", "2"... (orange)
 */
function updateMarkerLabels() {
  const total = state.waypoints.length;
  state.waypoints.forEach((wp, idx) => {
    const container = wp.marker.getElement();
    const pin = container.querySelector('.custom-map-pin') || container;
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
  });
}

/**
 * Ändert das Profil für ein einzelnes Strecken-Segment
 */
function setSegmentMode(segmentIndex, modeKey) {
  if (segmentIndex < 0 || segmentIndex >= state.segmentModes.length) return;
  state.segmentModes[segmentIndex] = modeKey;
  if (state.waypoints.length >= 2) {
    calculateRoute();
  }
}

/**
 * Rendert die Wegpunkteliste in der Seitenleiste mit Drag & Drop & Sortierknoepfen
 * und interaktiven Abschnitts-Profilwählern zwischen den Wegpunkten
 */
function renderWaypointsList() {
  const list = domElements.waypointsList;
  const emptyHint = domElements.emptyWaypointsHint;

  if (!list) return;
  list.innerHTML = '';

  const total = state.waypoints.length;
  syncSegmentModes();

  if (total === 0) {
    if (emptyHint) emptyHint.style.display = 'block';
    if (domElements.btnCalculate) domElements.btnCalculate.disabled = true;
    if (domElements.btnShareRoute) domElements.btnShareRoute.disabled = true;
    return;
  }

  if (emptyHint) emptyHint.style.display = 'none';
  if (domElements.btnCalculate) {
    domElements.btnCalculate.disabled = total < 2;
  }
  if (domElements.btnShareRoute) {
    domElements.btnShareRoute.disabled = total < 2;
  }

  state.waypoints.forEach((wp, index) => {
    // 1. Wenn nicht erster Wegpunkt: Profil-Wähler für den Abschnitt davor einfügen
    if (index > 0) {
      const segIndex = index - 1;
      const currentSegMode = state.segmentModes[segIndex] || state.selectedMode || 'kurvig';
      
      const connectorEl = document.createElement('div');
      connectorEl.className = 'segment-connector';
      connectorEl.innerHTML = `
        <div class="segment-connector-content">
          <span class="segment-label">Abschnitt ${segIndex + 1}:</span>
          <select class="segment-mode-select" data-seg-index="${segIndex}" title="Profil für diesen Streckenabschnitt anpassen">
            <option value="schnellste" ${currentSegMode === 'schnellste' ? 'selected' : ''}>🚀 Schnellste</option>
            <option value="schnell" ${currentSegMode === 'schnell' ? 'selected' : ''}>💨 Schnell</option>
            <option value="kurvig" ${currentSegMode === 'kurvig' ? 'selected' : ''}>🏍️ Kurvig</option>
            <option value="extra_kurvig" ${currentSegMode === 'extra_kurvig' ? 'selected' : ''}>⚡ Extra kurvig</option>
          </select>
        </div>
      `;

      const selectEl = connectorEl.querySelector('.segment-mode-select');
      selectEl.addEventListener('change', (e) => {
        setSegmentMode(segIndex, e.target.value);
      });

      list.appendChild(connectorEl);
    }

    // 2. Wegpunkt-Zeile
    const li = document.createElement('li');
    li.className = 'waypoint-item is-draggable';
    li.draggable = true;
    li.dataset.index = String(index);

    let roleLabel = '';
    let badgeClass = '';
    let badgeText = '';

    if (index === 0) {
      roleLabel = 'Start';
      badgeClass = 'marker-start';
      badgeText = 'Start';
    } else if (index === total - 1 && total > 1) {
      roleLabel = 'Ziel';
      badgeClass = 'marker-end';
      badgeText = 'Ziel';
    } else {
      roleLabel = `Via ${index}`;
      badgeClass = 'marker-via';
      badgeText = String(index);
    }

    li.innerHTML = `
      <span class="waypoint-drag-handle" title="Wegpunkt per Drag & Drop verschieben">⠿</span>
      <span class="waypoint-badge ${badgeClass}">${badgeText}</span>
      <span style="font-weight: 600; font-size: 0.85rem; min-width: 36px;">${roleLabel}</span>
      <span class="waypoint-coords" title="${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}">
        ${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}
      </span>
      <div class="waypoint-reorder-actions">
        <button type="button" class="btn-move-wp btn-move-up" title="Nach oben verschieben" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="btn-move-wp btn-move-down" title="Nach unten verschieben" ${index === total - 1 ? 'disabled' : ''}>▼</button>
      </div>
      <button type="button" class="btn-remove-wp" title="Wegpunkt entfernen" aria-label="${roleLabel} entfernen">
        &times;
      </button>
    `;

    // Up / Down Knöpfe
    const btnUp = li.querySelector('.btn-move-up');
    if (btnUp) {
      btnUp.addEventListener('click', (e) => {
        e.stopPropagation();
        moveWaypoint(index, index - 1);
      });
    }

    const btnDown = li.querySelector('.btn-move-down');
    if (btnDown) {
      btnDown.addEventListener('click', (e) => {
        e.stopPropagation();
        moveWaypoint(index, index + 1);
      });
    }

    // Entfernen-Knopf
    const btnRemove = li.querySelector('.btn-remove-wp');
    btnRemove.addEventListener('click', (e) => {
      e.stopPropagation();
      removeWaypoint(index);
    });

    // Drag & Drop Events
    li.addEventListener('dragstart', (e) => {
      draggedWaypointIndex = index;
      li.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    });

    li.addEventListener('dragend', () => {
      li.classList.remove('is-dragging');
      draggedWaypointIndex = null;
      document.querySelectorAll('.waypoint-item').forEach(item => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    });

    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = li.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        li.classList.add('drag-over-top');
        li.classList.remove('drag-over-bottom');
      } else {
        li.classList.add('drag-over-bottom');
        li.classList.remove('drag-over-top');
      }
    });

    li.addEventListener('dragleave', () => {
      li.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drag-over-top', 'drag-over-bottom');
      const fromIdx = draggedWaypointIndex;
      const toIdx = index;
      if (fromIdx !== null && fromIdx !== toIdx) {
        moveWaypoint(fromIdx, toIdx);
      }
    });

    list.appendChild(li);
  });
}

/**
 * Loescht alle Wegpunkte und die aktuelle Route
 */
function clearAllWaypointsAndRoute() {
  closeContextMenu();
  state.waypoints.forEach(wp => wp.marker.remove());
  state.waypoints = [];
  state.segmentModes = [];
  state.currentRouteGeoJSON = null;
  state.currentRouteProperties = null;

  renderWaypointsList();
  clearRouteLayer();
  hideStatus();
  if (domElements.routeSummaryBox) {
    domElements.routeSummaryBox.classList.remove('is-visible');
  }
}

// ==========================================================================
// 6. ROUTENBERECHNUNG (BRouter API)
// ==========================================================================

/**
 * Richtet die MapLibre-Vektor-Layer fuer die Routenanzeige ein
 */
function setupRouteLayers() {
  if (map.getSource('route-source')) return;

  map.addSource('route-source', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });

  // Unterer weisser Rand (Casing) fuer optimale Sichtbarkeit auf jedem Untergrund
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route-source',
    layout: {
      'line-join': 'round',
      'line-cap': 'round'
    },
    paint: {
      'line-color': '#ffffff',
      'line-width': 8,
      'line-opacity': 0.95
    }
  });

  // Hauptlinie in dunklem Orange
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route-source',
    layout: {
      'line-join': 'round',
      'line-cap': 'round'
    },
    paint: {
      'line-color': '#d94800',
      'line-width': 5,
      'line-opacity': 1.0
    }
  });
}

/**
 * Loescht die Route auf der Karte
 */
function clearRouteLayer() {
  if (map && map.getSource('route-source')) {
    map.getSource('route-source').setData({
      type: 'FeatureCollection',
      features: []
    });
  }
  if (domElements.routeSummaryBox) {
    domElements.routeSummaryBox.classList.remove('is-visible');
  }
}

/**
 * Baut die BRouter-Anfrage-URL zusammen
 */
function buildBRouterUrl(waypoints, profileId, params = null) {
  const lonlatsParam = waypoints
    .map(wp => `${wp.lng.toFixed(6)},${wp.lat.toFixed(6)}`)
    .join('|');

  let url = `${ROUTING_SERVICE_URL}?lonlats=${encodeURIComponent(lonlatsParam)}&profile=${encodeURIComponent(profileId)}&format=geojson`;

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url += `&profile:${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }
  }

  return url;
}

/**
 * Fuehrt die Berechnung eines einzelnen Segments (von Punkt A nach Punkt B) durch.
 */
async function fetchSegmentRoute(wpA, wpB, modeKey) {
  const modeParams = MODE_PARAMETERS[modeKey] || MODE_PARAMETERS.kurvig;
  const segmentPoints = [wpA, wpB];

  const url = buildBRouterUrl(segmentPoints, PROFILE_ID, modeParams);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.features || data.features.length === 0) {
    throw new Error('Keine fahrbare Route fuer diesen Abschnitt gefunden.');
  }
  return data;
}

/**
 * Fuehrt die Routenberechnung ueber den BRouter-Dienst durch.
 * Unterstuetzt abschnittsweise Profile (Segment-Routing) oder Gesamtanfrage.
 */
async function calculateRoute() {
  if (state.waypoints.length < 2) {
    showStatus('Bitte setze mindestens 2 Punkte auf der Karte (Start und Ziel).', 'error');
    return;
  }

  syncSegmentModes();
  showStatus('Berechne optimale Motorradroute...', 'loading');
  state.isLoading = true;

  try {
    // Prüfen, ob alle Segmente denselben Modus haben
    const firstMode = state.segmentModes[0] || state.selectedMode || 'kurvig';
    const allSameMode = state.segmentModes.every(m => m === firstMode);

    let combinedGeoJSON = null;

    if (allSameMode) {
      // Schneller Gesamt-Abruf für alle Wegpunkte
      const modeParams = MODE_PARAMETERS[firstMode] || MODE_PARAMETERS.kurvig;
      const url = buildBRouterUrl(state.waypoints, PROFILE_ID, modeParams);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data.features || data.features.length === 0) throw new Error('Keine Route gefunden');
      combinedGeoJSON = data;
    } else {
      // Unterschiedliche Profile pro Segment: Segmente einzeln abrufen und zusammenfügen
      const segmentResults = [];
      for (let i = 0; i < state.waypoints.length - 1; i++) {
        const wpA = state.waypoints[i];
        const wpB = state.waypoints[i + 1];
        const segMode = state.segmentModes[i] || state.selectedMode || 'kurvig';

        const segData = await fetchSegmentRoute(wpA, wpB, segMode);
        segmentResults.push(segData);
      }

      // GeoJSON Geometrie und Eigenschaften kombinieren
      const allCoordinates = [];
      let totalLengthMeters = 0;
      let totalTimeSeconds = 0;

      segmentResults.forEach((segData, idx) => {
        const feat = segData.features[0];
        const coords = feat.geometry.coordinates;
        if (idx === 0) {
          allCoordinates.push(...coords);
        } else {
          // Den ersten Punkt des Segments auslassen, da er identisch mit dem letzten des vorherigen ist
          allCoordinates.push(...coords.slice(1));
        }

        const props = feat.properties || {};
        totalLengthMeters += parseFloat(props['track-length'] || 0);
        totalTimeSeconds += parseFloat(props['total-time'] || 0);
      });

      combinedGeoJSON = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: allCoordinates
            },
            properties: {
              'track-length': String(totalLengthMeters),
              'total-time': String(totalTimeSeconds)
            }
          }
        ]
      };
    }

    // Erfolgreiche Route verarbeiten
    state.currentRouteGeoJSON = combinedGeoJSON;
    const routeFeature = combinedGeoJSON.features[0];
    state.currentRouteProperties = routeFeature.properties || {};

    // Route auf der Karte zeichnen
    if (map.getSource('route-source')) {
      map.getSource('route-source').setData(combinedGeoJSON);
    } else {
      setupRouteLayers();
      map.getSource('route-source').setData(combinedGeoJSON);
    }

    // Kartenausschnitt auf die Route anpassen
    fitMapToRoute(routeFeature.geometry.coordinates);

    // Zusammenfassung (Distanz und Zeit) anzeigen
    displayRouteSummary(state.currentRouteProperties);

    hideStatus();
  } catch (err) {
    console.error('Fehler bei der Routenberechnung:', err);
    showStatus(`Routenberechnung fehlgeschlagen: ${err.message || 'Dienst nicht erreichbar'}.`, 'error');
    clearRouteLayer();
  } finally {
    state.isLoading = false;
  }
}

/**
 * Passt den sichtbaren Kartenausschnitt an die Route an
 */
function fitMapToRoute(coordinates) {
  if (!coordinates || coordinates.length === 0) return;

  const bounds = new maplibregl.LngLatBounds();
  coordinates.forEach(coord => bounds.extend(coord));

  map.fitBounds(bounds, {
    padding: { top: 60, bottom: 60, left: 60, right: 60 },
    maxZoom: 15,
    duration: 800
  });
}

/**
 * Zeigt Laenge und geschaetzte Fahrzeit an
 */
function displayRouteSummary(properties) {
  if (!domElements.routeSummaryBox) return;

  // BRouter liefert meist 'track-length' in Metern und 'total-time' in Sekunden
  const lengthMeters = parseFloat(properties['track-length'] || 0);
  const timeSeconds = parseFloat(properties['total-time'] || 0);

  const lengthKm = (lengthMeters / 1000).toFixed(1);
  const hours = Math.floor(timeSeconds / 3600);
  const minutes = Math.round((timeSeconds % 3600) / 60);

  let timeString = '';
  if (hours > 0) {
    timeString = `${hours} Std. ${minutes} Min.`;
  } else {
    timeString = `${minutes} Min.`;
  }

  if (domElements.routeDistance) {
    domElements.routeDistance.textContent = `${lengthKm} km`;
  }
  if (domElements.routeDuration) {
    domElements.routeDuration.textContent = timeString;
  }

  domElements.routeSummaryBox.classList.add('is-visible');
}

// ==========================================================================
// 7. GPX-DATEI DOWNLOAD
// ==========================================================================

/**
 * Erstellt eine GPX-Datei aus den aktuellen Routendaten und startet den Download
 */
function downloadGpxFile() {
  if (!state.currentRouteGeoJSON || !state.currentRouteGeoJSON.features || state.currentRouteGeoJSON.features.length === 0) {
    showStatus('Bitte berechne zuerst eine Route vor dem GPX-Export.', 'error');
    return;
  }

  const coordinates = state.currentRouteGeoJSON.features[0].geometry.coordinates;
  const now = new Date().toISOString();
  const routeName = `MotoAlex_Tour_${new Date().toISOString().slice(0, 10)}`;

  let gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MotoAlex Navigation (motoalex-navigation.de)" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${routeName}</name>
    <time>${now}</time>
  </metadata>
`;

  // Wegpunkte (WPT)
  state.waypoints.forEach((wp, idx) => {
    let name = `Wegpunkt ${idx + 1}`;
    if (idx === 0) name = 'Start';
    else if (idx === state.waypoints.length - 1) name = 'Ziel';

    gpxContent += `  <wpt lat="${wp.lat.toFixed(6)}" lon="${wp.lng.toFixed(6)}">
    <name>${name}</name>
  </wpt>
`;
  });

  // Track (TRK)
  gpxContent += `  <trk>
    <name>${routeName}</name>
    <trkseg>
`;

  coordinates.forEach(coord => {
    const lon = coord[0];
    const lat = coord[1];
    const ele = coord[2] !== undefined ? coord[2] : null;

    if (ele !== null) {
      gpxContent += `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>\n`;
    } else {
      gpxContent += `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}" />\n`;
    }
  });

  gpxContent += `    </trkseg>
  </trk>
</gpx>`;

  // Blob erstellen und Download anstossen
  const blob = new Blob([gpxContent], { type: 'application/gpx+xml;charset=utf-8' });
  const downloadUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement('a');
  downloadLink.href = downloadUrl;
  downloadLink.download = `${routeName}.gpx`;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(downloadUrl);
}

// ==========================================================================
// 8. STATUS & BENACHRICHTIGUNGEN
// ==========================================================================

function showStatus(message, type = 'loading') {
  if (!domElements.statusBanner) return;
  domElements.statusBanner.textContent = message;
  domElements.statusBanner.style.display = 'flex';
  domElements.statusBanner.className = `status-banner is-${type}`;
}

function hideStatus() {
  if (!domElements.statusBanner) return;
  domElements.statusBanner.style.display = 'none';
  domElements.statusBanner.className = 'status-banner';
}

// ==========================================================================
// 9. ROUTE TEILEN (LINK & QR-CODE)
// ==========================================================================

/**
 * Oeffnet das Modal zum Teilen der Route und erzeugt Link & QR-Code
 */
function openShareModal() {
  if (state.waypoints.length < 2) {
    showStatus('Bitte setze mindestens 2 Punkte, um eine Route zu teilen.', 'error');
    return;
  }

  if (!window.RouteUrl || typeof window.RouteUrl.buildRouteUrl !== 'function') {
    console.error('RouteUrl-Bibliothek ist nicht verfügbar.');
    return;
  }

  syncSegmentModes();

  // URL mit Segment-Modi erzeugen
  const shareUrl = window.RouteUrl.buildRouteUrl(state.waypoints, state.segmentModes);

  // Input-Feld befuellen
  if (domElements.shareUrlInput) {
    domElements.shareUrlInput.value = shareUrl;
  }

  // Rueckmeldung zuruecksetzen
  if (domElements.shareCopyFeedback) {
    domElements.shareCopyFeedback.style.display = 'none';
  }

  // QR-Code rendern
  if (domElements.shareQrContainer) {
    domElements.shareQrContainer.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      try {
        new QRCode(domElements.shareQrContainer, {
          text: shareUrl,
          width: 180,
          height: 180,
          colorDark: '#121212',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (err) {
        console.error('QR-Code-Erzeugung fehlgeschlagen:', err);
      }
    }
  }

  // Modal anzeigen
  if (domElements.shareModal) {
    domElements.shareModal.style.display = 'flex';
  }
}

/**
 * Schliesst das Teilen-Modal
 */
function closeShareModal() {
  if (domElements.shareModal) {
    domElements.shareModal.style.display = 'none';
  }
}

/**
 * Kopiert die Teilen-URL in die Zwischenablage
 */
function copyShareUrl() {
  if (!domElements.shareUrlInput) return;
  const url = domElements.shareUrlInput.value;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      showCopyFeedback();
    }).catch(() => {
      fallbackCopyText();
    });
  } else {
    fallbackCopyText();
  }
}

function fallbackCopyText() {
  if (!domElements.shareUrlInput) return;
  domElements.shareUrlInput.select();
  domElements.shareUrlInput.setSelectionRange(0, 99999);
  try {
    document.execCommand('copy');
    showCopyFeedback();
  } catch (err) {
    console.error('Kopieren fehlgeschlagen:', err);
  }
}

function showCopyFeedback() {
  if (!domElements.shareCopyFeedback) return;
  domElements.shareCopyFeedback.style.display = 'block';
  setTimeout(() => {
    if (domElements.shareCopyFeedback) {
      domElements.shareCopyFeedback.style.display = 'none';
    }
  }, 3000);
}

/**
 * Prueft beim Seitenstart, ob Routenparameter in der URL uebergeben wurden
 */
function checkUrlParamsOnLoad() {
  if (!window.RouteUrl || !window.location.search) return;

  const result = window.RouteUrl.parseRouteUrl(window.location.search);
  if (result.valid && result.waypoints.length >= 2) {
    if (result.mode && domElements.modeSelect) {
      state.selectedMode = result.mode;
      domElements.modeSelect.value = result.mode;
      updateProfileExplanation(result.mode);
    }

    if (result.segmentModes && result.segmentModes.length > 0) {
      state.segmentModes = [...result.segmentModes];
    }

    // Sobald die Karte bereit ist, Wegpunkte hinzufuegen
    const applyWaypoints = () => {
      result.waypoints.forEach(wp => {
        const wpObj = createWaypointObject(wp.lng, wp.lat);
        state.waypoints.push(wpObj);
      });
      syncSegmentModes();
      updateMarkerLabels();
      renderWaypointsList();
      if (state.waypoints.length >= 2) {
        calculateRoute();
      }
    };

    if (map && map.loaded()) {
      applyWaypoints();
    } else if (map) {
      map.on('load', applyWaypoints);
    }
  }
}

