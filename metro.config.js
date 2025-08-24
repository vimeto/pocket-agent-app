const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add FlashList to the list of packages that Metro should resolve
config.resolver.assetExts.push('db');

module.exports = config;