import { GahModuleBase } from './gah-module-base';
import { GahHost, GahModuleData } from '@awdware/gah-shared';
import { GahModuleDef } from './gah-module-def';
import { GahFolder } from './gah-folder';
import { GahAngularCompilerOptions } from '@awdware/gah-shared/lib/models/gah-angular-compiler-options';
import compareVersions from 'compare-versions';

export class GahHostDef extends GahModuleBase {
  private readonly _ngOptions: { aot: boolean } = {} as any;
  private readonly _indexHtmlLines: string[];
  private readonly _baseHref: string;
  private readonly _title: string;
  private readonly _gahCfgFolder: string;
  private readonly _ngCompilerOptions: GahAngularCompilerOptions;

  constructor(gahCfgPath: string, initializedModules: GahModuleBase[]) {
    super(gahCfgPath, null);
    this.isHost = true;
    this._gahCfgFolder = this.fileSystemService.ensureAbsolutePath(this.fileSystemService.getDirectoryPathFromFilePath(gahCfgPath));
    this.basePath = this.fileSystemService.join(this._gahCfgFolder, '.gah');
    this.srcBasePath = './src';

    this.installStepCount = 13;
    this._installDescriptionText = 'Installing host';

    const hostCfg = this.fileSystemService.parseFile<GahHost>(gahCfgPath);
    if (!hostCfg) {
      throw new Error(`Cannot find host in file "${gahCfgPath}"`);
    }
    hostCfg.modules?.forEach(moduleDependency => {
      moduleDependency.names.forEach(depModuleName => {
        const moduleAbsoluteBasepath = this.fileSystemService.join(this.basePath, moduleDependency.path);
        const alreadyInitialized = initializedModules.find(x => x.moduleName === depModuleName);
        if (alreadyInitialized) {
          this.dependencies.push(alreadyInitialized);
        } else {
          if (this.fileSystemService.fileExists(moduleAbsoluteBasepath)) {
            this.dependencies.push(new GahModuleDef(moduleAbsoluteBasepath, depModuleName, initializedModules));
          } else {
            this.loggerService.error(`Module '${depModuleName}' could not be found at '${moduleAbsoluteBasepath}' referenced by '${this.moduleName!}' in '${this.basePath}'`);
            process.exit(1);
          }
        }
      });
    });
    this._ngOptions.aot = hostCfg.aot ?? true; // If not set the default value is true
    this._ngCompilerOptions = hostCfg.angularCompilerOptions ?? {} as GahAngularCompilerOptions;
    this._indexHtmlLines = hostCfg.htmlHeadContent ? (Array.isArray(hostCfg.htmlHeadContent) ? hostCfg.htmlHeadContent : [hostCfg.htmlHeadContent]) : [];
    this._baseHref = hostCfg.baseHref ? hostCfg.baseHref : '/';
    this._title = hostCfg.title ?? '';
    this.gahFolder = new GahFolder(this.basePath, `${this.srcBasePath}/app`, this._gahCfgFolder);
  }

  public specificData(): Partial<GahModuleData> {
    return {
      ngOptions: this._ngOptions
    };
  }

