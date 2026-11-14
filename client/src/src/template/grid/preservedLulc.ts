/** Parse comma-separated LULC classes; null means the list is invalid. */
export function parsePreservedLulcClasses(input: string): number[] | null {
    const tokens = input.split(',').map(token => token.trim())
    if (tokens.some(token => !/^-?\d+$/.test(token))) return null
    const classes = tokens.map(Number)
    if (classes.some(value => !Number.isInteger(value) || value < 0 || value > 255)
        || new Set(classes).size !== classes.length) return null
    return classes
}
