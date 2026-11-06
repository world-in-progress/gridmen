import type { Bounds, DisplayCell, DisplayField } from './displayTypes'

export const CELL_PIXEL_THRESHOLD = 4
export const FULL_OUTLINE_THRESHOLD = 8

export function outlineCoverage(metersPerPixel: number, minCellSize: number): number {
    const u = Math.min(1, metersPerPixel / minCellSize)
    return 1 - (1 - u) ** 2
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

/** Physical float64 totals and exact class weights in a shared finest-lattice area unit. */
export class AreaSummary {
    occupiedArea = 0
    elevationArea = 0
    private singleClass: number | undefined
    private singleClassUnits = 0n
    private multiClasses: Map<number, bigint> | undefined
    minCellSize = Infinity
    finestLevel = -Infinity

    constructor(private readonly trackExtrema = true) {}

    clone(): AreaSummary {
        const copy = new AreaSummary(this.trackExtrema)
        copy.occupiedArea = this.occupiedArea
        copy.elevationArea = this.elevationArea
        copy.minCellSize = this.minCellSize
        copy.finestLevel = this.finestLevel
        copy.singleClass = this.singleClass
        copy.singleClassUnits = this.singleClassUnits
        if (this.multiClasses) copy.multiClasses = new Map(this.multiClasses)
        return copy
    }

    addCell(cell: DisplayCell, area: number, sign: 1 | -1, classUnits: bigint): void {
        if (area <= 0) return
        const signedArea = area * sign
        this.occupiedArea += signedArea
        this.elevationArea += signedArea * cell.elevation
        this.updateClass(cell.landClass, classUnits * BigInt(sign))
        if (this.trackExtrema && sign === 1) {
            this.minCellSize = Math.min(this.minCellSize, cellSide(cell))
            this.finestLevel = Math.max(this.finestLevel, cell.level)
        }
    }

    addSummary(other: AreaSummary): void {
        if (other.occupiedArea <= 0) return
        this.occupiedArea += other.occupiedArea
        this.elevationArea += other.elevationArea
        other.forEachClass((category, units) => this.updateClass(category, units))
        this.minCellSize = Math.min(this.minCellSize, other.minCellSize)
        this.finestLevel = Math.max(this.finestLevel, other.finestLevel)
    }

    toField(bounds: Bounds): DisplayField | null {
        if (this.occupiedArea <= 0) return null
        const sampleArea = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
        let landClass = Infinity
        let winningUnits = -1n
        this.forEachClass((category, units) => {
            if (units > winningUnits ||
                (units === winningUnits && category < landClass)) {
                landClass = category
                winningUnits = units
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

    private adjust(map: Map<number, bigint>, key: number, delta: bigint): void {
        const next = (map.get(key) ?? 0n) + delta
        // Each removal uses the same geometric contribution as its insertion.
        if (next === 0n) map.delete(key)
        else map.set(key, next)
    }

    updateClass(key: number, delta: bigint): void {
        if (delta === 0n) return
        if (this.multiClasses) {
            this.adjust(this.multiClasses, key, delta)
            if (this.multiClasses.size <= 1) {
                const last = this.multiClasses.entries().next().value as [number, bigint] | undefined
                this.singleClass = last?.[0]
                this.singleClassUnits = last?.[1] ?? 0n
                this.multiClasses = undefined
            }
        } else if (this.singleClass === undefined) {
            this.singleClass = key
            this.singleClassUnits = delta
        } else if (this.singleClass === key) {
            this.singleClassUnits += delta
            if (this.singleClassUnits === 0n) this.singleClass = undefined
        } else {
            this.multiClasses = new Map([[this.singleClass, this.singleClassUnits], [key, delta]])
            this.singleClass = undefined
            this.singleClassUnits = 0n
        }
    }

    private forEachClass(visit: (category: number, units: bigint) => void): void {
        if (this.multiClasses) {
            for (const [category, area] of this.multiClasses) visit(category, area)
        } else if (this.singleClass !== undefined) {
            visit(this.singleClass, this.singleClassUnits)
        }
    }
}
