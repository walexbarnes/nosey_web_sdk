// Background script for Adobe Web SDK Inspector

// Global state management
const state = {
  isListening: false,
  targetPaths: [],
  debugMode: false,
  requestCounter: 0
};

// LRU Cache implementation with automatic timeout
class RequestCache {
  constructor(maxSize = 100, expiryMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.expiryMs = expiryMs;
    this.cache = new Map();
    this.timeouts = new Map();
  }

  set(key, value) {
    // Clean up existing timeout if any
    if (this.timeouts.has(key)) {
      clearTimeout(this.timeouts.get(key));
    }
    
    // Set new value
    value.timestamp = Date.now();
    this.cache.set(key, value);
    
    // Create expiry timeout
    const timeout = setTimeout(() => this.delete(key), this.expiryMs);
    this.timeouts.set(key, timeout);
    
    // Clean up if we exceed max size (LRU eviction)
    if (this.cache.size > this.maxSize) {
      let oldestKey = null;
      let oldestTime = Infinity;
      
      // Find oldest entry
      for (const [k, v] of this.cache.entries()) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }
      
      // Remove oldest entry
      if (oldestKey) {
        this.delete(oldestKey);
      }
    }
  }

  get(key) {
    return this.cache.get(key);
  }

  delete(key) {
    this.cache.delete(key);
    if (this.timeouts.has(key)) {
      clearTimeout(this.timeouts.get(key));
      this.timeouts.delete(key);
    }
  }

  clear() {
    // Clear all timeouts
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.cache.clear();
    this.timeouts.clear();
  }
}

// Create cache instance
const requestCache = new RequestCache();

// Persistent connection management
class DevToolsConnectionManager {
  constructor() {
    this.connections = new Set();
  }

  add(port) {
    if (!port || !port.name) return;
    this.connections.add(port);
    
    // Set up disconnect handler
    port.onDisconnect.addListener(() => {
      this.connections.delete(port);
    });
  }

  broadcast(message) {
    if (this.connections.size === 0) {
      try {
        chrome.runtime.sendMessage(message).catch(() => {
          // Expected error when no listeners
        });
      } catch (e) {
        // Silently fail
      }
      return;
    }
    
    // Send to all connected DevTools panels
    for (const port of this.connections) {
      try {
        port.postMessage(message);
      } catch (e) {
        // Remove bad connection
        this.connections.delete(port);
      }
    }
  }
}

const devToolsManager = new DevToolsConnectionManager();

// Utility functions
const utils = {
  // Get default paths for monitoring
  getDefaultPaths() {
    return [
      'eventType',
      'web.webPageDetails.URL',
      'web.webInteraction.name',
      'web.webInteraction.region'
    ];
  },
  
  // Path sanitization - consistently applied
  sanitizeTargetPaths(paths) {
    if (!Array.isArray(paths)) {
      return this.getDefaultPaths();
    }

    // List of bad path prefixes to filter out
    const badPrefixes = [
      '_experience.analytics',
      '_intelcorp',
      'meta.state',
      'timestamp'
    ];
    
    // Default good paths we always want
    const defaultPaths = this.getDefaultPaths();
    
    // Filter out bad paths
    const cleanPaths = paths.filter(path => 
      !badPrefixes.some(prefix => path.includes(prefix))
    );
    
    // Combine with defaults and deduplicate
    return [...new Set([...defaultPaths, ...cleanPaths])];
  },
  
  // Reliable property access with path notation
  getNestedProperty(obj, path) {
    if (!obj || !path) return undefined;
    try {
      const keys = path.split('.');
      return keys.reduce((acc, key) => (acc && acc[key] !== undefined) ? acc[key] : undefined, obj);
    } catch (e) {
      return undefined;
    }
  },
  
  // Better JSON parsing with error protection
  safeParseJson(str) {
    if (!str || typeof str !== 'string') return null;
    try {
      return JSON.parse(str);
    } catch (e) {
      console.error("Error parsing JSON:", e, str.substring(0, 100));
      return null;
    }
  },
  
  // URL validation for Adobe SDK requests
  isAdobeWebSdkUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return url.includes('/ee/') && 
           url.includes('configId=') && 
           url.includes('requestId=');
  },
  
  // Request type determination
  getRequestType(url, reqType) {
    if (!url || !reqType) return 'unknown';
    if (reqType === 'fetch' || url.includes('fetch')) {
      return 'fetch';
    }
    return reqType;
  },
  
  // Debug logging helper
  debugLog(...args) {
    if (state.debugMode) {
      console.log('[Adobe SDK Inspector]', ...args);
    }
  }
};

