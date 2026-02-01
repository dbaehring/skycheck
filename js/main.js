/**
 * SkyCheck - Haupt-Modul
 * Orchestrierung, Event-Listener, Initialisierung
 * v9 - Rebranding
 */

import { state } from './state.js';
import { STORAGE_KEYS, APP_INFO } from './config.js';

// Map-Modul
import {
    initMap,
    setLocationCallback,
    getGPSLocation,
    shareLocation,
    checkURLParams,
    handleMapClick,
    flyTo
} from './map.js';

// Favorites-Modul
import {
    loadFavorites,
    loadFavoriteWeatherCache,
    renderFavorites,
    openFavoriteModal,
    closeFavoriteModal,
    saveFavorite,
    confirmDelete,
    closeConfirmModal,
    openCompareModal,
    closeCompareModal
} from './favorites.js';

// Weather-Modul
import {
    fetchWeatherData,
    refreshData,
    setWeatherCallback
} from './weather.js';

// UI-Modul
import {
    setupDays,
    selectDay,
    buildTimeline,
    selectHour,
    updateDisplay,
    getPreferredTheme,
    setTheme,
    toggleTheme,
    loadContrastMode,
    toggleContrastMode,
    toggleParamCard,
    expandAllCards,
    collapseAllCards,
    autoExpandRedCards,
    toggleWindroseVisibility,
    loadWindroseState,
    toggleHeightCard,
    loadHeightCardState,
    toggleExplanation,
    showQuickExplanation,
    loadParamFilter,
    handleFilterChange,
    resetParamFilter,
    toggleParamFilter,
    openAboutModal,
    closeAboutModal,
    switchAboutTab,
    initTouchTooltips,
    renderWindDiagram,
    toggleWindDiagram,
    loadWindDiagramState,
    initPullToRefresh,
    // Expertenmodus
    loadExpertMode,
    toggleExpertMode,
    openExpertSettings,
    closeExpertSettings,
    saveExpertSettings,
    resetExpertSettings,
    applyExpertPreset
} from './ui.js';

/**
 * App initialisieren
 */
async function initApp() {
    try {
        // 1. Theme laden
        const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
        setTheme(savedTheme || getPreferredTheme());
        loadContrastMode();

        // 2. Karte initialisieren
        initMap();

        // 3. Favoriten laden (inkl. Wetter-Cache)
        loadFavorites();
        loadFavoriteWeatherCache();
        renderFavorites();

        // 4. Callbacks registrieren
        setLocationCallback(fetchWeatherData);
        setWeatherCallback(onWeatherLoaded);

        // 5. Event-Listener registrieren
        registerEventListeners();

        // 6. UI-Zustände aus localStorage laden
        loadWindroseState();
        loadHeightCardState();
        loadParamFilter();
        loadWindDiagramState();
        loadExpertMode();

        // 7. Touch-Tooltips initialisieren
        initTouchTooltips();

        // 8. Pull-to-Refresh initialisieren
        initPullToRefresh(refreshData);

        // 9. App-Version global verfügbar machen (für About-Modal)
        window.APP_VERSION = APP_INFO.version;

        // 10. URL-Parameter prüfen
        const params = checkURLParams();
        if (!isNaN(params.lat) && !isNaN(params.lon)) {
            await handleMapClick(params.lat, params.lon, params.name);
            flyTo(params.lat, params.lon, 11);
        }

        // Theme aus URL (falls vorhanden)
        if (params.theme) {
            setTheme(params.theme);
        }
    } catch (error) {
        console.error('SkyCheck: Initialization error:', error);
    }
}


/**
 * Callback wenn Wetterdaten geladen wurden
 */
function onWeatherLoaded() {
    setupDays();
    selectDay(0);
}

/**
 * Alle Event-Listener registrieren
 */