  public async install() {
    if (this.installed) {
      return;
    }
    this.initTsConfigObject();
    this.installed = true;

    this.prog('preinstall scripts');
    await this.executePreinstallScripts();
    this.prog('cleanup');
    this.tsConfigFile.clean();
    this.pluginService.triggerEvent('TS_CONFIG_CLEANED', { module: this.data() });
    this.gahFolder.cleanGeneratedDirectory();
    this.gahFolder.cleanDependencyDirectory();
    this.gahFolder.cleanStylesDirectory();
    this.gahFolder.cleanPrecompiledFolder();
    this.pluginService.triggerEvent('GAH_FOLDER_CLEANED', { module: this.data() });

    this.fileSystemService.deleteFilesInDirectory(this.fileSystemService.join(this.basePath, this.srcBasePath, 'assets'));
    this.fileSystemService.ensureDirectory(this.fileSystemService.join(this.basePath, this.srcBasePath, 'assets'));
    this.fileSystemService.deleteFile(this.fileSystemService.join(this.basePath, this.srcBasePath, 'styles.scss'));
    this.fileSystemService.saveFile(this.fileSystemService.join(this.basePath, this.srcBasePath, 'styles.scss'),
      ''
      + '/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *\n'
      + ' *   Please do not edit this file. Any changes to this file will be overwriten by gah.   *\n'
      + ' *              Check the documentation for how to edit your global styles:              *\n'
      + ' *                          https://github.com/awdware/gah/wiki                          *\n'
      + ' * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */\n');
    this.pluginService.triggerEvent('STYLES_FILE_GENERATED', { module: this.data() });

    this.prog('linking dependencies');
    await this.createSymlinksToDependencies();
    this.pluginService.triggerEvent('SYMLINKS_CREATED', { module: this.data() });

    this.prog('referencing dependencies');
    await this.addDependenciesToTsConfigFile();
    this.prog('adjusting configuration');
    this.setAngularCompilerOptionsInTsConfig();
    this.pluginService.triggerEvent('TS_CONFIG_ADJUSTED', { module: this.data() });
    this.prog('generating template');
    this.generateFromTemplate();
    this.pluginService.triggerEvent('TEMPLATE_GENERATED', { module: this.data() });
    this.prog('linking assets');
    await this.linkAssets();
    this.prog('referencing styles');
    this.pluginService.triggerEvent('ASSETS_COPIED', { module: this.data() });
    this.referenceGlobalStyles();
    this.pluginService.triggerEvent('STYLES_REFERENCED', { module: this.data() });
    this.prog('merging packages');
    this.mergePackageDependencies();
    this.pluginService.triggerEvent('DEPENDENCIES_MERGED', { module: this.data() });
    this.prog('importing styles');
    this.generateStyleImports();
    this.pluginService.triggerEvent('STYLE_IMPORTS_GENERATED', { module: this.data() });
    this.prog('adjusting configurations');
    this.adjustGitignore();
    this.adjustGitignoreForHost();
    this.pluginService.triggerEvent('GITIGNORE_ADJUSTED', { module: this.data() });
    this.adjustAngularJsonConfig();
    this.pluginService.triggerEvent('ANGULAR_JSON_ADJUSTED', { module: this.data() });
    this.adjustIndexHtml();
    this.pluginService.triggerEvent('INDEX_HTML_ADJUSTED', { module: this.data() });

    this.collectModuleScripts();

    this.prog('installing packages');
    await this.installPackages();
    this.pluginService.triggerEvent('PACKAGES_INSTALLED', { module: this.data() });

    this.generateEnvFolderIfNeeded();

    this.prog('postinstall scripts');
    await this.executePostinstallScripts();
  }

  private adjustGitignoreForHost() {
    this.workspaceService.ensureGitIgnoreLine('src/assets/**', 'Ignoring gah generated assets', this.basePath);
  }

  private generateFromTemplate() {
    for (const dep of this.allRecursiveDependencies) {
      this.gahFolder.addGeneratedFileTemplateData(dep.moduleName!, dep.packageName!, dep.isEntry, dep.baseNgModuleName, dep.parentGahModule);
    }
    this.pluginService.triggerEvent('TEMPLATE_DATA_GENERATED', { module: this.data() });

    this.gahFolder.generateFileFromTemplate();
  }


  private async linkAssets() {
    // Bug: Symlinks are not copied to dist folder https://github.com/angular/angular-cli/issues/19086
    // workaround: include symlinked folder directly in assets config in angular json
    const ngJsonPath = this.fileSystemService.join(this.basePath, 'angular.json');
    const ngJson = this.fileSystemService.parseFile<any>(ngJsonPath);
    const assetsArray = ngJson.projects['gah-host'].architect.build.options.assets as string[];

    for (const dep of this.allRecursiveDependencies) {
      if (!dep.assetsFolderRelativeToBasePaths || (Array.isArray(dep.assetsFolderRelativeToBasePaths) && dep.assetsFolderRelativeToBasePaths.length === 0)) {
        continue;
      }
      const assetsFolderRelativeTobasePaths = Array.isArray(dep.assetsFolderRelativeToBasePaths) ? dep.assetsFolderRelativeToBasePaths : [dep.assetsFolderRelativeToBasePaths];

      for (const p of assetsFolderRelativeTobasePaths) {
        const assetsDirectoryPath = this.fileSystemService.join(dep.basePath, p);

        // Linking assets
        if (this.fileSystemService.directoryExists(assetsDirectoryPath)) {
          const hostAssetsFolder = this.fileSystemService.join(this.basePath, this.srcBasePath, 'assets', dep.moduleName!);
          await this.fileSystemService.createDirLink(hostAssetsFolder, assetsDirectoryPath);
        }
      }

      // workaround
      assetsArray.push(`src/assets/${dep.moduleName}`);
    }

    // workaround
    this.fileSystemService.saveObjectToFile(ngJsonPath, ngJson);
  }