// State management
const stateManager = {
  // Load state from storage
  init() {
    return new Promise(resolve => {
      chrome.storage.local.get(['isListening', 'targetPaths', 'debugMode'], (result) => {
        if (result.isListening !== undefined) {
          state.isListening = !!result.isListening;
        }
        
        if (result.debugMode !== undefined) {
          state.debugMode = !!result.debugMode;
        }
        
        // Always sanitize the paths when loading from storage
        if (result.targetPaths && Array.isArray(result.targetPaths)) {
          state.targetPaths = utils.sanitizeTargetPaths(result.targetPaths);
          // Save the sanitized paths back to storage
          this.savePaths(state.targetPaths);
        } else {
          // Use defaults if no paths in storage
          state.targetPaths = utils.getDefaultPaths();
          this.savePaths(state.targetPaths);
        }
        
        utils.debugLog("State initialized:", state);
        resolve(state);
      });
    });
  },
  
  // Update listening state
  setListening(value) {
    state.isListening = !!value;
    chrome.storage.local.set({ isListening: state.isListening });
    utils.debugLog("Listening state changed:", state.isListening);
    return state.isListening;
  },
  
  // Update debug mode
  setDebugMode(value) {
    state.debugMode = !!value;
    chrome.storage.local.set({ debugMode: state.debugMode });
    utils.debugLog("Debug mode changed:", state.debugMode);
    return state.debugMode;
  },
  
  // Update and sanitize paths
  savePaths(paths) {
    const sanitized = utils.sanitizeTargetPaths(paths);
    state.targetPaths = sanitized;
    chrome.storage.local.set({ targetPaths: sanitized });
    utils.debugLog("Paths updated:", sanitized);
    return sanitized;
  },
  
  // Get current state for API consumers
  getState() {
    // Ensure paths are always sanitized
    state.targetPaths = utils.sanitizeTargetPaths(state.targetPaths);
    return { ...state }; // Return copy to prevent mutation
  }
};

