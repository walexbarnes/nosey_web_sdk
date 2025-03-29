// Create a panel in DevTools
chrome.devtools.panels.create(
  "Adobe SDK",
  null,  // No icon path
  "panel.html",
  (panel) => {
    console.log("Adobe Web SDK Inspector panel created");
  }
); 