import BoundingBox2D from '../util/boundingBox2D'

export type PatchContext = {
    nodeInfo: string
    lockId: string
    srcCS: string
    targetCS: string
    bBox: BoundingBox2D
    rules: [number, number][]
}

export type GridContext = {
    nodeInfo: string
    lockId: string
    srcCS: string
    targetCS: string
    bBox: BoundingBox2D
}

export interface StructuredCellRenderVertices {
    tl: Float32Array
    tr: Float32Array
    bl: Float32Array
    br: Float32Array

    tlLow: Float32Array
    trLow: Float32Array
    blLow: Float32Array
    brLow: Float32Array
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

    static async fromPostUrl(url: string, data: any): Promise<MultiCellBaseInfo> {
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

export type MultiBlockCellInfo = {
    bBoxes: Float64Array
    altitudes: Float32Array
    lums: Uint8Array
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
    private _keyHashTable: Uint32Array
    private _storageIdTable: Uint32Array
    private _hashTableSize: number
    private _hashTableMask: number

    constructor(size: number) {
        this._hashTableSize = Math.max(8192, size * 2)
        this._hashTableSize = Math.pow(2, Math.ceil(Math.log2(this._hashTableSize)))
        this._hashTableMask = this._hashTableSize - 1

        this._keyHashTable = new Uint32Array(this._hashTableSize * 2)
        this._storageIdTable = new Uint32Array(this._hashTableSize)
        this._storageIdTable.fill(0xFFFFFFFF)
    }

    private _hash(level: number, globalId: number): number {
        // Simplified version of FNV-1a hash algorithm
        let hash = 2166136261
        hash ^= level
        hash *= 16777619
        hash ^= globalId
        hash *= 16777619
        return (hash >>> 0) & this._hashTableMask // ensure positive value and limit within table size
    }

    private _findSlot(level: number, globalId: number): number {
        let hash = this._hash(level, globalId)

        while (this._storageIdTable[hash] !== 0xFFFFFFFF) {
            const storedLevel = this._keyHashTable[hash * 2]
            const storedGlobalId = this._keyHashTable[hash * 2 + 1]

            if (storedLevel === level && storedGlobalId === globalId) {
                return hash
            }

            hash = (hash + 1) & this._hashTableMask
        }

        return hash
    }

    get(level: number, globalId: number): number | undefined {
        let hash = this._hash(level, globalId)

        while (this._storageIdTable[hash] !== 0xFFFFFFFF) {
            const storedLevel = this._keyHashTable[hash * 2]
            const storedGlobalId = this._keyHashTable[hash * 2 + 1]

            if (storedLevel === level && storedGlobalId === globalId) {
                return this._storageIdTable[hash]
            }

            hash = (hash + 1) & this._hashTableMask
        }

        return undefined
    }

    update(storageId: number, level: number, globalId: number) {
        const slot = this._findSlot(level, globalId)
        this._keyHashTable[slot * 2] = level
        this._keyHashTable[slot * 2 + 1] = globalId
        this._storageIdTable[slot] = storageId
    }

    delete(level: number, globalId: number) {
        let hash = this._hash(level, globalId)

        while (this._storageIdTable[hash] !== 0xFFFFFFFF) {
            const storedLevel = this._keyHashTable[hash * 2]
            const storedGlobalId = this._keyHashTable[hash * 2 + 1]

            if (storedLevel === level && storedGlobalId === globalId) {
                this._storageIdTable[hash] = 0xFFFFFFFF

                let nextHash = (hash + 1) & this._hashTableMask
                while (this._storageIdTable[nextHash] !== 0xFFFFFFFF) {
                    const nextLevel = this._keyHashTable[nextHash * 2]
                    const nextGlobalId = this._keyHashTable[nextHash * 2 + 1]
                    const nextStorageId = this._storageIdTable[nextHash]

                    this._storageIdTable[nextHash] = 0xFFFFFFFF
                    this.update(nextStorageId, nextLevel, nextGlobalId)

                    nextHash = (nextHash + 1) & this._hashTableMask
                }
                break
            }

            hash = (hash + 1) & this._hashTableMask
        }
    }
}


// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function lerp(a: number, b: number, t: number): number {
    return (1.0 - t) * a + t * b;
}

function simplifyFraction(n: number, m: number): [number, number] {
    let a = n,
        b = m;
    while (b !== 0) {
        [a, b] = [b, a % b];
    }

    return [n / a, m / a];
}
