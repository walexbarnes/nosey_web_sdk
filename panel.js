// Panel script for Adobe Web SDK Inspector

/**
 * DevTools panel module for the Adobe Web SDK Inspector
 * Manages the panel UI and communication with the background script
 */
(function AdobeSDKInspectorPanel() {
  // Configuration
  const CONFIG = {
    MAX_RESULTS: 20,
    MAX_RECONNECT_ATTEMPTS: 5,
    DEFAULT_EXTENSION_VERSION: '1.0.5'
  };
  
  // State management
  const state = {
    isListening: false,
    targetPaths: [],
    debugMode: true,
    connectionAttempts: 0,
    backgroundPort: null
  };
  
  // DOM element references
  const elements = {
    toggleButton: document.getElementById('toggleButton'),
    pathsInput: document.getElementById('pathsInput'),
    saveButton: document.getElementById('saveButton'),
    statusElement: document.getElementById('status'),
    resultsContainer: document.getElementById('results')
  };
  
  // Create optional controls
  elements.debugToggle = document.getElementById('debugToggle') || createDebugToggle();
  elements.clearButton = document.getElementById('clearButton') || createClearButton();
  
  /**
   * Get the default target paths
   * @returns {string[]} Array of default paths to extract
   */
  function getDefaultPaths() {
    return [
      'eventType',
      'web.webPageDetails.URL',
      'web.webInteraction.name',
      'web.webInteraction.region'
    ];
  }
  
  /**
   * Check if a string contains any bad paths
   * @param {string} value - The string to check
   * @returns {boolean} True if the string contains bad paths
   */
  function containsBadPaths(value) {
    if (!value) return false;
    
    const badPrefixes = [
      'timestamp',
      '_experience.analytics',
      '_intelcorp',
      'meta.state'
    ];
    
    return badPrefixes.some(prefix => value.includes(prefix));
  }
  
  /**
   * Create debug toggle button if it doesn't exist
   * @returns {HTMLElement|null} The created button or null
   */
  function createDebugToggle() {
    const controlsContainer = document.querySelector('.controls');
    if (!controlsContainer) return null;
    
    const toggle = document.createElement('button');
    toggle.id = 'debugToggle';
    toggle.textContent = 'Debug: ON';
    toggle.classList.add('active');
    toggle.style.marginLeft = '10px';
    
    controlsContainer.appendChild(toggle);
    toggle.addEventListener('click', toggleDebugMode);
    
    return toggle;
  }
  
  /**
   * Create clear button if it doesn't exist
   * @returns {HTMLElement|null} The created button or null
   */
  function createClearButton() {
    if (!elements.saveButton) return null;
    
    const clearBtn = document.createElement('button');
    clearBtn.id = 'clearButton';
    clearBtn.textContent = 'Reset Defaults';
    clearBtn.style.marginLeft = '10px';
    
    elements.saveButton.parentNode.insertBefore(clearBtn, elements.saveButton.nextSibling);
    clearBtn.addEventListener('click', resetPathsToDefaults);
    
    return clearBtn;
  }
  
  /**
   * Toggle debug mode
   */
  function toggleDebugMode() {
    state.debugMode = !state.debugMode;
    
    if (elements.debugToggle) {
      elements.debugToggle.textContent = `Debug: ${state.debugMode ? 'ON' : 'OFF'}`;
      elements.debugToggle.classList.toggle('active', state.debugMode);
    }
    
    // Save state and notify background script
    chrome.storage.local.set({ debugMode: state.debugMode });
    
    try {
      chrome.runtime.sendMessage({ 
        action: 'toggleDebug', 
        value: state.debugMode 
      }, (response) => {
        if (response && response.status === 'success') {
          updateStatus(`Debug mode ${state.debugMode ? 'enabled' : 'disabled'}`);
        }
      });
    } catch (e) {
      console.error('Error sending debug toggle message:', e);
    }
  }
  
  /**
   * Initialize connection to background page
   */
  function connectToBackgroundPage() {
    try {
      state.backgroundPort = chrome.runtime.connect({ name: 'devtools-panel' });
      
      state.backgroundPort.onMessage.addListener((message) => {
        if (message.action === 'displayResults') {
          addResult(message.results, message.url, message.requestInfo, message.fullXdm);
        } else if (message.action === 'statusUpdate') {
          updateStatus(message.status);
        }
      });
      
      // Send init message to let background know we're connected
      try {
        state.backgroundPort.postMessage({ action: 'devtools-init' });
      } catch (e) {
        console.error('Error sending init message via port:', e);
      }
      
      // Reconnect if disconnected, with backoff
      state.backgroundPort.onDisconnect.addListener(() => {
        state.backgroundPort = null;
        
        if (state.connectionAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS) {
          state.connectionAttempts++;
          const delay = Math.pow(2, state.connectionAttempts) * 1000; // Exponential backoff
          setTimeout(connectToBackgroundPage, delay);
        } else {
          updateStatus('Connection lost. Please refresh DevTools panel.');
        }
      });
      
      // Also send init message via runtime messaging as a backup
      try {
        chrome.runtime.sendMessage({ action: 'devtools-init' });
      } catch (e) {
        console.error('Error sending init via runtime:', e);
      }
      
      // Reset connection attempts on successful connection
      state.connectionAttempts = 0;
    } catch (e) {
      console.error('Error connecting to background page:', e);
      updateStatus('Error connecting to background. Please refresh DevTools panel.');
    }
  }
  
  /**
   * Initialize UI based on saved state
   */
  function initializeUI() {
    // Our forced default paths - we will ALWAYS use these
    const forcedPaths = getDefaultPaths();
    
    // Check if we need to update the path input (if it's empty or contains bad paths)
    const currentValue = elements.pathsInput.value;
    const needsUpdate = !currentValue || containsBadPaths(currentValue);
    
    if (needsUpdate) {
      // Set our paths in the UI
      state.targetPaths = forcedPaths;
      elements.pathsInput.value = forcedPaths.join('\n');
      
      // Save to storage
      chrome.storage.local.set({ targetPaths: forcedPaths });
    }
    
    // Get only isListening and debugMode from storage
    chrome.storage.local.get(['isListening', 'debugMode'], (result) => {
      if (result.isListening !== undefined) {
        state.isListening = result.isListening;
        updateToggleButton();
      }
      
      if (result.debugMode !== undefined) {
        state.debugMode = result.debugMode;
        if (elements.debugToggle) {
          elements.debugToggle.textContent = `Debug: ${state.debugMode ? 'ON' : 'OFF'}`;
          elements.debugToggle.classList.toggle('active', state.debugMode);
        }
      }
      
      // Notify background script of the paths
      sendPathsToBackground(state.targetPaths, needsUpdate);
    });
    
    // Request current status from background
    requestStatusFromBackground(needsUpdate);
  }
  
  /**
   * Send paths to background script
   * @param {string[]} paths - The paths to send
   * @param {boolean} shouldUpdateUI - Whether to update the UI with the response
   */
  function sendPathsToBackground(paths, shouldUpdateUI = true) {
    try {
      chrome.runtime.sendMessage({
        action: 'updatePaths',
        paths: paths
      }, function(response) {
        // Check if the background sanitized our paths differently
        if (response && response.sanitizedPaths && shouldUpdateUI) {
          // Use the sanitized paths from background
          state.targetPaths = response.sanitizedPaths;
          if (elements.pathsInput) {
            elements.pathsInput.value = state.targetPaths.join('\n');
          }
        }
      });
    } catch (e) {
      console.error('Error sending paths to background:', e);
    }
  }
  
  /**
   * Request current status from background
   * @param {boolean} shouldUpdatePaths - Whether to update paths with the response
   */
  function requestStatusFromBackground(shouldUpdatePaths = false) {
    try {
      chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
        if (response) {
          state.isListening = response.isListening;
          updateToggleButton();
          
          // Only update paths if we have a good response and if the UI needs an update
          if (response.targetPaths && Array.isArray(response.targetPaths) && 
              response.targetPaths.length > 0 && shouldUpdatePaths) {
            // Ensure no bad paths got through
            const cleanPaths = response.targetPaths.filter(path => 
              !containsBadPaths(path)
            );
            
            // Only update if we have clean paths
            if (cleanPaths.length > 0) {
              state.targetPaths = cleanPaths;
              elements.pathsInput.value = state.targetPaths.join('\n');
            }
          }
        }
      });
    } catch (e) {
      console.error('Error getting status from background:', e);
    }
  }
  
  /**
   * Update the toggle button appearance based on listening state
   */
  function updateToggleButton() {
    if (!elements.toggleButton) return;
    
    elements.toggleButton.textContent = `Listening: ${state.isListening ? 'ON' : 'OFF'}`;
    elements.toggleButton.classList.toggle('active', state.isListening);
  }
  
  /**
   * Toggle listening state
   */
  function toggleListening() {
    state.isListening = !state.isListening;
    
    // Update UI
    updateToggleButton();
    
    // Save state and notify background script
    chrome.storage.local.set({ isListening: state.isListening });
    try {
      chrome.runtime.sendMessage({ 
        action: 'toggleListening', 
        value: state.isListening 
      }, (response) => {
        if (response && response.status === 'success') {
          updateStatus(`Listening ${state.isListening ? 'enabled' : 'disabled'}`);
        }
      });
    } catch (e) {
      console.error('Error sending toggle message:', e);
      updateStatus('Error communicating with background. Please refresh.');
    }
  }
  
  /**
   * Save target paths
   */
  function savePaths() {
    // Our core forced paths - these will ALWAYS be included
    const forcedPaths = getDefaultPaths();
    
    const input = elements.pathsInput.value.trim();
    
    if (input) {
      // Split by newlines and filter out empty lines
      const userPaths = input.split('\n')
        .map(path => path.trim())
        .filter(path => path.length > 0);
      
      // Combine user paths with our forced paths, ensuring there are no duplicates
      const combinedPaths = [...new Set([...forcedPaths, ...userPaths])];
      
      // Filter out bad paths
      state.targetPaths = combinedPaths.filter(path => !containsBadPaths(path));
      
      // Update the UI
      elements.pathsInput.value = state.targetPaths.join('\n');
      
      // Save to storage and notify background script
      chrome.storage.local.set({ targetPaths: state.targetPaths });
      sendPathsToBackground(state.targetPaths, false);
      
      updateStatus(`Saved ${state.targetPaths.length} path(s)`);
    } else {
      // If no input, just use our forced paths
      state.targetPaths = forcedPaths;
      elements.pathsInput.value = state.targetPaths.join('\n');
      
      chrome.storage.local.set({ targetPaths: state.targetPaths });
      sendPathsToBackground(state.targetPaths, false);
      
      updateStatus('Saved default paths');
    }
  }
  
  /**
   * Reset paths to suggested defaults
   */
  function resetPathsToDefaults() {
    const suggestedPaths = getDefaultPaths();
    
    state.targetPaths = suggestedPaths;
    elements.pathsInput.value = state.targetPaths.join('\n');
    
    // Save to storage and notify background script
    chrome.storage.local.set({ targetPaths: state.targetPaths });
    sendPathsToBackground(state.targetPaths, false);
    
    updateStatus(`Reset to default paths`);
  }
  
  /**
   * Add a new result to the results container
   * @param {Object} resultData - The data to display
   * @param {string} url - The request URL
   * @param {Object} requestInfo - Information about the request
   * @param {Object} fullXdm - The complete XDM object
   */
  function addResult(resultData, url, requestInfo = {}, fullXdm = null) {
    if (!elements.resultsContainer || !resultData) {
      console.error("Cannot add result: missing container or data", !!elements.resultsContainer, !!resultData);
      return;
    }
    
    if (state.debugMode) {
      console.log("[Panel] Adding result:", 
        { 
          resultKeys: Object.keys(resultData), 
          url, 
          fullXdmAvailable: !!fullXdm,
          requestInfo: requestInfo
        }
      );
    }
    
    // Clear "no results" message if present
    const noResultsElement = elements.resultsContainer.querySelector('.no-results');
    if (noResultsElement) {
      elements.resultsContainer.removeChild(noResultsElement);
    }
    
    // Create and configure a new result element
    const resultElement = document.createElement('div');
    resultElement.className = 'result';
    
    // Get the event type - this is specific to Adobe Web SDK
    const eventType = resultData.eventType || 'unknown';
    
    // Determine badge color based on event type
    const badgeColor = getBadgeColor(eventType);
    
    // Separate simple and complex values
    const { simpleValues, complexValues } = categorizeValues(resultData);
    
    // Try to extract ECID from the fullXdm object if available
    try {
      if (fullXdm && fullXdm.handle && Array.isArray(fullXdm.handle)) {
        for (const item of fullXdm.handle) {
          if (item && item.type === 'identity:result' && item.payload && 
              item.payload.identity && item.payload.identity.namespace && 
              item.payload.identity.namespace.code === 'ECID') {
            
            simpleValues['ECID'] = item.payload.identity.id;
            
            if (state.debugMode) {
              console.log("[Panel] ECID found:", simpleValues['ECID']);
            }
            break;
          }
        }
      }
    } catch (e) {
      if (state.debugMode) {
        console.error("[Panel] Error extracting ECID:", e);
      }
    }
    
    // Create HTML elements
    appendHeader(resultElement, eventType, url, badgeColor);
    appendSimpleValuesTable(resultElement, simpleValues);
    appendComplexValues(resultElement, complexValues);
    appendFullXdm(resultElement, fullXdm);
    appendResponseData(resultElement, requestInfo);
    
    // Add the result to the container
    elements.resultsContainer.prepend(resultElement);
    
    // Limit the number of displayed results
    limitResultsCount();
  }
  
  /**
   * Get appropriate badge color for event type
   * @param {string} eventType - The event type
   * @returns {string} The color code
   */
  function getBadgeColor(eventType) {
    if (eventType === 'web.webpagedetails.pageViews') {
      return '#9C27B0'; // Purple for page views
    } else if (eventType.includes('click') || eventType.includes('link')) {
      return '#FF9800'; // Orange for clicks/links
    }
    return '#4CAF50'; // Default green
  }
  
  /**
   * Categorize values into simple and complex
   * @param {Object} data - The data to categorize
   * @returns {Object} Object with simpleValues and complexValues
   */
  function categorizeValues(data) {
    const simpleValues = {};
    const complexValues = {};
    
    Object.keys(data).forEach(key => {
      const value = data[key];
      if (value !== null && typeof value === 'object') {
        complexValues[key] = value;
      } else {
        simpleValues[key] = value;
      }
    });
    
    return { simpleValues, complexValues };
  }
  
  /**
   * Append header section to result element
   * @param {HTMLElement} resultElement - The element to append to
   * @param {string} eventType - The event type
   * @param {string} url - The request URL
   * @param {string} badgeColor - The badge color
   */
  function appendHeader(resultElement, eventType, url, badgeColor) {
    const urlDisplay = url ? new URL(url).pathname : 'No URL';
    
    const headerDiv = document.createElement('div');
    headerDiv.className = 'result-header';
    headerDiv.innerHTML = `
      <div class="event-type-badge" style="background-color: ${badgeColor};">${eventType}</div>
      <div class="result-url" title="${url || 'No URL'}">${urlDisplay}</div>
      <div class="timestamp">${new Date().toLocaleTimeString()}</div>
    `;
    
    resultElement.appendChild(headerDiv);
  }
  
  /**
   * Append simple values table to result element
   * @param {HTMLElement} resultElement - The element to append to
   * @param {Object} simpleValues - The simple values to display
   */
  function appendSimpleValuesTable(resultElement, simpleValues) {
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'result-details';
    
    const table = document.createElement('table');
    table.className = 'pretty-table';
    
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Path</th>
        <th>Value</th>
      </tr>
    `;
    table.appendChild(thead);
    
    const tbody = document.createElement('tbody');
    
    // Add alternating row colors
    let rowIndex = 0;
    Object.keys(simpleValues).forEach(key => {
      const row = document.createElement('tr');
      if (rowIndex % 2 === 1) {
        row.className = 'alt-row';
      }
      row.innerHTML = `
        <td>${key}</td>
        <td>${simpleValues[key]}</td>
      `;
      tbody.appendChild(row);
      rowIndex++;
    });
    
    table.appendChild(tbody);
    detailsDiv.appendChild(table);
    resultElement.appendChild(detailsDiv);
  }
  
  /**
   * Append complex values to result element
   * @param {HTMLElement} resultElement - The element to append to
   * @param {Object} complexValues - The complex values to display
   */
  function appendComplexValues(resultElement, complexValues) {
    if (Object.keys(complexValues).length === 0) return;
    
    const complexContainer = document.createElement('div');
    complexContainer.className = 'collapsible-container';
    
    const complexHeader = document.createElement('div');
    complexHeader.className = 'collapsible-header complex-header';
    complexHeader.textContent = `Complex Field Details`;
    
    const complexContent = document.createElement('div');
    complexContent.className = 'collapsible-content';
    complexContent.style.display = 'none'; // Initially hidden
    
    Object.keys(complexValues).forEach(key => {
      const fieldValue = document.createElement('pre');
      fieldValue.className = 'complex-field-value';
      
      try {
        fieldValue.textContent = `${key} details:\n${JSON.stringify(complexValues[key], null, 2)}`;
      } catch (e) {
        fieldValue.textContent = `${key} details:\nError formatting complex value: ${e.message}`;
      }
      
      complexContent.appendChild(fieldValue);
    });
    
    // Add event listener to toggle visibility
    complexHeader.addEventListener('click', () => {
      complexContent.style.display = complexContent.style.display === 'none' ? 'block' : 'none';
    });
    
    complexContainer.appendChild(complexHeader);
    complexContainer.appendChild(complexContent);
    resultElement.appendChild(complexContainer);
  }
  
  /**
   * Append full XDM object to result element
   * @param {HTMLElement} resultElement - The element to append to
   * @param {Object} fullXdm - The full XDM object
   */
  function appendFullXdm(resultElement, fullXdm) {
    if (!fullXdm) return;
    
    const xdmContainer = document.createElement('div');
    xdmContainer.className = 'collapsible-container';
    
    const xdmHeader = document.createElement('div');
    xdmHeader.className = 'collapsible-header xdm-header';
    xdmHeader.textContent = 'Full XDM Object';
    
    const xdmContent = document.createElement('div');
    xdmContent.className = 'collapsible-content';
    xdmContent.style.display = 'none'; // Initially hidden
    
    const xdmPre = document.createElement('pre');
    xdmPre.className = 'xdm-content';
    
    try {
      xdmPre.textContent = JSON.stringify(fullXdm, null, 2);
    } catch (e) {
      xdmPre.textContent = `Error formatting XDM data: ${e.message}`;
    }
    
    xdmContent.appendChild(xdmPre);
    
    // Add event listener to toggle visibility
    xdmHeader.addEventListener('click', () => {
      xdmContent.style.display = xdmContent.style.display === 'none' ? 'block' : 'none';
    });
    
    xdmContainer.appendChild(xdmHeader);
    xdmContainer.appendChild(xdmContent);
    resultElement.appendChild(xdmContainer);
  }
  
  /**
   * Append response data to result element
   * @param {HTMLElement} resultElement - The element to append to
   * @param {Object} requestInfo - The request info object
   */
  function appendResponseData(resultElement, requestInfo) {
    if (!requestInfo || !requestInfo.response) return;
    
    const responseContainer = document.createElement('div');
    responseContainer.className = 'collapsible-container';
    
    const responseHeader = document.createElement('div');
    responseHeader.className = 'collapsible-header xdm-header';
    responseHeader.textContent = 'Response Data';
    
    const responseContent = document.createElement('div');
    responseContent.className = 'collapsible-content';
    responseContent.style.display = 'none'; // Initially hidden
    
    const responsePre = document.createElement('pre');
    responsePre.className = 'xdm-content';
    
    try {
      responsePre.textContent = JSON.stringify(requestInfo.response, null, 2);
    } catch (e) {
      responsePre.textContent = `Error formatting response data: ${e.message}`;
    }
    
    responseContent.appendChild(responsePre);
    
    // Add event listener to toggle visibility
    responseHeader.addEventListener('click', () => {
      responseContent.style.display = responseContent.style.display === 'none' ? 'block' : 'none';
    });
    
    responseContainer.appendChild(responseHeader);
    responseContainer.appendChild(responseContent);
    resultElement.appendChild(responseContainer);
  }
  
  /**
   * Limit the number of displayed results
   */
  function limitResultsCount() {
    const results = document.querySelectorAll('.result');
    if (results.length > CONFIG.MAX_RESULTS) {
      for (let i = CONFIG.MAX_RESULTS; i < results.length; i++) {
        results[i].remove();
      }
    }
  }
  
  /**
   * Update status message
   * @param {string} message - The message to display
   */
  function updateStatus(message) {
    if (elements.statusElement) {
      elements.statusElement.textContent = message;
    }
  }
  
  /**
   * Initialize the panel
   */
  function init() {
    // Force default paths
    forceClearAndSetDefaults();
    
    // Set up event listeners
    registerEventListeners();
    
    // Initialize the UI when panel is opened
    document.addEventListener('DOMContentLoaded', handleDOMContentLoaded);
  }
  
  /**
   * Force clear storage and set defaults
   */
  function forceClearAndSetDefaults() {
    const forcedPaths = getDefaultPaths();
    
    chrome.storage.local.clear(() => {
      // Set our defaults
      chrome.storage.local.set({
        targetPaths: forcedPaths,
        extensionVersion: CONFIG.DEFAULT_EXTENSION_VERSION,
        isListening: false,
        debugMode: true
      }, () => {
        // Update the UI if pathsInput is available
        if (elements.pathsInput) {
          state.targetPaths = forcedPaths;
          elements.pathsInput.value = forcedPaths.join('\n');
        }
        
        // Notify background script
        sendPathsToBackground(forcedPaths, false);
      });
    });
  }
  
  /**
   * Register event listeners
   */
  function registerEventListeners() {
    if (elements.toggleButton) {
      elements.toggleButton.addEventListener('click', toggleListening);
    }
    
    if (elements.saveButton) {
      elements.saveButton.addEventListener('click', savePaths);
    }
    
    if (elements.debugToggle) {
      elements.debugToggle.addEventListener('click', toggleDebugMode);
    }
    
    if (elements.clearButton) {
      elements.clearButton.addEventListener('click', resetPathsToDefaults);
    }
  }
  
  /**
   * Handle DOMContentLoaded event
   */
  function handleDOMContentLoaded() {
    // Check storage for a flag indicating if we've reloaded already
    chrome.storage.local.get(['reloadedForCleanup'], function(result) {
      if (!result.reloadedForCleanup) {
        // Set the flag and force a reload to ensure we pick up sanitized storage
        chrome.storage.local.set({ reloadedForCleanup: true }, function() {
          location.reload();
          return; // Stop execution here
        });
      } else {
        // Continue with normal initialization
        setupInitialState();
      }
    });
  }
  
  /**
   * Set up initial state
   */
  function setupInitialState() {
    // Force our default paths
    const forcedPaths = getDefaultPaths();
    
    // Set paths in UI if available
    state.targetPaths = forcedPaths;
    if (elements.pathsInput) {
      elements.pathsInput.value = forcedPaths.join('\n');
    }
    
    // Always save our forced paths with a new version
    chrome.storage.local.set({ 
      targetPaths: forcedPaths,
      extensionVersion: CONFIG.DEFAULT_EXTENSION_VERSION
    });
    
    // Notify background script of the forced paths
    sendPathsToBackground(forcedPaths, true);
    
    // Continue with initialization
    initializeUI();
    connectToBackgroundPage();
  }
  
  // Start the module
  init();
})(); 