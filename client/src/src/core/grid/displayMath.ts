import type { Bounds, DisplayCell, DisplayField } from './displayTypes'

export const CELL_PIXEL_THRESHOLD = 4
export const FULL_OUTLINE_THRESHOLD = 8

export function outlineCoverage(metersPerPixel: number, minCellSize: number): number {
    return Math.min(1, 2 * metersPerPixel / minCellSize)
}

/** Smooth opacity handoff from field density to the original cell outlines. */
export function outlineBlend(cellPixels: number): number {
    const t = Math.max(0, Math.min(1,
        (cellPixels - CELL_PIXEL_THRESHOLD) / (FULL_OUTLINE_THRESHOLD - CELL_PIXEL_THRESHOLD)))
    return t * t * (3 - 2 * t)
}

export function validBounds(bounds: Bounds): boolean {
    return bounds.length === 4 && bounds.every(Number.isFinite) &&
        bounds[0] < bounds[2] && bounds[1] < bounds[3]
}

export function intersects(a: Bounds, b: Bounds): boolean {
    return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
}

/** Half-open ownership gives each shared edge or vertex one containing cell. */
export function containsPoint(bounds: Bounds, x: number, y: number): boolean {
    return bounds[0] <= x && x < bounds[2] && bounds[1] <= y && y < bounds[3]
}

export function intersectionArea(a: Bounds, b: Bounds): number {
    return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
        Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
}

export function cellSide(cell: DisplayCell): number {
    return Math.min(cell.bounds[2] - cell.bounds[0], cell.bounds[3] - cell.bounds[1])
}

/** The smallest schema-aligned dyadic interval no wider than one CSS pixel. */
export function sampleStep(unit: number, metersPerPixel: number): number {
    // Public geographic projection round-trips can land infinitesimally below
    // a power of two. Snap that numerical boundary to avoid doubling samples
    // on an otherwise unchanged CSS-pixel lattice.
    const exponent = Math.floor(Math.log2(metersPerPixel / unit) + 1e-8)
    return unit * 2 ** exponent
}

export class AreaSummary {
    occupiedArea = 0
    elevationArea = 0
    private singleClass: number | undefined
    private singleClassArea = 0
    private multiClasses: Map<number, number> | undefined
    private readonly sideAreas: Map<number, number> | null
    private readonly levelAreas: Map<number, number> | null
    minCellSize = Infinity
    finestLevel = -Infinity

    constructor(private readonly fixedSide?: number, private readonly fixedLevel?: number) {
        this.sideAreas = fixedSide === undefined ? new Map() : null
        this.levelAreas = fixedLevel === undefined ? new Map() : null
    }

    clone(): AreaSummary {
        const copy = new AreaSummary(this.fixedSide, this.fixedLevel)
        copy.occupiedArea = this.occupiedArea
        copy.elevationArea = this.elevationArea
        copy.minCellSize = this.minCellSize
        copy.finestLevel = this.finestLevel
        copy.singleClass = this.singleClass
        copy.singleClassArea = this.singleClassArea
        if (this.multiClasses) copy.multiClasses = new Map(this.multiClasses)
        for (const [side, area] of this.sideAreas ?? []) copy.sideAreas!.set(side, area)
        for (const [level, area] of this.levelAreas ?? []) copy.levelAreas!.set(level, area)
        return copy
    }

    addCell(cell: DisplayCell, area: number, sign: 1 | -1): void {
        if (area <= 0) return
        const signedArea = area * sign
        this.occupiedArea += signedArea
        this.elevationArea += signedArea * cell.elevation
        this.adjustClass(cell.landClass, signedArea)
        if (this.fixedSide !== undefined && this.fixedLevel !== undefined) {
            this.minCellSize = this.occupiedArea > 0 ? this.fixedSide : Infinity
            this.finestLevel = this.occupiedArea > 0 ? this.fixedLevel : -Infinity
        } else {
            const side = cellSide(cell)
            this.adjust(this.sideAreas!, side, signedArea)
            this.adjust(this.levelAreas!, cell.level, signedArea)
            if (sign === 1) {
                this.minCellSize = Math.min(this.minCellSize, side)
                this.finestLevel = Math.max(this.finestLevel, cell.level)
            } else {
                if (!this.sideAreas!.has(this.minCellSize)) {
                    this.minCellSize = Infinity
                    for (const size of this.sideAreas!.keys()) this.minCellSize = Math.min(this.minCellSize, size)
                }
                if (!this.levelAreas!.has(this.finestLevel)) {
                    this.finestLevel = -Infinity
                    for (const level of this.levelAreas!.keys()) this.finestLevel = Math.max(this.finestLevel, level)
                }
            }
        }
    }

    addSummary(other: AreaSummary, scale = 1): void {
        if (scale <= 0 || other.occupiedArea <= 0) return
        this.occupiedArea += other.occupiedArea * scale
        this.elevationArea += other.elevationArea * scale
        other.forEachClass((category, area) => this.adjustClass(category, area * scale))
        this.minCellSize = Math.min(this.minCellSize, other.minCellSize)
        this.finestLevel = Math.max(this.finestLevel, other.finestLevel)
    }

    toField(bounds: Bounds): DisplayField | null {
        if (this.occupiedArea <= 0) return null
        const sampleArea = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
        let landClass = Infinity
        let classArea = -Infinity
        const tieTolerance = sampleArea * 1e-12
        this.forEachClass((category, area) => {
            if (area > classArea + tieTolerance ||
                (Math.abs(area - classArea) <= tieTolerance && category < landClass)) {
                landClass = category
                classArea = area
            }
        })
        return {
            bounds,
            occupiedFraction: Math.min(1, Math.max(0, this.occupiedArea / sampleArea)),
            minCellSize: this.minCellSize,
            level: this.finestLevel,
            elevation: this.elevationArea / this.occupiedArea,
            landClass,
        }
    }

    private adjust(map: Map<number, number>, key: number, delta: number): void {
        const next = (map.get(key) ?? 0) + delta
        // Each removal uses the same geometric contribution as its insertion.
        if (next === 0) map.delete(key)
        else map.set(key, next)
    }

    private adjustClass(key: number, delta: number): void {
        if (delta === 0) return
        if (this.multiClasses) {
            this.adjust(this.multiClasses, key, delta)
            if (this.multiClasses.size <= 1) {
                const last = this.multiClasses.entries().next().value as [number, number] | undefined
                this.singleClass = last?.[0]
                this.singleClassArea = last?.[1] ?? 0
                this.multiClasses = undefined
            }
        } else if (this.singleClass === undefined) {
            this.singleClass = key
            this.singleClassArea = delta
        } else if (this.singleClass === key) {
            this.singleClassArea += delta
            if (this.singleClassArea === 0) this.singleClass = undefined
        } else {
            this.multiClasses = new Map([[this.singleClass, this.singleClassArea], [key, delta]])
            this.singleClass = undefined
            this.singleClassArea = 0
        }
    }

    private forEachClass(visit: (category: number, area: number) => void): void {
        if (this.multiClasses) {
            for (const [category, area] of this.multiClasses) visit(category, area)
        } else if (this.singleClass !== undefined) {
            visit(this.singleClass, this.singleClassArea)
        }
    }
}
