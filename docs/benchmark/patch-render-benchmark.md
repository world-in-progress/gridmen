# Patch Render Benchmark

This benchmark measures topology rendering throughput and frame-time stability in the patch editor. It is implemented in `client/src/src/template/patch/benchmark/renderBenchmarkRunner.ts`.

## Activation

Start the backend and Web client as described in the [README](../../README.md). Use a patch and data that you have permission to measure and share.

Open a patch in edit mode and add URL parameters to the web client:

```text
?benchmark=patch-render
```

The default workload is `static`. To run camera navigation:

```text
?benchmark=patch-render&benchmarkWorkload=navigation
```

Useful options:

```text
benchmarkDurationMs=10000
benchmarkWarmupMs=3000
benchmarkLabel=small-10k-run-1
benchmarkExport=both
```

`benchmarkExport` accepts `console`, `download`, or `both`.

## Workloads

- `static`: keeps the current camera fixed and continuously requests repaint during the measurement window.
- `navigation`: continuously requests repaint while applying a deterministic camera motion around the current view.

Both workloads ignore warm-up samples and only record frames where the active `TopologyLayer` renders.

The benchmark arms itself when the patch editor is mounted, but it does not start the warm-up or measurement window until the first valid `TopologyLayer` render sample is emitted. This avoids including large-patch data loading, initial topology preparation, and GPU buffer initialization in the FPS measurement. The excluded wait is recorded as `readinessWaitMs` in the exported JSON.

## Output

The exported JSON includes:

- `benchmark` (`patch-render`)
- `startedAt`
- `workload`
- `label`
- `patchId`
- `cellCount`
- `readinessWaitMs`
- `durationMs`
- `warmupMs`
- `viewport.width`
- `viewport.height`
- `viewport.devicePixelRatio`
- `environment.userAgent`
- `summary.meanFps`
- `summary.medianFrameMs`
- `summary.p95FrameMs`
- `summary.p99FrameMs`
- `summary.framesOver16Ms`
- `summary.framesOver33Ms`
- `summary.framesOver50Ms`
- `summary.sampleCount`, `summary.frameCount`, and `summary.measuredTimeMs`
- mean/min/max frame times and mean/p95/p99 render durations
- raw `samples`

## Suggested Paper Figures

Use two primary plots:

- FPS vs. cell count, with separate series for `static` and `navigation`.
- p95 frame time vs. cell count, with reference lines at 16.7 ms and 33.3 ms.

Report the hardware and software environment with the results:

- CPU, GPU, RAM.
- Browser or Electron version.
- Viewport resolution.
- Device pixel ratio.
- Mapbox style/base layer used during measurements.
- Patch cell count and level distribution.

Repeat each data point at least five times and report mean plus standard deviation or confidence intervals.

# Patch Edit Latency Benchmark

This benchmark measures core edit-operation responsiveness after the active patch has loaded and rendered. It is implemented in `client/src/src/template/patch/benchmark/editLatencyBenchmarkRunner.ts`. Initial loading, camera navigation FPS, assembly, and simulation runtime are outside the measurement.

Run it on a disposable patch: trials perform real edits against the active topology, and failed or interrupted paired operations can leave changes behind. Save any work first.

## Activation

Open a patch in edit mode and add URL parameters to the web client:

```text
?benchmark=patch-edit-latency
```

Useful options:

```text
benchmarkTrials=30
benchmarkWarmupFrames=3
benchmarkOperation=all
benchmarkLabel=500k-edit-run-1
benchmarkExport=both
```

`benchmarkOperation` accepts `all`, `pick`, `subdivide`, `merge`, `delete`, or `recover`. The defaults are 30 trials, 3 warm-up frames, and `all`. Each trial of `all` runs the five operations in that order.

`benchmarkExport` accepts `console`, `download`, or `both`.

## Workloads

The benchmark runs deterministic edit-operation trials against the active `TopologyLayer`:

- `pick`: selects one deterministic, undeleted storage id.
- `subdivide`: selects one deterministic, subdividable cell and uploads the generated child cells.
- `merge`: merges the child group created by the paired subdivision trial, or falls back to a deterministic valid sibling group.
- `delete`: marks one deterministic, undeleted cell as deleted.
- `recover`: restores the cell deleted by the paired delete trial.

Each trial starts timing immediately before the operation is triggered and stops only after the next topology render sample is emitted after the operation has updated GPU-visible state.

## Output

The exported JSON includes:

- `benchmark`
- `label`
- `patchId`
- `startedAt`
- `initialCellCount`
- `finalCellCount`
- `readinessWaitMs`
- `config.trials`
- `config.warmupFrames`
- `config.operation`
- `viewport.width`
- `viewport.height`
- `viewport.devicePixelRatio`
- `environment.userAgent`
- raw per-operation `trials`
- per-operation `summary` (successful/failed trial counts and mean/median/p95/p99/min/max latency)

Each trial records:

- `operation`
- `trialIndex`
- `success`
- `failureReason`, when the trial failed
- `latencyMs`, when the trial succeeded
- `cellCountBefore`
- `cellCountAfter`
- `selectedCellCount`
- `target`

## Suggested Paper Table

Use median and p95 operation latency:

| Cells | Pick p50 | Pick p95 | Subdivide p50 | Subdivide p95 | Merge p50 | Merge p95 | Delete p50 | Delete p95 | Recover p50 | Recover p95 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|

Choose cell counts that represent the intended workload and report stress cases separately. An interactive operating range must be established from measured latency and failure counts; the benchmark does not establish one by itself.

## Analysis scripts

Save downloaded JSON files in separate directories for the two benchmark types. From the repository root, run:

```bash
python3 scripts/analyze_patch_render_benchmarks.py --input-dir output/render --output-dir output/render-summary
python3 scripts/analyze_patch_edit_benchmarks.py --input-dir output/edit --output-dir output/edit-summary
```

The input directories must contain the corresponding exported JSON files. The scripts write `patch_render_summary.csv` / `patch_render_analysis.md` and `patch_edit_summary.csv` / `patch_edit_analysis.md`, respectively. Override both paths explicitly; their built-in defaults point to local `docs/paper/` directories, which are not supplied with the repository.

The JSON, generated summaries, labels, and browser metadata may identify a local environment or dataset. Check permissions and remove identifying details before publishing benchmark artifacts.