// Request processing logic
const requestProcessor = {
  processRequestData(requestData, url, requestInfo = {}) {
    try {
      state.requestCounter++;
      utils.debugLog("Processing request data:", url, "Counter:", state.requestCounter);
      
      const jsonData = utils.safeParseJson(requestData);
      if (!jsonData) {
        utils.debugLog("Failed to parse JSON from request data");
        return;
      }
      
      // Process different data structures appropriately
      if (jsonData.events && Array.isArray(jsonData.events)) {
        utils.debugLog("Processing event data");
        this.processEventData(jsonData, url, requestInfo);
      } else if (jsonData.meta || jsonData.requestId) {
        utils.debugLog("Processing metadata");
        this.processMetadata(jsonData, url, requestInfo);
      }
    } catch (error) {
      utils.debugLog("Error processing request data:", error);
    }
  },
  
  processEventData(jsonData, url, requestInfo) {
    const results = {};
    let hasMatches = false;
    
    // Get the first event's XDM data
    if (!jsonData.events[0]) {
      utils.debugLog("No events found in data");
      return;
    }
    
    const event = jsonData.events[0];
    const targetObject = event.xdm || event;
    
    utils.debugLog("Processing event:", targetObject.eventType || "unknown");
    
    // Add eventType as a standard field if not already specified
    if (!state.targetPaths.includes('eventType') && targetObject.eventType) {
      results['eventType'] = targetObject.eventType;
      hasMatches = true;
    }
    
    // Extract all specified target paths
    state.targetPaths.forEach(path => {
      const value = utils.getNestedProperty(targetObject, path);
      if (value !== undefined) {
        results[path] = value;
        hasMatches = true;
        utils.debugLog(`Found match for path ${path}:`, value);
      }
    });
    
    // Send results if matches found
    if (hasMatches) {
      utils.debugLog("Sending results for event data");
      this.sendResults(results, url, requestInfo, targetObject);
    } else {
      utils.debugLog("No matches found in event data");
    }
  },
  
  processMetadata(jsonData, url, requestInfo) {
    const results = {};
    let hasMatches = false;
    
    // Try to find matches in top-level objects
    state.targetPaths.forEach(path => {
      const value = utils.getNestedProperty(jsonData, path);
      if (value !== undefined) {
        results[path] = value;
        hasMatches = true;
        utils.debugLog(`Found match for path ${path} in metadata:`, value);
      }
    });
    
    // Send results if matches found
    if (hasMatches) {
      utils.debugLog("Sending results for metadata");
      this.sendResults(results, url, requestInfo, jsonData);
    } else {
      utils.debugLog("No matches found in metadata");
    }
  },
  
  sendResults(results, url, requestInfo, fullXdm) {
    // Prepare request info with response (if available)
    const completeRequestInfo = {
      method: requestInfo.method,
      type: requestInfo.type,
      statusCode: requestInfo.statusCode,
      response: requestInfo.response
    };
    
    // Prepare message for both content script and DevTools
    const message = {
      action: 'displayResults',
      results,
      url,
      requestInfo: completeRequestInfo,
      fullXdm
    };
    
    utils.debugLog("Prepared message for broadcast:", 
      JSON.stringify({ 
        action: message.action, 
        resultKeys: Object.keys(results),
        url: url
      })
    );
    
    // Send to content script in active tab
    this.sendToContentScript(message);
    
    // Send to DevTools panels
    devToolsManager.broadcast(message);
  },
  
  sendToContentScript(message) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs.length > 0 && tabs[0]?.id) {
          utils.debugLog("Sending to content script in tab:", tabs[0].id);
          
          chrome.tabs.sendMessage(tabs[0].id, message)
            .then(() => {
              utils.debugLog("Message sent to content script successfully");
            })
            .catch((error) => {
              utils.debugLog("Error sending message to content script:", error);
            });
        } else {
          utils.debugLog("No active tab found to send message to");
        }
      });
    } catch (e) {
      utils.debugLog("Exception in sendToContentScript:", e);
    }
  }
};

// Initialize extension on install
chrome.runtime.onInstalled.addListener(() => {
  // Set default state
  chrome.storage.local.set({ 
    targetPaths: utils.getDefaultPaths(),
    extensionVersion: '1.0.4',
    isListening: true // Set to true by default for better user experience
  });
  utils.debugLog("Extension installed, default state set");
});

// Initialize state from storage
stateManager.init();

// Track connections from DevTools panels
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'devtools-panel') {
    utils.debugLog("DevTools panel connected");
    devToolsManager.add(port);
    
    // Listen for messages from this DevTools panel
    port.onMessage.addListener((message) => {
      utils.debugLog("Message from DevTools panel:", message);
      // Handle messages as needed
    });
  }
});

// Handle extension messaging
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (!message || !message.action) {
      sendResponse({ status: 'error', message: 'Invalid message format' });
      return true;
    }
    
    utils.debugLog("Message received:", message.action);
    
    switch (message.action) {
      case 'toggleListening':
        stateManager.setListening(message.value);
        sendResponse({ status: 'success' });
        break;
        
      case 'updatePaths':
        const sanitizedPaths = stateManager.savePaths(message.paths);
        sendResponse({ status: 'success', sanitizedPaths });
        break;
        
      case 'getStatus':
        sendResponse(stateManager.getState());
        break;
        
      case 'toggleDebug':
        stateManager.setDebugMode(message.value);
        sendResponse({ status: 'success' });
        break;
        
      case 'devtools-init':
        utils.debugLog("DevTools initialized");
        sendResponse({ status: 'success' });
        break;
        
      default:
        sendResponse({ status: 'error', message: 'Unknown action' });
    }
  } catch (error) {
    utils.debugLog("Error handling message:", error);
    sendResponse({ status: 'error', message: error.message });
  }
  
  return true; // Indicate async response
});

