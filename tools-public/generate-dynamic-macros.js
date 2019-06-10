'use strict';

const _ = require('lodash');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const process = require('process');
const { mkdir } = require('shelljs');
const { IosPlist, IosPodsTools, ExponentTools, UrlUtils, Project, Modules } = require('@expo/xdl');
const JsonFile = require('@expo/json-file').default;
const spawnAsync = require('@exponent/spawn-async');
const request = require('request-promise-native').defaults({
  resolveWithFullResponse: true,
});
const ip = require('ip');
const uuidv4 = require('uuid/v4');

const { renderExpoKitPodspecAsync, renderPodfileAsync } = IosPodsTools;

const ProjectVersions = require('./project-versions');

const EXPONENT_DIR = process.env.EXPONENT_DIR || path.join(__dirname, '..');

const { exp: { sdkVersion } } = require('../package.json');

const EXPO_CLIENT_UNIVERSAL_MODULES = Modules.getAllNativeForExpoClientOnPlatform('ios', sdkVersion);

// We need these permissions when testing but don't want them
// ending up in our release.
const ANDROID_TEST_PERMISSIONS = `
  <uses-permission android:name="android.permission.WRITE_CONTACTS" />
`;

// some files are absent on turtle builders and we don't want log errors there
const isTurtle = !!process.env.TURTLE_WORKING_DIR_PATH;

// function generateUniversalModuleConfig(moduleInfo, modulesPath) {
//   const requiredProperties = ['podName', 'libName', 'subdirectory'];

//   requiredProperties.forEach(propName => {
//     if (!moduleInfo[propName]) {
//       throw new Error(
//         `Module info object provided to \`generateUniversalModuleConfig\` is invalid.\nExpected it to have properties ${JSON.stringify(
//           requiredProperties
//         )}, object provided:\n${JSON.stringify(moduleInfo, null, 2)}`
//       );
//     }
//   });
//   return {
//     ...moduleInfo,
//     path: path.join(modulesPath, moduleInfo.libName, moduleInfo.subdirectory),
//   };
// }

function generateUniversalModulesConfig(universalModules, modulesPath) {
  return universalModules
    .filter(moduleInfo => moduleInfo.isNativeModule)
    .map(moduleInfo => generateUniversalModuleConfig(moduleInfo, modulesPath));
}

/**
 *  args:
 *    platform (ios|android)
 *    buildConstantsPath
 *  ios-only:
 *    configuration - optional but we behave differently if this is Debug
 *    infoPlistPath
 *    expoKitPath (optional - if provided, generate files for ExpoKit)
 */
exports.generateDynamicMacrosAsync = async function generateDynamicMacrosAsync(args) {
  try {
    const { platform } = args;
    const templateSubstitutions = await getTemplateSubstitutions();
    if (platform === 'ios') {
      const infoPlistPath = args.infoPlistPath;
      args.infoPlist = await modifyIOSInfoPlistAsync(infoPlistPath, 'Info', templateSubstitutions);
      args.templateSubstitutions = templateSubstitutions;
    } else {
      args.configuration =
        process.env.EXPO_ANDROID_GRADLE_TASK_NAMES &&
        process.env.EXPO_ANDROID_GRADLE_TASK_NAMES.includes('Debug')
          ? 'debug'
          : 'release';
    }

    await generateBuildConfigAsync(platform, args);
    await copyTemplateFilesAsync(platform, args, templateSubstitutions);
  } catch (error) {
    console.error(
      `There was an error while generating Expo template files, which could lead to unexpected behavior at runtime:\n${
        error.stack
      }`
    );
    process.exit(1);
  }
};
