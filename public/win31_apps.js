/* ==========================================================================
   AUTHENTIC WINDOWS 3.1 BUILT-IN APPLICATIONS
   Minesweeper, Solitaire, Paintbrush, Notepad, Calculator, Clock, MS-DOS Prompt, File Manager
   ========================================================================== */

// --------------------------------------------------------------------------
// 1. MINESWEEPER (WINMINE.EXE)
// --------------------------------------------------------------------------
function launchMinesweeper() {
  if (windows.app_minesweeper) {
    restoreWindow('app_minesweeper');
    return;
  }
  const win = createMdiWindow('app_minesweeper', 'Minesweeper', 'icons/winmine.svg', 140, 60, 260, 340, true);
  const container = win.client;
  container.className = 'winmine-container';
  container.style.backgroundColor = '#c0c0c0';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.alignItems = 'center';
  container.style.padding = '8px';
  container.style.userSelect = 'none';

  const ROWS = 9;
  const COLS = 9;
  const MINES = 10;
  let grid = [];
  let revealed = [];
  let flagged = [];
  let gameOver = false;
  let gameWon = false;
  let timer = 0;
  let timerInterval = null;
  let firstClick = true;
  registerWindowCleanup('app_minesweeper', () => clearInterval(timerInterval));

  container.innerHTML = `
    <div style="background:#c0c0c0; border: 3px solid; border-color: #808080 #fff #fff #808080; padding: 6px; width: 100%; max-width: 230px;">
      <!-- Top Scoreboard -->
      <div style="display:flex; justify-content:space-between; align-items:center; background:#c0c0c0; border: 2px solid; border-color: #808080 #fff #fff #808080; padding: 4px 8px; margin-bottom: 8px;">
        <div id="mine-counter" style="background:#000; color:#f00; font-family:'Courier New', monospace; font-size:20px; font-weight:bold; padding: 1px 4px; letter-spacing:2px;">010</div>
        <button id="mine-face" class="win31-btn" style="width:28px; height:28px; font-size:16px;">🙂</button>
        <div id="mine-timer" style="background:#000; color:#f00; font-family:'Courier New', monospace; font-size:20px; font-weight:bold; padding: 1px 4px; letter-spacing:2px;">000</div>
      </div>
      <!-- Minefield Grid -->
      <div id="mine-grid" style="display:grid; grid-template-columns: repeat(${COLS}, 20px); grid-template-rows: repeat(${ROWS}, 20px); border: 3px solid; border-color: #808080 #fff #fff #808080; width: fit-content; margin: 0 auto; background:#7b7b7b;"></div>
    </div>
  `;

  const gridEl = container.querySelector('#mine-grid');
  const faceBtn = container.querySelector('#mine-face');
  const counterEl = container.querySelector('#mine-counter');
  const timerEl = container.querySelector('#mine-timer');

  function initBoard() {
    grid = Array(ROWS).fill(null).map(() => Array(COLS).fill(0));
    revealed = Array(ROWS).fill(null).map(() => Array(COLS).fill(false));
    flagged = Array(ROWS).fill(null).map(() => Array(COLS).fill(false));
    gameOver = false;
    gameWon = false;
    timer = 0;
    firstClick = true;
    clearInterval(timerInterval);
    timerInterval = null;
    timerEl.textContent = '000';
    counterEl.textContent = '010';
    faceBtn.textContent = '🙂';
    renderGrid();
  }

  function placeMines(firstR, firstC) {
    let placed = 0;
    while (placed < MINES) {
      const r = Math.floor(Math.random() * ROWS);
      const c = Math.floor(Math.random() * COLS);
      if ((r !== firstR || c !== firstC) && grid[r][c] !== -1) {
        grid[r][c] = -1;
        placed++;
      }
    }
    // Calculate numbers
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === -1) continue;
        let count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] === -1) {
              count++;
            }
          }
        }
        grid[r][c] = count;
      }
    }
  }

  function renderGrid() {
    gridEl.innerHTML = '';
    const numColors = ['', '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        cell.style.width = '20px';
        cell.style.height = '20px';
        cell.style.fontSize = '12px';
        cell.style.fontWeight = 'bold';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.cursor = 'default';

        if (revealed[r][c]) {
          cell.style.backgroundColor = '#c0c0c0';
          cell.style.border = '1px solid #808080';
          if (grid[r][c] === -1) {
            cell.textContent = '💣';
            cell.style.backgroundColor = '#ff0000';
          } else if (grid[r][c] > 0) {
            cell.textContent = grid[r][c];
            cell.style.color = numColors[grid[r][c]];
          }
        } else {
          cell.style.backgroundColor = '#c0c0c0';
          cell.style.border = '2px solid';
          cell.style.borderColor = '#fff #000 #000 #fff';
          if (flagged[r][c]) {
            cell.textContent = '🚩';
          }
        }

        cell.addEventListener('mousedown', (e) => {
          if (gameOver || gameWon) return;
          if (e.button === 0 && !flagged[r][c]) {
            faceBtn.textContent = '😮';
          }
        });

        cell.addEventListener('mouseup', (e) => {
          if (gameOver || gameWon) return;
          faceBtn.textContent = '🙂';
          if (e.button === 0) {
            // Left click: reveal
            if (!flagged[r][c]) {
              clickCell(r, c);
            }
          } else if (e.button === 2) {
            // Right click: flag
            e.preventDefault();
            if (!revealed[r][c]) {
              flagged[r][c] = !flagged[r][c];
              playSound('click');
              updateCounter();
              renderGrid();
            }
          }
        });

        cell.addEventListener('contextmenu', e => e.preventDefault());
        gridEl.appendChild(cell);
      }
    }
  }

  function updateCounter() {
    let flagCount = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (flagged[r][c]) flagCount++;
      }
    }
    const rem = Math.max(0, MINES - flagCount);
    counterEl.textContent = String(rem).padStart(3, '0');
  }

  function clickCell(r, c) {
    if (firstClick) {
      firstClick = false;
      placeMines(r, c);
      timerInterval = setInterval(() => {
        timer++;
        timerEl.textContent = String(Math.min(999, timer)).padStart(3, '0');
      }, 1000);
    }

    if (grid[r][c] === -1) {
      // Hit a mine!
      gameOver = true;
      clearInterval(timerInterval);
      faceBtn.textContent = '😵';
      playSound('chord');
      // Reveal all mines
      for (let i = 0; i < ROWS; i++) {
        for (let j = 0; j < COLS; j++) {
          if (grid[i][j] === -1) revealed[i][j] = true;
        }
      }
      renderGrid();
      return;
    }

    // Flood reveal
    revealCell(r, c);
    playSound('click');
    checkWin();
    renderGrid();
  }

  function revealCell(r, c) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || revealed[r][c] || flagged[r][c]) return;
    revealed[r][c] = true;
    if (grid[r][c] === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          revealCell(r + dr, c + dc);
        }
      }
    }
  }

  function checkWin() {
    let unrevealedSafe = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] !== -1 && !revealed[r][c]) unrevealedSafe++;
      }
    }
    if (unrevealedSafe === 0) {
      gameWon = true;
      clearInterval(timerInterval);
      faceBtn.textContent = '😎';
      playSound('ding');
    }
  }

  faceBtn.onclick = initBoard;
  initBoard();
}

