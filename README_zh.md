# Gridmen

[English](README.md) | 中文

Gridmen 是一个供研究人员和工程人员创建、编辑多分辨率笛卡尔网格（MRCG）的工具，用于为二维洪水模拟准备网格。网格由基础网格及有序的矢量干预组成。装配合并 patch，并将地形和地类采样一次写入基础网格；其他情景的网格从该基础网格派生，无须重复装配或采样基础属性。它们复用相同的基础二进制文件，使用同一基础网格时，干预范围以外的计算单元在各情景间保留逐位相同的属性。Gridmen 将与求解器无关的单元-边拓扑和属性导出为 `ne.txt` 和 `ns.txt`，可供独立项目 nh-flood-2d 等求解器使用。

[观看演示视频](https://doi.org/10.6084/m9.figshare.32677584)。

## 概念与流程

- **网格层级：** `schema` 定义坐标参考系、对齐原点和各层级的单元尺寸。尺寸逐层减小，前一层级的各维尺寸必须是下一层级的整数倍。
- **Patch：** 在 schema 内创建、可编辑的一部分网格。通过细分、合并、删除和恢复计算单元，设置局部分辨率与范围。
- **基础网格：** 装配产生的几何、拓扑与基础属性。装配合并 patch、过滤祖先冲突、执行层级平衡（grading）、重建拓扑，并采样 DEM 和可选的地类。基础二进制文件此后不再修改。
- **矢量干预：** 一个矢量资源及其高程操作和／或地类赋值。干预按列表顺序执行，后面的操作作用于前面操作的结果。
- **求解器输入：** 导出网格即可取得基础文件、该情景的 `ne.txt` 与 `ns.txt`，以及构建报告。

典型流程如下：

1. 创建项目与 schema，设置所需的坐标参考系、对齐原点和网格层级。
2. 在该 schema 下创建并编辑 patch，以所需分辨率覆盖模拟区域。
3. 使用 patch、DEM 和可选的地类创建网格。栅格坐标必须已与网格坐标参考系一致，装配不会对其重投影。
4. 创建或导入矢量资源，并在创建网格时按所需顺序添加高程和／或地类操作。
5. 为另一个情景选择已有网格作为 **Base Grid**，并设置新的有序矢量干预。派生复用其基础属性，不继承其已经干预的求解器输入。复用使用硬链接，因此基础文件必须位于同一文件系统。`crest` 还要求记录的 DEM 仍可访问。
6. 使用 **Export Grid** 下载网格归档。将 `ne.txt` 与 `ns.txt` 提供给兼容的求解器，并在该求解器中配置模拟。

用户需自行提供具有适当使用权的 DEM、地类和矢量数据。

## 查看网格分辨率与属性

对装配后的网格选择 **Check**，即可只读浏览。patch 编辑器与装配网格查看器共用一个渲染器，按视口加载、绘制与 schema 格点对齐的显示块。显示块与 patch 无关；编辑只重建包含改动单元的块，GPU 缓冲按可见块申请，不再按固定单元总容量预分配。

单元边长达到 4 个 CSS 像素时保留真实填充与 1 个 CSS 像素宽的居中边线。更小的区域使用不带格线的网格坐标显示节点。native schema 层之间插入二进层；客户端为每个块选择最细的显示层，要求所有节点（含截短末条）都能容下半径 0.75 个实际光栅像素的圆。远距离缩小时，同一层级继续延伸到存储根以上；分块遇到容不下该圆的窄子块时保留合格父块。节点通常宽 1.5–3 个光栅像素，不随 DPR 改变。暗化采用 `u = min(1, s/c); coverage = 1 - (1 - u)^2`，其中 `s` 为每 CSS 像素米数，`c` 为节点内最小真实单元边长；4 个 CSS 像素时覆盖率为 0.4375。共享图例和地图附近的场模式标识均提供中英文本。

相机无关的汇总保留占用面积、面积加权高程、各土地类别的稀疏面积总量和真实最细单元尺寸。类别面积相等时选择小编码，孔洞通过占用率降低透明度。浏览器按网格 revision、块和显示层请求可复用的二进制节点，使用标准 HTTP 缓存。服务端查询不遍历未分辨的细叶，也不依赖相机或属性边界。跨块的大原单元只绘制一次；局部编辑更新祖先路径及受影响的缓冲。

装配网格查看器提供层级、高程和地类场。高程与地类读取 `ne.txt` 中包含矢量干预的最终情景属性。在 **Check** 中点击地图，或启用 patch 编辑器的查看工具，即可在任何比例尺下查看真实单元及相邻单元。粗细交界处每条分段边的邻接都会列出，场样本不会被当作计算单元报告。

## 快速开始

需要 Node.js 22.12 或更新版本及 npm、Python 3.12（`server/.python-version` 选定的版本）和 `uv`。服务端清单允许 Python 3.10 或更新版本，实际还受锁定依赖的要求约束。本机 GDAL 库必须与 Python 绑定匹配；macOS 清单固定为 GDAL 3.13.1。完整依赖见各清单文件。

在新检出中运行：

```bash
git clone https://github.com/Dsssyc/gridmen.git
cd gridmen
npm run doctor
npm run setup
cp client/src/.env.example client/src/.env
```

`doctor` 检查本机工具与 GDAL 链接。`setup` 在根目录、`client/` 和 `client/src/` 分别运行 `npm ci`，安装 Electron 运行时，并在 `server/` 运行 `uv sync`。

在 `client/src/.env` 中将渲染端的 `VITE_API_BASE_URL` 设为服务端 URL（默认 `http://127.0.0.1:8000`）。旧的 `VITE_LOCAL_API_URL` 仍作为后备值。要加载 Mapbox 样式，将 `VITE_MAP_TOKEN` 设为自己的 Mapbox 公开令牌，或在 **Settings → Map View → General** 中输入。缺少有效公开令牌时，地图视图可以打开，但无法加载 Mapbox 样式。客户端环境配置值对浏览器可见。

### 桌面版

```bash
npm start
```

这会启动 Electron、位于 `http://127.0.0.1:5173` 的 Vite，以及端口为 8000 的服务端。在该终端按 Ctrl+C 可停止受管进程。Electron 加载 Vite URL；单独启动 Electron 时，需要已有运行中的渲染端和服务端。

### 分别启动 Web 版与服务端

从仓库根目录，在不同终端运行：

```bash
npm run start:server
npm run dev:web
```

在浏览器中打开 Vite URL。Vite 将 `/api` 与 `/noodle` 代理到配置的服务端。以上两个服务运行后，只启动桌面端可运行：

```bash
npm run start:client
```

服务端的直接入口为：

```bash
cd server
uv run main.py
```

服务端绑定 `0.0.0.0`，使用 `SERVER_PORT`（默认 8000），并启用自动重载。默认数据库、临时状态、配置与资源位于 `server/` 下。可通过 `server/.env` 配置 `SQLITE_PATH`、`MEMORY_TEMP_PATH` 和 `NOODLE_CONFIG_PATH`；资源路径相对于服务端工作目录。需要在服务端机器上提供自己的栅格与矢量文件。桌面版通过本机对话框选择文件；Web 版使用的路径必须指向服务端可访问的文件。

开发检查：

```bash
cd server
uv run pytest tests
```

```bash
cd client/src
npx tsc -b
npm run build
```

渲染端构建输出到仓库根目录的 `templates/`。基准测试说明见 [docs/benchmark/patch-render-benchmark.md](docs/benchmark/patch-render-benchmark.md)。显示接口与场聚合规则见 [docs/viewport-grid-contract.md](docs/viewport-grid-contract.md)。

## 矢量干预的高程操作

选中规则为：面按中心选中计算单元、按中点选中边；线选中经过或接触的单元与边；点选中包含该点的单元与边。矢量坐标会转换到网格坐标参考系。除 `crest` 的特殊边规则外，选中的单元与边接受同一操作。

| 操作 | 高程结果 |
|---|---|
| `set` | 将选中的高程设为给定值。 |
| `add` | 在当前高程上加上给定值。 |
| `subtract` | 从当前高程减去给定值。 |
| `max` | 将选中范围统一为当前选中计算单元的最高高程；无须给定值。 |
| `crest`（取埂顶） | 仅用于线：将每个选中单元抬高至当前高程、足迹内有效 DEM 像元中心的最高高程、可选设计下限三者的最大值。 |

`crest` 的足迹是线两侧带圆形端部的走廊。半径为 schema 最细单元边长的一半（矩形单元取较短边），选中粗单元时也使用该半径。在足迹与每个选中单元的交集中取 DEM 最高值。走廊边界上的像元中心计入，单元边界采用半开区间。例如 `{"type": "crest", "value": 3.07}` 给出设计下限。省略 `value`、传入 `null` 或将界面字段留空时，不设设计下限；当前高程仍作为下限保留。

线经过或接触的边不低于原高程，也不低于相邻选中单元的最终最高高程，该规则同样适用于层级交界。后续干预仍按顺序执行，可以再次改变这些高程。新基础网格在 `grid.meta.json` 中记录采样 DEM 路径，派生网格继承该路径。`crest` 读取局部窗口，要求 DEM 使用网格坐标参考系、朝北且无旋转，并完整覆盖足迹。选中单元的足迹内没有有效 DEM 像元中心时，操作失败。

干预也可以对选中的单元与边执行地类 `set`，可同时设置高程操作。代码字段 `lum` 表示地类。每个网格均从基础属性与其有序干预重新计算求解器输入；导出不会修改基础二进制文件，也不会叠加前一情景的编辑。

基础采样读取第 1 波段。单元取中心落在其足迹内的有效像元：高程取均值，地类取多数（并列时取较小的类别值）；足迹内至多一个像元中心时，取该像元或单元中心所在的像元。边取中点所在的像元。没有有效像元时，高程记为 `-9999`，地类记为 `0`。

## 导出文件

**Export Grid** 将网格资源目录打包为 `.tar.gz` 归档。

| 文件 | 内容 |
|---|---|
| `ne.txt` | 情景计算单元：从 1 开始的 ID，西／东／南／北方向的边数，对应的边 ID，中心坐标，高程及地类。 |
| `ns.txt` | 情景边：从 1 开始的 ID，方向（`1` 为水平，`2` 为竖直），左／右／下／上相邻单元 ID（缺失时为 `0`），长度，中点坐标，高程及地类。 |
| `cell_topo.bin` | 内部基础网格的单元几何、连接关系与采样基础属性，供派生复用。 |
| `edge_topo.bin` | 内部基础网格的边几何、相邻关系与采样基础属性，供派生复用。 |
| `grid.meta.json` | 网格坐标参考系、范围、网格层级、细分规则、对齐原点及记录的栅格源路径。 |
| `build_report.json` | 装配参数或基础网格引用、单元／边数量、干预选中数量及各阶段耗时。 |

基础二进制文件描述基础网格；情景的高程与地类变化写在 `ne.txt` 和 `ns.txt` 中。元数据与报告可能包含本机源路径，分享前需审查导出归档及数据权限。

## 开发结构

渲染端使用 React、TypeScript 和 Vite。可复用的界面组件位于 `client/src/src/components/ui/`，采用 shadcn/ui 与 Radix UI，样式使用 Tailwind CSS，图标使用 Lucide React。地图视图使用 Mapbox GL JS；Three.js 与 `3d-tiles-renderer` 代码位于 `client/src/src/threejs/`。

资源模板位于 `client/src/src/template/`，视图实现位于 `client/src/src/views/`，网格编辑逻辑位于 `client/src/src/core/grid/`。资源树、标签页和导航组件位于 `client/src/src/components/`。Zustand 状态定义在 `client/src/src/store/storeSet.ts`，其中设置持久化到 localStorage；`client/src/src/store/store.ts` 另提供用于临时状态的内存存储。服务端通过 FastAPI 提供网格操作。

## 仓库结构与许可证

```text
client/electron/      Electron shell
client/src/           React/Vite renderer and its package.json
server/main.py        Backend launch entry point
server/src/           FastAPI endpoints, schemas, and settings
server/templates/     Resource lifecycle hooks, assembly, interventions
server/crms/          Resource implementations
server/icrms/         Resource interfaces
server/tests/         Backend tests
scripts/              Setup, launch, diagnostics, benchmark analysis
docs/benchmark/       Patch rendering and edit-latency measurement guide
templates/            Generated renderer build (ignored)
server/resource/      Local resources (ignored)
```

Gridmen 以 [MIT 许可证](LICENSE)发布。
