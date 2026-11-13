/* ==========================================================================
   AUTHENTIC WINDOWS 3.1 PROGRAM MANAGER LOGIC
   With Retro Game Catalog + Real Win16 + Emulators + Archive Downloader
   ========================================================================== */

let catalog = [];
let favorites = new Set();
let recent = [];
let appConfig = {
  mode: 'workstation',
  capabilities: {
    system_optimizer: true,
    archive_search: true,
    archive_download: true,
    catalog_refresh: true
  }
};
let windows = {};
let activeWindowId = null;
let selectedGame = null;
let soundEnabled = true;
let scanlinesEnabled = false;
let audioCtx = null;
let pageStates = {}; // id -> currentPage
const BOOKLET_PDF_URL = window.retroBrowserBookletUrl || `roms/${['shareware_cds', 'Sirius_5_Foot_10_Pack_Booklet.pdf'].map(encodeURIComponent).join('/')}`;
const BOOKLET_PDFJS_URL = './vendor/pdfjs/pdf.min.js';
const BOOKLET_PDFJS_WORKER_URL = './vendor/pdfjs/pdf.worker.min.js';
const BOOKLET_MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
let bookletPdfJsPromise = null;
let bookletLoadingTask = null;
let bookletDocument = null;
let bookletRenderTask = null;
let bookletSession = 0;
let bookletRenderVersion = 0;
let bookletPageNumber = 1;
let bookletZoom = 1;
let bookletRotation = 0;

// Built-in Windows 3.1 Software Definitions
const WIN31_GAMES_LIST = [
  { id: 'win16_skifree', title: 'SkiFree', icon: 'icons/winlogo.svg', desc: 'Classic Windows 3.1 SkiFree (Runs natively via WineVDM)', platform: 'win31', exe: 'SKI.EXE', folder: 'skifree' },
  { id: 'win16_jezzball', title: 'JezzBall', icon: 'icons/winlogo.svg', desc: 'Classic Windows 3.1 JezzBall (Runs natively via WineVDM)', platform: 'win31', exe: 'JEZZBALL.EXE', folder: 'jezzball' },
  { id: 'win16_chips', title: "Chip's Challenge", icon: 'icons/winlogo.svg', desc: "Classic tile puzzle game (Runs natively via WineVDM)", platform: 'win31', exe: 'CHIPS.EXE', folder: 'chips' },
  { id: 'win16_castle', title: 'Castle of the Winds', icon: 'icons/winlogo.svg', desc: 'Legendary Windows 3.1 RPG (Runs natively via WineVDM)', platform: 'win31', exe: 'CASTLE1.EXE', folder: 'castle' },
  { id: 'app_winmine', title: 'Minesweeper', icon: 'icons/winmine.svg', desc: 'The classic Windows 3.1 minefield logic puzzle.', fn: () => launchMinesweeper() },
  { id: 'app_sol', title: 'Solitaire', icon: 'icons/sol.svg', desc: 'Klondike Solitaire card game with retro Windows card backs.', fn: () => launchSolitaire() }
];

const WIN31_ACCESSORIES_LIST = [
  { id: 'app_pbrush', title: 'Paintbrush', icon: 'icons/pbrush.svg', desc: 'Classic bitmap painting and drawing studio.', fn: () => launchPaintbrush() },
  { id: 'app_notepad', title: 'Notepad', icon: 'icons/notepad.svg', desc: 'Simple text editor for notes, cheats, and passwords.', fn: () => launchNotepad() },
  { id: 'app_calc', title: 'Calculator', icon: 'icons/calc.svg', desc: 'Standard arithmetic calculator.', fn: () => launchCalculator() },
  { id: 'app_clock', title: 'Clock', icon: 'icons/clock.svg', desc: 'Analog and digital clock.', fn: () => launchClock() },
  { id: 'app_dosprompt', title: 'MS-DOS Prompt', icon: 'icons/dosprompt.svg', desc: 'Command line terminal with DIR and game launcher.', fn: () => launchDosPrompt() },
  { id: 'app_winfile', title: 'File Manager', icon: 'icons/winfile.svg', desc: 'Dual-pane directory and real filesystem browser.', fn: () => openFileManager() },
  { id: 'app_archive', title: 'Archive.org Downloader', icon: 'icons/cdrom.svg', desc: 'Search and install thousands of free DOS/Win3.1 games.', fn: () => openArchiveDownloader() },
  { id: 'app_pccleanup', title: 'System Optimizer', icon: 'icons/winfile.svg', desc: 'Hardware-tuned PC Cleanup & System Maintenance Suite.', fn: () => launchSystemOptimizer() }
];

function familyWin31Games() {
  const bundledApps = WIN31_GAMES_LIST.filter(app => typeof app.fn === 'function');
  const catalogGames = catalog
    .filter(game => game.platform === 'win31')
    .map(game => ({
      ...game,
      icon: 'icons/winlogo.svg',
      desc: game.desc || `${game.title} from the local Windows 3.1 catalog.`
    }));
  const seen = new Set();
  return [...bundledApps, ...catalogGames].filter(game => {
    if (seen.has(game.id)) return false;
    seen.add(game.id);
    return true;
  });
}

const GEMINI_LINKS = [
  { id: 'gemini_home', title: 'Gemini Home', url: 'https://gemini.google.com/', desc: 'Google Gemini AI assistant' },
  { id: 'gemini_chat', title: 'New Chat', url: 'https://gemini.google.com/app', desc: 'Start a new conversation' },
  { id: 'gemini_lib', title: 'Library', url: 'https://gemini.google.com/library', desc: 'Saved chats and prompts' },
  { id: 'gemini_img', title: 'Images', url: 'https://gemini.google.com/images', desc: 'AI image generator and gallery' },
  { id: 'gemini_sched', title: 'Scheduled', url: 'https://gemini.google.com/scheduled', desc: 'Automations and schedules' },
  { id: 'gemini_brief', title: 'Daily Brief', url: 'https://gemini.google.com/daily-brief', desc: 'Your morning daily briefing' },
  { id: 'gemini_nb_view', title: 'All Notebooks', url: 'https://gemini.google.com/notebooks/view', desc: 'View all research notebooks' },
  { id: 'gemini_nb_new', title: 'New Notebook', url: 'https://gemini.google.com/notebooks/create', desc: 'Create a new research notebook' },
];

// Sound Effects Synthesizer using Web Audio API
function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
}

function playSound(type) {
  if (!soundEnabled || !audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;

  if (type === 'tada') {
    const notes = [293.66, 369.99, 440.00, 587.33];
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);
      gain.gain.setValueAtTime(0.08, now + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 1.2);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 1.3);
    });
  } else if (type === 'click') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(750, now);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  } else if (type === 'ding') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.65);
  }
}

// --------------------------------------------------------------------------
// Initialization
// --------------------------------------------------------------------------
let desktopInitialized = false;

async function initializeDesktop() {
  if (desktopInitialized) return;
  desktopInitialized = true;
  setupMenus();
  setupToolbar();
  setupKeyboard();
  setupBookletViewer();
  window.addEventListener('resize', () => Object.values(windows).forEach(clampWindowToWorkspace));

  await loadData();
  initGroupWindows();

  const triggerTada = () => {
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    playSound('tada');
    window.removeEventListener('click', triggerTada);
    window.removeEventListener('keydown', triggerTada);
  };
  window.addEventListener('click', triggerTada);
  window.addEventListener('keydown', triggerTada);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDesktop, { once: true });
} else {
  void initializeDesktop();
}

async function loadData() {
  try {
    const [configResp, catResp, favResp, recResp] = await Promise.all([
      fetch('/api/capabilities'),
      fetch('/api/catalog'),
      fetch('/api/favorites'),
      fetch('/api/recent')
    ]);
    if (configResp.ok) {
      appConfig = normalizeAppConfig(await configResp.json());
    }
    catalog = await catResp.json();
    favorites = new Set(await favResp.json());
    recent = await recResp.json();
    applyProfileToShell();
    updateCatalogCounts();
    updateFavCount();
    document.getElementById('status-total-games').textContent = `${catalog.length} ${catalog.length === 1 ? 'Game' : 'Games'}`;
    const aboutCount = document.getElementById('about-games-count');
    if (aboutCount) aboutCount.textContent = `${catalog.length} Classic Titles`;
  } catch (err) {
    console.error('Error fetching data:', err);
  }
}

function refreshCatalogWindows() {
  const groups = [
    ['dos', catalog.filter(game => game.platform === 'dos'), 'dos'],
    ['shareware_cds', catalog.filter(game => game.platform === 'shareware_cds'), 'shareware_cds'],
    ['snes', catalog.filter(game => game.platform === 'snes'), 'snes'],
    ['gb_gbc', catalog.filter(game => game.platform === 'gb' || game.platform === 'gbc'), 'gb_gbc'],
    ['sega_arcade', catalog.filter(game => game.platform === 'md' || game.platform === 'mame'), 'sega_arcade'],
    ['favorites', catalog.filter(game => favorites.has(game.id)), 'favorites']
  ];
  groups.forEach(([id, games, groupId]) => {
    const win = windows[id];
    if (win) renderGamesToClient(win.client, games, groupId);
  });
  const snesCount = document.getElementById('snes-toolbar-count');
  if (snesCount) snesCount.textContent = catalog.filter(game => game.platform === 'snes').length;
}

