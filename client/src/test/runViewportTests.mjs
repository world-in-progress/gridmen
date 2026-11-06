import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidence = resolve(root, '../../.verification/client-tests')
const output = resolve(evidence, 'node-tests')
await mkdir(output, { recursive: true })
const files = (await readdir(resolve(root, 'test'))).sort()
const tests = files.filter(name => name.endsWith('.test.ts'))
await build({ entryPoints: tests.map(name => resolve(root, 'test', name)),
    outdir: output, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm',
    tsconfig: resolve(root, 'tsconfig.app.json'), logLevel: 'warning' })
const entries = [
    ...tests.map(name => resolve(output, name.replace(/\.ts$/, '.mjs'))),
    ...files.filter(name => name.endsWith('.test.cjs')).map(name => resolve(root, 'test', name)),
]
const result = spawnSync(process.execPath, ['--test', ...entries], { encoding: 'utf8', cwd: root })
const raw = (result.stdout ?? '') + (result.stderr ?? '')
await writeFile(resolve(evidence, 'unit-tests.txt'), raw)
process.stdout.write(raw)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
