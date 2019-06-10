import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import JsonFile from '@expo/json-file';

import macros from './macros';
import { Directories } from '../expotools';

import IosMacrosGenerator from './IosMacrosGenerator';
import AndroidMacrosGenerator from './AndroidMacrosGenerator';

const EXPO_DIR = Directories.getExpoRepositoryRootDir();

async function getTemplateSubstitutionsFromSecrets() {
  try {
    return await new JsonFile(path.join(EXPO_DIR, 'secrets', 'keys.json')).readAsync();
  } catch (e) {
    // Don't have access to decrypted secrets, use public keys
    console.log('You don\'t have access to decrypted secrets. Falling back to `template-files/keys.json`.');
    return await new JsonFile(path.join(EXPO_DIR, 'template-files', 'keys.json')).readAsync();
  }
}

async function getTemplateSubstitutions() {
  const defaultKeys = await getTemplateSubstitutionsFromSecrets();

  try {
    // Keys from secrets/template-files can be overwritten by private-keys.json file.
    const privateKeys = await new JsonFile(path.join(EXPO_DIR, 'private-keys.json')).readAsync();
    return { ...defaultKeys, ...privateKeys };
  } catch (error) {
    return defaultKeys;
  }
}

async function generateMacrosAsync(platform, configuration) {
  const macrosObject = {};

  console.log('Resolving macros...');

  for (const [name, func] of Object.entries(macros)) {
    // @ts-ignore
    const macroValue = await func.call(macros, platform, configuration);

    macrosObject[name] = macroValue;

    console.log(
      'Resolved %s macro to %s',
      chalk.green(name),
      chalk.yellow(JSON.stringify(macroValue)),
    );
  }
  console.log();
  return macrosObject;
}

// async function generateBuildConfigAsync(platform, args) {
//   const filepath = path.resolve(args.buildConstantsPath);
//   const { configuration } = args;

//   mkdir('-p', path.dirname(filepath));

//   const macros = await generateMacrosAsync(platform, configuration);

//   console.log(
//     'Generating build config %s...',
//     chalk.cyan(path.relative(EXPO_DIR, filepath))
//   );

//   if (platform === 'android') {
//     const [source, existingSource] = await Promise.all([
//       generateAndroidBuildConstantsFromMacrosAsync(macros),
//       readExistingSourceAsync(filepath),
//     ]);

//     if (source !== existingSource) {
//       await fs.writeFile(filepath, source, 'utf8');
//     }
//   } else {
//     // await generateIOSBuildConstantsFromMacrosAsync(
//     //   filepath,
//     //   macros,
//     //   configuration,
//     //   args.infoPlist,
//     //   args.templateSubstitutions
//     // );
//   }
// }

function getMacrosGeneratorForPlatform(platform) {
  if (platform === 'ios') {
    return new IosMacrosGenerator();
  }
  if (platform === 'android') {
    return new AndroidMacrosGenerator();
  }
  throw new Error(`Platform '${platform}' is not supported.`);
}

async function generateDynamicMacrosAsync(args) {
  try {
    const { platform } = args;
    const templateSubstitutions = await getTemplateSubstitutions();

    if (platform === 'ios') {
      // args.infoPlist = await modifyIOSInfoPlistAsync(infoPlistPath, 'Info', templateSubstitutions);
      // args.templateSubstitutions = templateSubstitutions;
    } else {
      const { EXPO_ANDROID_GRADLE_TASK_NAMES } = process.env;
      args.configuration = (EXPO_ANDROID_GRADLE_TASK_NAMES || []).includes('Debug') ? 'debug' : 'release';
    }

    const macros = await generateMacrosAsync(platform, args.configuration);
    const macrosGenerator = getMacrosGeneratorForPlatform(platform);

    // await generateBuildConfigAsync(platform, args);

    await macrosGenerator.generateAsync({ ...args, macros, templateSubstitutions });

    // Copy template files - it is platform-agnostic.
    await copyTemplateFilesAsync(platform, args, templateSubstitutions);

  } catch (error) {
    console.error(
      `There was an error while generating Expo template files, which could lead to unexpected behavior at runtime:\n${
        error.stack
      }`
    );
    process.exit(1);
  }
}

async function cleanupDynamicMacrosAsync(args) {
  try {
    const macrosGenerator = getMacrosGeneratorForPlatform(args.platform);
    await macrosGenerator.cleanupAsync(args);
  } catch (error) {
    console.error(`There was an error cleaning up Expo template files:\n${error.stack}`);
    process.exit(1);
  }
}

async function readExistingSourceAsync(filepath) {
  try {
    return await fs.readFile(filepath, 'utf8');
  } catch (e) {
    return null;
  }
}

async function copyTemplateFileAsync(source, dest, templateSubstitutions, configuration): Promise<void> {
  let [currentSourceFile, currentDestFile] = await Promise.all([
    readExistingSourceAsync(source),
    readExistingSourceAsync(dest),
  ]);

  for (const [textToReplace, value] of Object.entries(templateSubstitutions)) {
    currentSourceFile = currentSourceFile.replace(
      new RegExp(`\\$\\{${textToReplace}\\}`, 'g'),
      value
    );
  }

  if (configuration === 'debug') {
    // We need these permissions when testing but don't want them
    // ending up in our release.
    currentSourceFile = currentSourceFile.replace(
      `<!-- ADD TEST PERMISSIONS HERE -->`,
      `<uses-permission android:name="android.permission.WRITE_CONTACTS" />`,
    );
  }

  if (currentSourceFile !== currentDestFile) {
    await fs.writeFile(dest, currentSourceFile, 'utf8');
  }
}

async function copyTemplateFilesAsync(platform, args, templateSubstitutions) {
  const templateFilesPath = args.templateFilesPath || path.join(EXPO_DIR, 'template-files');
  const templatePaths = await new JsonFile(path.join(templateFilesPath, `${platform}-paths.json`)).readAsync();
  const promises: Promise<any>[] = [];

  for (const [source, dest] of Object.entries(templatePaths)) {
    promises.push(
      copyTemplateFileAsync(
        path.join(templateFilesPath, platform, source),
        path.join(EXPO_DIR, dest as string, source),
        templateSubstitutions,
        args.configuration,
      )
    );
  }

  await Promise.all(promises);
}

export {
  generateDynamicMacrosAsync,
  cleanupDynamicMacrosAsync,
  getTemplateSubstitutions,
};
