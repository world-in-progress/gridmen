export const ELEVATION_LOW_COLOR: [number, number, number] = [0.16, 0.40, 0.46]
export const ELEVATION_HIGH_COLOR: [number, number, number] = [0.87, 0.76, 0.52]
export const OUTLINE_DARKENING = 0.65

export function elevationColor(value: number, range: [number, number]): [number, number, number] {
    const t = range[0] === range[1] ? 0 : Math.max(0, Math.min(1, (value - range[0]) / (range[1] - range[0])))
    return ELEVATION_LOW_COLOR.map((low, channel) => low + (ELEVATION_HIGH_COLOR[channel] - low) * t) as [number, number, number]
}
