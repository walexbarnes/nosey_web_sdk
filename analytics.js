// Analytics helper for Adobe Web SDK Inspector
// Uses GA4 direct collection endpoint without requiring API secret

// GA4 Configuration
const GA4_MEASUREMENT_ID = 'G-3QEYQTJLJG';

// Generate or retrieve persistent client ID
function getClientId() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['ga4_client_id'], (result) => {
      if (result.ga4_client_id) {
        resolve(result.ga4_client_id);
      } else {
        // Format: randomNumbers(10).unixTimeStamp() as recommended by GA4
        const randomNum = Math.floor(Math.random() * 9000000000) + 1000000000;
        const timestamp = Math.floor(Date.now() / 1000);
        const clientId = `${randomNum}.${timestamp}`;
        chrome.storage.local.set({ ga4_client_id: clientId });
        resolve(clientId);
      }
    });
  });
}

// Get current tab info (hostname, pathname, full URL)
async function getPageInfo() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0 && tabs[0].url) {
      const url = new URL(tabs[0].url);
      return {
        host: url.hostname,
        pathname: url.pathname,
        full_url: url.hostname + url.pathname
      };
    }
  } catch (error) {
    console.error('Error getting page info:', error);
  }
  
  // Default values if tab info can't be retrieved
  return {
    host: 'unknown',
    pathname: 'unknown',
    full_url: 'unknown'
  };
}

// Get or create session ID
let currentSessionId = null;
let lastEventTime = 0;
const SESSION_EXPIRATION_MS = 30 * 60 * 1000; // 30 minutes

function getOrCreateSessionId() {
  const now = Date.now();
  
  // Check if we have a current session that hasn't expired
  if (currentSessionId && (now - lastEventTime < SESSION_EXPIRATION_MS)) {
    lastEventTime = now;
    return currentSessionId;
  }
  
  // Create new session ID (10-digit random number)
  currentSessionId = Math.floor(Math.random() * 9000000000) + 1000000000;
  lastEventTime = now;
  return currentSessionId;
}

// Send event to GA4 using direct collection endpoint
async function sendEvent(eventName, eventParams = {}) {
  try {
    const clientId = await getClientId();
    const pageInfo = await getPageInfo();
    
    // Create URL parameters
    const params = new URLSearchParams({
      v: '2',                                     // GA4 API version
      tid: GA4_MEASUREMENT_ID,                    // Measurement ID
      cid: clientId,                              // Client ID
      _et: 100,                                   // Engagement time (milliseconds)
      en: eventName,                              // Event name
    });
    
    // Add page info parameters
    params.append('ep.host', pageInfo.host);
    params.append('ep.pathname', pageInfo.pathname);
    params.append('ep.full_url', pageInfo.full_url);
    
    // Add custom event parameters
    if (eventParams) {
      // Special handling for items array
      if (eventParams.items && Array.isArray(eventParams.items)) {
        eventParams.items.forEach((item, index) => {
          Object.entries(item).forEach(([itemKey, itemValue]) => {
            params.append(`ep.items${index}.${itemKey}`, String(itemValue));
          });
        });
      } else {
        // Handle other parameters
        Object.entries(eventParams).forEach(([key, value]) => {
          if (key !== 'items') { // Skip items as we handled them specially
            params.append(`ep.${key}`, String(value));
          }
        });
      }
    }
    
    // Prepare the request URL
    const requestUrl = `https://www.google-analytics.com/g/collect?${params.toString()}`;
    
    // Send the request
    const response = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        'User-Agent': navigator.userAgent
      }
    });
    
    if (!response.ok) {
      console.error('Analytics error:', response.status, response.statusText);
    } else {
      console.log('Analytics event sent successfully:', eventName);
    }
    
    return response.ok;
  } catch (error) {
    console.error('Error sending analytics event:', error);
    return false;
  }
}

// Track tool_opn event when popup opens
async function trackToolOpen() {
  return sendEvent('tool_opn');
}

// Track sniff_init event when save button is clicked
async function trackSniffInit(paths) {
  // Format the paths as items
  const items = paths.map(path => ({ name: path }));
  
  return sendEvent('sniff_init', { items });
}

// Export the functions
window.Analytics = {
  trackToolOpen,
  trackSniffInit
}; 