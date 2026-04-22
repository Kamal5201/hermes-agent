import { execFile } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface AirDropShareItem {
  filename: string;
  content: Buffer | string;
}

export interface AirDropShareResult {
  stagedFile: string;
  revealedInFinder: boolean;
  mode: 'finder_handoff';
}

export class AirDropIntegration {
  constructor(
    private readonly stagingDir: string = join(homedir(), 'Library', 'Application Support', 'Hermes Companion', 'airdrop'),
  ) {}

  public async share(item: AirDropShareItem): Promise<AirDropShareResult> {
    this.assertMacOS();

    const stagedFile = await this.stageItem(item);
    let revealedInFinder = false;

    try {
      await execFileAsync('open', ['-R', stagedFile]);
      revealedInFinder = true;
    } catch {
      revealedInFinder = false;
    }

    return {
      stagedFile,
      revealedInFinder,
      mode: 'finder_handoff',
    };
  }

  public async stageItem(item: AirDropShareItem): Promise<string> {
    this.assertMacOS();

    const target = resolve(this.stagingDir, basename(item.filename));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, item.content);
    return target;
  }

  private assertMacOS(): void {
    if (process.platform !== 'darwin') {
      throw new Error('AirDrop integration is only available on macOS');
    }
  }
}

export default AirDropIntegration;
