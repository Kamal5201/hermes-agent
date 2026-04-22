import { execFile } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface SpotlightSearchResult {
  path: string;
}

export interface SpotlightIndexResult {
  indexedPath: string;
  command: string[];
}

export interface SpotlightDocumentInput {
  title: string;
  content: string;
  identifier: string;
}

export class SpotlightIntegration {
  constructor(
    private readonly storageDir: string = join(homedir(), 'Library', 'Application Support', 'Hermes Companion', 'spotlight'),
  ) {}

  public async indexFile(filePath: string): Promise<SpotlightIndexResult> {
    this.assertMacOS();

    const indexedPath = resolve(filePath);
    const command = ['-f', indexedPath];
    await execFileAsync('mdimport', command);

    return {
      indexedPath,
      command,
    };
  }

  public async search(query: string, limit = 10): Promise<SpotlightSearchResult[]> {
    this.assertMacOS();

    const { stdout } = await execFileAsync('mdfind', ['-limit', String(limit), query]);
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((path) => ({ path }));
  }

  public async indexDocument(input: SpotlightDocumentInput): Promise<SpotlightIndexResult> {
    this.assertMacOS();

    const safeName = basename(input.identifier).replace(/[^\w.-]/g, '_');
    const target = resolve(this.storageDir, `${safeName}.md`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `# ${input.title}\n\n${input.content}\n`, 'utf8');
    return this.indexFile(target);
  }

  private assertMacOS(): void {
    if (process.platform !== 'darwin') {
      throw new Error('Spotlight integration is only available on macOS');
    }
  }
}

export default SpotlightIntegration;
