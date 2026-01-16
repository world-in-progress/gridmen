import proj4 from 'proj4'
import * as apis from '../../template/api/apis'
import type { Converter } from 'proj4/dist/lib/core'
import { MercatorCoordinate } from '../math/mercatorCoordinate'
import { PatchContext, StructuredCellRenderVertices } from './types'

interface PatchLevelInfo {
    width: number
    height: number
}

export default class PatchManager {
    private _context: PatchContext
    private _centerX!: Float32Array
    private _centerY!: Float32Array
    private _projConverter!: Converter
    private _levelInfos: PatchLevelInfo[]

    constructor(context: PatchContext) {
        this._levelInfos = [{ width: 1, height: 1 }]

        this._context = context
        this._context.rules.forEach((_, level, rules) => {
            let width: number, height: number
            if (level == 0) {
                width = 1
                height = 1
            } else {
                width = this._levelInfos[level - 1].width * rules[level - 1][0]
                height =
                    this._levelInfos[level - 1].height * rules[level - 1][1]
            }
            this._levelInfos[level] = { width, height }
        })
    }

    async init(): Promise<void> {
        // Get src EPSG code (number type)
        const srcEPSG: number = parseInt(this._context.srcCS.split(':')[1])

        // Update proj4 definitions
        const proj4Defs = await apis.proj.getProj4Defs(srcEPSG)
        proj4.defs(this._context.srcCS, proj4Defs)

        // Define projection converter
        this._projConverter = proj4(
            this._context.srcCS,
            this._context.targetCS
        )

        // Define center point
        const center: [number, number] = [
            (this._context.bBox.xMin + this._context.bBox.xMax) / 2.0,
            (this._context.bBox.yMin + this._context.bBox.yMax) / 2.0,
        ]
        const relativeCenter: [number, number] = this._projConverter.forward(center)
        const mercatorCenter = MercatorCoordinate.fromLonLat(relativeCenter)
        this._centerX = encodeFloatToDouble(mercatorCenter[0])
        this._centerY = encodeFloatToDouble(mercatorCenter[1])
    }

    // Not used (but kept for later use if necessary)
    set context(context: PatchContext) {
        // Update projection converter
        // Caution: proj4.defs should be set before this
        this._projConverter = proj4(context.srcCS, context.targetCS)

        // Update subdivide rules first
        this._context = context

        // Update level infos then
        this._levelInfos = [{ width: 1, height: 1 }];
        this._context.rules.forEach((_, level, rules) => {
            let width: number, height: number;
            if (level == 0) {
                width = 1;
                height = 1;
            } else {
                width = this._levelInfos[level - 1].width * rules[level - 1][0];
                height =
                    this._levelInfos[level - 1].height * rules[level - 1][1];
            }
            this._levelInfos[level] = { width, height };
        });
    }

    createCellRenderVertices(
        level: number,
        globalId: number,
        vertices: Float32Array,
        verticesLow: Float32Array
    ) {
        const bBox = this._context.bBox
        const { width, height } = this._levelInfos[level]

        const globalU = globalId % width
        const globalV = Math.floor(globalId / width)

        const xMin = lerp(bBox.xMin, bBox.xMax, globalU / width)
        const yMin = lerp(bBox.yMin, bBox.yMax, globalV / height)
        const xMax = lerp(bBox.xMin, bBox.xMax, (globalU + 1) / width)
        const yMax = lerp(bBox.yMin, bBox.yMax, (globalV + 1) / height)

        const targetCoords = [
            this._projConverter.forward([xMin, yMax]), // srcTL
            this._projConverter.forward([xMax, yMax]), // srcTR
            this._projConverter.forward([xMin, yMin]), // srcBL
            this._projConverter.forward([xMax, yMin]), // srcBR
        ]
        
        targetCoords.forEach((coord, index) => {
            const mercatorCoord = MercatorCoordinate.fromLonLat(coord as [number, number])
            const mercatorCoordX = encodeFloatToDouble(mercatorCoord[0])
            const mercatorCoordY = encodeFloatToDouble(mercatorCoord[1])
            vertices[index * 2 + 0] = mercatorCoordX[0] - this._centerX[0]
            verticesLow[index * 2 + 0] = mercatorCoordX[1] - this._centerX[1]
            vertices[index * 2 + 1] = mercatorCoordY[0] - this._centerY[0]
            verticesLow[index * 2 + 1] = mercatorCoordY[1] - this._centerY[1]
        })
    }

