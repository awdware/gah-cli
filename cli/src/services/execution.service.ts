import { injectable } from 'inversify';
import { exec, spawn } from 'child_process';
import { IExecutionService } from '@awdware/gah-shared';

@injectable()
export class ExecutionService implements IExecutionService {
  public executionResult: string = '';
  public executionErrorResult: string = '';

  public execute(cmd: string, outPut: boolean, outPutCallback?: (out: string) => string, cwd?: string): Promise<boolean> {
    return new Promise((resolve) => {
      const childProcess = exec(cmd, { cwd });

      childProcess.stdout?.on('data', buffer => {
        this.executionResult += buffer;
        if (outPut) {
          if (outPutCallback) {
            const newOut = outPutCallback(buffer);
            if (newOut) { console.log(newOut); }
          } else {
            console.log(buffer);
          }
        }
      });
      childProcess.stderr?.on('data', buffer => {
        if (outPut) {
          console.error(buffer);
        }
        this.executionResult += buffer;
        this.executionErrorResult += buffer;
      });

      childProcess.on('exit', code => {
        if (code !== 0) {
          setTimeout(() => {
            resolve(false);
          }, 100);
        }
        else {
          setTimeout(() => {
            resolve(true);
          }, 100);
        }
      });
    });
  }


  public executeAndForget(executeable: string, options: string[], outPut: boolean, cwd?: string): Promise<boolean> {
    return new Promise((resolve) => {
      const childProcess = spawn(executeable, options, { cwd, shell: true, stdio: outPut ? 'inherit' : 'ignore' });
      childProcess.on('exit', code => {
        if (code !== 0) {
          setTimeout(() => {
            resolve(false);
          }, 10);
        }
        else {
          setTimeout(() => {
            resolve(true);
          }, 10);
        }
      });
    });
  }
}
