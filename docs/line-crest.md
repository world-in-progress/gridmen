# 线要素高程操作 crest（取埂顶）

`crest` 仅适用于 LineString / MultiLineString，不需要数值参数；混有面或点的资源在载入时直接报错。客户端对纯线资源显示 `Crest`，选择后不要求输入数值。空线、非有限坐标直接报错。

选中规则沿用线经过或接触的单元与边。足迹是线的圆头缓冲带，半径为基础网格 `grid_info` 中最细分辨率的边长一半；矩形单元取较小边长。整个网格共用此宽度，粗单元不会扩大足迹。例如最细分辨率为 4 m 时，线两侧各取 2 m。单元高程取其与足迹交集内有效 DEM 像元中心值的最大值；缓冲带边界上的中心纳入，单元边界按左、下含，右、上不含。多个线段和多条线取并集。

线经过或接触的边，取当前边高程与该边相邻选中单元的 crest 高程的最大值。这一保守规则适用于粗细单元连接处的分裂边，并防止已有更高的边被降低。没有经过的边不受影响。操作仍按列表顺序执行，后续操作可以再次改变这些高程。

装配基础网格时，`assembly.py` 将实际采样 DEM 的绝对路径写入 `grid.meta.json.dem_path`。派生网格继承元数据及基础二进制文件；`crest` 使用这一来源，不重新采样整张基础网格，也不修改基础二进制。DEM 打开一次，在入口检查 CRS、北向无旋转变换和最细分辨率；每项 crest 在读取前检查完整足迹覆盖范围。读取窗口仅覆盖线段足迹与选中单元的交集包围盒，再按距离与像元中心过滤。单元足迹内全是 nodata、NaN、无穷值，或没有像元中心时直接报错。

挂载参数示例：

```json
{
  "base_grid": ".g.base",
  "vector": [{"node_key": ".v.perimeter", "dem": {"type": "crest"}}]
}
```

`set`、`add`、`subtract`、`max` 的选取、执行顺序和数值语义保持原状，`crest` 也可以同时设置 LULC。

改动文件为 `server/templates/grid/vector.py`、`assembly.py`、`hooks.py`、`server/tests/templates/grid/test_grid_mount.py`、`client/src/src/template/grid/gridCreation.tsx`、`README.md` 和本文档。

客户端清单虽声明 `i18next` 和 `react-i18next`，但当前源码没有初始化、翻译资源或在用的翻译调用；本项沿用现有英文界面写法，没有新建 i18n 框架。

当前限制：旧基础网格若未记录 `dem_path`，需要用原 DEM 重新装配；绝对路径要求原始 DEM 在本机仍可访问，未增加内容指纹或随网格打包 DEM。足迹宽度采用网格坐标单位，使用米制投影时才对应米；DEM 必须预先与网格同 CRS，禁止运行时重投影。埂顶必须能被 DEM 像元中心表达；分辨率过粗以致足迹没有中心时会失败。边规则可能把粗单元内其他位置较高的埂顶传播到经过的边，属于有意保守处理。未做真实 LiDAR 数据验收、浏览器交互验收或性能基准。

验证使用本检出内独立 Python 环境，依赖按仓库 `server/uv.lock` 安装，网格测试未使用的 GDAL 包未安装；运行时使用空模板配置及独立测试数据库。客户端使用 `npm ci --ignore-scripts --no-audit --no-fund` 安装锁定依赖。

服务端检查命令：`.venv/bin/python .venv/crest-test-run.py`，脚本实际执行 `.venv/bin/python -m pytest -q server/tests/templates/grid`，并将配置、数据库及临时目录指向本检出的 `.venv/`。原样输出如下：

```text
......................................................................   [100%]
=============================== warnings summary ===============================
.venv/lib/python3.12/site-packages/pynoodle/config.py:5
  /private/tmp/claude-501/-Users-soku-Desktop-codespace-WorldInProgress-gridmen/840f3bc5-8dab-4895-8a2d-7fd589b470b2/scratchpad/gridmen-line-crest/.venv/lib/python3.12/site-packages/pynoodle/config.py:5: PydanticDeprecatedSince20: Support for class-based `config` is deprecated, use ConfigDict instead. Deprecated in Pydantic V2.0 to be removed in V3.0. See Pydantic V2 Migration Guide at https://errors.pydantic.dev/2.12/migration/
    class Settings(BaseSettings):

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
70 passed, 1 warning in 1.22s
```

客户端类型检查命令：`cd client/src && ./node_modules/.bin/tsc -b --pretty false`。标准输出和标准错误均为空，退出码为 0。

测试覆盖 4 m / 16 m 单元、16 m 单元配 4 m 最细分辨率、混合层级、斜线、MultiLineString、圆头及足迹边界、足迹外埂顶排除、边不降高、按相邻单元最大埂顶保护分裂边、面和点拒绝、全 nodata 与逐单元无效像元、覆盖不足、错误 CRS / 旋转变换、派生链的 DEM 来源与局部分窗、单次打开 DEM、基础二进制保持原值，以及已有 set / add / subtract / max 行为。唯一警告来自 py-noodle 的 Pydantic 配置类写法。