// --------------------------------------------------------------------------
// 2. SOLITAIRE (SOL.EXE)
// --------------------------------------------------------------------------
function launchSolitaire() {
  if (windows.app_solitaire) {
    restoreWindow('app_solitaire');
    return;
  }
  const win = createMdiWindow('app_solitaire', 'Solitaire', 'icons/sol.svg', 100, 30, 640, 480, true);
  const container = win.client;
  container.style.backgroundColor = '#008000'; // Classic Solitaire Felt Green
  container.style.padding = '12px';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.userSelect = 'none';
  container.style.position = 'relative';

  // Solitaire state
  const SUITS = ['♠', '♥', '♦', '♣'];
  const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  let deck = [];
  let waste = [];
  let foundations = [[], [], [], []];
  let tableau = [[], [], [], [], [], [], []];
  let selectedCard = null;

  function createDeck() {
    const cards = [];
    SUITS.forEach(suit => {
      VALUES.forEach((val, valIdx) => {
        cards.push({
          suit,
          val,
          rank: valIdx + 1,
          color: (suit === '♥' || suit === '♦') ? 'red' : 'black',
          faceUp: false
        });
      });
    });
    // Shuffle
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  function initSolitaire() {
    deck = createDeck();
    waste = [];
    foundations = [[], [], [], []];
    tableau = [[], [], [], [], [], [], []];
    selectedCard = null;

    for (let col = 0; col < 7; col++) {
      for (let row = 0; row <= col; row++) {
        const c = deck.pop();
        if (row === col) c.faceUp = true;
        tableau[col].push(c);
      }
    }
    renderSolitaire();
  }

  function cardHtml(card, extraStyle = '') {
    if (!card) return '';
    if (!card.faceUp) {
      // Classic Win3.1 card back (Navy blue with pattern)
      return `<div class="sol-card card-back" style="${extraStyle}">
        <div style="width:100%; height:100%; background:#000080; border: 2px solid #fff; display:flex; align-items:center; justify-content:center; color:#ffd700; font-size:16px;">✦</div>
      </div>`;
    }
    const color = card.color === 'red' ? '#cc0000' : '#000000';
    return `<div class="sol-card" style="color: ${color}; ${extraStyle}">
      <div style="font-size:10px; font-weight:bold; line-height:1;">${card.val}<br>${card.suit}</div>
      <div style="font-size:18px; text-align:center;">${card.suit}</div>
      <div style="font-size:10px; font-weight:bold; line-height:1; text-align:right;">${card.suit}<br>${card.val}</div>
    </div>`;
  }

  function clearSelection() {
    selectedCard = null;
  }

  function selectWaste() {
    selectedCard = selectedCard?.source === 'waste' ? null : { source: 'waste' };
    renderSolitaire();
  }

  function selectTableau(colIdx, cardIdx) {
    const col = tableau[colIdx];
    if (!col[cardIdx]?.faceUp) return;
    if (selectedCard?.source === 'tableau' && selectedCard.colIdx === colIdx && selectedCard.cardIdx === cardIdx) {
      clearSelection();
    } else {
      selectedCard = { source: 'tableau', colIdx, cardIdx };
    }
    renderSolitaire();
  }

  function selectedValue() {
    if (!selectedCard) return null;
    if (selectedCard.source === 'waste') return waste.at(-1) || null;
    return tableau[selectedCard.colIdx][selectedCard.cardIdx] || null;
  }

  function moveSelectionToFoundation() {
    if (!selectedCard) return false;
    const card = selectedValue();
    if (!card || (selectedCard.source === 'tableau' && selectedCard.cardIdx !== tableau[selectedCard.colIdx].length - 1)) return false;
    if (!tryMoveToFoundation(card)) return false;
    if (selectedCard.source === 'waste') {
      waste.pop();
    } else {
      const source = tableau[selectedCard.colIdx];
      source.pop();
      if (source.length > 0) source[source.length - 1].faceUp = true;
    }
    clearSelection();
    playSound('click');
    renderSolitaire();
    checkSolitaireWin();
    return true;
  }

  function moveSelectionToTableau(targetColIdx) {
    if (!selectedCard) return false;
    const card = selectedValue();
    if (!card) return false;
    const target = tableau[targetColIdx];
    if (selectedCard.source === 'tableau' && selectedCard.colIdx === targetColIdx) return false;
    if (target.length === 0 ? card.rank !== 13 : (() => {
      const top = target.at(-1);
      return !top.faceUp || top.color === card.color || top.rank !== card.rank + 1;
    })()) return false;

    if (selectedCard.source === 'waste') {
      target.push(waste.pop());
    } else {
      const source = tableau[selectedCard.colIdx];
      const stack = source.splice(selectedCard.cardIdx);
      target.push(...stack);
      if (source.length > 0) source.at(-1).faceUp = true;
    }
    clearSelection();
    playSound('click');
    renderSolitaire();
    return true;
  }

  function renderSolitaire() {
    container.innerHTML = `
      <style>
        .sol-card {
          width: 54px; height: 76px; background: #fff; border: 1px solid #000; border-radius: 3px;
          display: flex; flex-direction: column; justify-content: space-between; padding: 2px 4px;
          box-shadow: 1px 1px 2px rgba(0,0,0,0.4); cursor: pointer;
        }
        .sol-slot {
          width: 54px; height: 76px; border: 1px dashed rgba(255,255,255,0.4); border-radius: 3px;
          display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.4); font-size: 20px;
        }
        .sol-selected { outline: 2px solid #fff; outline-offset: 1px; box-shadow: 0 0 0 4px #000080; z-index: 2; }
      </style>
      <div style="display:flex; justify-content:space-between; margin-bottom: 20px;">
        <!-- Top Left: Stock & Waste -->
        <div style="display:flex; gap:12px;">
          <div id="sol-stock" style="cursor:pointer;">
            ${deck.length > 0 ? cardHtml({ faceUp: false }) : '<div class="sol-slot">↺</div>'}
          </div>
          <div id="sol-waste" class="${selectedCard?.source === 'waste' ? 'sol-selected' : ''}">
            ${waste.length > 0 ? cardHtml(waste[waste.length - 1]) : '<div class="sol-slot"></div>'}
          </div>
        </div>
        <!-- Top Right: Foundations -->
        <div style="display:flex; gap:8px;">
          ${foundations.map((f, idx) => `
            <div class="sol-foundation" data-found="${idx}" style="cursor:pointer;">
              ${f.length > 0 ? cardHtml(f[f.length - 1]) : `<div class="sol-slot">${SUITS[idx]}</div>`}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Bottom: 7 Tableau Columns -->
      <div style="display:flex; justify-content:space-between; flex-grow:1; gap:8px;">
        ${tableau.map((col, colIdx) => `
          <div class="sol-column" data-col="${colIdx}" style="width:54px; position:relative; min-height: 240px; cursor:pointer;">
            ${col.length === 0 ? '<div class="sol-slot">K</div>' : ''}
            ${col.map((c, rIdx) => `
              <div class="${selectedCard?.source === 'tableau' && selectedCard.colIdx === colIdx && rIdx >= selectedCard.cardIdx ? 'sol-selected' : ''}" style="position:absolute; top:${rIdx * 16}px; left:0;" data-card-idx="${rIdx}" data-card-rank="${c.rank}" data-card-color="${c.color}" data-card-suit="${c.suit}" data-card-face-up="${c.faceUp}">
                ${cardHtml(c)}
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
      <div style="margin-top:auto; display:flex; justify-content:space-between; align-items:center; color:#fff; font-size:11px;">
        <div>Solitaire Klondike | Select a card or stack, then click a legal destination</div>
        <button class="dialog-btn" id="sol-restart-btn">Deal New Game</button>
      </div>
    `;

    // Events
    container.querySelector('#sol-restart-btn').onclick = initSolitaire;

    // Stock click: draw
    container.querySelector('#sol-stock').onclick = () => {
      playSound('click');
      clearSelection();
      if (deck.length > 0) {
        const c = deck.pop();
        c.faceUp = true;
        waste.push(c);
      } else {
        // Recycle waste back to deck
        deck = waste.reverse().map(c => { c.faceUp = false; return c; });
        waste = [];
      }
      renderSolitaire();
    };

    // Waste card: select first; double-click still moves directly to a legal foundation.
    const wasteEl = container.querySelector('#sol-waste .sol-card');
    if (wasteEl) {
      wasteEl.onclick = () => {
        selectWaste();
      };
      wasteEl.ondblclick = () => {
        selectedCard = { source: 'waste' };
        if (!moveSelectionToFoundation()) {
          clearSelection();
          renderSolitaire();
        }
      };
    }

    // Clicking a column's empty area is an explicit tableau destination.
    container.querySelectorAll('.sol-column').forEach(colEl => {
      const colIdx = parseInt(colEl.dataset.col, 10);
      colEl.addEventListener('click', () => {
        if (!selectedCard) return;
        if (!moveSelectionToTableau(colIdx)) {
          clearSelection();
          renderSolitaire();
        }
      });
      colEl.querySelectorAll('[data-card-idx]').forEach(cardWrapper => {
        const cardIdx = parseInt(cardWrapper.dataset.cardIdx, 10);
        cardWrapper.onclick = (e) => {
          e.stopPropagation();
          const colCards = tableau[colIdx];
          const card = colCards[cardIdx];
          if (!card.faceUp) {
            if (cardIdx === colCards.length - 1) {
              clearSelection();
              card.faceUp = true;
              playSound('click');
              renderSolitaire();
            }
            return;
          }

          if (selectedCard) {
            if (selectedCard.source === 'tableau' && selectedCard.colIdx === colIdx && selectedCard.cardIdx === cardIdx) {
              clearSelection();
              renderSolitaire();
              return;
            }
            if (moveSelectionToTableau(colIdx)) return;
            clearSelection();
            renderSolitaire();
            return;
          }
          selectTableau(colIdx, cardIdx);
        };
        cardWrapper.ondblclick = () => {
          if (cardIdx !== tableau[colIdx].length - 1) return;
          selectedCard = { source: 'tableau', colIdx, cardIdx };
          if (!moveSelectionToFoundation()) {
            clearSelection();
            renderSolitaire();
          }
        };
      });
    });

    container.querySelectorAll('.sol-foundation').forEach(foundationEl => {
      foundationEl.addEventListener('click', () => {
        if (!selectedCard) return;
        if (!moveSelectionToFoundation()) {
          clearSelection();
          renderSolitaire();
        }
      });
    });
  }

  function tryMoveToFoundation(card) {
    for (let i = 0; i < 4; i++) {
      const f = foundations[i];
      if (f.length === 0) {
        if (card.rank === 1 && card.suit === SUITS[i]) {
          f.push(card);
          return true;
        }
      } else {
        const top = f[f.length - 1];
        if (top.suit === card.suit && top.rank + 1 === card.rank) {
          f.push(card);
          return true;
        }
      }
    }
    return false;
  }

  function checkSolitaireWin() {
    if (foundations.every(f => f.length === 13)) {
      playSound('ding');
      alert('Congratulations! You won Solitaire!');
    }
  }

  initSolitaire();
}

// --------------------------------------------------------------------------
// 3. PAINTBRUSH (PBRUSH.EXE)
// --------------------------------------------------------------------------
function launchPaintbrush() {
  if (windows.app_paintbrush) {
    restoreWindow('app_paintbrush');
    return;
  }
  const win = createMdiWindow('app_paintbrush', 'Paintbrush - (Untitled)', 'icons/pbrush.svg', 120, 40, 560, 420, true);
  const container = win.client;
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.padding = '0';
  container.style.backgroundColor = '#c0c0c0';

  const COLORS = [
    '#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080', '#800080',
    '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff'
  ];

  let currentColor = '#000000';
  let currentTool = 'brush'; // brush, eraser, line, rect, filled_rect
  let brushSize = 3;
  let isDrawing = false;
  let startX, startY;

  container.innerHTML = `
    <!-- Top toolbar / canvas area -->
    <div style="display:flex; flex-grow:1; overflow:hidden;">
      <!-- Tool Palette Left -->
      <div style="width: 52px; background: #c0c0c0; border-right: 1px solid #808080; padding: 4px; display: grid; grid-template-columns: repeat(2, 20px); gap: 2px; align-content: start;">
        <button class="win31-btn active" data-tool="brush" title="Brush">🖌</button>
        <button class="win31-btn" data-tool="eraser" title="Eraser">▫</button>
        <button class="win31-btn" data-tool="line" title="Line">/</button>
        <button class="win31-btn" data-tool="rect" title="Rectangle">▭</button>
        <button class="win31-btn" data-tool="filled_rect" title="Filled Rectangle">■</button>
        <button class="win31-btn" data-tool="clear" title="Clear">✕</button>
      </div>

      <!-- Drawing Canvas Center -->
      <div style="flex-grow:1; background: #808080; padding: 8px; overflow: auto; display:flex; justify-content:center; align-items:center;">
        <canvas id="paint-canvas" width="460" height="300" style="background:#fff; border: 1px solid #000; box-shadow: 2px 2px 0 #000; cursor: crosshair;"></canvas>
      </div>
    </div>

    <!-- Bottom Color Palette Bar -->
    <div style="display:flex; align-items:center; background:#c0c0c0; border-top: 1px solid #fff; padding: 4px 8px; gap: 8px;">
      <div style="width:24px; height:24px; border:1px solid #000; box-shadow:inset 1px 1px 0 #fff; background:${currentColor};" id="active-color-swatch"></div>
      <div style="display:grid; grid-template-columns: repeat(8, 16px); gap: 2px;">
        ${COLORS.map(c => `<div class="paint-color" data-color="${c}" style="width:16px; height:16px; background:${c}; border:1px solid #000; cursor:pointer;"></div>`).join('')}
      </div>
      <div style="margin-left:auto; display:flex; gap:6px;">
        <button class="win31-btn" id="paint-save-btn" style="width:auto; padding:2px 8px;">Save PNG</button>
      </div>
    </div>
  `;

  const canvas = container.querySelector('#paint-canvas');
  const ctx = canvas.getContext('2d');
  const swatch = container.querySelector('#active-color-swatch');

  // Fill canvas initially with white
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  container.querySelectorAll('[data-tool]').forEach(btn => {
    btn.onclick = () => {
      const tool = btn.dataset.tool;
      if (tool === 'clear') {
        if (confirm('Clear current drawing?')) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        return;
      }
      container.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = tool;
    };
  });

  container.querySelectorAll('.paint-color').forEach(el => {
    el.onclick = () => {
      currentColor = el.dataset.color;
      swatch.style.backgroundColor = currentColor;
    };
  });

  // Canvas drawing
  let snapshot = null;
  canvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (currentTool === 'brush') {
      ctx.beginPath();
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.moveTo(startX, startY);
    } else if (currentTool === 'eraser') {
      ctx.beginPath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 12;
      ctx.lineCap = 'square';
      ctx.moveTo(startX, startY);
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const currX = e.clientX - rect.left;
    const currY = e.clientY - rect.top;

    if (currentTool === 'brush' || currentTool === 'eraser') {
      ctx.lineTo(currX, currY);
      ctx.stroke();
    } else if (currentTool === 'line') {
      ctx.putImageData(snapshot, 0, 0);
      ctx.beginPath();
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = brushSize;
      ctx.moveTo(startX, startY);
      ctx.lineTo(currX, currY);
      ctx.stroke();
    } else if (currentTool === 'rect') {
      ctx.putImageData(snapshot, 0, 0);
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = brushSize;
      ctx.strokeRect(startX, startY, currX - startX, currY - startY);
    } else if (currentTool === 'filled_rect') {
      ctx.putImageData(snapshot, 0, 0);
      ctx.fillStyle = currentColor;
      ctx.fillRect(startX, startY, currX - startX, currY - startY);
    }
  });

  const stopDrawing = () => {
    isDrawing = false;
  };
  window.addEventListener('mouseup', stopDrawing);
  registerWindowCleanup('app_paintbrush', () => window.removeEventListener('mouseup', stopDrawing));

  container.querySelector('#paint-save-btn').onclick = () => {
    const link = document.createElement('a');
    link.download = 'paintbrush.png';
    link.href = canvas.toDataURL();
    link.click();
  };
}

// --------------------------------------------------------------------------
// 4. NOTEPAD (NOTEPAD.EXE)
// --------------------------------------------------------------------------
function launchNotepad() {
  if (windows.app_notepad) {
    restoreWindow('app_notepad');
    return;
  }
  const win = createMdiWindow('app_notepad', 'Notepad - (Untitled)', 'icons/notepad.svg', 160, 50, 480, 360, true);
  const container = win.client;
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.padding = '0';
  container.style.backgroundColor = '#fff';

  container.innerHTML = `
    <div class="win31-menubar" style="border-bottom: 1px solid #808080; height:20px; font-size:11px;">
      <div class="menu-item" id="note-menu-new"><u>N</u>ew</div>
      <div class="menu-item" id="note-menu-sample"><u>L</u>oad Retro Notes</div>
      <div class="menu-item" id="note-menu-time"><u>T</u>ime/Date (F5)</div>
      <div class="menu-item" id="note-menu-save"><u>S</u>ave File</div>
    </div>
    <textarea id="notepad-text" style="flex-grow:1; width:100%; border:none; outline:none; padding:8px; font-family:'Courier New', monospace; font-size:13px; resize:none;"></textarea>
  `;

  const textarea = container.querySelector('#notepad-text');
  const draftKey = 'penny-retro-notepad-draft';
  textarea.value = localStorage.getItem(draftKey) ?? `MICROSOFT WINDOWS 3.1 RETRO LAUNCHER
Release Notes & Documentation
--------------------------------------------------
Welcome to the authentic Windows 3.1 Program Manager!

Over 1,038 retro titles are installed on this machine:
* Super Nintendo Entertainment System (763 games)
* MS-DOS Classics & Shareware (18 games)
* Shareware CD-ROMs & Documentation (Sirius 5-Foot 10-Pack)
* Nintendo Game Boy & Game Boy Color (206 games)
* Sega Genesis & Arcade Classics (49 games)

Feel free to write your gaming notes, cheats, and passwords here!
`;

  const saveDraft = () => localStorage.setItem(draftKey, textarea.value);
  const insertTimestamp = () => {
    textarea.value += `${textarea.value.endsWith('\n') ? '' : '\n'}${new Date().toLocaleString()}\n`;
    saveDraft();
  };
  const handleNotepadKeyDown = (event) => {
    if (event.key === 'F5') {
      event.preventDefault();
      insertTimestamp();
    }
  };
  textarea.addEventListener('input', saveDraft);
  win.element.addEventListener('keydown', handleNotepadKeyDown);
  registerWindowCleanup('app_notepad', () => win.element.removeEventListener('keydown', handleNotepadKeyDown));

  container.querySelector('#note-menu-new').onclick = () => {
    if (confirm('Clear current note?')) {
      textarea.value = '';
      saveDraft();
    }
  };
  container.querySelector('#note-menu-time').onclick = () => {
    insertTimestamp();
  };
  container.querySelector('#note-menu-save').onclick = () => {
    const blob = new Blob([textarea.value], { type: 'text/plain' });
    const link = document.createElement('a');
    link.download = 'retro_notes.txt';
    link.href = URL.createObjectURL(blob);
    const downloadUrl = link.href;
    link.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  };
}

// --------------------------------------------------------------------------
// 5. CALCULATOR (CALC.EXE)
// --------------------------------------------------------------------------
function launchCalculator() {
  if (windows.app_calculator) {
    restoreWindow('app_calculator');
    return;
  }
  const win = createMdiWindow('app_calculator', 'Calculator', 'icons/calc.svg', 200, 80, 240, 280, true);
  win.element.tabIndex = 0;
  const container = win.client;
  container.style.backgroundColor = '#c0c0c0';
  container.style.padding = '8px';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';

  let currentVal = '0';
  let prevVal = null;
  let op = null;
  let resetNext = false;

  container.innerHTML = `
    <!-- LCD Display -->
    <div id="calc-display" style="background:#fff; border: 1px solid #000; box-shadow: inset 1px 1px 0 #808080; padding: 4px 8px; font-family:'Courier New', monospace; font-size:18px; font-weight:bold; text-align:right; margin-bottom: 8px;">0</div>
    <!-- Keypad -->
    <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap: 4px; flex-grow:1;">
      <button class="win31-btn calc-key" data-k="C">C</button>
      <button class="win31-btn calc-key" data-k="CE">CE</button>
      <button class="win31-btn calc-key" data-k="sqrt">√</button>
      <button class="win31-btn calc-key" data-k="/">/</button>

      <button class="win31-btn calc-key" data-k="7">7</button>
      <button class="win31-btn calc-key" data-k="8">8</button>
      <button class="win31-btn calc-key" data-k="9">9</button>
      <button class="win31-btn calc-key" data-k="*">*</button>

      <button class="win31-btn calc-key" data-k="4">4</button>
      <button class="win31-btn calc-key" data-k="5">5</button>
      <button class="win31-btn calc-key" data-k="6">6</button>
      <button class="win31-btn calc-key" data-k="-">-</button>

      <button class="win31-btn calc-key" data-k="1">1</button>
      <button class="win31-btn calc-key" data-k="2">2</button>
      <button class="win31-btn calc-key" data-k="3">3</button>
      <button class="win31-btn calc-key" data-k="+">+</button>

      <button class="win31-btn calc-key" data-k="0" style="grid-column: span 2;">0</button>
      <button class="win31-btn calc-key" data-k=".">.</button>
      <button class="win31-btn calc-key" data-k="=">=</button>
    </div>
  `;

  const display = container.querySelector('#calc-display');

  function applyKey(k) {
    playSound('click');
    if (!isNaN(k)) {
      if (currentVal === '0' || currentVal === 'Error' || resetNext) {
        currentVal = k;
        resetNext = false;
      } else {
        currentVal += k;
      }
    } else if (k === '.') {
      if (currentVal === 'Error') currentVal = '0';
      if (!currentVal.includes('.')) currentVal += '.';
    } else if (k === 'C') {
      currentVal = '0';
      prevVal = null;
      op = null;
      resetNext = false;
    } else if (k === 'CE') {
      currentVal = '0';
    } else if (k === 'sqrt') {
      const result = Math.sqrt(Number(currentVal));
      currentVal = Number.isFinite(result) ? String(result) : 'Error';
      resetNext = currentVal === 'Error';
    } else if (['+', '-', '*', '/'].includes(k)) {
      prevVal = Number(currentVal);
      op = k;
      resetNext = true;
    } else if (k === '=') {
      if (op && prevVal !== null) {
        const current = Number(currentVal);
        const result = op === '+' ? prevVal + current
          : op === '-' ? prevVal - current
            : op === '*' ? prevVal * current
              : current === 0 ? Number.NaN : prevVal / current;
        currentVal = Number.isFinite(result) ? String(result) : 'Error';
        op = null;
        prevVal = null;
        resetNext = true;
      }
    }
    display.textContent = currentVal;
  }

  container.querySelectorAll('.calc-key').forEach(btn => {
    btn.onclick = () => applyKey(btn.dataset.k);
  });
  const handleKeyDown = (event) => {
    if (activeWindowId !== 'app_calculator' || event.target.matches('input, textarea, select')) return;
    const key = ({ Enter: '=', Backspace: 'CE', Escape: 'C' })[event.key] || event.key;
    if (/^\d$/.test(key) || ['.', '+', '-', '*', '/', '=', 'C', 'CE'].includes(key)) {
      event.preventDefault();
      applyKey(key);
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  registerWindowCleanup('app_calculator', () => window.removeEventListener('keydown', handleKeyDown));
}

// --------------------------------------------------------------------------
// 6. CLOCK (CLOCK.EXE)
// --------------------------------------------------------------------------
function launchClock() {
  if (windows.app_clock) {
    restoreWindow('app_clock');
    return;
  }
  const win = createMdiWindow('app_clock', 'Clock', 'icons/clock.svg', 240, 100, 220, 240, true);
  const container = win.client;
  container.style.backgroundColor = '#ffffff';
  container.style.display = 'flex';
  container.style.justifyContent = 'center';
  container.style.alignItems = 'center';
  container.style.padding = '8px';

  container.innerHTML = `<canvas id="clock-canvas" width="180" height="180" aria-label="Analog clock"></canvas><output id="clock-digital" aria-live="off" style="font-family:'Courier New',monospace; font-size:14px; font-weight:bold; margin-top:6px;"></output>`;
  const canvas = container.querySelector('#clock-canvas');
  const digital = container.querySelector('#clock-digital');
  const ctx = canvas.getContext('2d');

  function drawClock() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const now = new Date();
    digital.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const cx = 90;
    const cy = 90;
    const r = 80;

    // Face
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Ticks
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6;
      const x1 = cx + Math.sin(angle) * (r - 8);
      const y1 = cy - Math.cos(angle) * (r - 8);
      const x2 = cx + Math.sin(angle) * r;
      const y2 = cy - Math.cos(angle) * r;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = i % 3 === 0 ? 3 : 1;
      ctx.stroke();
    }

    // Hands
    const hr = now.getHours() % 12;
    const min = now.getMinutes();
    const sec = now.getSeconds();

    // Hour hand
    const hrAngle = ((hr + min / 60) * Math.PI) / 6;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(hrAngle) * 45, cy - Math.cos(hrAngle) * 45);
    ctx.lineWidth = 4;
    ctx.stroke();

    // Minute hand
    const minAngle = (min * Math.PI) / 30;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(minAngle) * 65, cy - Math.cos(minAngle) * 65);
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Second hand (red)
    const secAngle = (sec * Math.PI) / 30;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(secAngle) * 70, cy - Math.cos(secAngle) * 70);
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Center pin
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
    ctx.fillStyle = '#000';
    ctx.fill();
  }

  const interval = setInterval(drawClock, 1000);
  drawClock();

  registerWindowCleanup('app_clock', () => clearInterval(interval));
}

// --------------------------------------------------------------------------
// 7. MS-DOS PROMPT (DOSPRMPT.PIF)
// --------------------------------------------------------------------------
function launchDosPrompt() {
  if (windows.app_dosprompt) {
    restoreWindow('app_dosprompt');
    return;
  }
  const win = createMdiWindow('app_dosprompt', 'MS-DOS Prompt', 'icons/dosprompt.svg', 110, 60, 580, 360, true);
  const container = win.client;
  container.style.backgroundColor = '#000000';
  container.style.color = '#ffffff';
  container.style.fontFamily = "'Courier New', Courier, monospace";
  container.style.fontSize = '13px';
  container.style.padding = '12px';
  container.style.overflowY = 'auto';
  container.style.display = 'block';

  container.innerHTML = `
    <div id="dos-output">
      Microsoft(R) MS-DOS(R) Version 6.22<br>
      (C)Copyright Microsoft Corp 1981-1994.<br><br>
      Type <strong>DIR</strong> to view files, <strong>PLAY [name]</strong> to launch a game, or <strong>HELP</strong> for commands.<br><br>
    </div>
    <div style="display:flex; align-items:center;">
      <span>C:\\&gt;&nbsp;</span>
      <input type="text" id="dos-input" style="flex-grow:1; background:transparent; border:none; outline:none; color:#fff; font-family:inherit; font-size:inherit;">
    </div>
  `;

  const output = container.querySelector('#dos-output');
  const input = container.querySelector('#dos-input');
  function appendTextLine(text) {
    const line = document.createElement('div');
    line.textContent = text;
    output.appendChild(line);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cmd = input.value.trim();
      input.value = '';
      appendTextLine(`C:\\> ${cmd}`);

      const lower = cmd.toLowerCase();
      if (!lower) return;

      if (lower === 'cls') {
        output.replaceChildren();
      } else if (lower === 'ver') {
        appendTextLine('MS-DOS Version 6.22 (Retro Windows 3.1 Edition)');
      } else if (lower === 'dir') {
        output.innerHTML += `
 Volume in drive C is RETRO_GAMES<br>
 Directory of C:\\<br><br>
 DOS&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&lt;DIR&gt;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;18 Games (DOOM, KEEN1, WOLF3D...)<br>
 SNES&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&lt;DIR&gt;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;763 Games (Mario, Chrono, Metroid...)<br>
 GB&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&lt;DIR&gt;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;173 Games (Pokemon, Zelda...)<br>
 GBC&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&lt;DIR&gt;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;33 Games<br>
 SEGA&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&lt;DIR&gt;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;23 Games (Sonic, Streets of Rage...)<br>
 ARCADE&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&lt;DIR&gt;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;26 Games<br>
 SIRIUS&nbsp;&nbsp;PDF&nbsp;&nbsp;18,693,529&nbsp;&nbsp;&nbsp;Sirius 5-Foot 10-Pack Booklet<br>
 GAMEBOSS&nbsp;ISO&nbsp;&nbsp;58,241,024&nbsp;&nbsp;&nbsp;Windows Game Boss 99 Games CD-ROM<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;8 file(s)&nbsp;&nbsp;&nbsp;&nbsp;76,934,553 bytes<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;0 dir(s)&nbsp;&nbsp;&nbsp;&nbsp;649,801,728 bytes free<br><br>
        `;
      } else if (lower === 'help') {
        output.innerHTML += `
Supported commands:<br>
  DIR             - List preserved game platforms and shareware CDs<br>
  PLAY [game]     - Launch any game (e.g. PLAY DOOM, PLAY KEEN, PLAY MARIO)<br>
  VER             - Display DOS version<br>
  CLS             - Clear screen<br>
  EXIT            - Close MS-DOS Prompt<br><br>
        `;
      } else if (lower === 'exit') {
        closeWindow('app_dosprompt');
      } else if (lower.startsWith('play ') || lower.startsWith('run ')) {
        const query = lower.replace(/^(play|run)\s+/, '').trim();
        const found = catalog.find(g => g.title.toLowerCase().includes(query) || (g.folder && g.folder.toLowerCase().includes(query)));
        if (found) {
          appendTextLine(`Launching ${found.title}...`);
          launchGame(found);
        } else {
          appendTextLine(`Game '${query}' not found. Type DIR to list.`);
        }
      } else {
        // Direct title match
        const found = catalog.find(g => g.title.toLowerCase().includes(lower) || (g.folder && g.folder.toLowerCase() === lower));
        if (found) {
          appendTextLine(`Executing ${found.title}...`);
          launchGame(found);
        } else {
          appendTextLine(`Bad command or file name: '${cmd}'`);
        }
      }
      container.scrollTop = container.scrollHeight;
    }
  });

  const focusTimeout = setTimeout(() => input.focus(), 50);
  registerWindowCleanup('app_dosprompt', () => clearTimeout(focusTimeout));
}

// --------------------------------------------------------------------------
// 8. FILE MANAGER (WINFILE.EXE)
// --------------------------------------------------------------------------
function launchFileManager() {
  return openFileManager();
}

function launchSystemOptimizer() {
  if (typeof isCapabilityEnabled === 'function' && !isCapabilityEnabled('system_optimizer')) {
    document.getElementById('status-selection').textContent = 'System Optimizer is unavailable in this profile.';
    return;
  }
  if (windows.app_pccleanup) {
    restoreWindow('app_pccleanup');
    return;
  }
  const win = createMdiWindow('app_pccleanup', 'System Optimizer', 'icons/winfile.svg', 220, 120, 440, 260);
  const container = win.client;
  container.style.padding = '12px';
  container.style.fontFamily = 'sans-serif';
  container.style.fontSize = '12px';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.justifyContent = 'space-between';
  container.style.background = '#c0c0c0';

  container.innerHTML = `
    <div>
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
        <span style="font-size:28px;">⚡</span>
        <div>
          <div style="font-weight:bold; font-size:13px;">System Maintenance Suite</div>
          <div style="color:#444; font-size:11px;">Consolidated PC Cleanup &amp; Performance Optimizer</div>
        </div>
      </div>
      <div style="background:#fff; border:1px solid #808080; padding:8px; font-family:'Courier New', monospace; font-size:11px; margin-bottom:12px;">
        Open the PC Cleanup dashboard or start its scan console. This launcher does not run cleanup actions directly.
      </div>
      <div id="pccleanup-status" style="font-size:11px; color:#000080; font-weight:bold;">Status: Ready to launch.</div>
    </div>
    <div style="display:flex; justify-content:flex-start; flex-wrap:wrap; gap:8px;">
      <button class="win31-btn" id="btn-launch-gui" style="width:auto; padding:4px 12px; font-size:11px; font-weight:bold; white-space:nowrap; flex:0 0 auto;">Open Cleanup GUI</button>
      <button class="win31-btn" id="btn-launch-scan" style="width:auto; padding:4px 12px; font-size:11px; white-space:nowrap; flex:0 0 auto;">Run Quick Scan</button>
      <button class="win31-btn" id="btn-close-pccleanup" style="width:auto; padding:4px 10px; font-size:11px; white-space:nowrap; flex:0 0 auto;">Close</button>
    </div>
  `;

  const statusEl = container.querySelector('#pccleanup-status');
  container.querySelector('#btn-launch-gui').onclick = () => {
    statusEl.textContent = 'Launching WPF Dashboard...';
    fetch('/api/launch_tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'pc-cleanup' })
    })
    .then(r => r.json())
    .then(data => {
      statusEl.textContent = data.success ? 'WPF Dashboard active.' : ('Error: ' + data.error);
    })
    .catch(err => {
      statusEl.textContent = 'Network error: ' + err;
    });
  };

  container.querySelector('#btn-launch-scan').onclick = () => {
    statusEl.textContent = 'Spawning PowerShell scan console...';
    fetch('/api/launch_tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'pc-cleanup-scan' })
    })
    .then(r => r.json())
    .then(data => {
      statusEl.textContent = data.success ? 'Scan console active.' : ('Error: ' + data.error);
    })
    .catch(err => {
      statusEl.textContent = 'Network error: ' + err;
    });
  };

  container.querySelector('#btn-close-pccleanup').onclick = () => {
    closeWindow(win.id);
  };
}