window.retroReloadCatalog = async () => {
  await loadData();
  refreshCatalogWindows();
};

function normalizeAppConfig(payload) {
  const familyMode = payload && typeof payload === 'object' && (
    payload.family_mode === true || payload.mode === 'family' || payload.profile === 'family'
  );
  const defaults = familyMode
    ? { system_optimizer: false, archive_search: false, archive_download: false, catalog_refresh: true }
    : { system_optimizer: true, archive_search: true, archive_download: true, catalog_refresh: true };
  const supplied = payload && typeof payload === 'object' && payload.capabilities && typeof payload.capabilities === 'object'
    ? payload.capabilities
    : {
      system_optimizer: payload?.private_tools,
      archive_search: payload?.archive_access,
      archive_download: payload?.archive_access,
      catalog_refresh: payload?.catalog_refresh
    };
  const capabilities = Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => [
    name,
    typeof supplied[name] === 'boolean' ? supplied[name] : fallback
  ]));
  return { mode: familyMode ? 'family' : 'workstation', capabilities };
}

function isCapabilityEnabled(name) {
  return appConfig.capabilities[name] === true;
}

function setProfileAction(id, enabled) {
  const element = document.getElementById(id);
  if (!element) return;
  element.hidden = !enabled;
  element.setAttribute('aria-disabled', String(!enabled));
}

function applyProfileToShell() {
  setProfileAction('toolbar-downloader-btn', isCapabilityEnabled('archive_search') && isCapabilityEnabled('archive_download'));
  setProfileAction('menu-downloader', isCapabilityEnabled('archive_search') && isCapabilityEnabled('archive_download'));
  setProfileAction('menu-sirius-booklet', appConfig.mode !== 'family');
}

function updateFavCount() {
  const el = document.getElementById('fav-count');
  if (el) el.textContent = favorites.size;
}

function updateCatalogCounts() {
  const snesCount = catalog.filter(game => game.platform === 'snes').length;
  const snesToolbarCount = document.getElementById('snes-toolbar-count');
  if (snesToolbarCount) snesToolbarCount.textContent = String(snesCount);
}

// --------------------------------------------------------------------------
// MDI Window Manager
// --------------------------------------------------------------------------
let windowZIndex = 10;
let activeLaunchRequest = 0;
let dialogReturnFocus = null;
let contextMenuReturnFocus = null;
const windowCleanups = new Map();

function registerWindowCleanup(id, callback) {
  const callbacks = windowCleanups.get(id) || new Set();
  callbacks.add(callback);
  windowCleanups.set(id, callbacks);
}

function openDialog(dialog) {
  if (!dialog) return;
  const activeElement = document.activeElement;
  const owningMenu = activeElement instanceof HTMLElement ?
    [...document.querySelectorAll('.win31-menubar .menu-item')].find(item => item.contains(activeElement)) : null;
  dialogReturnFocus = owningMenu || (activeElement instanceof HTMLElement ? activeElement : null);
  dialog.classList.add('open');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.tabIndex = -1;
  const firstControl = dialog.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]');
  (firstControl || dialog).focus();
}

function closeDialog(dialog) {
  if (!dialog) return;
  dialog.classList.remove('open');
  dialog.removeAttribute('aria-modal');
  dialogReturnFocus?.focus();
  dialogReturnFocus = null;
}

function clampWindowToWorkspace(win) {
  if (!win?.element || win.isMinimized || win.isMaximized) return;
  const workspace = document.getElementById('mdi-workspace');
  const style = getComputedStyle(win.element);
  const borderWidth = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  const borderHeight = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const maxOuterWidth = workspace.clientWidth;
  const maxOuterHeight = Math.max(0, workspace.clientHeight - 64);
  const maxWidth = Math.max(200, maxOuterWidth - borderWidth);
  const maxHeight = Math.max(150, maxOuterHeight - borderHeight);
  const width = Math.min(parseInt(win.element.style.width, 10) || win.width, maxWidth);
  const height = Math.min(parseInt(win.element.style.height, 10) || win.height, maxHeight);
  const outerWidth = width + borderWidth;
  const outerHeight = height + borderHeight;
  const left = Math.min(Math.max(0, parseInt(win.element.style.left, 10) || 0), Math.max(0, maxOuterWidth - outerWidth));
  const top = Math.min(Math.max(0, parseInt(win.element.style.top, 10) || 0), Math.max(0, maxOuterHeight - outerHeight));
  win.element.style.width = `${width}px`;
  win.element.style.height = `${height}px`;
  win.element.style.left = `${left}px`;
  win.element.style.top = `${top}px`;
}

function createMdiWindow(id, title, iconSrc, x, y, width, height, isClosable = false) {
  if (windows[id]) {
    restoreWindow(id);
    return windows[id];
  }

  const workspace = document.getElementById('mdi-workspace');
  const winEl = document.createElement('div');
  winEl.className = 'mdi-window active';
  winEl.id = `win-${id}`;
  winEl.style.left = `${x}px`;
  winEl.style.top = `${y}px`;
  winEl.style.width = `${width}px`;
  winEl.style.height = `${height}px`;
  winEl.style.zIndex = ++windowZIndex;

  winEl.innerHTML = `
    <div class="mdi-titlebar">
      <div class="win31-btn sys-btn" title="Control"><span class="sys-hyphen-sub"></span></div>
      <div class="mdi-title">${escapeHtml(title)}</div>
      <div class="titlebar-controls">
        <div class="win31-btn min-btn" title="Minimize"></div>
        <div class="win31-btn max-btn" title="Maximize"></div>
        ${isClosable ? '<div class="win31-btn close-btn" title="Close"></div>' : ''}
      </div>
    </div>
    <div class="mdi-client" id="client-${id}"></div>
    <!-- Resize Handles -->
    <div class="resize-handle resize-n"></div>
    <div class="resize-handle resize-s"></div>
    <div class="resize-handle resize-w"></div>
    <div class="resize-handle resize-e"></div>
    <div class="resize-handle resize-nw"></div>
    <div class="resize-handle resize-ne"></div>
    <div class="resize-handle resize-sw"></div>
    <div class="resize-handle resize-se"></div>
  `;

  workspace.appendChild(winEl);

  const winObj = {
    id,
    title,
    iconSrc,
    element: winEl,
    client: winEl.querySelector('.mdi-client'),
    x, y, width, height,
    isMinimized: false,
    isMaximized: false,
    savedPos: { x, y, width, height }
  };

  windows[id] = winObj;

  winEl.addEventListener('pointerdown', () => activateWindow(id));

  const titlebar = winEl.querySelector('.mdi-titlebar');
  titlebar.tabIndex = 0;
  titlebar.setAttribute('role', 'group');
  titlebar.setAttribute('aria-label', `${title} title bar; hold Alt and use arrow keys to move`);
  titlebar.addEventListener('keydown', (event) => {
    if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || winObj.isMaximized) return;
    event.preventDefault();
    const delta = event.shiftKey ? 40 : 10;
    const x = parseInt(winObj.element.style.left, 10) || 0;
    const y = parseInt(winObj.element.style.top, 10) || 0;
    if (event.key === 'ArrowLeft') winObj.element.style.left = `${x - delta}px`;
    if (event.key === 'ArrowRight') winObj.element.style.left = `${x + delta}px`;
    if (event.key === 'ArrowUp') winObj.element.style.top = `${y - delta}px`;
    if (event.key === 'ArrowDown') winObj.element.style.top = `${y + delta}px`;
    clampWindowToWorkspace(winObj);
  });
  setupWindowDragging(winObj, titlebar);

  const minBtn = winEl.querySelector('.min-btn');
  minBtn.setAttribute('role', 'button');
  minBtn.tabIndex = 0;
  minBtn.setAttribute('aria-label', `Minimize ${title}`);
  minBtn.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); minBtn.click(); }
  });
  minBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    minimizeWindow(id);
  });

  const maxBtn = winEl.querySelector('.max-btn');
  maxBtn.setAttribute('role', 'button');
  maxBtn.tabIndex = 0;
  maxBtn.setAttribute('aria-label', `Maximize ${title}`);
  maxBtn.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); maxBtn.click(); }
  });
  maxBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMaximizeWindow(id);
  });

  const closeBtn = winEl.querySelector('.close-btn');
  if (closeBtn) {
    closeBtn.setAttribute('role', 'button');
    closeBtn.tabIndex = 0;
    closeBtn.setAttribute('aria-label', `Close ${title}`);
    closeBtn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); closeBtn.click(); }
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeWindow(id);
    });
  }

  setupWindowResizing(winObj);
  clampWindowToWorkspace(winObj);
  activateWindow(id);
  return winObj;
}

function activateWindow(id) {
  if (activeWindowId === id) return;
  activeWindowId = id;
  Object.values(windows).forEach(w => {
    if (w.element) {
      if (w.id === id) {
        w.element.classList.add('active');
        w.element.style.zIndex = ++windowZIndex;
      } else {
        w.element.classList.remove('active');
      }
    }
  });
}

