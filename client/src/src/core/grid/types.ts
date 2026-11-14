import BoundingBox2D from '../util/boundingBox2D'

export type PatchContext = {
    nodeInfo: string
    lockId: string
    srcCS: string
    targetCS: string
    bBox: BoundingBox2D
    rules: [number, number][]
}

export type MultiCellBaseInfo = {
    levels: Uint8Array
    globalIds: Uint32Array
    deleted?: Uint8Array
}

export type PatchSaveInfo = {
    success: boolean
    message: string
}

export type CellCheckInfo = {
    level: number
    globalId: number
    localId: number
    deleted: boolean
    storageId: number
}

export class MultiCellInfoParser {
    static fromBuffer(buffer: ArrayBuffer): MultiCellBaseInfo {
        if (buffer.byteLength < 4) {
            return {
                levels: new Uint8Array(0),
                globalIds: new Uint32Array(0),
            }
        }

        const prefixView = new DataView(buffer, 0, 4);
        const cellNum = prefixView.getUint32(0, true);
        const alignedOffset = 4 + cellNum + ((4 - (cellNum % 4 || 4)) % 4);

        const levels = new Uint8Array(buffer, 4, cellNum);
        const globalIds = new Uint32Array(buffer, alignedOffset);

        return {
            levels,
            globalIds,
        }
    }

    static toBuffer(cellInfo: MultiCellBaseInfo): ArrayBuffer {
        const cellNum = cellInfo.levels.length;
        const buffer = new ArrayBuffer(4 + cellNum + ((4 - (cellNum % 4 || 4)) % 4) + cellNum * 4);
        const prefixView = new DataView(buffer, 0, 4);
        prefixView.setUint32(0, cellNum, true);
        const levelsView = new Uint8Array(buffer, 4, cellNum);
        levelsView.set(cellInfo.levels);
        const globalIdsView = new Uint32Array(buffer, 4 + cellNum + ((4 - (cellNum % 4 || 4)) % 4), cellNum);
        globalIdsView.set(cellInfo.globalIds);
        return buffer;
    }

    static async fromGetUrl(url: string): Promise<MultiCellBaseInfo> {
        const response = await fetch(url, { method: 'GET' });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        return MultiCellInfoParser.fromBuffer(buffer);
    }

    static async fromPostUrl(url: string, data: unknown): Promise<MultiCellBaseInfo> {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const buffer = await response.arrayBuffer();
            return MultiCellInfoParser.fromBuffer(buffer);

        } catch (error) {
            console.error('Failed to fetch MultiCellInfo:', error);
            throw error;
        }
    }

    static async fromPostUrlByBuffer(url: string, cellInfo: MultiCellBaseInfo): Promise<MultiCellBaseInfo> {
        const buffer = MultiCellInfoParser.toBuffer(cellInfo);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: buffer,
            });

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const resBuffer = await response.arrayBuffer();
            return MultiCellInfoParser.fromBuffer(resBuffer);
        } catch (error) {
            console.error('Failed to post MultiCellInfo:', error);
            throw error;
        }
    }

    static async toPostUrl(url: string, cellInfo: MultiCellBaseInfo): Promise<void> {
        try {
            const buffer = MultiCellInfoParser.toBuffer(cellInfo);
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: buffer,
            });

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
        } catch (error) {
            console.error('Failed to post MultiCellInfo:', error);
            throw error;
        }
    }
}

export type GridBlockMetaInfo = {
    epsg: number
    blockExtents: number[]
}

// export class GridBlockParser {
//     static fromBuffer(buffer: ArrayBuffer): BlockCellInfo {
//         if (buffer.byteLength < 4) {
//             return {
//                 bBoxes: new Float64Array(0),
//                 altitudes: new Float32Array(0),
//                 lums: new Uint8Array(0),
//             }
//         }


//     }
// }

export class CellKeyHashTable {
    private _levels = new Map<number, Map<number, number>>()

    get(level: number, globalId: number): number | undefined {
        return this._levels.get(level)?.get(globalId)
    }

    update(storageId: number, level: number, globalId: number): void {
        let cells = this._levels.get(level)
        if (!cells) {
            cells = new Map<number, number>()
            this._levels.set(level, cells)
        }
        cells.set(globalId, storageId)
    }

    delete(level: number, globalId: number): void {
        const cells = this._levels.get(level)
        cells?.delete(globalId)
        if (cells?.size === 0) this._levels.delete(level)
    }
}
