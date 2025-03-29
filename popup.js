// Popup logic for Adobe Web SDK Inspector

// DOM elements
const toggleButton = document.getElementById('toggleButton');
const pathsInput = document.getElementById('pathsInput');
const saveButton = document.getElementById('saveButton');
const statusElement = document.getElementById('status');

// Extension state
let isListening = false;
let targetPaths = [];

// Initialize UI based on saved state
function initializeUI() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    if (response) {
      isListening = response.isListening;
      targetPaths = response.targetPaths;
      
      // Update UI elements
      updateToggleButton();
      pathsInput.value = targetPaths.join('\n');
    }
  });
  
  // Also load from storage
  chrome.storage.local.get(['isListening', 'targetPaths'], (result) => {
    if (result.isListening !== undefined) {
      isListening = result.isListening;
      updateToggleButton();
    }
    
    if (result.targetPaths && result.targetPaths.length > 0) {
      targetPaths = result.targetPaths;
      pathsInput.value = targetPaths.join('\n');
    }
  });
}

// Update the toggle button appearance based on listening state
function updateToggleButton() {
  if (isListening) {
    toggleButton.textContent = 'Listening: ON';
    toggleButton.classList.add('active');
  } else {
    toggleButton.textContent = 'Listening: OFF';
    toggleButton.classList.remove('active');
  }
}

// Toggle listening state
function toggleListening() {
  isListening = !isListening;
  
  // Update UI
  updateToggleButton();
  
  // Save state and notify background script
  chrome.storage.local.set({ isListening });
  chrome.runtime.sendMessage({ 
    action: 'toggleListening', 
    value: isListening 
  }, (response) => {
    if (response && response.status === 'success') {
      statusElement.textContent = `Listening ${isListening ? 'enabled' : 'disabled'}`;
    }
  });
}

// Save target paths
function savePaths() {
  const input = pathsInput.value.trim();
  
  if (input) {
    // Split by newlines and filter out empty lines
    targetPaths = input.split('\n')
      .map(path => path.trim())
      .filter(path => path.length > 0);
    
    // Save to storage and notify background script
    chrome.storage.local.set({ targetPaths });
    chrome.runtime.sendMessage({
      action: 'updatePaths',
      paths: targetPaths
    }, (response) => {
      if (response && response.status === 'success') {
        statusElement.textContent = `Saved ${targetPaths.length} path(s)`;
      }
    });
  } else {
    targetPaths = [];
    chrome.storage.local.set({ targetPaths });
    chrome.runtime.sendMessage({
      action: 'updatePaths',
      paths: []
    });
    statusElement.textContent = 'No paths specified';
  }
}

// Event listeners
toggleButton.addEventListener('click', toggleListening);
saveButton.addEventListener('click', savePaths);

// Initialize the UI when popup is opened
document.addEventListener('DOMContentLoaded', initializeUI); 