function minimizeWindow(id) {
  const win = windows[id];
  if (!win || win.isMinimized) return;
  playSound('click');
  const shouldReturnFocus = win.element.contains(document.activeElement);

  win.isMinimized = true;
  win.element.style.display = 'none';

  const shelf = document.getElementById('minimized-shelf');
  const iconItem = document.createElement('div');
  iconItem.className = 'minimized-group';
  iconItem.id = `min-${id}`;
  iconItem.innerHTML = `
    <img src="${win.iconSrc}" class="minimized-icon" alt="">
    <div class="minimized-label">${escapeHtml(win.title)}</div>
  `;
  iconItem.tabIndex = 0;
  iconItem.setAttribute('role', 'button');
  iconItem.setAttribute('aria-label', `Restore ${win.title}`);
  iconItem.addEventListener('dblclick', () => restoreWindow(id));
  iconItem.addEventListener('click', () => {
    document.querySelectorAll('.minimized-group').forEach(el => el.classList.remove('selected'));
    iconItem.classList.add('selected');
    playSound('click');
  });
  iconItem.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      restoreWindow(id);
    }
  });
  shelf.appendChild(iconItem);
  if (shouldReturnFocus) iconItem.focus();
  if (activeWindowId === id) {
    activeWindowId = null;
    const fallback = Object.values(windows).filter(item => !item.isMinimized).at(-1);
    if (fallback) activateWindow(fallback.id);
  }
}

function restoreWindow(id) {
  const win = windows[id];
  if (!win) return;
  playSound('click');

  if (win.isMinimized) {
    win.isMinimized = false;
    win.element.style.display = 'flex';
    const minIcon = document.getElementById(`min-${id}`);
    if (minIcon) minIcon.remove();
  }

  clampWindowToWorkspace(win);
  activateWindow(id);
}

function toggleMaximizeWindow(id) {
  const win = windows[id];
  if (!win) return;
  playSound('click');

  const maxBtn = win.element.querySelector('.max-btn');
  if (win.isMaximized) {
    win.isMaximized = false;
    win.element.classList.remove('maximized');
    win.element.style.left = `${win.savedPos.x}px`;
    win.element.style.top = `${win.savedPos.y}px`;
    win.element.style.width = `${win.savedPos.width}px`;
    win.element.style.height = `${win.savedPos.height}px`;
    maxBtn.classList.remove('restore-btn');
    maxBtn.title = 'Maximize';
    maxBtn.setAttribute('aria-label', `Maximize ${win.title}`);
    clampWindowToWorkspace(win);
  } else {
    win.isMaximized = true;
    win.savedPos = {
      x: parseInt(win.element.style.left, 10),
      y: parseInt(win.element.style.top, 10),
      width: parseInt(win.element.style.width, 10),
      height: parseInt(win.element.style.height, 10)
    };
    win.element.classList.add('maximized');
    maxBtn.classList.add('restore-btn');
    maxBtn.title = 'Restore';
    maxBtn.setAttribute('aria-label', `Restore ${win.title}`);
  }
}

function closeWindow(id) {
  const win = windows[id];
  if (!win) return;
  playSound('click');
  if (win.element) win.element.remove();
  const minIcon = document.getElementById(`min-${id}`);
  if (minIcon) minIcon.remove();
  for (const callback of windowCleanups.get(id) || []) callback();
  windowCleanups.delete(id);
  delete windows[id];
  if (activeWindowId === id) {
    activeWindowId = null;
    const fallback = Object.values(windows).filter(item => !item.isMinimized).at(-1);
    if (fallback) activateWindow(fallback.id);
  }
}

function setupWindowDragging(winObj, handle) {
  handle.addEventListener('pointerdown', (event) => {
    if (winObj.isMaximized || event.button !== 0 || event.target.closest('.win31-btn')) return;
    event.preventDefault();
    const workspace = document.getElementById('mdi-workspace');
    const startX = event.clientX;
    const startY = event.clientY;
    const origX = parseInt(winObj.element.style.left, 10) || 0;
    const origY = parseInt(winObj.element.style.top, 10) || 0;
    const limit = () => ({
      x: Math.max(0, workspace.clientWidth - winObj.element.offsetWidth),
      y: Math.max(0, workspace.clientHeight - 64 - winObj.element.offsetHeight)
    });
    const move = (next) => {
      const bounds = limit();
      winObj.element.style.left = `${Math.min(bounds.x, Math.max(0, origX + next.clientX - startX))}px`;
      winObj.element.style.top = `${Math.min(bounds.y, Math.max(0, origY + next.clientY - startY))}px`;
    };
    const cleanup = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', cleanup);
      handle.removeEventListener('pointercancel', cleanup);
      handle.removeEventListener('lostpointercapture', cleanup);
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', cleanup, { once: true });
    handle.addEventListener('pointercancel', cleanup, { once: true });
    handle.addEventListener('lostpointercapture', cleanup, { once: true });
    handle.setPointerCapture(event.pointerId);
  });
}

function setupWindowResizing(winObj) {
  const handles = winObj.element.querySelectorAll('.resize-handle');
  handles.forEach(handle => {
    handle.addEventListener('pointerdown', (event) => {
      if (winObj.isMaximized || event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      const direction = handle.className.split(' ')[1].replace('resize-', '');
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = parseInt(winObj.element.style.width, 10);
      const startHeight = parseInt(winObj.element.style.height, 10);
      const startLeft = parseInt(winObj.element.style.left, 10);
      const startTop = parseInt(winObj.element.style.top, 10);
      const workspace = document.getElementById('mdi-workspace');
      const computedStyle = getComputedStyle(winObj.element);
      const borderWidth = parseFloat(computedStyle.borderLeftWidth) + parseFloat(computedStyle.borderRightWidth);
      const borderHeight = parseFloat(computedStyle.borderTopWidth) + parseFloat(computedStyle.borderBottomWidth);

      const onPointerMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const maxWidth = Math.max(200, workspace.clientWidth - startLeft - borderWidth);
        const maxHeight = Math.max(150, workspace.clientHeight - startTop - 64 - borderHeight);
        if (direction.includes('e')) winObj.element.style.width = `${Math.min(maxWidth, Math.max(200, startWidth + dx))}px`;
        if (direction.includes('s')) winObj.element.style.height = `${Math.min(maxHeight, Math.max(150, startHeight + dy))}px`;
        if (direction.includes('w')) {
          const outerRight = startLeft + startWidth + borderWidth;
          const left = Math.max(0, Math.min(outerRight - 200 - borderWidth, startLeft + dx));
          winObj.element.style.left = `${left}px`;
          winObj.element.style.width = `${Math.max(200, outerRight - borderWidth - left)}px`;
        }
        if (direction.includes('n')) {
          const outerBottom = startTop + startHeight + borderHeight;
          const top = Math.max(0, Math.min(outerBottom - 150 - borderHeight, startTop + dy));
          winObj.element.style.top = `${top}px`;
          winObj.element.style.height = `${Math.max(150, outerBottom - borderHeight - top)}px`;
        }
        clampWindowToWorkspace(winObj);
      };
      const cleanup = () => {
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', cleanup);
        handle.removeEventListener('pointercancel', cleanup);
        handle.removeEventListener('lostpointercapture', cleanup);
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      };
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', cleanup, { once: true });
      handle.addEventListener('pointercancel', cleanup, { once: true });
      handle.addEventListener('lostpointercapture', cleanup, { once: true });
      handle.setPointerCapture(event.pointerId);
    });
  });
}

function cascadeWindows() {
  playSound('click');
  let offset = 20;
  Object.values(windows).forEach((win, i) => {
    if (!win.isMinimized && !win.isMaximized) {
      win.element.style.left = `${offset + i * 26}px`;
      win.element.style.top = `${offset + i * 26}px`;
      win.element.style.width = `460px`;
      win.element.style.height = `320px`;
      win.element.style.zIndex = ++windowZIndex;
      clampWindowToWorkspace(win);
    }
  });
}

function tileWindowsH() {
  playSound('click');
  const workspace = document.getElementById('mdi-workspace');
  const totalW = workspace.clientWidth;
  const totalH = workspace.clientHeight - 64;
  const activeWins = Object.values(windows).filter(w => !w.isMinimized);
  const count = activeWins.length;
  if (count === 0) return;

  const rowHeight = Math.floor(totalH / count);
  activeWins.forEach((win, i) => {
    if (!win.isMaximized) {
      win.savedPos = {
        x: parseInt(win.element.style.left, 10),
        y: parseInt(win.element.style.top, 10),
        width: parseInt(win.element.style.width, 10),
        height: parseInt(win.element.style.height, 10)
      };
    }
    win.isMaximized = false;
    win.element.classList.remove('maximized');
    const maxButton = win.element.querySelector('.max-btn');
    maxButton?.classList.remove('restore-btn');
    if (maxButton) {
      maxButton.title = 'Maximize';
      maxButton.setAttribute('aria-label', `Maximize ${win.title}`);
    }
    win.element.style.left = `0px`;
    win.element.style.top = `${i * rowHeight}px`;
    win.element.style.width = `${totalW}px`;
    win.element.style.height = `${rowHeight}px`;
    clampWindowToWorkspace(win);
  });
}

