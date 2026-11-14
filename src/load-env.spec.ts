import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile } from './load-env.js';

describe('loadEnvFile', () => {
  it('does nothing when the file is missing', () => {
    expect(() => loadEnvFile(join(tmpdir(), 'cocos-missing.env'))).not.toThrow();
  });

  it('ignores a line without a separator and keeps a value that is already set', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cocos-env-')), '.env');
    writeFileSync(path, 'NO_EQUALS\nCOCOS_COVERAGE_ALREADY=from-file\nCOCOS_COVERAGE_NEW=from-file\n');
    process.env.COCOS_COVERAGE_ALREADY = 'from-env';
    delete process.env.COCOS_COVERAGE_NEW;

    try {
      loadEnvFile(path);
      expect(process.env.COCOS_COVERAGE_ALREADY).toBe('from-env');
      expect(process.env.COCOS_COVERAGE_NEW).toBe('from-file');
    } finally {
      delete process.env.COCOS_COVERAGE_ALREADY;
      delete process.env.COCOS_COVERAGE_NEW;
    }
  });
});
