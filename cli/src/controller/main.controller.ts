import { injectable, inject } from 'inversify';
import chalk from 'chalk';
import figlet from 'figlet';
import { program } from 'commander';

import { InitController } from './init.controller';
import { DependencyController } from './dependency.controller';
import { InstallController } from './install.controller';
import { PluginController } from './plugin.controller';
import { Controller } from './controller';
import { ReferenceController } from './reference.controller';
import { GahModuleType } from '@awdware/gah-shared';
import { CopyHost } from '../install-helper/copy-host';
import { RunController } from './run.controller';

@injectable()
export class MainController extends Controller {
  @inject(InitController)
  private readonly _initController: InitController;
  @inject(DependencyController)
  private readonly _dependencyController: DependencyController;
  @inject(ReferenceController)
  private readonly _hostModuleController: ReferenceController;
  @inject(InstallController)
  private readonly _installController: InstallController;
  @inject(PluginController)
  private readonly _pluginController: PluginController;
  @inject(RunController)
  private readonly _runController: RunController;

  public async main() {
    if (this._configService.getGahModuleType() === GahModuleType.HOST) {
      this._contextService.setContext({ calledFromHostFolder: true });
      CopyHost.copy(this._fileSystemService, this._workspaceService);
    }

    // This sets the debug context variable depending on the used options
    this._contextService.setContext({ debug: process.argv.some(x => x === '--debug') });

    await this._pluginService.loadInstalledPlugins();

    var pjson = require(this._fileSystemService.join(__dirname, '../../package.json'));
    const version = pjson.version;

    // This is so useless, I love it.
    const fontWidth = process.stdout.columns > 111 ? 'full' : process.stdout.columns > 96 ? 'fitted' : 'controlled smushing';

    program.on('--help', () => {
      console.log(
        chalk.yellow(
          figlet.textSync(`gah-cli v${version}`, { horizontalLayout: fontWidth, font: 'Cricket', verticalLayout: 'full' })
        )
      );
    });
    console.log();

    program
      .version(version);

    program
      .option('--debug', 'Enables verbose debug logging');

    program
      .command('init')
      .description('Initiates a new  module (or host).')
      .option('-h, --host', 'Initiates a host instead of a module')
      .option('-e, --entry', 'Initiates a module as the entry module')
      // .option('--moduleName <name>', 'The name for the new module')
      // .option('--facadeFolderPath <path>', 'The relative path to the facade files')
      // .option('--publicApiPath <path>', 'The relative path public api file (public-api.ts / index.ts / etc.)')
      // .option('--baseModuleName <name>', 'The name of the base NgModule of the new module')
      .action(async (cmdObj) => this._initController.init(cmdObj.host, cmdObj.entry));

    const cmdDependency = program
      .command('dependency <add|remove> [options]');
    cmdDependency
      .command('add [moduleName] [dependencyConfigPath] [dependencyModuleNames...]')
      .description('Adds new dependencies to a specified module.')
      .action(async (moduleName, dependencyConfigPath, dependencyModuleNames) => this._dependencyController.add(moduleName, dependencyConfigPath, dependencyModuleNames));
    cmdDependency
      .command('remove [dependencyName] [moduleName]')
      .description('Removes dependencies from a specified module.')
      .action(async (dependencyName, moduleName) => this._dependencyController.remove(dependencyName, moduleName));

    const cmdReference = program
      .command('reference <add|remove> [options]')
      .description('Manages modules for the host')
      .alias('ref');
    cmdReference
      .command('add [dependencyConfigPath] [dependencyModuleNames...]')
      .description('Adds a new module to the host.')
      .action(async (dependencyConfigPath, dependencyModuleNames) => this._hostModuleController.add(dependencyConfigPath, dependencyModuleNames));
    cmdReference
      .command('remove [moduleName]')
      .description('Removes modules from the host.')
      .action(async (moduleName) => this._hostModuleController.remove(moduleName));

    const cmdPlugin = program
      .command('plugin <add|remove|update> [options]');
    cmdPlugin
      .command('add [pluginName]')
      .description('Adds and installs a new plugin.')
      .action(async (pluginName) => this._pluginController.add(pluginName));
    cmdPlugin
      .command('remove [pluginName]')
      .description('Removes and uninstalls a plugin.')
      .action(async (pluginName) => this._pluginController.remove(pluginName));
    cmdPlugin
      .command('update [pluginName]')
      .description('Updates plugin to its newest version.')
      .action(async (pluginName) => this._pluginController.update(pluginName));

    program
      .command('run  <command...>')
      .description('Executes a command.')
      .option('-e --environment <name>', 'The name of the environment that should be used')
      .allowUnknownOption()
      .action(async (command, cmdObj) => this._runController.exec(command, cmdObj.environment));

    program
      .command('install')
      .description('Installs all dependencies.')
      .alias('i')
      .action(async () => this._installController.install());

    await program.parseAsync(process.argv);
  }


}