function tileWindowsV() {
  playSound('click');
  const workspace = document.getElementById('mdi-workspace');
  const totalW = workspace.clientWidth;
  const totalH = workspace.clientHeight - 64;
  const activeWins = Object.values(windows).filter(w => !w.isMinimized);
  const count = activeWins.length;
  if (count === 0) return;

  const colWidth = Math.floor(totalW / count);
  activeWins.forEach((win, i) => {
    if (!win.isMaximized) {
      win.savedPos = {
        x: parseInt(win.element.style.left, 10),
        y: parseInt(win.element.style.top, 10),
        width: parseInt(win.element.style.width, 10),
        height: parseInt(win.element.style.height, 10)
      };
    }
    win.isMaximized = false;
    win.element.classList.remove('maximized');
    const maxButton = win.element.querySelector('.max-btn');
    maxButton?.classList.remove('restore-btn');
    if (maxButton) {
      maxButton.title = 'Maximize';
      maxButton.setAttribute('aria-label', `Maximize ${win.title}`);
    }
    win.element.style.left = `${i * colWidth}px`;
    win.element.style.top = `0px`;
    win.element.style.width = `${colWidth}px`;
    win.element.style.height = `${totalH}px`;
    clampWindowToWorkspace(win);
  });
}

// --------------------------------------------------------------------------
// Populate Group Windows
// --------------------------------------------------------------------------
function initGroupWindows() {
  // 1. MS-DOS Classics Window
  const dosWin = createMdiWindow('dos', 'MS-DOS Classics & Shareware', 'icons/floppy.svg', 25, 20, 480, 310);
  renderGamesToClient(dosWin.client, catalog.filter(g => g.platform === 'dos'), 'dos');

  // 2. Windows 3.1 Win16 Classics
  const win16 = createMdiWindow('win31_classics', 'Windows 3.1 Win16 Classics', 'icons/winlogo.svg', 80, 40, 420, 270);
  renderAppItems(win16.client, appConfig.mode === 'family' ? familyWin31Games() : WIN31_GAMES_LIST);

  // 3. Windows 3.1 Accessories & Main
  const winAcc = createMdiWindow('win31_accessories', 'Accessories & Main', 'icons/pbrush.svg', 160, 60, 440, 280);
  const accessories = WIN31_ACCESSORIES_LIST.filter(app => {
    if (app.id === 'app_pccleanup') return isCapabilityEnabled('system_optimizer');
    if (app.id === 'app_archive') return isCapabilityEnabled('archive_search') && isCapabilityEnabled('archive_download');
    return true;
  });
  renderAppItems(winAcc.client, accessories);

  // 4. Shareware CD-ROMs & Documentation
  const cdWin = createMdiWindow('shareware_cds', 'Shareware CD-ROMs & Documentation', 'icons/cdrom.svg', 220, 80, 450, 290);
  renderGamesToClient(cdWin.client, catalog.filter(g => g.platform === 'shareware_cds'), 'shareware_cds');

  // 5. Super Nintendo Entertainment System (SNES - with pagination)
  const snesGames = catalog.filter(g => g.platform === 'snes');
  const snesWin = createMdiWindow('snes', `Super Nintendo (SNES) - ${snesGames.length} Games`, 'icons/snes.svg', 55, 100, 540, 360);
  renderGamesToClient(snesWin.client, snesGames, 'snes');

  // 6. Game Boy & GBC (Minimized by default)
  const handheldGames = catalog.filter(g => g.platform === 'gb' || g.platform === 'gbc');
  const gbWin = createMdiWindow('gb_gbc', `Game Boy & Game Boy Color (${handheldGames.length} Games)`, 'icons/gameboy.svg', 260, 95, 480, 320);
  renderGamesToClient(gbWin.client, handheldGames, 'gb_gbc');
  minimizeWindow('gb_gbc');

  // 7. Sega Genesis & Arcade (Minimized by default)
  const segaGames = catalog.filter(g => g.platform === 'md' || g.platform === 'mame');
  const segaWin = createMdiWindow('sega_arcade', `Sega Genesis & Arcade Classics (${segaGames.length} Games)`, 'icons/genesis.svg', 320, 120, 460, 300);
  renderGamesToClient(segaWin.client, segaGames, 'sega_arcade');
  minimizeWindow('sega_arcade');

  // 8. Google & Gemini Workspace (Minimized by default)
  const geminiWin = createMdiWindow('gemini', 'Google & Gemini Workspace', 'icons/folder.svg', 380, 140, 460, 300);
  renderGeminiItems(geminiWin.client, GEMINI_LINKS);
  minimizeWindow('gemini');

  // 9. Favorites Window (Minimized)
  const favWin = createMdiWindow('favorites', 'Favorites / Quick Play', 'icons/progman.svg', 420, 160, 420, 280);
  renderFavoritesToClient(favWin.client);
  minimizeWindow('favorites');

  activateWindow('dos');
}

function renderGeminiItems(container, list) {
  container.innerHTML = '';
  container.setAttribute('role', 'grid');
  container.setAttribute('aria-label', 'Shortcuts');
  list.forEach(item => {
    const el = document.createElement('div');
    el.className = 'program-item';
    el.tabIndex = 0;
    el.setAttribute('role', 'gridcell');
    el.setAttribute('aria-label', `Open ${item.title}`);
    el.innerHTML = `
      <img src="icons/folder.svg" class="program-icon" alt="">
      <div class="program-label">${escapeHtml(item.title)}</div>
    `;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.program-item').forEach(i => i.classList.remove('selected'));
      el.classList.add('selected');
      document.getElementById('status-selection').textContent = `${item.title} - ${item.desc}`;
      playSound('click');
    });
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      playSound('click');
      window.open(item.url, '_blank');
    });
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        window.open(item.url, '_blank');
      }
    });
    container.appendChild(el);
  });
}

function gameArtworkMarkup(gameId, fallbackIcon, artworkRevision) {
  const revision = artworkRevision ? String(artworkRevision) : '';
  const artworkUrl = window.retroBrowserArtwork?.(gameId, revision) || fallbackIcon;
  return `<div class="program-artwork-frame">
    <img class="program-icon program-artwork" src="${escapeHtml(artworkUrl)}" data-fallback-src="${escapeHtml(fallbackIcon)}" alt="" aria-hidden="true" loading="lazy" decoding="async">
  </div>`;
}

function attachArtworkFallback(image) {
  if (!(image instanceof HTMLImageElement)) return;
  image.addEventListener('error', () => {
    if (image.dataset.fallbackAttempted === 'true') {
      image.hidden = true;
      return;
    }
    image.dataset.fallbackAttempted = 'true';
    image.classList.remove('program-artwork');
    image.classList.add('program-artwork-fallback');
    image.src = image.dataset.fallbackSrc;
  });
}

function renderAppItems(container, appList) {
  container.innerHTML = '';
  container.setAttribute('role', 'grid');
  container.setAttribute('aria-label', 'Programs');
  appList.forEach(app => {
    const item = document.createElement('div');
    item.className = 'program-item';
    item.tabIndex = 0;
    item.setAttribute('role', 'gridcell');
    item.setAttribute('aria-label', `Open ${app.title}`);
    const iconMarkup = app.platform === 'win31'
      ? gameArtworkMarkup(app.id, app.icon, app.artwork_revision)
      : `<img src="${app.icon}" class="program-icon" alt="">`;
    item.innerHTML = `${iconMarkup}<div class="program-label">${escapeHtml(app.title)}</div>`;
    attachArtworkFallback(item.querySelector('.program-artwork'));

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.program-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      document.getElementById('status-selection').textContent = `${app.title} - ${app.desc}`;
      playSound('click');
    });

    item.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      playSound('click');
      if (app.fn) {
        app.fn();
      } else if (app.platform === 'win31') {
        launchGame(app);
      }
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (app.fn) app.fn();
        else if (app.platform === 'win31') launchGame(app);
      }
    });

    container.appendChild(item);
  });
}

function renderGamesToClient(container, gamesList, groupId = 'generic', pageSize = 60) {
  container.innerHTML = '';
  if (!gamesList || gamesList.length === 0) {
    if (appConfig.mode === 'family' && catalog.length === 0) {
      renderFamilyEmptyLibrary(container, groupId);
      return;
    }
    container.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: #888;">No games found.</div>';
    return;
  }

  // Large groups get pagination
  if (gamesList.length > pageSize) {
    const page = pageStates[groupId] || 0;
    const totalPages = Math.ceil(gamesList.length / pageSize);
    const startIdx = page * pageSize;
    const currentSlice = gamesList.slice(startIdx, startIdx + pageSize);

    // Items container
    const itemsGrid = document.createElement('div');
    itemsGrid.style.display = 'grid';
    itemsGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(85px, 1fr))';
    itemsGrid.style.gap = '8px';
    itemsGrid.style.padding = '8px';
    itemsGrid.style.flexGrow = '1';
    itemsGrid.style.overflowY = 'auto';

    renderItemList(itemsGrid, currentSlice);

    // Pagination bar
    const paginationBar = document.createElement('div');
    paginationBar.className = 'win31-pagination';
    paginationBar.innerHTML = `
      <button class="page-btn" ${page <= 0 ? 'disabled' : ''} id="prev-${groupId}">◄ Prev</button>
      <span class="page-info">Page ${page + 1} of ${totalPages} (${startIdx + 1}-${Math.min(startIdx + pageSize, gamesList.length)} of ${gamesList.length})</span>
      <button class="page-btn" ${page >= totalPages - 1 ? 'disabled' : ''} id="next-${groupId}">Next ►</button>
    `;

    paginationBar.querySelector(`#prev-${groupId}`).addEventListener('click', (e) => {
      e.stopPropagation();
      if (page > 0) {
        pageStates[groupId] = page - 1;
        playSound('click');
        renderGamesToClient(container, gamesList, groupId, pageSize);
      }
    });

    paginationBar.querySelector(`#next-${groupId}`).addEventListener('click', (e) => {
      e.stopPropagation();
      if (page < totalPages - 1) {
        pageStates[groupId] = page + 1;
        playSound('click');
        renderGamesToClient(container, gamesList, groupId, pageSize);
      }
    });

    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.appendChild(itemsGrid);
    container.appendChild(paginationBar);
  } else {
    renderItemList(container, gamesList);
  }
}

