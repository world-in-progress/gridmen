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

/** Occupied and selected areas, with the extrema required by field rendering. */
export class AreaSummary {
    occupiedArea = 0
    selectedArea = 0
    selectionEpoch = 0
    minCellSize = Infinity
    finestLevel = -Infinity

    constructor(private readonly trackExtrema = true) {}

    clone(): AreaSummary {
        const copy = new AreaSummary(this.trackExtrema)
        copy.occupiedArea = this.occupiedArea
        copy.selectedArea = this.selectedArea
        copy.selectionEpoch = this.selectionEpoch
        copy.minCellSize = this.minCellSize
        copy.finestLevel = this.finestLevel
        return copy
    }

    addCell(cell: DisplayCell, area: number, sign: 1 | -1, selected = false): void {
        if (area <= 0) return
        const signedArea = area * sign
        this.occupiedArea += signedArea
        if (selected) this.selectedArea += signedArea
        if (this.trackExtrema && sign === 1) {
            this.minCellSize = Math.min(this.minCellSize, cellSide(cell))
            this.finestLevel = Math.max(this.finestLevel, cell.level)
        }
    }

    addSummary(other: AreaSummary): void {
        if (other.occupiedArea <= 0) return
        this.occupiedArea += other.occupiedArea
        this.selectedArea += other.selectedArea
        this.minCellSize = Math.min(this.minCellSize, other.minCellSize)
        this.finestLevel = Math.max(this.finestLevel, other.finestLevel)
    }

    toField(bounds: Bounds): DisplayField | null {
        if (this.occupiedArea <= 0) return null
        const sampleArea = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
        return {
            bounds,
            occupiedFraction: Math.min(1, Math.max(0, this.occupiedArea / sampleArea)),
            minCellSize: this.minCellSize,
            level: this.finestLevel,
            elevation: 0,
            landClass: 0,
        }
    }
}
