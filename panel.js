// Panel script for Adobe Web SDK Inspector

// DOM elements
const toggleButton = document.getElementById('toggleButton');
const pathsInput = document.getElementById('pathsInput');
const saveButton = document.getElementById('saveButton');
const statusElement = document.getElementById('status');
const resultsContainer = document.getElementById('results');
const debugToggle = document.getElementById('debugToggle') || createDebugToggle();
const clearButton = document.getElementById('clearButton') || createClearButton();

// Extension state
let isListening = false;
let targetPaths = [];
let results = [];
let debugMode = true;

// Our forced default paths
function getDefaultPaths() {
  return [
    'eventType',
    'web.webPageDetails.URL',
    'web.webInteraction.name',
    'web.webInteraction.region'
  ];
}

// EMERGENCY FIX: Forcefully clear storage and set our defaults
(function forceDefaultPaths() {
  // Our forced default paths
  const forcedPaths = getDefaultPaths();
  
  // Clear all storage and set our defaults
  chrome.storage.local.clear(() => {
    // Set our defaults
    chrome.storage.local.set({
      targetPaths: forcedPaths,
      extensionVersion: '1.0.2',
      isListening: false,
      debugMode: true
    }, () => {
      // Update the UI if pathsInput is available
      if (pathsInput) {
        targetPaths = forcedPaths;
        pathsInput.value = forcedPaths.join('\n');
      }
      
      // Notify background script
      try {
        chrome.runtime.sendMessage({
          action: 'updatePaths',
          paths: forcedPaths
        });
      } catch (e) {
        console.error('Error notifying background of default paths', e);
      }
    });
  });
})();

// Port for communication with background page
let backgroundPort;
let connectionAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Create debug toggle if it doesn't exist
function createDebugToggle() {
  const controlsContainer = document.querySelector('.controls');
  
  if (!controlsContainer) {
    return null;
  }
  
  const toggle = document.createElement('button');
  toggle.id = 'debugToggle';
  toggle.textContent = 'Debug: ON';
  toggle.classList.add('active');
  toggle.style.marginLeft = '10px';
  
  controlsContainer.appendChild(toggle);
  
  toggle.addEventListener('click', toggleDebugMode);
  
  return toggle;
}

// Create clear button if it doesn't exist
function createClearButton() {
  const saveButton = document.getElementById('saveButton');
  
  if (!saveButton) {
    return null;
  }
  
  const clearBtn = document.createElement('button');
  clearBtn.id = 'clearButton';
  clearBtn.textContent = 'Reset Defaults';
  clearBtn.style.marginLeft = '10px';
  
  saveButton.parentNode.insertBefore(clearBtn, saveButton.nextSibling);
  
  clearBtn.addEventListener('click', resetPathsToDefaults);
  
  return clearBtn;
}