function renderFamilyEmptyLibrary(container, groupId) {
  const emptyState = document.createElement('div');
  emptyState.className = 'family-empty-state';
  emptyState.setAttribute('role', 'status');

  const heading = document.createElement('strong');
  heading.textContent = 'No games are installed yet.';
  const message = document.createElement('p');
  message.textContent = 'Add your games to the local library, then refresh the catalog to see them here.';
  emptyState.append(heading, message);

  const refreshButton = document.createElement('button');
  refreshButton.type = 'button';
  refreshButton.className = 'dialog-btn';
  refreshButton.textContent = isCapabilityEnabled('catalog_refresh') ? 'Refresh Catalog' : 'Refresh unavailable';
  refreshButton.disabled = !isCapabilityEnabled('catalog_refresh');
  refreshButton.setAttribute('aria-controls', `client-${groupId}`);
  refreshButton.addEventListener('click', () => {
    if (isCapabilityEnabled('catalog_refresh')) refreshCatalog();
  });
  emptyState.appendChild(refreshButton);
  container.appendChild(emptyState);
}

function renderItemList(container, list) {
  container.setAttribute('role', 'grid');
  container.setAttribute('aria-label', 'Programs');
  list.forEach(game => {
    const item = document.createElement('div');
    item.className = 'program-item';
    item.dataset.gameId = game.id;
    if (favorites.has(game.id)) {
      item.classList.add('is-favorite');
    }

    const iconMap = {
      snes: 'icons/snes.svg',
      dos: 'icons/floppy.svg',
      win31: 'icons/winlogo.svg',
      shareware_cds: game.filename && game.filename.endsWith('.pdf') ? 'icons/booklet.svg' : 'icons/cdrom.svg',
      gb: 'icons/gameboy.svg',
      gbc: 'icons/gameboy.svg',
      md: 'icons/genesis.svg',
      mame: 'icons/arcade.svg'
    };
    const iconUrl = iconMap[game.platform] || 'icons/progman.svg';

    item.innerHTML = `
      ${gameArtworkMarkup(game.id, iconUrl, game.artwork_revision)}
      <div class="program-label">${escapeHtml(game.title)}</div>
      ${favorites.has(game.id) ? '<span class="fav-star">★</span>' : ''}
    `;
    attachArtworkFallback(item.querySelector('.program-artwork'));

    item.tabIndex = container.querySelector('.program-item') ? -1 : 0;
    item.setAttribute('role', 'gridcell');
    item.setAttribute('aria-label', `Launch ${game.title}`);
    item.addEventListener('keydown', (event) => {
      if (!event.key.startsWith('Arrow')) return;
      const direction = event.key.slice(5).toLowerCase();
      const candidates = [...container.querySelectorAll('.program-item')].filter(candidate => candidate !== item);
      const origin = item.getBoundingClientRect();
      const ox = origin.left + origin.width / 2;
      const oy = origin.top + origin.height / 2;
      const next = candidates.map(candidate => {
        const rect = candidate.getBoundingClientRect();
        const dx = rect.left + rect.width / 2 - ox;
        const dy = rect.top + rect.height / 2 - oy;
        const primary = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
        const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
        return { candidate, primary, secondary };
      }).filter(entry => entry.primary > 0)
        .sort((a, b) => a.secondary - b.secondary || a.primary - b.primary)[0];
      if (!next) return;
      event.preventDefault();
      item.tabIndex = -1;
      next.candidate.tabIndex = 0;
      next.candidate.focus();
    });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      selectGame(game, item);
      playSound('click');
    });

    item.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      launchGame(game);
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        launchGame(game);
      }
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      selectGame(game, item);
      item.focus();
      showContextMenu(e.clientX, e.clientY, game);
    });

    container.appendChild(item);
  });
}

function renderFavoritesToClient(container) {
  const favGames = catalog.filter(g => favorites.has(g.id));
  renderGamesToClient(container, favGames, 'favorites');
}

function selectGame(game, itemEl) {
  selectedGame = game;
  document.querySelectorAll('.program-item').forEach(el => el.classList.remove('selected'));
  if (itemEl) itemEl.classList.add('selected');

  const statusText = `${game.title} [${game.platform.toUpperCase()}] • ${game.genre || 'Classic'} • ${game.year || '1993'}`;
  document.getElementById('status-selection').textContent = statusText;
}

// --------------------------------------------------------------------------
// Launch Game Functionality
// --------------------------------------------------------------------------
async function launchGame(game, setup_mode = false) {
  if (!game) return;
  const requestId = ++activeLaunchRequest;
  playSound('click');

  // Immediate 0ms visual feedback: cursor wait, status bar update, and vintage launch indicator dialog
  document.body.classList.add('cursor-wait');
  document.getElementById('status-selection').textContent = `Starting ${game.title}... Please wait...`;

  const indicator = document.getElementById('launch-indicator-box');
  const indicatorTitle = document.getElementById('launch-indicator-title');
  if (indicator) {
    if (indicatorTitle) indicatorTitle.textContent = game.title || 'Starting Application...';
    const gameName = document.getElementById('launch-game-name');
    if (gameName) gameName.textContent = game.title || 'Starting Application...';
    indicator.setAttribute('aria-busy', 'true');
    indicator.classList.add('show');
  }

  try {
    const resp = await fetch('/api/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: game.id, setup_mode: setup_mode })
    });
    const result = await resp.json();
    if (requestId !== activeLaunchRequest) return;
    if (result.canceled) {
      document.getElementById('status-selection').textContent = 'Launch canceled.';
      return;
    }
    if (result.success) {
      document.getElementById('status-selection').textContent = `✓ ${result.message}${result.pid ? ` (PID: ${result.pid})` : ''}`;
    } else {
      document.getElementById('status-selection').textContent = `✕ Launch failed: ${result.message}`;
      alert(`Launch error:\n${result.message}`);
    }
  } catch (err) {
    if (requestId !== activeLaunchRequest) return;
    document.getElementById('status-selection').textContent = `✕ Connection error launching game.`;
    console.error('Launch request error:', err);
  } finally {
    if (requestId === activeLaunchRequest) {
      document.body.classList.remove('cursor-wait');
      if (indicator) {
        indicator.classList.remove('show');
        indicator.removeAttribute('aria-busy');
      }
    }
  }
}

// --------------------------------------------------------------------------
// Quick Filter & Search Bar
// --------------------------------------------------------------------------
function setupToolbar() {
  document.querySelectorAll('.win31-toolbar [data-open-group]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const groupId = btn.dataset.openGroup;
      restoreWindow(groupId);
    });
  });

  const searchInput = document.getElementById('game-search');
  const platformSelect = document.getElementById('platform-select');
  const clearBtn = document.getElementById('search-clear-btn');
  const downloaderBtn = document.getElementById('toolbar-downloader-btn');

  if (downloaderBtn) {
    downloaderBtn.addEventListener('click', () => openArchiveDownloader());
  }

  const applyFilters = () => {
    const q = searchInput.value.toLowerCase().trim();
    const plat = platformSelect.value;

    if (!q && plat === 'ALL') {
      const searchWin = windows['search_results'];
      if (searchWin) closeWindow('search_results');
      return;
    }

    let filtered = catalog;

    if (plat === 'favorites') {
      filtered = filtered.filter(g => favorites.has(g.id));
    } else if (plat === 'recent') {
      filtered = filtered.filter(g => recent.includes(g.id));
    } else if (plat !== 'ALL') {
      filtered = filtered.filter(g => g.platform === plat);
    }

    if (q) {
      filtered = filtered.filter(g =>
        (g.title && g.title.toLowerCase().includes(q)) ||
        (g.genre && g.genre.toLowerCase().includes(q)) ||
        (g.filename && g.filename.toLowerCase().includes(q))
      );
    }

    const searchWin = createMdiWindow('search_results', `Search: "${q || plat}" (${filtered.length} found)`, 'icons/progman.svg', 100, 70, 520, 360, true);
    renderGamesToClient(searchWin.client, filtered, 'search_results');
    activateWindow('search_results');
  };

  searchInput.addEventListener('input', applyFilters);
  platformSelect.addEventListener('change', applyFilters);
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    platformSelect.value = 'ALL';
    applyFilters();
  });
}

