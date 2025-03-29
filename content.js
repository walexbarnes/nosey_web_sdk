// Content script for Adobe Web SDK Inspector

/**
 * Main module for handling Adobe Web SDK Inspector content script features
 * Responsible for displaying intercepted Adobe Web SDK events in the console
 */
(function AdobeSDKInspector() {
  // Module configuration
  const config = {
    // Styling for the main header
    headerStyle: 'color: #f00; font-weight: bold; font-size: 14px; background-color: #000; padding: 2px 6px; border-radius: 4px;',
    
    // Initialization message styling
    initMessageStyle: 'color: #2196F3; font-weight: bold; background-color: #E3F2FD; padding: 4px 8px; border-radius: 4px;',
    
    // Debug mode (can be changed by the background script)
    debugMode: false
  };
  
  /**
   * Debug logging helper
   * @param {...any} args - Arguments to log
   */
  function debugLog(...args) {
    if (config.debugMode) {
      console.log('[Adobe SDK Inspector Content]', ...args);
    }
  }
  
  /**
   * Process and display Adobe Web SDK event data in the console
   * @param {Object} results - The extracted data fields
   * @param {string} url - The request URL
   * @param {Object} requestInfo - Information about the request
   * @param {Object} fullXdm - The complete XDM object
   */
  function displayResults(results, url, requestInfo = {}, fullXdm = null) {
    if (!results) {
      debugLog("Received empty results");
      return;
    }
    
    debugLog("Displaying results:", Object.keys(results));
    
    try {
      // Extract the event type from results or use default
      const eventTypeValue = extractEventType(results);
      
      // Begin a console group with the event type header
      console.group(
        `%c🕵🏻‍♂️ ${eventTypeValue} || AEP Web SDK 🕵🏻‍♂️`, 
        config.headerStyle
      );
      
      // Split results into simple and complex values
      const { simpleValues, complexValues } = categorizeResults(results);
      
      // Display simple values in a table
      displaySimpleValues(simpleValues);
      
      // Optionally display complex objects
      if (Object.keys(complexValues).length > 0) {
        displayComplexValues(complexValues);
      }
      
      // Optionally display the full XDM object
      if (fullXdm) {
        displayFullXdm(fullXdm);
      }
      
      // End the console group
      console.groupEnd();
    } catch (error) {
      console.error('Error displaying results:', error);
      debugLog("Error stack:", error.stack);
    }
  }
  
  /**
   * Extract the event type value from the results
   * @param {Object} results - The extracted data fields
   * @returns {string} The event type or "unknown"
   */
  function extractEventType(results) {
    for (const key in results) {
      if (key === 'eventType') {
        return results[key];
      }
    }
    return "unknown";
  }
  
  /**
   * Categorize results into simple and complex values
   * @param {Object} results - The extracted data fields
   * @returns {Object} Object containing simpleValues and complexValues
   */
  function categorizeResults(results) {
    const simpleValues = {};
    const complexValues = {};
    
    for (const key in results) {
      const value = results[key];
      if (value !== null && typeof value === 'object') {
        complexValues[key] = value;
      } else {
        simpleValues[key] = value;
      }
    }
    
    return { simpleValues, complexValues };
  }
  
  /**
   * Display simple values in a standard console table
   * @param {Object} simpleValues - Object containing simple key-value pairs
   */
  function displaySimpleValues(simpleValues) {
    const keys = Object.keys(simpleValues);
    if (keys.length > 0) {
      // Display results in a standard table format
      console.table(simpleValues);
    } else {
      console.log('No simple values found');
    }
  }
  
  /**
   * Display complex objects in a collapsible group
   * @param {Object} complexValues - Object containing complex values
   */
  function displayComplexValues(complexValues) {
    console.groupCollapsed('Complex Field Details');
    
    for (const key in complexValues) {
      console.log(`${key} details:`, complexValues[key]);
    }
    
    console.groupEnd();
  }
  
  /**
   * Display the full XDM object in a collapsible group
   * @param {Object} fullXdm - The complete XDM object
   */
  function displayFullXdm(fullXdm) {
    console.groupCollapsed('Full XDM Object');
    console.log(fullXdm);
    console.groupEnd();
  }
  
  /**
   * Handle message from background script
   * @param {Object} message - The message object
   * @param {Object} sender - The sender information
   * @param {Function} sendResponse - Function to send response
   * @returns {boolean} Whether to keep the message channel open
   */
  function handleMessage(message, sender, sendResponse) {
    try {
      debugLog("Message received:", message?.action);
      
      if (!message || !message.action) {
        debugLog("Invalid message format");
        return false;
      }
      
      if (message.action === 'displayResults' && message.results) {
        debugLog(`Displaying results with ${Object.keys(message.results).length} fields`);
        displayResults(message.results, message.url, message.requestInfo, message.fullXdm);
        
        // Send an acknowledgment back
        if (sendResponse) {
          sendResponse({ status: 'success' });
        }
      } else if (message.action === 'updateDebug') {
        // Update debug mode if requested
        config.debugMode = !!message.value;
        debugLog("Debug mode updated:", config.debugMode);
        
        if (sendResponse) {
          sendResponse({ status: 'success' });
        }
      }
    } catch (e) {
      console.error('Error handling message in content script:', e);
      debugLog("Error stack:", e.stack);
      
      if (sendResponse) {
        sendResponse({ status: 'error', message: e.message });
      }
    }
    
    return true; // Keep the message channel open for async response
  }
  
  /**
   * Initialize the content script
   */
  function init() {
    // Get debug mode from storage
    try {
      chrome.storage.local.get(['debugMode'], (result) => {
        if (result.debugMode !== undefined) {
          config.debugMode = !!result.debugMode;
          debugLog("Debug mode initialized:", config.debugMode);
        }
      });
    } catch (e) {
      console.error("Error getting debug mode from storage:", e);
    }
    
    // Register message listener
    try {
      chrome.runtime.onMessage.addListener(handleMessage);
      debugLog("Message listener registered");
    } catch (e) {
      console.error("Error registering message listener:", e);
    }
    
    // Display initialization message
    console.log(
      '%cAdobe Web SDK Inspector activated',
      config.initMessageStyle
    );
    
    // Always display a confirmation message
    console.log('Adobe Web SDK Inspector is listening for network requests. Toggle the extension icon to enable/disable.');
    
    // Ping background script to ensure connection is established
    try {
      chrome.runtime.sendMessage({ action: 'contentScriptReady' }, (response) => {
        if (response) {
          debugLog("Background script connection established:", response);
        }
      });
    } catch (e) {
      console.error("Error pinging background script:", e);
    }
  }
  
  // Initialize the module
  init();
})(); 