// Toggle debug mode
function toggleDebugMode() {
  debugMode = !debugMode;
  
  if (debugToggle) {
    debugToggle.textContent = `Debug: ${debugMode ? 'ON' : 'OFF'}`;
    if (debugMode) {
      debugToggle.classList.add('active');
    } else {
      debugToggle.classList.remove('active');
    }
  }
  
  // Save state and notify background script
  chrome.storage.local.set({ debugMode });
  try {
    chrome.runtime.sendMessage({ 
      action: 'toggleDebug', 
      value: debugMode 
    }, (response) => {
      if (response && response.status === 'success') {
        updateStatus(`Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
      }
    });
  } catch (e) {
    console.error('Error sending debug toggle message:', e);
  }
}

// Initialize connection to background page
function connectToBackgroundPage() {
  try {
    backgroundPort = chrome.runtime.connect({ name: 'devtools-panel' });
    
    backgroundPort.onMessage.addListener((message) => {
      if (message.action === 'displayResults') {
        addResult(message.results, message.url, message.requestInfo, message.fullXdm);
      } else if (message.action === 'statusUpdate') {
        updateStatus(message.status);
      }
    });
    
    // Send init message to let background know we're connected
    try {
      backgroundPort.postMessage({ action: 'devtools-init' });
    } catch (e) {
      console.error('Error sending init message via port:', e);
    }
    
    // Reconnect if disconnected, with backoff
    backgroundPort.onDisconnect.addListener(() => {
      backgroundPort = null;
      if (connectionAttempts < MAX_RECONNECT_ATTEMPTS) {
        connectionAttempts++;
        const delay = Math.pow(2, connectionAttempts) * 1000; // Exponential backoff
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
    connectionAttempts = 0;
  } catch (e) {
    console.error('Error connecting to background page:', e);
    updateStatus('Error connecting to background. Please refresh DevTools panel.');
  }
}

// Initialize UI based on saved state
function initializeUI() {
  // Our forced default paths - we will ALWAYS use these
  const forcedPaths = getDefaultPaths();

  // Function to check if current path value contains any bad paths
  function containsBadPaths(value) {
    if (!value) return false;
    
    const badPrefixes = [
      'timestamp'
    ];
    
    return badPrefixes.some(prefix => value.includes(prefix));
  }
  
  // Check if we need to update the path input (if it's empty or contains bad paths)
  const currentValue = pathsInput.value;
  const needsUpdate = !currentValue || containsBadPaths(currentValue);
  
  if (needsUpdate) {
    // Set our paths in the UI
    targetPaths = forcedPaths;
    pathsInput.value = forcedPaths.join('\n');
    
    // Save to storage
    chrome.storage.local.set({ targetPaths: forcedPaths });
  }
  
  // Get only isListening and debugMode from storage
  chrome.storage.local.get(['isListening', 'debugMode'], (result) => {
    if (result.isListening !== undefined) {
      isListening = result.isListening;
      updateToggleButton();
    }
    
    if (result.debugMode !== undefined) {
      debugMode = result.debugMode;
      if (debugToggle) {
        debugToggle.textContent = `Debug: ${debugMode ? 'ON' : 'OFF'}`;
        if (debugMode) {
          debugToggle.classList.add('active');
        } else {
          debugToggle.classList.remove('active');
        }
      }
    }
    
    // Notify background script of the paths
    try {
      chrome.runtime.sendMessage({
        action: 'updatePaths',
        paths: targetPaths
      }, function(response) {
        // Check if the background sanitized our paths differently
        if (response && response.sanitizedPaths) {
          // Use the sanitized paths from background
          targetPaths = response.sanitizedPaths;
          if (pathsInput && needsUpdate) {
            pathsInput.value = targetPaths.join('\n');
          }
        }
      });
    } catch (e) {
      console.error('Error sending forced paths to background:', e);
    }
  });
  
  // Request current status from background
  try {
    chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
      if (response) {
        isListening = response.isListening;
        updateToggleButton();
        
        // Only update paths if we have a good response and if the UI needs an update
        if (response.targetPaths && Array.isArray(response.targetPaths) && 
            response.targetPaths.length > 0 && needsUpdate) {
          // Ensure no bad paths got through
          const cleanPaths = response.targetPaths.filter(path => 
            !path.includes('_experience.analytics') && 
            !path.includes('_intelcorp') &&
            !path.includes('meta.state') &&
            path !== 'timestamp'
          );
          
          // Only update if we have clean paths
          if (cleanPaths.length > 0) {
            targetPaths = cleanPaths;
            pathsInput.value = targetPaths.join('\n');
          }
        }
      }
    });
  } catch (e) {
    console.error('Error getting status from background:', e);
  }
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
  try {
    chrome.runtime.sendMessage({ 
      action: 'toggleListening', 
      value: isListening 
    }, (response) => {
      if (response && response.status === 'success') {
        updateStatus(`Listening ${isListening ? 'enabled' : 'disabled'}`);
      }
    });
  } catch (e) {
    console.error('Error sending toggle message:', e);
    updateStatus('Error communicating with background. Please refresh.');
  }
}

// Save target paths
function savePaths() {
  // Our core forced paths - these will ALWAYS be included
  const forcedPaths = getDefaultPaths();
  
  const input = pathsInput.value.trim();
  
  if (input) {
    // Split by newlines and filter out empty lines
    const userPaths = input.split('\n')
      .map(path => path.trim())
      .filter(path => path.length > 0);
    
    // Combine user paths with our forced paths, ensuring there are no duplicates
    const combinedPaths = [...new Set([...forcedPaths, ...userPaths])];
    
    // Ensure none of the old defaults are included
    const oldDefaultPaths = [
      '_experience.analytics.customDimensions.eVars.eVar41',
      '_experience.analytics.customDimensions.eVars.eVar18',
      '_intelcorp.web.dimensions',
      'meta.state',
      'timestamp'
    ];
    
    targetPaths = combinedPaths.filter(path => !oldDefaultPaths.includes(path));
    
    // Update the UI
    pathsInput.value = targetPaths.join('\n');
    
    // Save to storage and notify background script
    chrome.storage.local.set({ targetPaths });
    try {
      chrome.runtime.sendMessage({
        action: 'updatePaths',
        paths: targetPaths
      }, (response) => {
        if (response && response.status === 'success') {
          updateStatus(`Saved ${targetPaths.length} path(s)`);
        }
      });
    } catch (e) {
      console.error('Error sending paths update:', e);
      updateStatus('Paths saved locally, but error communicating with background.');
    }
  } else {
    // If no input, just use our forced paths
    targetPaths = forcedPaths;
    pathsInput.value = targetPaths.join('\n');
    
    chrome.storage.local.set({ targetPaths });
    try {
      chrome.runtime.sendMessage({
        action: 'updatePaths',
        paths: targetPaths
      });
    } catch (e) {
      console.error('Error sending default paths update:', e);
    }
    updateStatus('Saved default paths');
  }
}

// Reset paths to suggested defaults
function resetPathsToDefaults() {
  const suggestedPaths = getDefaultPaths();
  
  targetPaths = suggestedPaths;
  pathsInput.value = targetPaths.join('\n');
  
  // Save to storage and notify background script
  chrome.storage.local.set({ targetPaths });
  try {
    chrome.runtime.sendMessage({
      action: 'updatePaths',
      paths: targetPaths
    }, (response) => {
      if (response && response.status === 'success') {
        updateStatus(`Reset to default paths`);
      }
    });
  } catch (e) {
    console.error('Error sending paths update:', e);
    updateStatus('Paths reset locally, but error communicating with background.');
  }
}

// Add a new result to the results container
function addResult(resultData, url, requestInfo = {}, fullXdm = null) {
  // Get the container for the results
  const resultsContainer = document.getElementById('results');
  
  // Clear "no results" message if present
  const noResultsElement = resultsContainer.querySelector('.no-results');
  if (noResultsElement) {
    resultsContainer.removeChild(noResultsElement);
  }
  
  // Create and configure a new result element
  const resultElement = document.createElement('div');
  resultElement.className = 'result';
  
  // Get the event type - this is specific to Adobe Web SDK
  let eventType = resultData.eventType || 'unknown';
  
  // Add event type badge with appropriate styling
  let badgeColor = '#4CAF50'; // Default green
  if (eventType === 'web.webpagedetails.pageViews') {
    badgeColor = '#9C27B0'; // Purple for page views
  } else if (eventType.includes('click') || eventType.includes('link')) {
    badgeColor = '#FF9800'; // Orange for clicks/links
  }
  
  // Separate simple and complex values
  const simpleValues = {};
  const complexValues = {};
  
  Object.keys(resultData).forEach(key => {
    const value = resultData[key];
    if (value !== null && typeof value === 'object') {
      complexValues[key] = value;
    } else {
      simpleValues[key] = value;
    }
  });
  
  // Add event title and URL
  const urlDisplay = url ? new URL(url).pathname : 'No URL';
  
  // Create the header section
  const headerDiv = document.createElement('div');
  headerDiv.className = 'result-header';
  headerDiv.innerHTML = `
    <div class="event-type-badge" style="background-color: ${badgeColor};">${eventType}</div>
    <div class="result-url" title="${url || 'No URL'}">${urlDisplay}</div>
    <div class="timestamp">${new Date().toLocaleTimeString()}</div>
  `;
  resultElement.appendChild(headerDiv);
  
  // Create the table for simple values
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
  
  // Add complex values in a collapsible section
  if (Object.keys(complexValues).length > 0) {
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
        // Just add a simple header before the JSON content
        fieldValue.textContent = `${key} details:\n${JSON.stringify(complexValues[key], null, 2)}`;
      } catch (e) {
        fieldValue.textContent = `${key} details:\nError formatting complex value: ${e.message}`;
      }
      
      complexContent.appendChild(fieldValue);
    });
    
    // Add event listener to toggle visibility
    complexHeader.addEventListener('click', () => {
      const isVisible = complexContent.style.display !== 'none';
      complexContent.style.display = isVisible ? 'none' : 'block';
    });
    
    complexContainer.appendChild(complexHeader);
    complexContainer.appendChild(complexContent);
    resultElement.appendChild(complexContainer);
  }
  
  // Add Full XDM button and container if we have XDM data
  if (fullXdm) {
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
      const isVisible = xdmContent.style.display !== 'none';
      xdmContent.style.display = isVisible ? 'none' : 'block';
    });
    
    xdmContainer.appendChild(xdmHeader);
    xdmContainer.appendChild(xdmContent);
    resultElement.appendChild(xdmContainer);
  }
  
  // Add the response data container if available in requestInfo
  if (requestInfo && requestInfo.response) {
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
      const isVisible = responseContent.style.display !== 'none';
      responseContent.style.display = isVisible ? 'none' : 'block';
    });
    
    responseContainer.appendChild(responseHeader);
    responseContainer.appendChild(responseContent);
    resultElement.appendChild(responseContainer);
  }
  
  // Add the result to the container
  resultsContainer.prepend(resultElement);
  
  // Limit the number of displayed results
  const maxResults = 20;
  const results = document.querySelectorAll('.result');
  if (results.length > maxResults) {
    for (let i = maxResults; i < results.length; i++) {
      results[i].remove();
    }
  }
}

// Update status message
function updateStatus(message) {
  statusElement.textContent = message;
}

// Event listeners
toggleButton.addEventListener('click', toggleListening);
saveButton.addEventListener('click', savePaths);
if (debugToggle) debugToggle.addEventListener('click', toggleDebugMode);
if (clearButton) clearButton.addEventListener('click', resetPathsToDefaults);

// Initialize the UI when panel is opened
document.addEventListener('DOMContentLoaded', () => {
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
      // Force our default paths - no version checking needed
      const forcedPaths = getDefaultPaths();
      
      // Set paths in UI if available
      targetPaths = forcedPaths;
      if (pathsInput) {
        pathsInput.value = forcedPaths.join('\n');
      }
      
      // Always save our forced paths with a new version
      chrome.storage.local.set({ 
        targetPaths: forcedPaths,
        extensionVersion: '1.0.5' // Increment version
      });
      
      // Notify background script of the forced paths
      try {
        chrome.runtime.sendMessage({
          action: 'updatePaths',
          paths: forcedPaths
        }, function(response) {
          // Check if the background sanitized our paths differently
          if (response && response.sanitizedPaths) {
            // Use the sanitized paths from background
            targetPaths = response.sanitizedPaths;
            if (pathsInput) {
              pathsInput.value = targetPaths.join('\n');
            }
          }
        });
      } catch (e) {
        console.error('Error sending forced paths on init:', e);
      }
      
      // Continue with initialization
      initializeUI();
      connectToBackgroundPage();
    }
  });
}); 