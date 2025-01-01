class StateManager {
    constructor() {
        this.states = new Map();
        this.loadFromStorage();
    }

    generateId() {
        return `state_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    saveState(name, grid, previousGrid = null) {
        const id = this.generateId();
        const state = {
            id,
            name,
            grid: grid.map(row => [...row]),
            previousGrid: previousGrid ? previousGrid.map(row => [...row]) : null,
            timestamp: new Date().toISOString()
        };
        this.states.set(id, state);
        this.saveToStorage();
        return id;
    }

    getState(id) {
        return this.states.get(id);
    }

    deleteState(id) {
        const deleted = this.states.delete(id);
        if (deleted) {
            this.saveToStorage();
        }
        return deleted;
    }

    getAllStates() {
        return Array.from(this.states.values())
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    saveToStorage() {
        const serializedStates = Array.from(this.states.entries());
        localStorage.setItem('gameStates', JSON.stringify(serializedStates));
    }

    loadFromStorage() {
        try {
            const stored = localStorage.getItem('gameStates');
            if (stored) {
                const parsed = JSON.parse(stored);
                this.states = new Map(parsed);
            }
        } catch (e) {
            console.error('Error loading states from storage:', e);
        }
    }

    exportState(state) {
        return JSON.stringify({
            grid: state.grid,
            previousGrid: state.previousGrid,
            name: state.name,
            timestamp: state.timestamp
        });
    }

    importState(stateStr) {
        try {
            const state = JSON.parse(stateStr);
            if (!state.grid || !Array.isArray(state.grid)) {
                throw new Error('Invalid grid format');
            }
            return this.saveState(
                state.name || `Imported ${new Date().toLocaleTimeString()}`,
                state.grid,
                state.previousGrid
            );
        } catch (e) {
            console.error('Error importing state:', e);
            throw new Error('Invalid state format');
        }
    }
}

class GameOfLife {
    constructor() {
        this.width = 50;
        this.height = 30;
        this.grid = Array(this.height).fill().map(() => Array(this.width).fill(0));
        this.previousGrid = Array(this.height).fill().map(() => Array(this.width).fill(0));
        this.nextGrid = Array(this.height).fill().map(() => Array(this.width).fill(0));
        this.isRunning = false;
        this.currentTheme = 'divergent';
        this.baseInterval = 1000;
        this.speedMultiplier = 3;
        this.updateInterval = this.baseInterval / this.speedMultiplier;
        this.intervalId = null;
        this.selectedStateId = null;
        this.stateManager = new StateManager();
        this.generation = 0;
        
        // Wait for DOM to be ready
        if (typeof document !== 'undefined') {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.initialize());
            } else {
                this.initialize();
            }
        }

        // Handle window resize
        window.addEventListener('resize', () => this.resizeGrid());
    }

    resizeGrid() {
        const grid = document.querySelector('.grid');
        const container = document.querySelector('.grid-container');
        if (!grid || !container) return;

        // Get container dimensions, accounting for padding
        const containerWidth = container.offsetWidth;
        const containerHeight = container.offsetHeight - 40; // Account for 20px padding top and bottom

        // Calculate cell size to fit available space
        const cellWidth = Math.floor(containerWidth / this.width);
        const cellHeight = Math.floor(containerHeight / this.height);
        this.cellSize = Math.min(cellWidth, cellHeight);

        // Update grid styles
        grid.style.gridTemplateColumns = `repeat(${this.width}, ${this.cellSize}px)`;
        
        // Update cell sizes
        const cells = grid.querySelectorAll('.cell');
        cells.forEach(cell => {
            cell.style.width = `${this.cellSize}px`;
            cell.style.height = `${this.cellSize}px`;
        });
    }

    initialize() {
        this.createGrid();
        this.setupEventListeners();
        this.initializeSpeedControl();

        // Initialize theme
        const defaultThemeRadio = document.querySelector('input[name="colorTheme"][value="divergent"]');
        if (defaultThemeRadio) {
            defaultThemeRadio.checked = true;
            this.updateTheme('divergent');
        }

        // Initialize metrics
        this.updateMetrics();

        // Auto-start after a short delay
        setTimeout(() => {
            if (!this.isRunning) {
                this.randomize();
                const toggleButton = document.getElementById('toggleButton');
                if (toggleButton) {
                    toggleButton.textContent = 'Stop';
                    toggleButton.classList.add('active');
                }
                this.start();
            }
        }, 1000);
    }

    updateTheme(newTheme) {
        this.currentTheme = newTheme;
        
        // Update main grid
        const grid = document.querySelector('.grid');
        if (grid) {
            grid.className = `grid ${newTheme}-theme`;
        }
        
        // Update legend
        const legend = document.querySelector('.legend');
        if (legend) {
            legend.className = `legend ${newTheme}-theme`;
        }

        // Update legend colors
        this.updateLegendColors(newTheme);
        
        // Update all previews
        const previews = document.querySelectorAll('.state-preview-mini, .state-preview-large');
        previews.forEach(preview => {
            const classes = preview.className.split(' ').filter(c => !c.endsWith('-theme'));
            preview.className = [...classes, `${newTheme}-theme`].join(' ');
        });

        // Save theme preference
        localStorage.setItem('colorTheme', newTheme);
    }

    updateLegendColors(theme) {
        const getThemeColor = (colorVar) => {
            return getComputedStyle(document.documentElement)
                .getPropertyValue(colorVar)
                .trim();
        };

        const themeColors = {
            solid: {
                birth: getThemeColor('--solid-cell-alive'),
                alive: getThemeColor('--solid-cell-alive'),
                dead: getThemeColor('--solid-cell-dead'),
                starved: getThemeColor('--solid-cell-dead'),
                lonely: getThemeColor('--solid-cell-dead')
            },
            divergent: {
                birth: getThemeColor('--divergent-cell-birth'),
                alive: getThemeColor('--divergent-cell-alive'),
                dead: getThemeColor('--divergent-cell-dead'),
                starved: getThemeColor('--divergent-cell-death-starved'),
                lonely: getThemeColor('--divergent-cell-death-lonely')
            },
            sequential: {
                birth: getThemeColor('--seq-cell-birth'),
                alive: getThemeColor('--seq-cell-alive'),
                dead: getThemeColor('--seq-cell-dead'),
                starved: getThemeColor('--seq-cell-death-starved'),
                lonely: getThemeColor('--seq-cell-death-lonely')
            }
        };

        const colors = themeColors[theme];
        const legendColors = {
            '.birth-color': colors.birth,
            '.survivor-color': colors.alive,
            '.starved-color': colors.starved,
            '.lonely-color': colors.lonely,
            '.dead-color': colors.dead
        };

        Object.entries(legendColors).forEach(([selector, color]) => {
            const element = document.querySelector(selector);
            if (element) {
                element.style.backgroundColor = color;
            }
        });
    }

    adjustSpeed(delta) {
        const newSpeed = Math.max(1, Math.min(10, this.speedMultiplier + delta));
        if (newSpeed !== this.speedMultiplier) {
            this.speedMultiplier = newSpeed;
            this.updateInterval = this.baseInterval / this.speedMultiplier;
            
            // Update speed display
            const speedValue = document.querySelector('.speed-value');
            if (speedValue) {
                speedValue.textContent = `Speed: ${this.speedMultiplier}x`;
            }
            
            // Restart interval if running
            if (this.isRunning) {
                clearInterval(this.intervalId);
                this.intervalId = setInterval(() => this.step(), this.updateInterval);
            }
        }
    }

    initializeSpeedControl() {
        const speedSlider = document.querySelector('.speed-slider');
        const speedValue = document.querySelector('.speed-value');
        
        if (speedSlider && speedValue) {
            speedSlider.value = this.speedMultiplier;
            speedValue.textContent = `Speed: ${this.speedMultiplier}x`;
            
            speedSlider.addEventListener('input', (e) => {
                const newSpeed = parseInt(e.target.value);
                const delta = newSpeed - this.speedMultiplier;
                this.adjustSpeed(delta);
            });
        }
    }

    createGrid() {
        const grid = document.querySelector('.grid');
        if (!grid) return;

        grid.innerHTML = '';
        
        for (let i = 0; i < this.height; i++) {
            for (let j = 0; j < this.width; j++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.row = i;
                cell.dataset.col = j;
                cell.addEventListener('click', () => this.toggleCell(i, j));
                grid.appendChild(cell);
            }
        }

        // Initial grid sizing
        this.resizeGrid();
    }

    countNeighbors(row, col) {
        let count = 0;
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                if (i === 0 && j === 0) continue;
                const newRow = (row + i + this.height) % this.height;
                const newCol = (col + j + this.width) % this.width;
                count += this.grid[newRow][newCol];
            }
        }
        return count;
    }

    draw() {
        const cells = document.querySelectorAll('.cell');
        cells.forEach(cell => {
            const i = parseInt(cell.dataset.row);
            const j = parseInt(cell.dataset.col);
            const wasAlive = this.grid[i][j] === 1;
            const isAlive = this.nextGrid[i][j] === 1;
            const neighbors = this.countNeighbors(i, j);
            
            // Remove all state classes
            cell.classList.remove('alive', 'birth', 'death-starved', 'death-lonely', 'dead');
            
            // Add appropriate class based on state
            if (isAlive) {
                if (!wasAlive) {
                    cell.classList.add('birth');
                } else {
                    cell.classList.add('alive');
                }
            } else if (wasAlive) {
                if (neighbors < 2) {
                    cell.classList.add('death-lonely');
                } else {
                    cell.classList.add('death-starved');
                }
            } else {
                cell.classList.add('dead');
            }
        });
    }

    step() {
        // Store current grid as previous before updating
        this.previousGrid = this.grid.map(row => [...row]);
        
        // Copy current grid to next grid
        this.nextGrid = this.grid.map(row => [...row]);
        
        // Update grid based on Game of Life rules
        for (let i = 0; i < this.height; i++) {
            for (let j = 0; j < this.width; j++) {
                const neighbors = this.countNeighbors(i, j);
                const wasAlive = this.grid[i][j] === 1;
                
                // Apply Conway's Game of Life rules
                if (wasAlive) {
                    if (neighbors < 2 || neighbors > 3) {
                        this.nextGrid[i][j] = 0; // Death by loneliness or overcrowding
                    } else {
                        this.nextGrid[i][j] = 1; // Survival
                    }
                } else {
                    if (neighbors === 3) {
                        this.nextGrid[i][j] = 1; // Birth
                    }
                }
            }
        }

        // Draw before updating grid to show transitions
        this.draw();
        
        // Update grid and metrics
        this.grid = this.nextGrid.map(row => [...row]);
        this.generation++;
        this.updateMetrics();
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.intervalId = setInterval(() => this.step(), this.updateInterval);
        }
    }

    stop() {
        this.isRunning = false;
        clearInterval(this.intervalId);
    }

    tick() {
        if (!this.isRunning) return;
        
        this.step();
        this.intervalId = setTimeout(() => this.tick(), this.updateInterval);
    }

    createPreviewGrid(grid, size) {
        const container = document.createElement('div');
        container.className = `state-preview-${size} ${this.currentTheme}-theme`;

        // Create cells for the entire grid dimensions (50x30)
        for (let i = 0; i < this.height; i++) {
            for (let j = 0; j < this.width; j++) {
                const cell = document.createElement('div');
                cell.className = `preview-cell-${size}`;
                cell.classList.add(grid[i]?.[j] ? 'alive' : 'dead');
                container.appendChild(cell);
            }
        }

        return container;
    }

    updateStatesList() {
        const statesList = document.querySelector('.states-list');
        if (!statesList) return;

        statesList.innerHTML = '';
        const states = this.stateManager.getAllStates();
        
        states.forEach(state => {
            const stateItem = document.createElement('div');
            stateItem.className = 'state-item';
            if (state.id === this.selectedStateId) {
                stateItem.classList.add('selected');
            }
            
            // Add checkbox
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'state-checkbox';
            checkbox.dataset.stateId = state.id;
            
            const previewGrid = this.createPreviewGrid(state.grid, 'mini');
            const stateName = document.createElement('div');
            stateName.className = 'state-name';
            stateName.textContent = state.name;
            
            stateItem.appendChild(checkbox);
            stateItem.appendChild(previewGrid);
            stateItem.appendChild(stateName);
            
            // Prevent checkbox from triggering state selection
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            
            stateItem.addEventListener('click', (e) => {
                if (e.target !== checkbox) {
                    document.querySelectorAll('.state-item').forEach(item => item.classList.remove('selected'));
                    stateItem.classList.add('selected');
                    this.selectedStateId = state.id;
                    
                    const selectedPreview = document.getElementById('selectedPreview');
                    if (selectedPreview) {
                        selectedPreview.innerHTML = '';
                        const largePreview = this.createPreviewGrid(state.grid, 'large');
                        selectedPreview.appendChild(largePreview);
                    }
                }
            });
            
            statesList.appendChild(stateItem);
        });
    }

    openStateManager() {
        const modal = document.getElementById('stateModal');
        if (modal) {
            // Save current state automatically
            const currentTime = new Date().toLocaleTimeString();
            const id = this.stateManager.saveState(`Autosave ${currentTime}`, this.grid.map(row => [...row]), this.previousGrid?.map(row => [...row]));
            this.selectedStateId = id;
            
            modal.style.display = 'block';
            this.updateStatesList();
            
            // Update preview with current state
            const selectedPreview = document.getElementById('selectedPreview');
            if (selectedPreview) {
                selectedPreview.innerHTML = '';
                const largePreview = this.createPreviewGrid(this.grid, 'large');
                selectedPreview.appendChild(largePreview);
            }
        }
    }

    setupEventListeners() {
        const toggleButton = document.getElementById('toggleButton');
        const stepBtn = document.getElementById('stepBtn');
        const randomizeBtn = document.getElementById('randomizeBtn');
        const openStateManagerBtn = document.getElementById('openStateManager');
        const closeBtn = document.querySelector('.close-btn');
        const saveStateBtn = document.getElementById('saveState');
        const deleteStateBtn = document.getElementById('deleteState');
        const stateModal = document.getElementById('stateModal');

        if (toggleButton) {
            toggleButton.addEventListener('click', () => {
                if (this.isRunning) {
                    this.stop();
                    toggleButton.textContent = 'Start';
                    toggleButton.classList.remove('active');
                } else {
                    this.start();
                    toggleButton.textContent = 'Stop';
                    toggleButton.classList.add('active');
                }
            });
        }

        if (stepBtn) stepBtn.addEventListener('click', () => this.step());
        if (randomizeBtn) randomizeBtn.addEventListener('click', () => this.randomize());
        
        // State management
        if (openStateManagerBtn && stateModal) {
            openStateManagerBtn.addEventListener('click', () => this.openStateManager());
        }

        if (closeBtn && stateModal) {
            closeBtn.addEventListener('click', () => {
                stateModal.style.display = 'none';
            });
        }

        if (saveStateBtn) {
            saveStateBtn.addEventListener('click', () => {
                const nameInput = document.getElementById('stateName');
                const name = nameInput.value.trim() || `State ${this.stateManager.getAllStates().length + 1}`;
                this.stateManager.saveState(name, this.grid.map(row => [...row]), this.previousGrid);
                nameInput.value = '';
                this.updateStatesList();
            });
        }

        // Modal close handlers
        const modal = document.getElementById('stateModal');
        const closeBtnModal = modal?.querySelector('.close');
        
        closeBtnModal?.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        // Close modal when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });

        // Preview click handler
        const selectedPreview = document.getElementById('selectedPreview');
        selectedPreview?.addEventListener('click', () => {
            if (this.selectedStateId) {
                const state = this.stateManager.getState(this.selectedStateId);
                if (state) {
                    this.grid = state.grid.map(row => [...row]);
                    this.previousGrid = state.previousGrid ? 
                        state.previousGrid.map(row => [...row]) : 
                        Array(this.height).fill().map(() => Array(this.width).fill(0));
                    this.draw();
                    document.getElementById('stateModal').style.display = 'none';
                }
            }
        });

        // State manager event listeners
        const selectAll = document.getElementById('selectAll');
        const deleteSelected = document.getElementById('deleteSelected');

        selectAll?.addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.state-item input[type="checkbox"]');
            checkboxes.forEach(checkbox => checkbox.checked = e.target.checked);
        });

        deleteSelected?.addEventListener('click', () => {
            const checkedStates = document.querySelectorAll('.state-item input[type="checkbox"]:checked');
            checkedStates.forEach(checkbox => {
                const stateId = checkbox.dataset.stateId;
                this.stateManager.deleteState(stateId);
            });
            this.updateStatesList();
            document.getElementById('selectAll').checked = false;
        });

        // Theme radio buttons
        const themeRadios = document.querySelectorAll('input[name="colorTheme"]');
        themeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.updateTheme(e.target.value);
            });
        });

        // Speed control
        const speedSlider = document.querySelector('.speed-slider');
        const speedValue = document.querySelector('.speed-value');
        if (speedSlider) {
            speedSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                this.speedMultiplier = value;
                this.updateInterval = this.baseInterval / this.speedMultiplier;
                
                if (speedValue) {
                    speedValue.textContent = `${value}x`;
                    // Position the value above the thumb
                    const percent = (value - speedSlider.min) / (speedSlider.max - speedSlider.min);
                    const thumbWidth = 24; // Width of the thumb in pixels
                    const sliderWidth = speedSlider.offsetWidth;
                    const position = percent * (sliderWidth - thumbWidth);
                    speedValue.style.left = `${position}px`;
                }
                
                if (this.isRunning) {
                    this.stop();
                    this.start();
                }
            });
        }

        // Import/Export functionality
        const dropZone = document.getElementById('dropZone');
        const importTextarea = document.getElementById('stateImportExport');
        const importBtn = document.getElementById('importState');
        const exportBtn = document.getElementById('exportState');

        if (dropZone) {
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });

            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('drag-over');
            });

            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('drag-over');
                
                const file = e.dataTransfer.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        importTextarea.value = event.target.result;
                    };
                    reader.readAsText(file);
                }
            });

            dropZone.addEventListener('click', () => {
                navigator.clipboard.readText().then(text => {
                    importTextarea.value = text;
                }).catch(err => {
                    console.error('Failed to read clipboard:', err);
                });
            });
        }

        if (importBtn) {
            importBtn.addEventListener('click', () => {
                try {
                    const stateStr = importTextarea.value.trim();
                    if (stateStr) {
                        const id = this.stateManager.importState(stateStr);
                        this.selectedStateId = id;
                        const state = this.stateManager.getState(id);
                        this.grid = state.grid.map(row => [...row]);
                        if (state.previousGrid) {
                            this.previousGrid = state.previousGrid.map(row => [...row]);
                        }
                        this.draw();
                        this.updateStatesList();
                        importTextarea.value = '';
                    }
                } catch (e) {
                    alert('Invalid state format. Please check your input.');
                }
            });
        }

        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                if (this.selectedStateId) {
                    const state = this.stateManager.getState(this.selectedStateId);
                    if (state) {
                        const exportData = this.stateManager.exportState(state);
                        const blob = new Blob([exportData], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${state.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${new Date().toISOString().split('T')[0]}.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }
                }
            });
        }

        // ... rest of event listeners ...
    }

    saveCurrentState(name) {
        const state = {
            grid: this.grid.map(row => [...row]),
            previousGrid: this.previousGrid.map(row => [...row]),
            generation: this.generation,
            name: name,
            timestamp: new Date().toISOString()
        };
        const id = this.stateManager.generateId();
        this.stateManager.saveState(id, state.grid, state.previousGrid);
        this.updateStatesList();
        return id;
    }

    loadSelectedState(stateId) {
        const state = this.stateManager.getState(stateId);
        if (state) {
            this.grid = state.grid.map(row => [...row]);
            this.previousGrid = state.previousGrid.map(row => [...row]);
            this.generation = state.generation || 0;
            this.updateMetrics();
            this.draw();
        }
    }

    updateMetrics() {
        const generationCounter = document.querySelector('.generation-counter');
        if (generationCounter) {
            generationCounter.textContent = `Gen: ${this.generation}`;
        }
    }

    randomize() {
        for (let i = 0; i < this.height; i++) {
            for (let j = 0; j < this.width; j++) {
                this.grid[i][j] = Math.random() < 0.3 ? 1 : 0;
            }
        }
        this.nextGrid = this.grid.map(row => [...row]);
        this.draw();
    }

    toggleCell(i, j) {
        this.grid[i][j] = this.grid[i][j] === 0 ? 1 : 0;
        this.nextGrid[i][j] = this.grid[i][j];
        this.draw();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GameOfLife, StateManager };
} else if (typeof window !== 'undefined') {
    window.GameOfLife = GameOfLife;
    window.StateManager = StateManager;
}
