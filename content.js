// Content script for Adobe Web SDK Inspector

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.action === 'displayResults' && message.results) {
      displayResults(message.results, message.url, message.requestInfo, message.fullXdm);
    }
  } catch (e) {
    console.error('Error handling message in content script:', e);
  }
  return false; // No async response needed
});

// Function to display results in the console
function displayResults(results, url, requestInfo = {}, fullXdm = null) {
  let eventTypeValue = "unknown";
  
  // Check if eventType is available in results
  for (const key in results) {
    if (key === 'eventType') {
      eventTypeValue = results[key];
      break;
    }
  }
  
  try {
    // Display results in the console
    console.group(
      `%c🕵🏻‍♂️ ${eventTypeValue} || AEP Web SDK 🕵🏻‍♂️`, 
      `color: #f00; font-weight: bold; font-size: 14px; background-color: #000; padding: 2px 6px; border-radius: 4px;`
    );
    
    // Create a new object with only the simple values for the table
    const tableResults = {};
    const complexResults = {};
    
    // Separate simple and complex values
    for (const key in results) {
      const value = results[key];
      if (value !== null && typeof value === 'object') {
        complexResults[key] = value;
      } else {
        tableResults[key] = value;
      }
    }
    
    // Check if we have simple values to display
    const keys = Object.keys(tableResults);
    if (keys.length > 0) {
      // Just display the standard console table directly
      console.table(tableResults);
    } else {
      console.log('No simple values found');
    }
    
    // Display complex objects in a simplified format
    if (Object.keys(complexResults).length > 0) {
      console.groupCollapsed('Complex Field Details');
      
      for (const key in complexResults) {
        console.log(`${key} details:`, complexResults[key]);
      }
      
      console.groupEnd();
    }
    
    // Display the full XDM object if available
    if (fullXdm) {
      console.groupCollapsed('Full XDM Object');
      console.log(fullXdm);
      console.groupEnd();
    }
    
    console.groupEnd();
  } catch (error) {
    console.error('Error displaying results:', error);
  }
}

// Initialize content script
(function() {
  console.log(
    '%cAdobe Web SDK Inspector activated',
    'color: #2196F3; font-weight: bold; background-color: #E3F2FD; padding: 4px 8px; border-radius: 4px;'
  );
})(); 