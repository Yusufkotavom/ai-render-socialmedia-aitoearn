import React, { useEffect, ... } from 'react';

// ... rest of the component code

useEffect(() => {
  const { groqApiKey, geminiApiKey } = storeKeys; // Assuming 'storeKeys' contains these values
  setGroqApiKey(groqApiKey);
  setGeminiApiKey(geminiApiKey);
}, [storeKeys]);
// Dependencies array to watch for changes in storeKeys