  private referenceGlobalStyles() {
    const stylesScss = this.fileSystemService.readFileLineByLine(this.fileSystemService.join(this.basePath, this.srcBasePath, 'styles.scss'));

    for (const dep of this.allRecursiveDependencies) {
      if (!dep.stylesFilePathRelativeToBasePath) {
        continue;
      }
      let finalStyleImportPath: string;
      if (dep.preCompiled) {
        const stylePathRelativeToPackageBase = this.fileSystemService.ensureRelativePath(
          dep.stylesFilePathRelativeToBasePath, this.fileSystemService.getDirectoryPathFromFilePath(dep.srcBasePath), true
        );

        finalStyleImportPath = this.fileSystemService.join(dep.packageName ? `@${dep.packageName}` : '', dep.moduleName!, stylePathRelativeToPackageBase);
      } else {
        const absoluteStylesFilePathOfDep = this.fileSystemService.join(dep.basePath, dep.stylesFilePathRelativeToBasePath);

        // Copying base styles if they exist
        if (this.fileSystemService.fileExists(absoluteStylesFilePathOfDep)) {

          const depAbsoluteSrcFolder = this.fileSystemService.join(dep.basePath, dep.srcBasePath);

          const depStylesPathRelativeToSrcBase = this.fileSystemService.ensureRelativePath(absoluteStylesFilePathOfDep, depAbsoluteSrcFolder, true);
          const dependencyPathRelativeFromSrcBase = this.fileSystemService.ensureRelativePath(this.gahFolder.dependencyPath, this.srcBasePath, true);

          finalStyleImportPath = this.fileSystemService.join(dependencyPathRelativeFromSrcBase, dep.moduleName!, depStylesPathRelativeToSrcBase);
        } else {
          this.loggerService.error(`Could not find styles file "${dep.stylesFilePathRelativeToBasePath}" defined by module "${dep.moduleName}"`);
          process.exit(1);
        }
      }
      stylesScss.push(`@import "${finalStyleImportPath}";`);
    }
    this.fileSystemService.saveFile(this.fileSystemService.join(this.basePath, this.srcBasePath, 'styles.scss'), stylesScss.join('\n'));
  }

  private mergePackageDependencies() {
    const packageJsonPath = this.fileSystemService.join(this.basePath, 'package.json');
    // Get package.json from host
    const hostDeps = this.packageJson.dependencies!;
    const hostDevDeps = this.packageJson.devDependencies!;

    const blocklistPackages = new Array<string>();

    for (const dep of this.allRecursiveDependencies) {
      blocklistPackages.push(`@${dep.packageName}/${dep.moduleName!}`);
    }

    for (const dep of this.allRecursiveDependencies) {
      // Get package.json from module to installed into host
      const externalPackageJson = dep.packageJson;

      // Getting (dev-)dependency objects from host and module
      const externalDeps = externalPackageJson!.dependencies!;
      const externalDevDeps = externalPackageJson!.devDependencies!;

      const deps = Object.keys(externalDeps)
        .filter(x => blocklistPackages.indexOf(x) === - 1)
        .filter(x => dep.excludedPackages.indexOf(x) === -1);
      const devDeps = Object.keys(externalDevDeps)
        .filter(x => dep.excludedPackages.indexOf(x) === -1);

      // Merging module (dev-)dependencies into host
      deps.forEach((d) => {
        const isEntry = dep.isEntry;
        const isNewer = compareVersions(hostDeps[d].replace('~', '').replace('^', ''), externalDeps[d].replace('~', '').replace('^', ''));

        if (!hostDeps[d] || isEntry || (!isEntry && isNewer)) {
          hostDeps[d] = externalDeps[d];
        }
      });
      devDeps.forEach((d) => {
        const isEntry = dep.isEntry;
        const isNewer = !dep.isEntry && compareVersions(hostDevDeps[d].replace('~', '').replace('^', ''), externalDevDeps[d].replace('~', '').replace('^', ''));

        if (!hostDevDeps[d] || isEntry || (!isEntry && isNewer)) {
          hostDevDeps[d] = externalDevDeps[d];
        }
      });

    }

    // Saving the file back into the host package.json
    this.fileSystemService.saveObjectToFile(packageJsonPath, this.packageJson);
  }

