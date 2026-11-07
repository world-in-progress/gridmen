import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = await mkdtemp(join(tmpdir(), 'gridmen-tests-'))
try {
    const files = (await readdir(resolve(root, 'test'))).sort()
    const tests = files.filter(name => name.endsWith('.test.ts'))
    await build({ entryPoints: tests.map(name => resolve(root, 'test', name)),
        outdir: output, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm',
        tsconfig: resolve(root, 'tsconfig.app.json'), logLevel: 'warning' })
    const entries = [
        ...tests.map(name => resolve(output, name.replace(/\.ts$/, '.mjs'))),
        ...files.filter(name => name.endsWith('.test.cjs')).map(name => resolve(root, 'test', name)),
    ]
    const result = spawnSync(process.execPath, ['--test', ...entries], { cwd: root, stdio: 'inherit' })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
} finally {
    await rm(output, { recursive: true, force: true })
}