// --------------------------------------------------------------------------
// Menus
// --------------------------------------------------------------------------
function setupMenus() {
  const menuItems = document.querySelectorAll('.win31-menubar .menu-item');
  let openMenu = null;

  menuItems.forEach(item => {
    const entries = [...item.querySelectorAll('.dropdown-entry')];
    entries.forEach((entry, index) => {
      entry.setAttribute('role', 'menuitem');
      entry.tabIndex = index === 0 ? 0 : -1;
    });
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.setAttribute('aria-haspopup', 'menu');
    item.setAttribute('aria-expanded', 'false');
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = item.querySelector('.dropdown-menu');
      if (dropdown) {
        if (openMenu && openMenu !== dropdown) {
          openMenu.classList.remove('open');
        }
        dropdown.classList.toggle('open');
        openMenu = dropdown.classList.contains('open') ? dropdown : null;
        item.setAttribute('aria-expanded', String(Boolean(openMenu)));
        if (openMenu) dropdown.querySelector('.dropdown-entry')?.focus();
      }
    });

    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        item.click();
      }
    });

    item.querySelector('.dropdown-menu')?.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const currentIndex = entries.indexOf(document.activeElement);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 :
        (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
      event.preventDefault();
      entries.forEach((entry, index) => { entry.tabIndex = index === nextIndex ? 0 : -1; });
      entries[nextIndex]?.focus();
    });

    item.addEventListener('mouseenter', () => {
      if (openMenu) {
        const dropdown = item.querySelector('.dropdown-menu');
        if (dropdown && dropdown !== openMenu) {
          openMenu.classList.remove('open');
          item.setAttribute('aria-expanded', 'false');
          dropdown.classList.add('open');
          openMenu = dropdown;
          item.setAttribute('aria-expanded', 'true');
        }
      }
    });
  });

  window.addEventListener('click', () => {
    if (openMenu) {
      openMenu.classList.remove('open');
      document.querySelector('.menu-item[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
      openMenu = null;
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !openMenu) return;
    openMenu.classList.remove('open');
    document.querySelector('.menu-item[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
    openMenu = null;
  });

  // Action bindings
  document.getElementById('menu-run')?.addEventListener('click', openRun);
  document.getElementById('menu-open')?.addEventListener('click', () => {
    if (selectedGame) launchGame(selectedGame);
  });
  document.getElementById('menu-launch-native')?.addEventListener('click', () => {
    if (selectedGame) launchGame(selectedGame);
  });
  document.getElementById('menu-properties')?.addEventListener('click', () => {
    if (selectedGame) openProperties(selectedGame);
  });
  document.getElementById('menu-downloader')?.addEventListener('click', openArchiveDownloader);
  document.getElementById('menu-refresh-catalog')?.addEventListener('click', refreshCatalog);
  document.getElementById('menu-cascade')?.addEventListener('click', cascadeWindows);
  document.getElementById('menu-tile-h')?.addEventListener('click', tileWindowsH);
  document.getElementById('menu-tile-v')?.addEventListener('click', tileWindowsV);
  document.getElementById('menu-about')?.addEventListener('click', openAbout);
  document.getElementById('menu-sirius-booklet')?.addEventListener('click', openBooklet);
  document.getElementById('menu-exit')?.addEventListener('click', () => {
    if (confirm('Exit Windows 3.1 Retro Launcher?')) {
      fetch('/api/exit', { method: 'POST' }).then(() => window.close());
    }
  });

}

async function refreshCatalog() {
  if (!isCapabilityEnabled('catalog_refresh')) {
    document.getElementById('status-selection').textContent = 'Catalog refresh is unavailable in this profile.';
    return;
  }
  playSound('click');
  document.getElementById('status-selection').textContent = 'Scanning filesystem for new games...';
  try {
    const res = await fetch('/api/scan', { method: 'POST' });
    const data = await res.json();
    await loadData();
    initGroupWindows();
    document.getElementById('status-selection').textContent = `✓ ${data.message}`;
  } catch (e) {
    document.getElementById('status-selection').textContent = `✕ Scan error: ${e}`;
  }
}

// --------------------------------------------------------------------------
// Keyboard Shortcuts
// --------------------------------------------------------------------------
function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const editing = e.target instanceof HTMLElement && e.target.matches('input, textarea, select, [contenteditable="true"]');
    const activeDialog = document.querySelector('.modal-overlay.open');
    if (e.key === 'Escape') {
      const contextMenu = document.getElementById('context-menu');
      if (contextMenu?.style.display === 'block') hideContextMenu(true);
      const openMenu = document.querySelector('.dropdown-menu.open');
      if (openMenu) {
        openMenu.classList.remove('open');
        document.querySelector('.menu-item[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
      }
      if (activeDialog) {
        const closeActions = {
          'properties-modal': closeProperties,
          'run-modal': closeRun,
          'about-modal': closeAbout,
          'archive-modal': closeArchiveDownloader,
          'filemanager-modal': closeFileManager,
          'booklet-modal': closeBooklet
        };
        closeActions[activeDialog.id]?.();
      }
      return;
    }

    if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && e.target instanceof HTMLElement) {
      const gameItem = e.target.closest('.program-item[data-game-id]');
      const game = gameItem instanceof HTMLElement ? catalog.find(item => item.id === gameItem.dataset.gameId) : null;
      if (gameItem instanceof HTMLElement && game) {
        e.preventDefault();
        showContextMenu(gameItem.getBoundingClientRect().left, gameItem.getBoundingClientRect().bottom, game);
      }
    }

    if (activeDialog && e.key === 'Tab') {
      const controls = [...activeDialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), iframe')]
        .filter(element => element instanceof HTMLElement && element.offsetParent !== null);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    // Ctrl+F or F3: Focus Search
    if ((e.ctrlKey && e.key.toLowerCase() === 'f') || e.key === 'F3') {
      e.preventDefault();
      const s = document.getElementById('game-search');
      if (s) {
        s.focus();
        s.select();
      }
    }

    // F5: Refresh
    if (e.key === 'F5' && !e.shiftKey && !editing) {
      e.preventDefault();
      refreshCatalog();
    }

    // Enter: Launch selected game
    if (e.key === 'Enter' && selectedGame && e.target === document.body) {
      launchGame(selectedGame);
    }

    // Shift+F5: Cascade
    if (e.shiftKey && e.key === 'F5' && !editing) {
      e.preventDefault();
      cascadeWindows();
    }

    // Shift+F4: Tile
    if (e.shiftKey && e.key === 'F4') {
      e.preventDefault();
      tileWindowsH();
    }
  });
}

// --------------------------------------------------------------------------
// Archive.org Game Downloader Utility
// --------------------------------------------------------------------------
function openArchiveDownloader() {
  if (!isCapabilityEnabled('archive_search') || !isCapabilityEnabled('archive_download')) {
    document.getElementById('status-selection').textContent = 'Archive downloads are unavailable in this profile.';
    return;
  }
  playSound('click');
  const modal = document.getElementById('archive-modal');
  openDialog(modal);

  const searchBtn = document.getElementById('archive-search-btn');
  const searchInput = document.getElementById('archive-search-input');
  const collSelect = document.getElementById('archive-collection-select');

  const executeSearch = async () => {
    const q = searchInput.value.trim() || 'game';
    const coll = collSelect.value;
    const status = document.getElementById('archive-status');
    const tbody = document.getElementById('archive-results-body');

    status.textContent = `Searching Archive.org (${coll})...`;
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">Searching Internet Archive API...</td></tr>';

    try {
      const resp = await fetch(`/api/archive/search?q=${encodeURIComponent(q)}&collection=${encodeURIComponent(coll)}`);
      const data = await resp.json();
      const results = data.results || [];

      if (results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color:#888;">No games found matching query.</td></tr>';
        status.textContent = '0 results found.';
        return;
      }

      status.textContent = `Found ${results.length} preserved items:`;
      tbody.innerHTML = '';

      results.forEach(item => {
        const tr = document.createElement('tr');
        const titleCell = document.createElement('td');
        titleCell.style.padding = '4px';
        const title = document.createElement('strong');
        title.textContent = String(item.title || item.identifier || 'Untitled item');
        const identifierLabel = document.createElement('small');
        identifierLabel.style.color = '#666';
        identifierLabel.textContent = String(item.identifier || '');
        titleCell.append(title, document.createElement('br'), identifierLabel);

        const yearCell = document.createElement('td');
        yearCell.style.textAlign = 'center';
        yearCell.textContent = String(item.year || 'N/A');
        const downloadsCell = document.createElement('td');
        downloadsCell.style.textAlign = 'center';
        downloadsCell.textContent = String(item.downloads || 0);
        const actionCell = document.createElement('td');
        actionCell.style.textAlign = 'center';
        const installButton = document.createElement('button');
        installButton.className = 'dialog-btn';
        installButton.style.padding = '2px 6px';
        installButton.textContent = 'Install';
        installButton.addEventListener('click', () => {
          installArchiveGame(item.identifier, coll);
        });
        actionCell.append(installButton);
        tr.append(titleCell, yearCell, downloadsCell, actionCell);

        tbody.appendChild(tr);
      });
    } catch (e) {
      status.textContent = `Search error: ${e}`;
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px; color:red;">Error connecting to API.</td></tr>`;
    }
  };

  searchBtn.onclick = executeSearch;
  searchInput.onkeydown = (e) => {
    if (e.key === 'Enter') executeSearch();
  };
}

function closeArchiveDownloader() {
  playSound('click');
  const modal = document.getElementById('archive-modal');
  closeDialog(modal);
}