// Network request monitoring
const setupNetworkListeners = () => {
  utils.debugLog("Setting up network listeners");
  
  // Listen for request headers being sent
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      if (!state.isListening) return { cancel: false };
      
      // Quick validation to reduce processing overhead
      if (!utils.isAdobeWebSdkUrl(details.url)) return { cancel: false };
      
      utils.debugLog("Detected Adobe SDK request (onBeforeSendHeaders):", details.url);
      
      // Additional processing can go here if needed
      return { cancel: false };
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders"]
  );

  // Listen for request data being sent
  chrome.webRequest.onSendHeaders.addListener(
    (details) => {
      if (!state.isListening) return { cancel: false };
      
      // Quick validation to reduce processing overhead
      if (!utils.isAdobeWebSdkUrl(details.url)) return { cancel: false };
      
      utils.debugLog("Storing request info in cache (onSendHeaders):", details.requestId);
      
      // Store request in cache for later correlation
      requestCache.set(details.requestId, {
        url: details.url,
        method: details.method,
        type: details.type,
        timestamp: Date.now(),
        requestId: details.requestId
      });
      
      return { cancel: false };
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders"]
  );

  // Capture request data for processing
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!state.isListening) return { cancel: false };
      
      // Quick validation to reduce processing overhead
      if (!utils.isAdobeWebSdkUrl(details.url)) return { cancel: false };
      
      utils.debugLog("Examining request (onBeforeRequest):", details.url);
      
      // Only process POST requests with request bodies
      if (details.method === 'POST' && details.requestBody) {
        utils.debugLog("Processing POST request body");
        
        let requestData = '';
        if (details.requestBody.raw && details.requestBody.raw.length > 0) {
          try {
            // Convert raw bytes to string
            const rawBytes = new Uint8Array(details.requestBody.raw[0].bytes);
            requestData = decodeURIComponent(String.fromCharCode.apply(null, rawBytes));
            utils.debugLog("Request data extracted, length:", requestData.length);
          } catch (e) {
            utils.debugLog("Error extracting request data:", e);
          }
        } else if (details.requestBody.formData) {
          // For form data payloads
          utils.debugLog("Form data detected");
          try {
            requestData = JSON.stringify(details.requestBody.formData);
          } catch (e) {
            utils.debugLog("Error stringifying form data:", e);
          }
        }
        
        if (requestData) {
          // Get cached request info
          const requestInfo = requestCache.get(details.requestId) || { 
            url: details.url,
            method: details.method,
            type: details.type,
            requestId: details.requestId
          };
          
          // Process the data
          requestProcessor.processRequestData(requestData, details.url, requestInfo);
        } else {
          utils.debugLog("No request data found");
        }
      }
      
      return { cancel: false };
    },
    { urls: ["<all_urls>"] },
    ["requestBody"]
  );

  // Capture response data
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (!state.isListening) return { cancel: false };
      
      // Quick validation to reduce processing overhead
      if (!utils.isAdobeWebSdkUrl(details.url)) return { cancel: false };
      
      utils.debugLog("Received response headers:", details.statusCode);
      
      // Update cached request with status code
      const requestInfo = requestCache.get(details.requestId);
      if (requestInfo) {
        requestInfo.statusCode = details.statusCode;
        requestCache.set(details.requestId, requestInfo);
      }
      
      return { cancel: false };
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
  );
  
  // Handle completed requests
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (!state.isListening) return;
      
      // Quick validation to reduce processing overhead
      if (!utils.isAdobeWebSdkUrl(details.url)) return;
      
      utils.debugLog("Request completed:", details.url);
      
      // If we have this request in our cache, we've already processed it
      // Just update the status code if needed
      const requestInfo = requestCache.get(details.requestId);
      if (requestInfo) {
        requestInfo.statusCode = details.statusCode;
        requestCache.set(details.requestId, requestInfo);
      }
    },
    { urls: ["<all_urls>"] }
  );
};

// Clean up expired requests every minute
setInterval(() => {
  const now = Date.now();
  const expiredRequests = [];
  
  requestCache.cache.forEach((value, key) => {
    if (now - value.timestamp > 5 * 60 * 1000) { // 5 minutes
      expiredRequests.push(key);
    }
  });
  
  expiredRequests.forEach(key => requestCache.delete(key));
  
  if (expiredRequests.length > 0 && state.debugMode) {
    utils.debugLog(`Cleaned up ${expiredRequests.length} expired requests`);
  }
}, 60 * 1000);

// Initialize network listeners
setupNetworkListeners();

// Announce that we're ready to go
utils.debugLog("Adobe Web SDK Inspector background script initialized"); 