    createStructuredCellRenderVertices(
        levels: number[] | Uint8Array,
        globalIds: number[] | Uint32Array
    ): StructuredCellRenderVertices {
        const cellNum = levels.length
        const tlBuffer = new Float32Array(cellNum * 2)
        const trBuffer = new Float32Array(cellNum * 2)
        const blBuffer = new Float32Array(cellNum * 2)
        const brBuffer = new Float32Array(cellNum * 2)
        const tlBufferLow = new Float32Array(cellNum * 2)
        const trBufferLow = new Float32Array(cellNum * 2)
        const blBufferLow = new Float32Array(cellNum * 2)
        const brBufferLow = new Float32Array(cellNum * 2)

        // Temporary buffers
        const vertices = new Float32Array(8)
        const verticesLow = new Float32Array(8)

        for (let i = 0; i < cellNum; i++) {
            const level = levels[i]
            const globalId = globalIds[i]
            this.createCellRenderVertices(level, globalId, vertices, verticesLow)
            tlBuffer[i * 2 + 0] = vertices[0]
            tlBuffer[i * 2 + 1] = vertices[1]
            trBuffer[i * 2 + 0] = vertices[2]
            trBuffer[i * 2 + 1] = vertices[3]
            blBuffer[i * 2 + 0] = vertices[4]
            blBuffer[i * 2 + 1] = vertices[5]
            brBuffer[i * 2 + 0] = vertices[6]
            brBuffer[i * 2 + 1] = vertices[7]

            tlBufferLow[i * 2 + 0] = verticesLow[0]
            tlBufferLow[i * 2 + 1] = verticesLow[1]
            trBufferLow[i * 2 + 0] = verticesLow[2]
            trBufferLow[i * 2 + 1] = verticesLow[3]
            blBufferLow[i * 2 + 0] = verticesLow[4]
            blBufferLow[i * 2 + 1] = verticesLow[5]
            brBufferLow[i * 2 + 0] = verticesLow[6]
            brBufferLow[i * 2 + 1] = verticesLow[7]
        }

        return {
            tl: tlBuffer,
            tr: trBuffer,
            bl: blBuffer,
            br: brBuffer,
            tlLow: tlBufferLow,
            trLow: trBufferLow,
            blLow: blBufferLow,
            brLow: brBufferLow
        }
    }

    createBlockCellRenderVertices(
        xMin: number, yMin: number,
        xMax: number, yMax: number,
        vertices: Float32Array,
        verticesLow: Float32Array
    ) {
        const targetCoords = [
            this._projConverter.forward([xMin, yMax]), // srcTL
            this._projConverter.forward([xMax, yMax]), // srcTR
            this._projConverter.forward([xMin, yMin]), // srcBL
            this._projConverter.forward([xMax, yMin]), // srcBR
        ]
        
        targetCoords.forEach((coord, index) => {
            const mercatorCoord = MercatorCoordinate.fromLonLat(coord as [number, number])
            const mercatorCoordX = encodeFloatToDouble(mercatorCoord[0])
            const mercatorCoordY = encodeFloatToDouble(mercatorCoord[1])
            vertices[index * 2 + 0] = mercatorCoordX[0] - this._centerX[0]
            verticesLow[index * 2 + 0] = mercatorCoordX[1] - this._centerX[1]
            vertices[index * 2 + 1] = mercatorCoordY[0] - this._centerY[0]
            verticesLow[index * 2 + 1] = mercatorCoordY[1] - this._centerY[1]
        })
    }

    createStructuredBlockRenderVertices(
        bBoxes: Float64Array
    ): StructuredCellRenderVertices {
        const cellNum = bBoxes.length / 4   // bBox: xMin, yMin, xMax, yMax
        const tlBuffer = new Float32Array(cellNum * 2)
        const trBuffer = new Float32Array(cellNum * 2)
        const blBuffer = new Float32Array(cellNum * 2)
        const brBuffer = new Float32Array(cellNum * 2)
        const tlBufferLow = new Float32Array(cellNum * 2)
        const trBufferLow = new Float32Array(cellNum * 2)
        const blBufferLow = new Float32Array(cellNum * 2)
        const brBufferLow = new Float32Array(cellNum * 2)

        // Temporary buffers
        const vertices = new Float32Array(8)
        const verticesLow = new Float32Array(8)

        for (let i = 0; i < cellNum; i++) {
            const [ xMin, yMin, xMax, yMax ] = bBoxes.slice(i * 4, i * 4 + 4)
            this.createBlockCellRenderVertices(xMin, yMin, xMax, yMax, vertices, verticesLow)
            tlBuffer[i * 2 + 0] = vertices[0]
            tlBuffer[i * 2 + 1] = vertices[1]
            trBuffer[i * 2 + 0] = vertices[2]
            trBuffer[i * 2 + 1] = vertices[3]
            blBuffer[i * 2 + 0] = vertices[4]
            blBuffer[i * 2 + 1] = vertices[5]
            brBuffer[i * 2 + 0] = vertices[6]
            brBuffer[i * 2 + 1] = vertices[7]

            tlBufferLow[i * 2 + 0] = verticesLow[0]
            tlBufferLow[i * 2 + 1] = verticesLow[1]
            trBufferLow[i * 2 + 0] = verticesLow[2]
            trBufferLow[i * 2 + 1] = verticesLow[3]
            blBufferLow[i * 2 + 0] = verticesLow[4]
            blBufferLow[i * 2 + 1] = verticesLow[5]
            brBufferLow[i * 2 + 0] = verticesLow[6]
            brBufferLow[i * 2 + 1] = verticesLow[7]
        }

        return {
            tl: tlBuffer,
            tr: trBuffer,
            bl: blBuffer,
            br: brBuffer,
            tlLow: tlBufferLow,
            trLow: trBufferLow,
            blLow: blBufferLow,
            brLow: brBufferLow
        }
    }
}

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function lerp(a: number, b: number, t: number): number {
    return a + t * (b - a)
}

function encodeFloatToDouble(value: number) {
    const result = new Float32Array(2)
    result[0] = value

    const delta = value - result[0]
    result[1] = delta
    return result
}