async function installArchiveGame(identifier, collection) {
  if (!isCapabilityEnabled('archive_download')) {
    document.getElementById('status-selection').textContent = 'Archive downloads are unavailable in this profile.';
    return;
  }
  const progressBox = document.getElementById('archive-progress-container');
  const progressText = document.getElementById('archive-progress-text');
  const progressFill = document.getElementById('archive-progress-fill');
  const progressTrack = document.getElementById('archive-progress-track');

  progressBox.style.display = 'block';
  progressBox.setAttribute('aria-busy', 'true');
  progressText.textContent = `Downloading ${identifier} from Internet Archive...`;
  progressFill.style.width = '';
  progressFill.classList.add('indeterminate');
  progressTrack.removeAttribute('aria-valuenow');
  progressTrack.setAttribute('aria-valuetext', 'Downloading');

  try {
    const resp = await fetch('/api/archive/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, collection })
    });
    const res = await resp.json();

    if (res.success) {
      progressFill.classList.remove('indeterminate');
      progressFill.style.width = '100%';
      progressBox.removeAttribute('aria-busy');
      progressTrack.setAttribute('aria-valuenow', '100');
      progressTrack.setAttribute('aria-valuetext', 'Installation complete');
      progressText.textContent = `✓ Successfully installed ${identifier}!`;
      await loadData();
      initGroupWindows();
      setTimeout(() => {
        progressBox.style.display = 'none';
        alert(`Installation Complete!\n\n${identifier} has been downloaded and added to your Program Manager.`);
      }, 800);
    } else {
      progressFill.classList.remove('indeterminate');
      progressBox.removeAttribute('aria-busy');
      progressText.textContent = `✕ Install failed: ${res.error}`;
      progressFill.style.width = '0%';
      progressTrack.removeAttribute('aria-valuenow');
      progressTrack.setAttribute('aria-valuetext', 'Installation failed');
    }
  } catch (e) {
    progressFill.classList.remove('indeterminate');
    progressBox.removeAttribute('aria-busy');
    progressText.textContent = `✕ Network error: ${e}`;
    progressTrack.removeAttribute('aria-valuenow');
    progressTrack.setAttribute('aria-valuetext', 'Network error');
  }
}

// --------------------------------------------------------------------------
// Real File Manager Window
// --------------------------------------------------------------------------
async function openFileManager(relPath = '') {
  playSound('click');
  const modal = document.getElementById('filemanager-modal');
  openDialog(modal);

  const pathLabel = document.getElementById('fm-current-path');
  const treePane = document.getElementById('fm-tree-pane');
  const filesPane = document.getElementById('fm-files-pane');
  const statusPane = document.getElementById('fm-status');
  const upBtn = document.getElementById('fm-up-btn');

  pathLabel.textContent = relPath ? `games\\${relPath}` : `games`;
  statusPane.textContent = 'Reading directory...';

  try {
    const resp = await fetch(`/api/fs?path=${encodeURIComponent(relPath)}`);
    const data = await resp.json();
    const items = data.items || [];

    statusPane.textContent = `${items.length} file(s) found in directory.`;

    // Render tree / folders
    treePane.innerHTML = `
      <div style="font-weight:bold; margin-bottom: 6px;">Folders:</div>
      <div class="fm-item" id="fm-root">📁 [root: games]</div>
    `;
    treePane.querySelector('#fm-root').onclick = () => openFileManager('');

    filesPane.innerHTML = '';

    items.forEach(it => {
      const row = document.createElement('div');
      row.className = 'fm-item';
      const icon = it.is_dir ? '📁' : (it.ext in {'.exe':1, '.com':1, '.bat':1} ? '⚙️' : '📄');
      row.innerHTML = `
        <span style="margin-right: 6px;">${icon}</span>
        <span style="flex-grow: 1; font-family: monospace;">${escapeHtml(it.name)}</span>
        <span style="font-size: 10px; color: #666; width: 80px; text-align: right;">${it.is_dir ? '&lt;DIR&gt;' : formatBytes(it.size)}</span>
        <span style="font-size: 10px; color: #666; width: 120px; text-align: right; margin-left: 10px;">${it.modified}</span>
      `;

      row.onclick = () => {
        document.querySelectorAll('.fm-item').forEach(el => el.classList.remove('selected'));
        row.classList.add('selected');
        statusPane.textContent = `${it.name} (${it.is_dir ? 'Directory' : formatBytes(it.size)})`;
      };

      row.ondblclick = () => {
        if (it.is_dir) {
          const next = relPath ? `${relPath}\\${it.name}` : it.name;
          openFileManager(next);
        } else {
          // If it matches a game in catalog, launch it!
          const g = catalog.find(c => c.filename === it.name || c.folder === it.name || c.id.includes(it.name.split('.')[0].toLowerCase()));
          if (g) {
            launchGame(g);
          } else {
            alert(`File: ${it.name}\nSize: ${formatBytes(it.size)}\nModified: ${it.modified}`);
          }
        }
      };

      filesPane.appendChild(row);
    });

    upBtn.onclick = () => {
      if (relPath) {
        const parts = relPath.split(/[/\\]/);
        parts.pop();
        openFileManager(parts.join('\\'));
      }
    };
  } catch (e) {
    statusPane.textContent = `Error reading directory: ${e}`;
  }
}

function closeFileManager() {
  playSound('click');
  const modal = document.getElementById('filemanager-modal');
  closeDialog(modal);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// --------------------------------------------------------------------------
// Modals & Dialogs
// --------------------------------------------------------------------------
function openProperties(game) {
  if (!game) return;
  playSound('click');
  document.getElementById('prop-title').textContent = game.title;
  document.getElementById('prop-platform').textContent = `Platform: ${game.platform.toUpperCase()}`;
  document.getElementById('prop-genre').textContent = game.genre || 'Action';
  document.getElementById('prop-dev').textContent = game.developer || 'Unknown';
  document.getElementById('prop-year').textContent = game.year || '1993';
  document.getElementById('prop-file').textContent = game.filename || game.exe || game.folder || 'N/A';
  document.getElementById('prop-desc').textContent = game.desc || `Classic ${game.platform.toUpperCase()} video game title.`;

  document.getElementById('prop-launch-btn').onclick = () => {
    closeProperties();
    launchGame(game);
  };

  openDialog(document.getElementById('properties-modal'));
}

function closeProperties() {
  playSound('click');
  closeDialog(document.getElementById('properties-modal'));
}

function openRun() {
  playSound('click');
  openDialog(document.getElementById('run-modal'));
  const input = document.getElementById('run-command-input');
  input.value = '';
  input.focus();

  document.getElementById('run-submit-btn').onclick = () => {
    const cmd = input.value.trim().toLowerCase();
    closeRun();
    if (!cmd) return;

    if (cmd === 'winmine') launchMinesweeper();
    else if (cmd === 'sol') launchSolitaire();
    else if (cmd === 'pbrush') launchPaintbrush();
    else if (cmd === 'notepad') launchNotepad();
    else if (cmd === 'calc') launchCalculator();
    else if (cmd === 'clock') launchClock();
    else if (cmd === 'command' || cmd === 'cmd') launchDosPrompt();
    else if (cmd === 'winfile') openFileManager();
    else {
      const match = catalog.find(g => g.id.toLowerCase().includes(cmd) || g.title.toLowerCase().includes(cmd));
      if (match) launchGame(match);
      else alert(`Cannot find '${cmd}'. Make sure the path and filename are correct.`);
    }
  };
}

function closeRun() {
  playSound('click');
  closeDialog(document.getElementById('run-modal'));
}

function openAbout() {
  playSound('click');
  openDialog(document.getElementById('about-modal'));
}

function closeAbout() {
  playSound('click');
  closeDialog(document.getElementById('about-modal'));
}

function openBooklet() {
  if (appConfig.mode === 'family') {
    document.getElementById('status-selection').textContent = 'The booklet is unavailable in this profile.';
    return;
  }
  playSound('click');
  const modal = document.getElementById('booklet-modal');
  document.getElementById('booklet-open-pdf').href = BOOKLET_PDF_URL;
  openDialog(modal);
  const session = ++bookletSession;
  bookletPageNumber = 1;
  bookletZoom = 1;
  bookletRotation = 0;
  clearBookletCanvas();
  document.getElementById('booklet-page-number').value = '1';
  document.getElementById('booklet-page-count').textContent = 'of —';
  setBookletBusy(true);
  setBookletControls(false, 1);
  setBookletStatus('Loading booklet…');
  void loadBooklet(session);
}

function closeBooklet() {
  playSound('click');
  const modal = document.getElementById('booklet-modal');
  bookletSession += 1;
  bookletRenderVersion += 1;
  try {
    cancelBookletRender();
    destroyBookletDocument();
  } catch (error) {
    console.error('Booklet viewer cleanup failed:', error);
  } finally {
    clearBookletCanvas();
    setBookletBusy(false);
    setBookletControls(false, 1);
    setBookletStatus('Open the booklet to load its pages.');
    closeDialog(modal);
  }
}

function setupBookletViewer() {
  document.getElementById('booklet-modal').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeBooklet();
    }
  });
  document.getElementById('booklet-previous').addEventListener('click', () => goToBookletPage(bookletPageNumber - 1));
  document.getElementById('booklet-next').addEventListener('click', () => goToBookletPage(bookletPageNumber + 1));
  document.getElementById('booklet-rotate').addEventListener('click', () => {
    bookletRotation = (bookletRotation + 270) % 360;
    void renderBookletPage(bookletPageNumber);
  });
  document.getElementById('booklet-page-number').addEventListener('change', event => {
    goToBookletPage(Number(event.currentTarget.value));
  });
  document.getElementById('booklet-page-number').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      goToBookletPage(Number(event.currentTarget.value));
    }
  });
  document.getElementById('booklet-zoom-out').addEventListener('click', () => setBookletZoom(bookletZoom / 1.25));
  document.getElementById('booklet-zoom-in').addEventListener('click', () => setBookletZoom(bookletZoom * 1.25));
  document.getElementById('booklet-fit').addEventListener('click', () => setBookletZoom(1));
}

