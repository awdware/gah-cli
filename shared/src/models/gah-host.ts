import { ModuleReference } from './module-reference';

export class GahHost {
  protected $schema: string = 'https://raw.githubusercontent.com/awdware/gah/master/assets/gah-host-schema.json';
  /**
   * The array of the modules that should be loaded for this host.
   */
  public modules: ModuleReference[];

  public get isHost() { return true; }

  constructor() {
    this.modules = new Array<ModuleReference>();
  }
}