function registerEventListeners() {
    // GPS-Button
    const gpsBtn = document.getElementById('gpsBtn');
    if (gpsBtn) {
        gpsBtn.addEventListener('click', getGPSLocation);
    }

    // Share-Button
    const shareBtn = document.getElementById('shareBtn');
    if (shareBtn) {
        shareBtn.addEventListener('click', shareLocation);
    }

    // Refresh-Button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshData);
    }

    // Favoriten-Button
    const addFavoriteBtn = document.getElementById('addFavoriteBtn');
    if (addFavoriteBtn) {
        addFavoriteBtn.addEventListener('click', openFavoriteModal);
    }

    // Theme-Toggle
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }

    // High Contrast Toggle
    const contrastToggle = document.getElementById('contrastToggle');
    if (contrastToggle) {
        contrastToggle.addEventListener('click', toggleContrastMode);
    }

    // Favoriten-Modal
    const closeFavModal = document.getElementById('closeFavModal');
    if (closeFavModal) {
        closeFavModal.addEventListener('click', closeFavoriteModal);
    }

    const saveFavBtn = document.getElementById('saveFavBtn');
    if (saveFavBtn) {
        saveFavBtn.addEventListener('click', saveFavorite);
    }

    const cancelFavBtn = document.getElementById('cancelFavBtn');
    if (cancelFavBtn) {
        cancelFavBtn.addEventListener('click', closeFavoriteModal);
    }

    // Enter-Taste im Favoriten-Input
    const favoriteNameInput = document.getElementById('favoriteNameInput');
    if (favoriteNameInput) {
        favoriteNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                saveFavorite();
            }
        });
    }

    // Bestätigungs-Modal (für Favoriten löschen)
    const confirmOkBtn = document.getElementById('confirmOkBtn');
    if (confirmOkBtn) {
        confirmOkBtn.addEventListener('click', confirmDelete);
    }

    const confirmCancelBtn = document.getElementById('confirmCancelBtn');
    if (confirmCancelBtn) {
        confirmCancelBtn.addEventListener('click', closeConfirmModal);
    }

    const confirmModal = document.getElementById('confirmModal');
    if (confirmModal) {
        confirmModal.addEventListener('click', (e) => {
            if (e.target === confirmModal) {
                closeConfirmModal();
            }
        });
    }

    // Favoriten-Vergleich
    const favCompareBtn = document.getElementById('favCompareBtn');
    if (favCompareBtn) {
        favCompareBtn.addEventListener('click', openCompareModal);
    }

    const closeCompareModalBtn = document.getElementById('closeCompareModal');
    if (closeCompareModalBtn) {
        closeCompareModalBtn.addEventListener('click', closeCompareModal);
    }

    const compareModal = document.getElementById('compareModal');
    if (compareModal) {
        compareModal.addEventListener('click', (e) => {
            if (e.target === compareModal) {
                closeCompareModal();
            }
        });
    }

    // Windrose-Toggle
    const windroseToggle = document.getElementById('windroseToggle');
    if (windroseToggle) {
        windroseToggle.addEventListener('click', toggleWindroseVisibility);
    }

    // Höhenkarte-Toggle
    const heightCardToggle = document.getElementById('heightCardToggle');
    if (heightCardToggle) {
        heightCardToggle.addEventListener('click', toggleHeightCard);
    }

    // Alle erweitern/reduzieren Buttons
    const expandAllBtn = document.getElementById('expandAllBtn');
    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', expandAllCards);
    }

    const collapseAllBtn = document.getElementById('collapseAllBtn');
    if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', collapseAllCards);
    }

    // Parameter-Karten (Event-Delegation)
    const parameterGrid = document.querySelector('.parameter-grid');
    if (parameterGrid) {
        parameterGrid.addEventListener('click', (e) => {
            const header = e.target.closest('.param-header');
            if (header) {
                const card = header.closest('.param-card');
                if (card) {
                    toggleParamCard(card, e);
                }
            }

            // Quick-Explanation Links
            const explainLink = e.target.closest('.explain-link');
            if (explainLink) {
                e.preventDefault();
                const param = explainLink.dataset.param;
                if (param) {
                    showQuickExplanation(param);
                }
            }
        });
    }

    // Day-Comparison Cards (Event-Delegation)
    const dayComparisonGrid = document.getElementById('dayComparisonGrid');
    if (dayComparisonGrid) {
        dayComparisonGrid.addEventListener('click', (e) => {
            const card = e.target.closest('.day-comparison-card');
            if (card && card.dataset.dayIdx !== undefined) {
                selectDay(parseInt(card.dataset.dayIdx));
            }
        });
    }

    // Timeline Slots (Event-Delegation)
    const timeline = document.getElementById('timeline');
    if (timeline) {
        timeline.addEventListener('click', (e) => {
            const slot = e.target.closest('.timeline-slot');
            if (slot && slot.dataset.hourIdx !== undefined) {
                selectHour(parseInt(slot.dataset.hourIdx));
            }
        });
    }

    // Erklärungen-Bereich Toggle
    const explanationToggle = document.getElementById('explanationToggle');
    if (explanationToggle) {
        explanationToggle.addEventListener('click', toggleExplanation);
    }

    // Keyboard-Shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Modal schließen bei Klick außerhalb
    const favoriteModal = document.getElementById('favoriteModal');
    if (favoriteModal) {
        favoriteModal.addEventListener('click', (e) => {
            if (e.target === favoriteModal) {
                closeFavoriteModal();
            }
        });
    }

    // Escape zum Schließen von Modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeFavoriteModal();
            closeAboutModal();
        }
    });

    // Parameter-Filter Toggle
    const paramFilterToggle = document.getElementById('paramFilterToggle');
    if (paramFilterToggle) {
        paramFilterToggle.addEventListener('click', toggleParamFilter);
    }

    // Parameter-Filter Checkboxen
    const filterCheckboxes = ['filterWind', 'filterThermik', 'filterClouds', 'filterPrecip'];
    filterCheckboxes.forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) {
            checkbox.addEventListener('change', handleFilterChange);
        }
    });

    // Parameter-Filter Reset
    const paramFilterReset = document.getElementById('paramFilterReset');
    if (paramFilterReset) {
        paramFilterReset.addEventListener('click', resetParamFilter);
    }

    // === About-Modal Event-Listener ===
    const aboutBtn = document.getElementById('aboutBtn');
    if (aboutBtn) {
        aboutBtn.addEventListener('click', openAboutModal);
    }

    const closeAboutModalBtn = document.getElementById('closeAboutModal');
    if (closeAboutModalBtn) {
        closeAboutModalBtn.addEventListener('click', closeAboutModal);
    }

    const aboutModal = document.getElementById('aboutModal');
    if (aboutModal) {
        // Schließen bei Klick auf Overlay
        aboutModal.addEventListener('click', (e) => {
            if (e.target === aboutModal) {
                closeAboutModal();
            }
        });
    }

    // About-Tabs (Event-Delegation)
    const aboutTabs = document.querySelector('.about-tabs');
    if (aboutTabs) {
        aboutTabs.addEventListener('click', (e) => {
            const tab = e.target.closest('.about-tab');
            if (tab && tab.dataset.tab) {
                switchAboutTab(tab.dataset.tab);
            }
        });
    }

    // Wind-Profil Toggle
    const windProfileToggle = document.getElementById('windProfileToggle');
    if (windProfileToggle) {
        windProfileToggle.addEventListener('click', toggleWindDiagram);
    }

    // === Expertenmodus Event-Listener ===
    const expertModeToggle = document.getElementById('expertModeToggle');
    if (expertModeToggle) {
        expertModeToggle.addEventListener('change', toggleExpertMode);
    }

    const expertSettingsBtn = document.getElementById('expertSettingsBtn');
    if (expertSettingsBtn) {
        expertSettingsBtn.addEventListener('click', openExpertSettings);
    }

    const closeExpertModalBtn = document.getElementById('closeExpertModal');
    if (closeExpertModalBtn) {
        closeExpertModalBtn.addEventListener('click', closeExpertSettings);
    }

    const expertModal = document.getElementById('expertModal');
    if (expertModal) {
        expertModal.addEventListener('click', (e) => {
            if (e.target === expertModal) {
                closeExpertSettings();
            }
        });
    }

    const expertSaveBtn = document.getElementById('expertSaveBtn');
    if (expertSaveBtn) {
        expertSaveBtn.addEventListener('click', saveExpertSettings);
    }

    const expertResetBtn = document.getElementById('expertResetBtn');
    if (expertResetBtn) {
        expertResetBtn.addEventListener('click', resetExpertSettings);
    }

    // Expert Presets (Event-Delegation)
    const expertPresets = document.querySelector('.expert-presets');
    if (expertPresets) {
        expertPresets.addEventListener('click', (e) => {
            const btn = e.target.closest('.expert-preset-btn');
            if (btn && btn.dataset.preset) {
                applyExpertPreset(btn.dataset.preset);
            }
        });
    }
}

/**
 * Keyboard-Shortcuts verarbeiten
 */
function handleKeyboardShortcuts(e) {
    // Nicht wenn in Input-Feld
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch(e.key) {
        case 'r':
        case 'R':
            if (!e.ctrlKey && !e.metaKey) {
                refreshData();
            }
            break;
        case 't':
        case 'T':
            if (!e.ctrlKey && !e.metaKey) {
                toggleTheme();
            }
            break;
        case '1':
        case '2':
        case '3':
            const dayIdx = parseInt(e.key) - 1;
            if (state.forecastDays[dayIdx]) {
                selectDay(dayIdx);
            }
            break;
        case 'ArrowLeft':
            if (state.selectedHourIndex !== null && state.selectedHourIndex > 0) {
                selectHour(state.selectedHourIndex - 1);
            }
            break;
        case 'ArrowRight':
            if (state.selectedHourIndex !== null) {
                selectHour(state.selectedHourIndex + 1);
            }
            break;
    }
}

// App starten wenn DOM geladen
document.addEventListener('DOMContentLoaded', initApp);
