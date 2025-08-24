const { withDangerousMod, withPlugins } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function withLlamaRNPodfile(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let podfileContents = fs.readFileSync(podfilePath, 'utf8');
      
      // Add build from source flag
      const marker = "require 'json'";
      const addition = `${marker}\n\nENV['RNLLAMA_BUILD_FROM_SOURCE'] = '1'`;
      
      if (!podfileContents.includes("ENV['RNLLAMA_BUILD_FROM_SOURCE']")) {
        podfileContents = podfileContents.replace(marker, addition);
      }
      
      // Add post_install to exclude arm64 for simulator
      const postInstallHook = `
post_install do |installer|
  installer.pods_project.build_configurations.each do |config|
    config.build_settings['EXCLUDED_ARCHS[sdk=iphonesimulator*]'] = 'arm64'
  end
  
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
    end
  end
end`;
      
      if (!podfileContents.includes('post_install do |installer|')) {
        podfileContents += postInstallHook;
      }
      
      fs.writeFileSync(podfilePath, podfileContents);
      return config;
    },
  ]);
}

module.exports = (config) => withPlugins(config, [withLlamaRNPodfile]);