  private adjustAngularJsonConfig() {
    const ngJsonPath = this.fileSystemService.join(this.basePath, 'angular.json');
    const ngJson = this.fileSystemService.parseFile<any>(ngJsonPath);
    if (!this._ngOptions.aot) {
      ngJson.projects['gah-host'].architect.build.options.aot = false;

      const configs = ngJson.projects['gah-host'].architect.build.configurations;
      const keys = Object.keys(configs);
      keys.forEach(key => {
        // buildOptimizer is only available when using aot. We have to disable it for all configurations
        if (configs[key].buildOptimizer !== undefined) {
          configs[key].buildOptimizer = false;
        }
      });
    }
    this.fileSystemService.saveObjectToFile(ngJsonPath, ngJson, true);
  }

  private adjustIndexHtml() {
    const indexHtmlPath = this.fileSystemService.join(this.basePath, this.srcBasePath, 'index.html');
    let htmlContent = this.fileSystemService.readFile(indexHtmlPath);

    if (this._indexHtmlLines.length > 0) {
      const content = `<!--[custom]-->\n  ${this._indexHtmlLines.join('\n  ')}\n  <!--[custom]-->`;
      htmlContent = htmlContent.replace('<!--[htmlHeadContent]-->', content);
    }

    htmlContent = htmlContent.replace('<!--[title]-->', `<title>${this._title}</title>`);

    this.fileSystemService.saveFile(indexHtmlPath, htmlContent);
  }

  private generateEnvFolderIfNeeded() {
    const envDirPath = this.fileSystemService.join(this._gahCfgFolder, 'env');
    this.fileSystemService.ensureDirectory(envDirPath);
    const envFilePath = this.fileSystemService.join(envDirPath, 'environment.json');
    if (!this.fileSystemService.fileExists(envFilePath)) {
      this.fileSystemService.saveObjectToFile(envFilePath, { production: false });
      const envProdFilePath = this.fileSystemService.join(envDirPath, 'environment.prod.json');
      if (!this.fileSystemService.fileExists(envProdFilePath)) {
        this.fileSystemService.saveObjectToFile(envProdFilePath, { production: true });
      }
    }
  }

  private collectModuleScripts() {
    type ScriptDef = { name: string, script: string, moduleName: string };

    const allGahScripts = new Array<ScriptDef>();
    this.allRecursiveDependencies.forEach(m => {
      if (!m.packageJson.scripts) {
        return;
      }
      Object.keys(m.packageJson.scripts).forEach(scriptName => {
        if (scriptName.startsWith('gah-') && scriptName !== 'gah-preinstall' && scriptName !== 'gah-postinstall') {
          const simpleScriptName = scriptName.substring(4);

          const existingScript = allGahScripts.find(x => x.name === simpleScriptName);

          if (existingScript) {
            this.loggerService.warn(`The gah-script named "${simpleScriptName}" is declared multiple times. (${existingScript.moduleName} & ${m.moduleName!})`);
          } else {
            allGahScripts.push(
              {
                name: simpleScriptName,
                script: m.packageJson.scripts![scriptName]!,
                moduleName: m.moduleName!
              }
            );
          }
        }
      });
    });

    const pkgJson = this.packageJson;

    if (allGahScripts.length > 0) {
      pkgJson!.scripts ??= {};

      allGahScripts.forEach(script => {
        pkgJson!.scripts![script.name] = script.script;
      });

      this.fileSystemService.saveObjectToFile(this.packageJsonPath, pkgJson);
    }
  }

  private setAngularCompilerOptionsInTsConfig() {
    this.tsConfigFile.setAngularCompilerOptions(this._ngCompilerOptions);
  }

}
