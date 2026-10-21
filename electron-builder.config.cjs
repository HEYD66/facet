'use strict';
module.exports={
 appId:'Facet.MultiInstanceBrowser',
 productName:'千面 Facet',
 executableName:'Facet',
 directories:{output:'release',buildResources:'resources'},
 files:['src/**/*','!src/main/subscription-proxy.cjs','package.json','LICENSE','README.md'],
 extraResources:[
  {from:'AGENTS.md',to:'AGENTS.md'},
  {from:'README.md',to:'README.md'},
  {from:'docs',to:'docs',filter:['README.md','AI-AGENT.md','AI-CONTROL-HANDOFF.md','CONTROL-API.md','PROJECT.md','CURRENT-SCOPE.md','RUNTIME-SECURITY.md','DIAGNOSTICS.md','EXTENSION-COMPATIBILITY.md','EXTENSIONS.md','FINGERPRINT-CATALOG.md','APPEARANCE.md','QUICK-LINKS.md','VIEWPORT-IP-BOOKMARKS.md','MEMORY-PERFORMANCE.md','UNIFIED-FAVORITES.md','RESET-ENVIRONMENT.md','releases/v0.2.18.md']},
  {from:'resources/mihomo',to:'mihomo',filter:['mihomo.exe','LICENSE','ARTIFACT.json','mihomo-source.tar.gz']},
  {from:'resources/process-host',to:'process-host',filter:['facet-process-host.exe','manifest.json','ProcessHost.cs']},
  {from:'resources/environment-pipe',to:'environment-pipe',filter:['environment-pipe.node','environment-pipe.cc','manifest.json']},
  {from:'resources/facet.ico',to:'facet.ico'},
  {from:'resources/facet.png',to:'facet.png'}
 ],
 asar:true,
 npmRebuild:false,
 win:{target:[{target:'nsis',arch:['x64']}],icon:'resources/facet.ico'},
 nsis:{
  oneClick:false,
  perMachine:false,
  allowElevation:false,
  allowToChangeInstallationDirectory:true,
  createDesktopShortcut:true,
  createStartMenuShortcut:true,
  shortcutName:'千面 Facet',
  runAfterFinish:false,
  deleteAppDataOnUninstall:false,
  installerLanguages:['zh_CN','en_US'],
  language:'2052',
  license:'LICENSE',
  include:'build/installer.nsh',
  artifactName:'Facet-Setup-${version}-${arch}.${ext}'
 },
 publish:[{provider:'github',owner:'HEYD66',repo:'facet',releaseType:'release'}]
};