async function loadBooklet(session) {
  try {
    bookletPdfJsPromise ??= import(BOOKLET_PDFJS_URL);
    const pdfjs = await bookletPdfJsPromise;
    if (session !== bookletSession) return;
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(BOOKLET_PDFJS_WORKER_URL, document.baseURI).href;
    bookletLoadingTask = pdfjs.getDocument({ url: BOOKLET_PDF_URL, disableRange: true });
    const pdf = await bookletLoadingTask.promise;
    if (session !== bookletSession) {
      await pdf.destroy();
      return;
    }
    bookletLoadingTask = null;
    bookletDocument = pdf;
    bookletPageNumber = 1;
    document.getElementById('booklet-page-number').max = String(pdf.numPages);
    document.getElementById('booklet-page-count').textContent = `of ${pdf.numPages}`;
    setBookletControls(true, pdf.numPages);
    await renderBookletPage(1, session);
  } catch (error) {
    if (session !== bookletSession) return;
    setBookletBusy(false);
    setBookletControls(false, 1);
    setBookletStatus('The booklet could not be rendered. Use Open PDF in New Tab to try your browser viewer.');
    console.error('Booklet viewer failed to load:', error);
  }
}

async function renderBookletPage(pageNumber, session = bookletSession) {
  const pdf = bookletDocument;
  if (!pdf || session !== bookletSession) return;
  const page = Math.max(1, Math.min(pdf.numPages, Math.trunc(pageNumber) || 1));
  bookletPageNumber = page;
  const renderVersion = ++bookletRenderVersion;
  const previous = bookletRenderTask;
  setBookletBusy(true);
  setBookletStatus(`Rendering page ${page} of ${pdf.numPages}…`);
  const canvas = document.getElementById('booklet-page-canvas');
  const pageArea = document.getElementById('booklet-page-area');
  try {
    if (previous) {
      previous.cancel();
      try { await previous.promise; } catch (error) {
        if (error?.name !== 'RenderingCancelledException') throw error;
      }
      if (bookletRenderTask === previous) bookletRenderTask = null;
    }
    if (session !== bookletSession || renderVersion !== bookletRenderVersion) return;
    const pdfPage = await pdf.getPage(page);
    if (session !== bookletSession || renderVersion !== bookletRenderVersion) return;
    const rotation = ((pdfPage.rotate + bookletRotation) % 360 + 360) % 360;
    const original = pdfPage.getViewport({ scale: 1, rotation });
    const fit = Math.min((pageArea.clientWidth - 20) / original.width, (pageArea.clientHeight - 20) / original.height);
    const baseScale = Number.isFinite(fit) && fit > 0 ? fit : 0.25;
    const outputScale = Math.min(window.devicePixelRatio || 1, 1.5);
    const requestedScale = baseScale * bookletZoom;
    const pagePixelLimit = Math.min(
      Math.sqrt(BOOKLET_MAX_CANVAS_PIXELS / (original.width * original.height)),
      8192 / original.width,
      8192 / original.height
    );
    const viewport = pdfPage.getViewport({ scale: Math.min(requestedScale, pagePixelLimit / outputScale), rotation });
    canvas.width = Math.ceil(viewport.width * outputScale);
    canvas.height = Math.ceil(viewport.height * outputScale);
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.height = `${Math.ceil(viewport.height)}px`;
    canvas.setAttribute('aria-label', `Booklet page ${page} of ${pdf.numPages}`);
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const task = pdfPage.render({
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
    });
    bookletRenderTask = task;
    await task.promise;
    if (session === bookletSession && renderVersion === bookletRenderVersion) {
      document.getElementById('booklet-page-number').value = String(page);
      document.getElementById('booklet-previous').disabled = page <= 1;
      document.getElementById('booklet-next').disabled = page >= pdf.numPages;
      const orientation = bookletRotation === 90
        ? ' · Rotated 90° clockwise'
        : bookletRotation === 270
          ? ' · Rotated 90° counterclockwise'
          : bookletRotation === 180 ? ' · Rotated 180°' : '';
      setBookletStatus(`Page ${page} of ${pdf.numPages}${orientation}`);
    }
  } catch (error) {
    if (error?.name !== 'RenderingCancelledException' && session === bookletSession && renderVersion === bookletRenderVersion) {
      setBookletStatus('This booklet page could not be rendered. Use Open PDF in New Tab to try your browser viewer.');
      console.error('Booklet page failed to render:', error);
    }
  } finally {
    if (renderVersion === bookletRenderVersion) {
      bookletRenderTask = null;
      setBookletBusy(false);
    }
  }
}

function goToBookletPage(page) {
  if (!bookletDocument) return;
  void renderBookletPage(page);
}

function setBookletZoom(zoom) {
  if (!bookletDocument) return;
  bookletZoom = Math.max(0.5, Math.min(3, zoom));
  void renderBookletPage(bookletPageNumber);
}

function setBookletControls(enabled, pageCount) {
  for (const id of ['booklet-previous', 'booklet-next', 'booklet-page-number', 'booklet-rotate', 'booklet-zoom-out', 'booklet-zoom-in', 'booklet-fit']) {
    document.getElementById(id).disabled = !enabled;
  }
  document.getElementById('booklet-page-number').max = String(pageCount);
}

function setBookletBusy(busy) {
  document.getElementById('booklet-page-area').setAttribute('aria-busy', String(busy));
}

function setBookletStatus(message) {
  document.getElementById('booklet-status').textContent = message;
}

function clearBookletCanvas() {
  const canvas = document.getElementById('booklet-page-canvas');
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.width = '';
  canvas.style.height = '';
}

function cancelBookletRender() {
  if (bookletRenderTask) {
    bookletRenderTask.cancel();
    bookletRenderTask = null;
  }
}

function destroyBookletDocument() {
  const loading = bookletLoadingTask;
  const pdf = bookletDocument;
  bookletLoadingTask = null;
  bookletDocument = null;
  if (pdf) void pdf.destroy().catch(() => {});
  else if (loading) void loading.destroy().catch(() => {});
}

// --------------------------------------------------------------------------
// Context Menu
// --------------------------------------------------------------------------
function showContextMenu(x, y, game) {
  const menu = document.getElementById('context-menu');
  contextMenuReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  menu.setAttribute('role', 'menu');
  menu.querySelectorAll('.dropdown-entry').forEach((entry, index) => {
    entry.setAttribute('role', 'menuitem');
    entry.tabIndex = index === 0 ? 0 : -1;
  });
  menu.style.left = `${Math.min(window.innerWidth - 190, x)}px`;
  menu.style.top = `${Math.min(window.innerHeight - 150, y)}px`;
  menu.style.display = 'block';

  const setupBtn = document.getElementById('ctx-setup');
  if (game.platform === 'dos') {
    setupBtn.style.display = 'block';
    setupBtn.onclick = () => {
      menu.style.display = 'none';
      launchGame(game, true);
    };
  } else {
    setupBtn.style.display = 'none';
  }

  document.getElementById('ctx-play-native').onclick = () => {
    menu.style.display = 'none';
    launchGame(game);
  };

  document.getElementById('ctx-fav').onclick = async () => {
    menu.style.display = 'none';
    await toggleFavorite(game.id);
  };

  document.getElementById('ctx-props').onclick = () => {
    menu.style.display = 'none';
    openProperties(game);
  };
  menu.querySelector('.dropdown-entry:not([style*="display: none"])')?.focus();
  menu.onkeydown = (event) => {
    const entries = [...menu.querySelectorAll('.dropdown-entry')].filter(entry => entry instanceof HTMLElement && entry.offsetParent !== null);
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const current = entries.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 :
      (current + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
    event.preventDefault();
    entries.forEach((entry, index) => { entry.tabIndex = index === next ? 0 : -1; });
    entries[next]?.focus();
  };
}

function hideContextMenu(restoreFocus = false) {
  const menu = document.getElementById('context-menu');
  if (menu) menu.style.display = 'none';
  if (restoreFocus) contextMenuReturnFocus?.focus();
  contextMenuReturnFocus = null;
}

window.addEventListener('click', () => {
  hideContextMenu();
});

async function toggleFavorite(gameId) {
  try {
    const resp = await fetch('/api/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: gameId })
    });
    const res = await resp.json();
    if (res.favorite) favorites.add(gameId);
    else favorites.delete(gameId);
    updateFavCount();
    initGroupWindows();
  } catch (e) {
    console.error('Favorite error:', e);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
